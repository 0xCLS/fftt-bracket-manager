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
