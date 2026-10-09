# Phase 1B B2e — Hosted synthetic Auth rehearsal

**Environment:** Supabase Free `fftt-bracket-manager-dev`, project ref `copmkalfkkrkzheohwuc`. This is **not** FFTT3 or any real event. Do not migrate real participants, authorize volunteers, or connect the GitHub Pages application.

**Status (October 9, 2026):** Hosted Supabase Auth now has four administratively confirmed identities: three newly created test-only role accounts (two scorekeepers and an unassigned outsider) and one previously existing, unchanged account. Exactly three synthetic accounts were created through Supabase Authentication → Users with individual Auto Confirm User enabled; no confirmation emails were sent. Temporary random passwords were not retained or delivered to the organizer: **the new accounts cannot yet be signed in by the organizer**. The dashboard's password reset requires email delivery, which may fail for Yahoo disposable aliases. Supabase's supported Auth Admin API can **update the passwords without deleting users**. The organizer has been provided a one-time **local Mac helper** that prompts for the `sb_secret_` key privately on the organizer's own machine, checks an exact three-email allowlist, generates random passwords, saves them with owner-only file permissions before mutation, updates via `PUT /auth/v1/admin/users/{id}`, and verifies password sign-in. **This repair has NOT yet been executed; user IDs are still intact and passwords are currently unknown to the organizer.** Never submit elevated keys or passwords in chat, browser automation, GitHub, or the public app. The suitability of the existing account as the synthetic organizer still requires explicit confirmation. There are **zero FFTT event records, staff grants, or published results**. Trusted organizer bootstrap, scorekeeper grants, and real hosted signed-in tests remain **not executed**.

## Approved method and gate checklist

1. **Identity plan (organizer approved October 9, 2026):** Use four distinct test-only aliases/inboxes owned by the organizer: one organizer, two scorekeepers, and one unassigned outsider. Never use players/volunteers or unrelated personal addresses. Create and store a strong unique password per test account privately in a password manager, never in ChatGPT, GitHub, screenshots or CI logs. Distinct role-labeled aliases such as `+fftt-b2e-organizer`, `+fftt-b2e-score-a`, `+fftt-b2e-score-b`, and `+fftt-b2e-outsider` are recommended **only if the provider supports them**.
2. **Account creation via Supabase Auth administration:** In the exact Free dev project's **Authentication → Users → Add user → Create new user**, enter each of the four role-labeled controlled aliases and a **different** strong password. For this synthetic-only rehearsal, use the per-user **Auto Confirm User** option *if it is shown*, after confirming control of each alias; this creates administratively confirmed users without sending emails. **Do not disable project-wide Confirm Email or open public signups.** If the UI lacks this option, stop and review rather than guessing. Alternatively use **Send invitation** with real inbox confirmation only if email delivery is configured. **Default Supabase SMTP delivers only to addresses authorized on the project team**, so unrelated plus aliases ordinarily cannot receive invite/confirmation messages without custom SMTP. Never insert into `auth.users` with raw SQL, paste secrets into chat, or put privileged service-role keys in the browser. **Administrative confirmation records `email_confirmed_at` but is not proof that an email link was opened**; it is a constrained B2e synthetic test exception, not the intended production volunteer onboarding method.
3. **Trusted first organizer bootstrap:** Verify the organizer's **test-only user UUID** and confirmed/eligible account privately in the dashboard. Read `docs/B2E_TRUSTED_BOOTSTRAP_TEMPLATE.sql`, replace its null-UUID placeholder with that exact account UUID, double-check the project, then run as a trusted database admin. The template refuses use when a prior FFTT event exists, if the account is unverified/ineligible, or if the placeholder has not been replaced. It creates one `2099-01-01` synthetic event and one initial organizer grant. Record the *new synthetic event UUID* from the notice privately. This is an explicit separate trusted bootstrap, not a browser RPC. ChatGPT can apply the reviewed one-time SQL via its connected Supabase tool **after** the organizer provides the test-only user IDs and explicitly authorizes that bootstrap.
4. **Organizer-authorized scorekeeper grants:** With the real organizer's confirmed login, run `tests/b2e_hosted_grant_staff.py` on an organizer-controlled computer. It refuses to write without `FFTT_B2E_APPROVE_STAFF_GRANTS=YES_SYNTHETIC_HOSTED_ONLY` and hard-pins the exact project. Both scorekeeper accounts receive event-scoped grants via the publicly exposed **SECURITY INVOKER** wrapper; no privileged service-role key is used. The outsider is not granted.
5. **Read-only real hosted Auth verification:** Run `tests/b2e_hosted_auth_probe.py` after grants are established. It authenticates each user through the real hosted Auth server, verifies the four independently signed accounts, checks roles, outsider/anonymous denial, private staff-schema denial and matchdesk field restrictions. Deliberately **does not call any grant/revoke/score mutation endpoint**; unauthorized grants/revocations are covered by isolated CI. The probe performs **no score/staff mutations**.
6. **Evidence + next gate:** Inspect the private counts, audit records, RLS/API grants and Supabase security advisor via the connected tool. Capture pass/fail and dated commit in the private changelog without recording identities, emails, secrets or signed tokens. A **separate, explicitly approved** fixture and an event-day-compatible remote score concurrency/recovery test will follow. Never treat successful local CI alone as a hosted signed-Auth pass.


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
| Initial access | Only trusted bootstrap-created organizer holds a role |
| Grant authorization | Authenticated organizer grants scorekeeper roles, not the public or outsiders |
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
