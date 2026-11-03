# FFTT3 — Staff & Access implementation, November 3, 2026

Status: Source implementation only in draft PR #44. NOT deployed or authorized for hosted activation. Based on draft PR #22's development branch.

## Approved user experience

- One full-width People card with search, People/By event toggle and Add Staff.
- Event assignment uses a custom checkbox dropdown, with one event as the default and additional events optional.
- One Role dropdown (Scorekeeper, Bracket Manager, Organizer) applies the selected role to all checked events upon Save.
- Unchecking an event and clicking Save revokes only that event's access. A small X at the right of a row removes the person from the staff directory after confirmation and revokes their active grants; historical event records and the Auth identity are preserved.
- Mobile: identity and verification status together, full-width event dropdown, Role + Save + X grouped below. Preserve the desktop layout.

## Authentication and directory service

- Existing Supabase email/password authentication and event-scoped grant RPCs remain authoritative.
- New Staff-only POST /api/staff-directory is fail-closed until an Organizer has deliberately configured server-only SUPABASE_ADMIN_SECRET on a vetted Staff host. Never expose it in a browser, GitHub, the public Spectator origin, or static Staff files.
- Before any admin action the Function verifies an authenticated Supabase user, that user's Organizer role on the requested event, and platform-Organizer privilege using the authoritative event list. Non-Organizer users, arbitrary origins and requests without valid sessions are rejected.
- The directory uses privileged Auth app_metadata for display names and visibility flags, NEVER for deciding access; Auth email confirmation is required before granting an event role. Existing accounts are reused, and user accounts are not deleted.
- An invitation requests the Supabase Auth admin Invite flow, directed to the Staff-only app/staff-invite.html callback. The callback handles implicit-flow tokens only in memory, strips the URL fragment promptly, and lets the invited volunteer set a password without public self-signup.
- STAFF_INVITE_REDIRECT_ENABLED=true must NOT be set until the exact callback URL has been allowlisted in Supabase Auth, its invite email template verified, and a staging invitation successfully checked with an independently controlled test identity. Supabase Free email limits may affect delivery.
- The directory currently inspects up to ten admin-user pages and returns at most 200 accounts. A future large multi-tenant system would need indexed server-side directory storage.

## Event grants, safety and failure reporting

- Organizer event snapshots for **non-archived** events are merged. Archived event staff remain historical and are not part of active access removal. A failed in-scope snapshot blocks changes rather than silently treating an inaccessible event as having no grants.
- Saving uses separate fftt_set_staff_v3 RPCs under the signed-in Organizer's own token. Each event permission is checked by the backend. Removing one event leaves other checked grants intact.
- Several event grant calls cannot be fully atomic with the current RPC API. Failed or uncertain operations never trigger automatic retries, and the UI reloads the server's actual state. A true atomic bulk RPC can be added later with SQL review.
- Directory removal first revokes each currently active event grant, then archives the staff member from the directory. It must never delete an Auth user or historical score/audit rows.
- No real FFTT3, rehearsal event, Supabase project, Auth account, registration, player check-in, bracket, publication, secret, domain or production deployment was modified by the source PR.

## Required gates before staging or production

1. Run the new isolated tests/fftt3_staff_directory.test.mjs together with Bracket Manager, authenticated-roles, Staff browser and Staff-vs-Spectator export checks.
2. Inspect integrated Staff desktop and mobile widths, iPhone Safari dropdown, focus/keyboard operation and event-change confirmation. The earlier approved standalone prototype is visual reference only.
3. Only with explicit approval, configure secret and callback on a dedicated staging Staff origin. Test owner-only add, invite arrival, password setup, confirmed sign-in, existing account reuse, invalid token/origin, multi-event role changes, single-event removal and directory X removal.
4. Preserve existing PR #22 draft state. No merge/deploy to production or individual account/grant creation without subsequent authorization and identity verification.

Known limitation: Add Staff and directory removal require the protected backend, so they stay unavailable on unconfigured hosts. This must never be disguised as a successful account creation. Staff account invitations still need to be received and completed by each person before event access works.
