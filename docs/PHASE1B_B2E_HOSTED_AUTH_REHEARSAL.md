# Phase 1B B2e — Hosted synthetic Auth rehearsal

**Environment:** Supabase Free `fftt-bracket-manager-dev`, project ref `copmkalfkkrkzheohwuc`. This is **not** FFTT3 or any real event. Do not migrate real participants, authorize volunteers, or connect the GitHub Pages application.

**Status:** Scripted procedure prepared and guard-tested; hosted Auth-user provisioning, administrative bootstrap and remote signed-in tests **not executed** until the organizer confirms ownership of four controlled test-only accounts. The existing hosted database may contain the B1/B2a/B2b/B2d migrations but does not yet contain any FFTT event, Auth user or grant.

## Approved method and gate checklist

1. **Identity plan (organizer confirmation required):** Use four distinct testing-only email inboxes or aliases under the organizer's control: one organizer, two scorekeepers, and one unassigned outsider. Never use actual players/volunteers, personal contact lists, or disposable addresses not capable of receiving confirmation mail. Test secrets must stay on an organizer-controlled machine/password manager, not in ChatGPT, public GitHub, CI logs or screenshots.
2. **Account creation via Supabase Auth administration:** Sign into the exact Free dev project dashboard, navigate to Authentication / Users, and use its administrator-supported invitation/user-creation flow for those four controlled addresses. Supabase supports `inviteUserByEmail` and admin user creation; these use privileged credentials only on a trusted server or dashboard, never in a public client. Keep the hosted email verification setting enabled; finish verifying all four test accounts. Do not open broad public signups or disable hosted confirmations merely for the test. **Do not create users via raw SQL inserts into `auth.users`.**
3. **Trusted first organizer bootstrap:** Verify the organizer's **test-only user UUID** and confirmed/eligible account privately in the dashboard. Read `docs/B2E_TRUSTED_BOOTSTRAP_TEMPLATE.sql`, replace its null-UUID placeholder with that exact account UUID, double-check the project, then run as a trusted database admin. The template refuses use when a prior FFTT event exists, if the account is unverified/ineligible, or if the placeholder has not been replaced. It creates one `2099-01-01` synthetic event and one initial organizer grant. Record the *new synthetic event UUID* from the notice privately. This is an explicit separate trusted bootstrap, not a browser RPC. ChatGPT can apply the reviewed one-time SQL via its connected Supabase tool **after** the organizer provides the test-only user IDs and explicitly authorizes that bootstrap.
4. **Organizer-authorized scorekeeper grants:** With the real organizer's confirmed login, run `tests/b2e_hosted_grant_staff.py` on an organizer-controlled computer. It refuses to write without `FFTT_B2E_APPROVE_STAFF_GRANTS=YES_SYNTHETIC_HOSTED_ONLY` and hard-pins the exact project. Both scorekeeper accounts receive event-scoped grants via the publicly exposed **SECURITY INVOKER** wrapper; no privileged service-role key is used. The outsider is not granted.
5. **Read-only real hosted Auth verification:** Run `tests/b2e_hosted_auth_probe.py` after grants are established. It authenticates each user through the real hosted Auth server, verifies the four independently signed accounts, checks roles, outsider/anonymous denial, private staff-schema denial and matchdesk field restrictions. Deliberately **does not call any grant/revoke/score mutation endpoint**; unauthorized grants/revocations are covered by isolated CI. The probe performs **no score/staff mutations**.
6. **Evidence + next gate:** Inspect the private counts, audit records, RLS/API grants and Supabase security advisor via the connected tool. Capture pass/fail and dated commit in the private changelog without recording identities, emails, secrets or signed tokens. A **separate, explicitly approved** fixture and an event-day-compatible remote score concurrency/recovery test will follow. Never treat successful local CI alone as a hosted signed-Auth pass.

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
| Hosted Auth verification | All four controlled accounts can sign in with verified emails |
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
