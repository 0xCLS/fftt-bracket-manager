# FFTT3 — Staff & Access implementation, November 3, 2026

Status (November 3): PR #44 was integrated into the production-compatible PR #22 feature branch as merge `2bde67269b734bb4fb0735fe5b797d305486beab`. Exact PR #44 head `e1e5bab26425789d92fabae40e0f086a300192e3` passed full GitHub CI run `41692239176`. The first, fail-closed Staff-only production stage was deployed as recorded below; no individual staff grants were authorized or changed. PR #22 remains draft/unmerged to `main`.

## November 3 first-stage production release — protected activation pending

- Staff-only production deployed from exact source `9686ce23e5422f12b1ff0e1757046e207e7cf9e3` as Cloudflare deployment `f6b1ed25-c466-4e37-a67a-d7ca825e0f53`. Previous good rollback deployment `2430fcd7-ab32-465d-b02b-cb8ec7965c18` (source `3a37976e3b31320ab79b7943aec92ba833dfd50e`). Source differs from CI-tested PR #44 tree only in this documentation.
- The sanitized export includes People and the invitation callback. Both `registrations` and `staff-directory` Pages Functions and dependencies compiled and deployed from the clean source. All 39 served asset hashes, live manifest, security headers, private-path denials, callback route and existing registration GET 405 / token-less POST 401 passed; Staff sign-in controls initialized without credentials. Staff directory returned fail-closed 503 `not-configured` and its server source paths returned 404. Spectator manifest and homepage bytes matched pre-release baselines; Spectator directory POST returned 405.
- Focused fictional tests: 13/13 directory unit checks and the phone/tablet/desktop Organizer UI and accessibility audit passed. These do not establish authenticated production acceptance.
- **Pending activation:** `SUPABASE_ADMIN_SECRET` was not available or installed; the connected Supabase account exposed only an unrelated project. The FFTT Auth callback allowlist, invite template and public-signup setting could not be verified. `STAFF_INVITE_REDIRECT_ENABLED` remains unset; invitation delivery, password setup, independently controlled identity and event grant/revoke/removal testing remain unverified. Existing Organizer sign-in and Google registration access were not exercised with credentials. Do not enable invitations until the exact FFTT project, redirect, template, protected endpoint and controlled identity are verified. No staging environment was created.
- The People screen can show existing event access from authorized snapshots but account invitations and directory removal remain unavailable while the protected service is unconfigured. No real account, grant, tournament record or registration was modified. PR #22 remains draft/unmerged.

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

## November 3 rollout decision — existing production Staff host, controlled activation

The Organizer explicitly approved a direct, **Staff-only production rollout** rather than creating another isolated staging environment. This supersedes the earlier staging-first preference for this Staff-directory feature, but does not waive credential handling, live-domain verification, exact-head testing, or individual account-grant approval.

- **Production baseline observed November 3:** `https://fftt-staff.clslifestyle.com/MANIFEST.json` still served source `3a37976e3b31320ab79b7943aec92ba833dfd50e` (target `staff`, environment `production`) after PR #44's feature-branch merge. New Staff directory code was **not yet live** at that observation. Preserve the documented current production rollback deployment and verify it again just before rollout.
- **Release integration:** Build from a clean, fixed PR #22 feature-branch commit after its exact-head checks. Follow the existing Staff-only manual release procedure. The `tools/staging/build_export.py --target staff` output is a **static export**, not an entire Pages Function deployment: explicitly include the reviewed Staff Pages Functions, **both** `/api/registrations` and new `/api/staff-directory`, with their required source dependencies in the isolated `fftt-staff` deployment bundle. Do not upload either Function or privileged dependencies to `fftt-games` or `fftt-public`. Preserve existing registration secrets/mode/allowlist; do not replace the Staff Pages project configuration with a new empty one.
- **Private configuration:** On the existing production `fftt-staff` project only, set `SUPABASE_ADMIN_SECRET` as a **server secret** held by the authorized local Cloudflare/Supabase operator. Set `STAFF_ORIGIN=https://fftt-staff.clslifestyle.com`. First allowlist and verify exactly `https://fftt-staff.clslifestyle.com/app/staff-invite.html` in the **existing FFTT Supabase project's Auth Redirect URLs**, without changing its Site URL, disabling existing callbacks or enabling public signup. Keep `STAFF_INVITE_REDIRECT_ENABLED` false/unset until the redirect and invitation email are verified. Never reveal secret values in GitHub, logs, chat, browser assets, or test reports.
- **Two safe rollout stages on the same production host:** (1) ship and verify static People UI and the protected Function with invitations still disabled; test signed-out/cross-origin/scorekeeper requests fail as expected and existing Google registration continues working; (2) with the Organizer's independently controlled test email identity and an explicitly verified Auth redirect, enable invitations and privately test email arrival, password creation, sign-in, per-event grant/revoke, directory × removal and audit preservation. Do not grant a real volunteer or alter the November 22 event as an implicit test.
- **Acceptance/rollback:** Confirm production manifest source and every asset hash, exact origin/security headers, the two Staff Function endpoints, unchanged spectator/homepage/staging projects and unchanged live FFTT3 registrations/attendance/brackets/scores. Preserve the previous good Staff deployment for rollback. If the invite email or Function fails, revert only the new feature/release path, not the real tournament data or pre-existing registration service.
- **Execution environment status:** This ChatGPT connection can merge and edit GitHub but currently exposes only an unrelated WorshipFold Supabase project and no authenticated Cloudflare administrative deployment connection. Therefore this direct-production rollout requires the established authorized local CLI or a newly connected Cloudflare/Supabase administrative session. A repository merge or public-host read alone is not evidence of a completed deployment.

## Required gates before staging or production

1. Run the new isolated tests/fftt3_staff_directory.test.mjs together with Bracket Manager, authenticated-roles, Staff browser and Staff-vs-Spectator export checks.
2. Inspect integrated Staff desktop and mobile widths, iPhone Safari dropdown, focus/keyboard operation and event-change confirmation. The earlier approved standalone prototype is visual reference only.
3. Only with explicit approval, configure secret and callback on a dedicated staging Staff origin. Test owner-only add, invite arrival, password setup, confirmed sign-in, existing account reuse, invalid token/origin, multi-event role changes, single-event removal and directory X removal.
4. Preserve existing PR #22 draft state. No merge/deploy to production or individual account/grant creation without subsequent authorization and identity verification.

Known limitation: Add Staff and directory removal require the protected backend, so they stay unavailable on unconfigured hosts. This must never be disguised as a successful account creation. Staff account invitations still need to be received and completed by each person before event access works.

## Replacement invitation for an expired link (bounded resend)

Supabase invitation links last **one hour** (`mailer_otp_exp = 3600` on the hosted project; not changed by this work). **Add Staff** on an existing person now sends one replacement invitation to the *same* Auth identity instead of silently doing nothing.

**Who can be re-invited.** Only an existing identity that is (a) tagged as an FFTT Staff directory member, (b) was created by an invitation (Auth records `invited_at` only through its invite endpoint, so this cannot be forged by the Organizer's request), (c) has never confirmed its email and (d) is not banned. Unrelated Auth users, confirmed, banned and archived identities are never messaged. Eligibility is judged on the state *before* the request, so tagging an unrelated account in one call does not make it eligible in the next.

**What it never does.** It does not create, delete, confirm, re-address or reset the account, does not write a password, does not grant or change any event role, and builds the callback only from the pinned Staff origin (`/app/staff-invite.html`). Hosted Auth settings are not changed.

**Duplicate-send safeguards (bounded, not exactly-once).**
- Auth's own `confirmation_sent_at` is the durable record. A resend inside **10 minutes** of the last send is refused (`recently-sent`) because a new message also invalidates the previous link. Auth's own 60 second per-user email throttle remains a second layer.
- One resend per email at a time per Function instance, and a fresh read of the account after taking that lock, so a request holding a stale account list cannot duplicate a send that just finished.
- If the invite call fails or gives no answer, the account's send time is re-read: changed means Auth issued a message (reported as sent); unchanged means nothing was sent and a retry is safe; if even that cannot be read the result is reported as **uncertain** and further resends from that instance are blocked for 10 minutes. There is no automatic retry.

**Limits that remain.** Without new infrastructure there is no cross-instance lock: two requests handled by *different* Function instances at the very same instant could both pass the checks, and only Auth's 60 second throttle would stop the second one if it arrives after the first is recorded. "Sent" means the Auth service issued a message; it does not prove delivery, that the person opened it, or that they accepted. Acceptance is established only by the person's own password setup and sign-in. The Organizer-facing messages for each outcome are in `app/view_staff_people.mjs`.

**Tests.** `tests/fftt3_staff_directory.test.mjs` (pending staff identity, unrelated, confirmed, banned and archived identities, repeats, concurrent requests, stale list, uncertain results, no creation or grant, pinned callback); `tests/e2e/staff_invite_page.test.mjs`; and `tests/staff_invite_resend_local_auth.mjs`, which runs the whole flow against a real disposable local GoTrue with fictional accounts.
