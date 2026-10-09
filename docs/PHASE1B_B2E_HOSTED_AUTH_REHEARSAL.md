# Phase 1B B2e — Hosted synthetic Auth rehearsal

**Environment:** Supabase Free `fftt-bracket-manager-dev`, project ref `copmkalfkkrkzheohwuc`. This is **not** FFTT3 or any real event. Do not migrate real participants, authorize volunteers, or connect the GitHub Pages application.

**Status (October 9, 2026 — synthetic organizer and administrator-approved scorekeepers assigned):** Hosted Supabase holds four confirmed development Auth identities. The existing development account was explicitly approved as organizer and received the initial grant in a one-time, guarded, trusted bootstrap. The organizer subsequently explicitly approved **administrator-controlled** role assignments for the two existing Yahoo scorekeeper test accounts. A single trusted `postgres` transaction assigned exactly **two active event-scoped scorekeeper grants** with `granted_by=NULL`, created two immutable `staff_grant_changed` audit rows with `actor_id=NULL` and explicit trusted-administrator reasons, and incremented the event revision **from 0 to 2**. Independent checks confirm exactly one organizer, two scorekeepers, **no outsider grant**, zero players/matches/public results, and no direct private staff table grants to `anon` or `authenticated`. This **did not test the signed-in organizer grant RPC**; `tests/b2e_hosted_grant_staff.py` has **not run against hosted Auth**. The three Yahoo test accounts' passwords have not been reset and remain unavailable to the organizer. No production data, FFTT3 registration, hosted GitHub Pages UI or Auth settings were changed.

## Approved method and gate checklist

1. **Identity plan (organizer approved October 9, 2026):** Use four distinct test-only aliases/inboxes owned by the organizer: one organizer, two scorekeepers, and one unassigned outsider. Never use players/volunteers or unrelated personal addresses. Create and store a strong unique password per test account privately in a password manager, never in ChatGPT, GitHub, screenshots or CI logs. Distinct role-labeled aliases such as `+fftt-b2e-organizer`, `+fftt-b2e-score-a`, `+fftt-b2e-score-b`, and `+fftt-b2e-outsider` are recommended **only if the provider supports them**.
2. **Account creation via Supabase Auth administration:** In the exact Free dev project's **Authentication → Users → Add user → Create new user**, enter each of the four role-labeled controlled aliases and a **different** strong password. For this synthetic-only rehearsal, use the per-user **Auto Confirm User** option *if it is shown*, after confirming control of each alias; this creates administratively confirmed users without sending emails. **Do not disable project-wide Confirm Email or open public signups.** If the UI lacks this option, stop and review rather than guessing. Alternatively use **Send invitation** with real inbox confirmation only if email delivery is configured. **Default Supabase SMTP delivers only to addresses authorized on the project team**, so unrelated plus aliases ordinarily cannot receive invite/confirmation messages without custom SMTP. Never insert into `auth.users` with raw SQL, paste secrets into chat, or put privileged service-role keys in the browser. **Administrative confirmation records `email_confirmed_at` but is not proof that an email link was opened**; it is a constrained B2e synthetic test exception, not the intended production volunteer onboarding method.
3. **Trusted first organizer bootstrap — COMPLETE (October 9, 2026):** With explicit organizer approval, the single confirmed preexisting development Auth account was resolved to its UUID and the guarded `docs/B2E_TRUSTED_BOOTSTRAP_TEMPLATE.sql` was executed as `postgres` with **only its organizer UUID placeholder changed**. Post-write SQL independently verified exactly one active synthetic-only event dated `2099-01-01`, exactly one approved organizer grant, and no other grants, players, matches or publication. **Do not rerun** the template; its zero-event guard will refuse duplicate execution. The new event UUID is retained in the private maintenance log and must not be confused with the FFTT3 date or identifier.
4. **Trusted administrator-controlled synthetic scorekeeper assignments — COMPLETE October 9; authenticated organizer grant RPC still PENDING:** With the organizer's explicit approval, a transaction locked the single synthetic-only rehearsal event dated 2099-01-01, verified exactly one approved organizer, no other staff, and two eligible, confirmed target test accounts; then inserted the two event-scoped scorekeeper grants. Each was transparently attributed to a trusted administrator (`granted_by=NULL`, immutable audit `actor_id=NULL`, reason explicitly distinguishing this from the organizer RPC), and individually advanced the revision to 1 and 2. The outsider remains unassigned. **Do not call this a signed-in organizer grant test.** The original `tests/b2e_hosted_grant_staff.py` requires real confirmed organizer and scorekeeper sessions and explicit `FFTT_B2E_APPROVE_STAFF_GRANTS=YES_SYNTHETIC_HOSTED_ONLY`; it was **not executed on hosted**. If later testing the real grant/revoke workflow, review its effects on these already-present grants first and authorize any state changes separately.
5. **Read-only real hosted Auth verification:** Run `tests/b2e_hosted_auth_probe.py` after grants are established. It authenticates each user through the real hosted Auth server, verifies the four independently signed accounts, checks roles, outsider/anonymous denial, private staff-schema denial and matchdesk field restrictions. Deliberately **does not call any grant/revoke/score mutation endpoint**; unauthorized grants/revocations are covered by isolated CI. The probe performs **no score/staff mutations**.
6. **Evidence + next gate:** Inspect the private counts, audit records, RLS/API grants and Supabase security advisor via the connected tool. Capture pass/fail and dated commit in the private changelog without recording identities, emails, secrets or signed tokens. A **separate, explicitly approved** fixture and an event-day-compatible remote score concurrency/recovery test will follow. Never treat successful local CI alone as a hosted signed-Auth pass.


### Hosted SQL-context authorization preflight — October 9, 2026 (read-only, PASS)

The isolated hosted database was tested directly in independent **read-only PostgreSQL transactions**. Each allowed-role test used `SET LOCAL ROLE authenticated` plus a temporary `request.jwt.claims` session value representing one of the *already-confirmed, preexisting synthetic* identities, then called the actual hosted `public.fftt_staff_role_v1` and `public.fftt_matchdesk_v1` functions. Those SQL session values are **simulated claims, NOT a cryptographically signed Supabase JWT**; these results do **not** validate GoTrue login, PostgREST JWT verification, cross-device sessions, or HTTP API behavior.

| Check | Observed hosted database result |
| --- | --- |
| Approved organizer role | `organizer` returned |
| Both assigned scorekeeper roles | `scorekeeper` returned individually |
| Organizer and each scorekeeper matchdesk | Allowed; zero matches, as fixture is empty |
| Unassigned outsider role and matchdesk | Each rejected `42501 forbidden` |
| Organizer querying a different event UUID | Rejected `42501 forbidden` |
| Authenticated database context lacking JWT claims | Rejected `42501 forbidden` |
| SQL role `anon` invoking role RPC | Rejected `42501 permission denied for function` |
| SQL role `authenticated` reading private staff table | Rejected `42501 permission denied for table` |
| SQL role `anon` public results projection | Allowed; zero public events/matches |
| Matchdesk return-field inspection | Only 14 allowlisted match fields; no emails, phone numbers, ratings, audit or private staffing fields |
| SQL grants/RPC privileges | Anonymous staff/matchdesk/grant RPC execution denied; authenticated has no direct private staff SELECT/INSERT |
| Data mutation | None: tests performed no score, role, event, account, or schema writes |

The Supabase security advisor remained at **nine expected INFO** `rls_enabled_no_policy` findings on inaccessible private tables and **one WARN** `auth_leaked_password_protection` (not enabled in the Free prototype). This confirms useful hosted SQL privilege behavior **but not the full B2e hosted signed-Auth acceptance gate**. That gate still requires genuine signed credentials for the four controlled accounts and remains pending; no password recovery, Auth settings, external services, or production cutover was authorized by this preflight.

### Source conflict / resolution — synthetic administrative grants versus signed-in organizer grants

The initial B2e procedure required staff grants through a genuine authenticated organizer session. The organizer subsequently requested progression **without resetting passwords** and explicitly approved an alternative, **administrator-controlled synthetic-only assignment** for the two identified scorekeepers. The role assignments have been applied with explicit audit provenance. This is valid fixture setup for inspecting database role state but is **not an authenticated user-access integration test** and does **not** establish that the production organizer workflow succeeds. Retain the original signed-Auth probes and scorekeeper-grant script as **pending**, and never silently reinterpret administrative fixture setup as their passing result.

### Source conflict / resolution — Hosted email confirmation on Free

The initial B2e runbook assumed arbitrary test aliases could receive ordinary Supabase invitations. Current Supabase Auth SMTP documentation states the built-in mailer can deliver only to project-team addresses; organizer-owned plus aliases generally do **not** qualify. Because the user has authorized synthetic alias-based testing, B2e instead prefers dashboard-created users with per-user **Auto Confirm User** (when available). That is a trusted administrative confirmation of controlled *test-only* addresses, **not** mailbox-proof verification. We must not change project-wide email-confirmation settings, enable broad signup, configure paid/custom SMTP, or apply this exception to production accounts. Sources: https://supabase.com/docs/guides/auth/auth-smtp and https://supabase.com/docs/reference/javascript/auth-admin-createuser.


### Source conflict / resolution — test account password access (October 9, 2026)

Supabase's dashboard only exposes email-based password recovery and magic-link buttons for these accounts. Earlier advice to delete/recreate test accounts is **superseded** by the documented, server-only Auth Admin API `updateUserById(uid,{password})`; deleting users would unnecessarily invalidate their IDs. A strictly scoped **one-time local Mac repair helper** has been packaged for the organizer to run on a trusted personal machine; it requires a modern `sb_secret_` key via a hidden prompt and **never sends that secret through ChatGPT**. The helper preserves all Auth user IDs, touches only the three listed test aliases, saves generated passwords to a permissions-0600 file in the organizer's Downloads folder *before* any write, uses HTTPS official Admin endpoints, and tests each new password using the project's public publishable key. It includes no delete method, and five no-network guards passed.

**Not yet executed** — no server-side key has been provided to ChatGPT or stored in GitHub, and no hosted passwords have yet been reset. See Supabase docs https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid and https://supabase.com/docs/guides/getting-started/api-keys. Do not use this for real volunteer accounts or production.

## Local invocation — placeholders only, do not paste secrets into this repository

The Python scripts are standard-library only, need network connectivity and should run on an organizer-controlled computer (not GitHub-hosted CI). Set environment variables privately through your shell or secret manager:

| Variable | Required value |
|---|---|
| `FFTT_B2E_URL` | `https://copmkalfkkrkzheohwuc.supabase.co` (may be omitted; default is pinned) |
| `FFTT_B2E_PUBLISHABLE_KEY` | The project's `sb_publishable_...` **public** key from Supabase; **not** a secret, service-role key, or legacy JWT key |
| `FFTT_B2E_EVENT_ID` | Newly created synthetic rehearsal event UUID |
| `FFTT_B2E_ORGANIZER_EMAIL` / `_PASSWORD` | Test-only organizer confirmed credentials |
| `FFTT_B2E_SCOREKEEPER_A_EMAIL` / `_PASSWORD` | First controlled test scorekeeper |
| `FFTT_B2E_SCOREKEEPER_B_EMAIL` / `_PASSWORD` | Second controlled test scorekeeper |
| `FFTT_B2E_OUTSIDER_EMAIL` / `_PASSWORD` | Fourth controlled, **unassigned** test account |
| `FFTT_B2E_APPROVE_STAFF_GRANTS` | The exact explicit flag `YES_SYNTHETIC_HOSTED_ONLY`, **only** when authorizing grant writes |

Run, from the repository root, after privately configuring the environment:

```sh
# MUTATES hosted synthetic staff grants — only with explicit authorization flag:
python3 tests/b2e_hosted_grant_staff.py

# Read-only; does not modify match, staff, user or event data:
python3 tests/b2e_hosted_auth_probe.py
```

Never run scripts while screen-sharing credentials, collect passwords in chat, or paste tokens into documentation. The scripts print verdicts only, not emails/passwords/tokens. Auth sign-in itself does create ordinary Auth sessions.

## Acceptance matrix

| Scenario | B2e required outcome |
|---|---|
| Hosted Auth verification | Four test-only organizer-controlled identities can sign in with either administratively confirmed synthetic emails or actually inbox-confirmed emails; document which method was used |
| Initial access | **Hosted database PASS:** the single trusted bootstrap-created organizer is the only active staff grant. Signed-Auth access still untested |
| Grant authorization | **Hosted admin fixture PASS:** two explicitly approved scorekeeper records, outsider absent, two immutable admin audit rows; **signed-in organizer RPC still UNTESTED** |
| Privacy | No contact/rating/staff/audit access through the public browser |
| Cross-event isolation | Staff grant is usable only for the designated synthetic event |
| Test account revocation | Remains to be tested in a later **write-authorized** hosted integration gate |
| Two-client hosted score conflict | **Deferred** until separate score fixture approval |
| Auth/account recovery | **Deferred**; no real volunteer onboarding |
| Hosted integration pass | Do not claim until the real hosted smoke test runs successfully |

## Source and safety notes

- Application B2d draft [PR #6](https://github.com/0xCLS/fftt-bracket-manager/pull/6) and dependencies (#5, #4, #3, #2) remain unmerged pending reconciliation with independent `main` UI updates.
- This rehearsal must never share the FFTT3 event folder or live registration sheet. The public GitHub Pages application remains localStorage/JSON-backup based; cloud mode is disabled.
- Because hosted migration versions were generated through the Supabase connector, reconcile the database migration table before any CLI `db push` operation.
- Official guidance: [Supabase Auth user administration](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [invitation](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [password sign-in and confirmations](https://supabase.com/docs/guides/auth/passwords), and [securing your API](https://supabase.com/docs/guides/api/securing-your-api).
