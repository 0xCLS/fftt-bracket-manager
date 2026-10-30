# FFTT permanent domains and Bracket Manager role — controlled release (October 30, 2026)

**Approved:** production staff hostname `fftt-staff.clslifestyle.com`; spectator hostname `fftt-games.clslifestyle.com`; independent event-scoped `bracket_manager` role for Debbie Young's confirmed *duty*, **not an account grant**. Public homepage `fftt.clslifestyle.com` must remain unchanged.

**Implementation status:** source candidate on a feature branch; **no Cloudflare Pages project, domain, DNS record, staff Auth user, live FFTT3 grant, real-event publication or hosted SQL change is created by this document**. SQL is intentionally `DO_NOT_APPLY` until live-schema review + disposable populated copy tests. Debbie's email identity and rehearsal availability remain unverified. Do not provision or grant her role without separate owner authorization.

## Intended production architecture

| Purpose | Domain | New isolated Pages project | Build | Existing staging remains |
| --- | --- | --- | --- | --- |
| Organizer, Bracket Manager, Scorekeeper | `https://fftt-staff.clslifestyle.com/app/staff` | `fftt-staff` (proposed) | `build_export.py --target staff --environment production` | `fftt3-staff-stg.pages.dev` |
| Anonymous spectator and TV | `https://fftt-games.clslifestyle.com/app/spectator`, `/tv` | `fftt-games` (proposed) | `build_export.py --target spectator --environment production` | `fftt3-games-stg.pages.dev` |

Never attach a production custom domain to the automatically deployed staging project. Create two separate *direct-upload* Pages projects if Cloudflare permissions/free account quota allow. Configure each subdomain as a Pages Custom Domain and allow Cloudflare to provision HTTPS; inspect actual DNS records, certificate status and domain response before advertising the URLs. Do not change the `fftt-public` Pages project or homepage. Keep existing staging deployments and keys untouched.

Build from a single exact, clean and CI-verified source commit, preserving source hashes and including the Staff Pages Function. Example flags (supply existing local clean checkout and reviewed source SHA):
- Staff: `--environment production --origin https://fftt-staff.clslifestyle.com --target staff --spectator-origin https://fftt-games.clslifestyle.com`.
- Spectator: `--environment production --origin https://fftt-games.clslifestyle.com --target spectator`.
- Ensure each bundle's `MANIFEST.json` identifies the same reviewed SHA, correct target and production profile. Assert no staff modules, Function or private files are present in the spectator export.
- Production should use an independently scoped Cloudflare deploy credential/environment; do not repurpose the staging workflow/token silently. The existing automatic staging workflow remains on its staging branch and projects.

## Origin and authentication gates

- Staff's exported `app/origin-profile.json`: `approvedHttpsOrigins` contains only `https://fftt-staff.clslifestyle.com`, environment is `production`, and `approvedPublicStaticOrigins` is empty. Origin policy is exact, not wildcard.
- Configured `spectatorOrigin` is `https://fftt-games.clslifestyle.com`, not a user-provided arbitrary URL.
- Supabase Auth Site URL and redirect allowlist: review current settings, retain existing staging callbacks, and add exact production callback(s) *only if required by the existing invitation/OTP/recovery flow*. Ordinary password sign-in does not need a URL redirect. Keep public signup OFF and all other privileged Auth configuration unchanged.
- Staff Function `STAFF_ORIGIN` must match the **actual** production Staff origin. Migrate required registration read-only secrets explicitly and privately into the new production project's isolated environment, never to the public spectator project or GitHub.
- Assert Content Security Policy, no-store, no-index, no credential leakage and correct Function behavior (GET 405, unauthenticated POST 401). Confirm zero public events unless the Organizer separately approves publication.

## Role boundary

Role value: `bracket_manager`; **one explicit active grant per event per identity** (server-side `fftt_private.event_staff`). No global Supabase admin, service-role key, owner Auth privileges, public self-registration or automatic player/referee enrollment.

**Allowed:** read scoped tournament snapshot of names, levels needed for seeding, check-ins, brackets and scores; create first-time championship and consolation brackets; assign tables; submit results with idempotency/concurrency protections; choose and record doubles teams/results. Pending bracket operations keep existing lifecycle/format constraints.

**Denied:** staff account/grant management, registration source/Google data and links, check-ins and player edits, audit/private export, event setup and rules, publication, lifecycle/archive/deletion, scoring corrections, no-show forfeit overrides and all existing-bracket rebuilds (even if unscored). Server checks, not hidden buttons, are authoritative.

The dedicated private RPC `fftt_bracket_manager_snapshot_v1` requires the current event's `bracket_manager` grant. It returns the parser-compatible bracket snapshot but with `staff=[]` and `registration_refs=[]`. The existing Organizer snapshot is unchanged. An Organizer is not implicitly a Bracket Manager, and a Bracket Manager cannot access the Organizer snapshot.

## Mandatory verification before database/app promotion

1. Review hosted mixed-mode SQL functions and exact constraint names against the isolated SQL proposal. Restore a recent private populated backup into disposable PostgreSQL, then apply proposal **only there**. Compare complete pre/post data fingerprints and confirm existing fixture results/audit/roles unchanged.
2. Add a fictional, confirmed test identity as `bracket_manager` to one NEW fictional event; exercise first-time championship, consolation, table assignment, concurrent scoring, and doubles on separate phones. Verify no access to a second event or to the real event.
3. Independently verify server-level denial for organizer snapshot, registration data/source, staff grants, result correction, forfeits, formats, publication, archive/delete and bracket rebuild; verify grant revocation denies the next operation. Existing Organizer/Scorekeeper tests must still pass.
4. Confirm sanitized snapshot response contains **no** staff names/emails, contact information, registration refs, spreadsheet details or private keys. Record security-safe response shapes, not actual participant data.
5. After acceptance, apply the reviewed SQL to the existing Supabase project once, with backup and rollback/roll-forward recovery strategy (real-mode events mean old destructive rollback is not safe); deploy Staff and Spectator production bundles from same verified commit.
6. On physical devices test both permanent domains and original staging, sign-in/session refresh, connectivity loss and no automatic score resubmission, server receipts, spectator/TV, printer/paper fallback. Keep *real* FFTT3 unpublished and unmodified until explicit event-day authorization.

## Debbie Young — separate provisioning gate

Debbie's **role is confirmed** in the private event record October 30. Her Auth identity and rehearsal attendance are not. Do **not** create her Auth account, identify her email in public files, share a password, or grant either a fictional or real event yet. After private email identity verification and distinct owner approval, use the existing owner-controlled Supabase Auth create/invite process, ensure email verified and individually owned password/session, grant only `bracket_manager` for the named FFTT3 event, and verify allowed/denied operations. Rehearse with a separate event and fictional players. Revocation must be available to the Organizer.

## Release note

The new code and SQL require full authorization/denial/regression checks rather than CSS-only UI tests. Do not merge or deploy based solely on static-source tests. If the hosting or Supabase accounts are not accessible to the execution environment, keep live configuration **blocked**, report it honestly and retain the tested source/PR rather than inventing deployments or credential access.

## Implementation status (October 30, 2026)

Application source for production: `56d7ffd` (CI run 41126021560, all jobs green). Status below is limited to what was actually performed and observed.

- **Database.** The reviewed proposal (SHA-256 `77641ccfc1ccd23b74f633d09042164aed7e6273fa8d17ba9e59cff26ad2eabd`) was applied once to the existing Supabase project after a private full-data/schema backup and a rehearsal on a restored populated copy. Verified afterwards: the hosted function/ACL manifest equals the rehearsed result; all 16 data-table fingerprints equal the pre-change backup (events, players, scores, audit, registration configuration unchanged); zero `bracket_manager` grants exist; nothing is published; public signups remain disabled. The strict exact-error role suite (`tests/fftt3_bracket_manager_strict.sql`) passed on the populated copy and, inside a rolled-back transaction, on the hosted project. A restore-tested roll-forward/rollback SQL is held in the private backup location (it refuses to run once any `bracket_manager` grant exists).
- **Origin bug found and fixed.** The registration Function accepted only `*.pages.dev` as `STAFF_ORIGIN`, so the permanent Staff origin would have returned `registration-not-configured` permanently. It now also accepts exactly `https://fftt-staff.clslifestyle.com` (regression test added).
- **Cloudflare Pages.** Two separate production projects, `fftt-staff` (with the registration Function) and `fftt-games` (static only), were created and deployed from the same commit with the production profile. Bundle manifests were audited (no secrets or private files; spectator bundle has no staff modules or Function). The public homepage project and both staging projects were not modified.
- **Custom domains and HTTPS.** Proxied CNAMEs `fftt-staff` → `fftt-staff.pages.dev` and `fftt-games` → `fftt-games.pages.dev` were created in the `clslifestyle.com` zone (no other record changed; `fftt` still points to the homepage project). Both Pages domains reached `active` with valid certificates. `tools/ops/verify_deployment.py` passed on both live hostnames: every manifest file served with the same SHA-256 as the commit `56d7ffd` manifest, self-only CSP with the pinned Supabase `connect-src`, HSTS, no-store, noindex, private paths not served, Staff Function `GET` 405 / token-less `POST` 401 / foreign-Origin `POST` 403, spectator origin serves no Function and no Staff page, and `/app/spectator` and `/app/tv` return 200.
- **Remaining owner steps.** (1) Organizer confirmation of the Google registration load (see below). (2) Physical-device tests (item 6 above), after which PR #22 may leave draft and merge. (3) Debbie Young's provisioning gate remains untouched: no account, invitation or grant exists.

## Google Sheets registration reading (October 30, 2026)

- **Credentials.** The existing read-only registration service account (the one used for the October 27 staging diagnostic; not rotated, staging untouched) was reused. Its two values were set as Cloudflare secrets `GOOGLE_SA_EMAIL` and `GOOGLE_SA_PRIVATE_KEY` on the production `fftt-staff` project only. No secret value appears in the repository, bundles (scanned), logs or chat. The key file is held privately outside the repository (mode 0600).
- **Diagnostic first.** With `REGISTRATION_GOOGLE_MODE=diagnostic`, the deployed reader code was run read-only against the existing response spreadsheet: Google sign-in succeeded; spreadsheet "FFTT3 Registration" opened; the single worksheet `Form Responses 1` was found; header row read (12 columns, same as the October 27 diagnostic); response count 21 (non-empty timestamps; not a verified unique-player count). No answer rows were read. The same service account gets HTTP 403 for the private Outreach Tracker, so it has no access to that file.
- **Enabled.** `REGISTRATION_GOOGLE_MODE=enabled`, with the existing allowlist `REGISTRATION_EVENT_IDS` containing only the one approved real FFTT3 event, and the same `56d7ffd` Staff bundle redeployed (Staff deployment `dd9661f4`, previous good deployment `c8c52b7c`). Nothing is imported automatically: the real event still has 0 players, remains unpublished, and registration reading happens only when the Organizer opens or loads registrations.
- **Access boundary.** `load` and `test` require the caller's own token and a database role of exactly `organizer` for that event (handler tests: organizer-only, cross-event denial). Anonymous and invalid-token requests to the live Function return 401. Bracket Manager and Scorekeeper roles are refused by that check; the Google credentials exist only as Function secrets. The spreadsheet id is never taken from the caller.
- **Outstanding.** The Organizer must sign in at https://fftt-staff.clslifestyle.com, open Players → Registration settings, run Test connection once, and load registrations to review duplicates. Rollback: set `REGISTRATION_GOOGLE_MODE` back to `diagnostic` and redeploy, or switch the event's source off.
