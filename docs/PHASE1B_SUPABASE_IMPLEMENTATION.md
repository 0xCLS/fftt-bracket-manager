# Phase 1B — Supabase Prototype and Security Milestones

_Status: October 8, 2026. Milestone **B1 schema foundation staged on a feature branch only**. Migration and 25 pgTAP security/shape checks **passed against an isolated local Supabase PostgreSQL instance in GitHub Actions** ([run #1](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37807810943)). An isolated hosted Free project and the B1 schema are now deployed; authenticated score submission, real-user login, and app integration remain unimplemented. All future milestones must use synthetic data exclusively. Production cutover is **not approved**._

## Source precedence

[Phase 1A contract](PHASE1A_SHARED_EVENT_CONTRACT.md) and [machine-readable allowlist](../contracts/phase1a_v1.json) govern shared-state invariants. Existing `index.html`, `localStorage` key `fftt_bracket_manager_v01`, JSON backups, bracket engine, seven-screen cool-gray/charcoal/pastel UI, circular FFTT emblem, exact `Developed by Chris Smith` credit and Overview headline remain unchanged. The private FFTT3 event record defines the 2026-11-22 plan, not prototype participant fixtures.

## Authorized environment / organizer-owned steps

1. Sign in at https://supabase.com/dashboard/projects using an account the organizer controls.
2. Choose **Free**, create a separate development project named `fftt-bracket-manager-dev` in an available nearby region. Store the database password privately; never put it in GitHub, this chat, browser source or build logs. Check Free limits at https://supabase.com/pricing.
3. Add or authorize ChatGPT's Supabase integration if you want ChatGPT to run migrations and inspect security tests on that isolated project. Do not grant access to real event data. The GitHub connector can already manage code/docs/PRs independently.
4. Enable only test users that the organizer has explicitly authorized; test identities and player records must be synthetic. Confirm email/invitation and recovery policy before enabling production volunteer access.
5. Keep `fftt_private` **out** of the Supabase API's Exposed Schemas. Store any server-only secrets in managed secret storage; the frontend is public GitHub Pages.
6. **No production approval implied:** do not link FFTT3's Google Form/Sheet, migrate participant data, upgrade billing, or switch GitHub Pages into shared mode without explicit new approval.

Local reproducible development, once tools and Docker are available:

```sh
supabase init                         # skip if repo already has config.toml
supabase start                        # local services only; never expose publicly
supabase db reset                     # only local isolated synthetic database
supabase test db                      # pgTAP tests in supabase/tests/
python -m unittest discover -s tests -p 'test_phase1b_schema.py' -v
python -m unittest discover -s tests -p 'test_phase1a_contract.py' -v
python tests/ui_smoke.py
python tests/safety.py
python tests/rehearsal.py
```

After organizer approval and project linking, use reviewed migrations (`supabase link` and `supabase db push`) **only against the isolated development project**. Do not commit `.env`, Supabase tokens, real user exports or credentialed URLs.

## Hosted Free development project — October 8, 2026

- **Verified project:** `fftt-bracket-manager-dev`, CLS Studios Free, `us-east-1`, PostgreSQL 17.11, `ACTIVE_HEALTHY`. Project reference: `copmkalfkkrkzheohwuc` (not a credential). No real participant data imported.
- **Applied hosted migrations:** Supabase `20261008183821_phase1b_foundation` from GitHub B1 migration, plus `restrict_auto_rls_helper_execution` hardening. The latter's equivalent tracked repository migration is `20261008000200_restrict_auto_rls_helper.sql`; the hosted migration's version/name differ because the first application was performed through the Supabase integration. **Do not blindly reapply either migration via CLI without reconciling hosted migration history.**
- **Live database verification:** exactly 9 `fftt_private` tables, all 9 with RLS enabled; `anon` and `authenticated` have no private schema USAGE; public result tables/view allow SELECT but no browser writes; invoker-secured public view; 0 published event/match rows. No score submission or publication RPC has been installed.
- **Security advisory resolution:** the new project's automatic-RLS event-trigger helper `public.rls_auto_enable()` was initially `SECURITY DEFINER` with execute rights for `anon` and `authenticated`. Revoked both roles' (and PUBLIC's) execute rights, preserving the event trigger. SQL privilege recheck passed; Supabase security advisor reports **only 9 informational `rls_enabled_no_policy` findings** in private, intentionally inaccessible tables. Those are deliberate B1 deny-all behavior, not missing public policies. Details: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.
- **Scope of pass:** previously all 25 local-CI pgTAP tests passed, and equivalent essential hosted permission/projection checks passed. Full hosted pgTAP suite, authenticated user/session grants, concurrent transactional scoring, corrections, and multi-device testing still pending. Do not call B2 production-ready.
- **Performance advisors:** foreign-key indexing opportunities (15) and unused indices on empty prototype tables (4) were reported. Assess after B2 query design and synthetic workload; don't remove protective indices due to zero usage.

## B1: Physical data model (prepared and applied to isolated hosted development project)

`supabase/migrations/20261008000100_phase1b_foundation.sql` defines the private schema:

| Entity | Role |
| --- | --- |
| `fftt_private.events` | Private identity + independent public UUID, event date/status, rules, revision, bracket generation; hard-coded synthetic-only guard |
| `fftt_private.event_staff` | Per-event Supabase Auth user ID, organizer/scorekeeper role, active/revoked status; organizer authorization not browser claims |
| `fftt_private.players` | Display name, check-in, internal Level 1–5 rating, provisional/established, first actual championship loss; **no contact columns** |
| `fftt_private.brackets` | Championship and reviewed consolation, keyed by event/generation; prior generations remain distinguishable |
| `fftt_private.matches` | Stable UUID, presentation code, round/slot, ordered players, result/bye status, table, version, deterministic advancement target |
| `fftt_private.consolation_reviews` | First-loss reference and explicit review/placement state; no automatic consolation insertion |
| `fftt_private.doubles_finale` | One finale team-selection record (championship finalists + consolation partners), **no doubles result** |
| `fftt_private.result_submissions` | Event/actor/submission UUID composite key, request fingerprint, saved response for exact retries |
| `fftt_private.audit_events` | Actor, operation, before/after, reason, revision; trigger rejects UPDATE/DELETE |

All nine private tables have RLS **enabled**, with no browser-role table grants or policies at B1. This is deliberate **fail-closed scaffolding**: no staff views or writes work yet. This does **not** by itself prove end-to-end authorization.

For public results, `public.fftt_published_events` and `public.fftt_published_matches` are *separately materialized* tables. They have independent public event IDs, allowlisted columns, enabled RLS, SELECT-only grants and SELECT policies for `anon` / `authenticated`. The `security_invoker` view `public.fftt_public_results_v1` assembles the exact Phase 1A public event/result JSON shape. The tables are empty until a trusted, audited B2/B3 server publication routine exists. **Do not bypass that gate by inserting real player names manually.** This pattern avoids an unrestricted view of private player rows and avoids trusting a client-side field filter.

### Privilege model to implement and verify next

- Organizer: authenticated and *currently* organizer-authorized for the event; can change player private data, brackets, memberships, corrections and secure exports **only through authorized server commands**.
- Scorekeeper: authenticated and actively event-authorized; reads a minimal match desk and submits an eligible match. No raw roster/rating access, staff management or corrections.
- Anonymous spectator and TV: SELECT only the explicit public projection; cannot see private schema, ratings, rating status, contact, audit or internal player IDs, and cannot write scores.
- Revocation is checked against server-side staff records **on every operation**, *before* idempotent replay, without trusting a JWT role claim beyond authenticated identity.
- In B2, privileged mutation functions reside in non-exposed `fftt_private`, with fixed `search_path`, narrow EXECUTE grants, and any thin exposed invoker wrapper reviewed for safe arguments/returns. Lock event/match transactionally. Never expose a `SECURITY DEFINER` function directly in an API-exposed schema.
- Cloud writes stop during disconnection; no offline queue, whole-state import, local Undo replay or automatic conflict merge in shared mode. Existing local app remains the separate fallback.

## B2a — DB-backed role checks and authorized match desk (synthetic hosted deployment verified)

Code: `supabase/migrations/20261008000300_b2a_staff_read_api.sql`; synthetic SQL tests: `supabase/tests/phase1b_b2a_authorization.sql`. Draft [PR #3](https://github.com/0xCLS/fftt-bracket-manager/pull/3) is based on B1 PR #2, not the independently changing `main` branch.

- Expose two versioned **security-invoker** PostgREST RPC wrappers, `public.fftt_staff_role_v1(event_id)` and `public.fftt_matchdesk_v1(event_id)`. Both are explicitly executable by `authenticated`, never `anon`.
- The wrappers call narrowly granted **security-definer** functions kept in `fftt_private`, which must remain *outside* Data API exposed schemas. `authenticated` obtains only the schema USAGE needed to resolve these specific private functions and EXECUTE on those functions — **no private-table SELECT, INSERT, UPDATE or DELETE grants**. This intentional B2 change supersedes B1's unconditional no-USAGE design.
- Every request checks `auth.uid()`, Supabase-authenticated JWT role, and **current** active, unrevoked membership in `fftt_private.event_staff` for the requested event. No browser-supplied role, editable `user_metadata`, or client-supplied event authority is honored. Supabase's API gateway must verify signed tokens; raw SQL test JWT settings merely simulate caller identity.
- Scorekeepers and organizers may see only *pending playable matches* for their authorized active synthetic event, with ordered names/IDs, match code/version, bracket, round/slot and table number. No rating, provisional status, check-in flag, contact, staff list, audit, or backup fields.
- **No write/grant-management or result-submission RPC is provided here.** Controlled organizer account invitation/bootstrap and permission-checked staff grants must be addressed before live Auth access is claimed. Bracket updates/corrections remain B2b/B3.
- Authorization tests use **transaction-rolled-back synthetic `auth.users` entries and simulated JWT GUCs** on local PostgreSQL; no real Auth user credentials, player contact data, or real participant migrations. Live signed-JWT/Auth integration, session revocation, concurrency and public API adversarial testing remain further gates.

## B2b — transactional score submission (synthetic hosted deployment verified; production unapproved)

Draft [PR #4](https://github.com/0xCLS/fftt-bracket-manager/pull/4) builds on B2a and stages:
- `supabase/migrations/20261008000400_b2b_transactional_score.sql`: event-row transaction lock, current active staff authorization checked *before* idempotent receipt lookup, event/generation/match-version guards, validated winner and table, winner-only or valid best-of 3/5 game scores, exact per-actor/submission fingerprinted replay, immutable audit, event revision and match version updates, downstream entrant placement, and first-*actual*-match loss eligibility for organizer **review**.
- `supabase/tests/phase1b_b2b_submissions.sql`: synthetic-only SQL integration checks for invalid scores, nonparticipant winners, stale generations/versions, exact retries, tampered submission IDs, correct finals validation, bracket advancement, first-loss review eligibility, revocation-before-retry and no writes from denied attempts.
- All outcomes are atomic in one PostgreSQL transaction. Event locking serializes simultaneous submit commands *using this RPC* for the same event, though actual competing-session load tests must still verify that property.

**Known deferred risks:** no fully-tested automatic BYE propagation on dynamically reconstructed downstream paths; bracket build/rebuild and controlled score corrections require separately reviewed commands, and published results currently remain empty. No organizer staff-grant UI, signed Auth session tests or frontend adapter. Do not enable cloud mode, real players, public result publishing or event-day use based on this B2b draft.

### October 8, 2026 verification checkpoint

- **CI:** [database workflow](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37837335922) passed **70 pgTAP assertions** across B1/B2a/B2b; accompanying browser regression workflow passed. This includes synthetic test cases for accepted results, validation, stale versions/generations, idempotency, tampered retries, revocation, deterministic current-generation bracket advancement, and first-actual-loss consolation review.
- **Hosted dev migrations:** `20261008195706_b2a_staff_read_api` and `20261008201142_b2b_transactional_score` have been applied to Free project `copmkalfkkrkzheohwuc`. Hosted migration versions differ from GitHub file timestamps; reconcile history before running CLI push.
- **Hosted access checks:** `anon` cannot EXECUTE staff-role, matchdesk, or score RPCs; `authenticated` may call them through explicit grants but cannot directly SELECT/UPDATE/INSERT private tables. Public wrappers use SECURITY INVOKER. No staff grants exist; thus no signed-in visitor can currently submit a valid result. Database rows remain empty; no public results published.
- **Security advisors:** only 9 informational `rls_enabled_no_policy` notices on private intentionally deny-all tables, no new warning findings. No production cutover, real participants, Auth test accounts, or client integration.
- **Not yet validated:** signed JWT/Auth session verification with real organizer-authorized accounts; simultaneous independent PostgreSQL sessions with conflicting submissions; dynamic byes and bracket build/rebuild/correction flows; strict server-side publication and recovery. Keep the app browser-local.

## B2c — real local signed Auth and concurrent HTTP requests (CI passed; hosted test accounts pending)

Draft [PR #5](https://github.com/0xCLS/fftt-bracket-manager/pull/5) extends the *existing B2b contract* without changing deployed SQL or `index.html`. A dedicated GitHub Actions workflow starts the full **local** Supabase Auth/PostgREST/PostgreSQL stack and runs `tests/b2c_auth_concurrency.py` with only Python standard-library HTTP clients, PostgreSQL CLI, and ephemeral synthetic identities.

- Four disposable synthetic email/password accounts are registered and then independently signed in through real local GoTrue to obtain signed access JWTs. Email confirmations are disabled **only in local `supabase/config.toml`**, not on the hosted project.
- The local database assigns organizer and event-scoped scorekeeper grants. Requests use the same PostgREST RPCs the future client would use. Cross-event, anonymous, unaffiliated-user, non-public field access, and revocation behavior are checked.
- Separate HTTP clients issue opposing submissions concurrently against one unresolved match. Tests require exactly one accepted result, one rejected conflict, a single persistent winner/version/audit/receipt, exact idempotent replay, tampered-retry denial, and rejection of previously accepted retries **after** staff revocation.
- Local test accounts, passwords, scores and JWTs never enter the hosted development project. The tests reject any non-loopback API/database URL. Credentials are generated at runtime and are never committed. This is not a hosted volunteer onboarding path.
- **Verified October 9, 2026:** [B2c full local Supabase workflow](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37883186264) **PASSED**. Four real local Auth accounts independently signed in with verified signed JWTs; unauthorized/cross-event and privacy checks passed; two simultaneous HTTP score submissions produced exactly one accepted winner, one conflict and one authoritative audit/receipt; exact retries, tampered retries, revocation and read-only public projections behaved as specified. All **70 existing pgTAP checks** passed in the same full-stack job. Browser regressions also passed ([run](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37883186262)). Hosted organizer-approved account bootstrap, hosted multi-client tests, full byes/corrections, controlled publication and frontend sync remain separate security gates.

## Increment sequence and gates

**B1 — isolated schema and privilege foundation** (PR #2; deployed to synthetic hosted development)
- [x] Review Phase 1A, current engine and FFTT3 private format/rating sources.
- [x] Stage schema migration, public allowlist projection, static guardrail test and pgTAP permission test.
- [x] Apply migration to isolated local Supabase Postgres in GitHub Actions and run 25 pgTAP permission/shape checks — **PASS**, [run #1](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37807810943).
- [x] Organizer created and connected isolated hosted Free project; applied B1 migration; verified critical hosted RLS/grants and fixed automatic-RLS helper EXECUTE exposure. Full hosted pgTAP and authenticated-RPC tests remain pending.
- [ ] Verify `anon`, unaffiliated authenticated, organizer and scorekeeper access in a real authenticated database context. No role is assumed functional at B1.
- [ ] Verify existing browser/Phase 1A regressions on the PR head before merging.

**B2 — authenticated read and transactional scoring** (B2a/B2b synthetic implementations deployed; full Auth and concurrency acceptance pending)
- Event-scoped secure grants/admin access, organizer-only controlled setup, minimal scorekeeper match desk.
- Atomic score validation + version/generation guards + exact idempotent retries + locking, audit, bracket-advancement, byes, first actual championship loss; perform all writes within one transaction.
- Match existing best-of-3, championship-final best-of-5, 11/win-by-2 and optional winner-only score.
- Verify simultaneous opposing scorekeepers, stale clients, unauthorized/revoked users, payload tampering, failed transaction rollback and replay on actual PostgreSQL.
- No production event, no public frontend wiring.

**B3 — corrections, approved consolation and safe publication**
- Organizer-only reasoned score corrections with immutable history. Refuse correction if resolved descendants would be invalidated; require explicit remediation.
- Organizer-reviewed consolation placement only after all checked-in players' first actual championship matches. Preserve mixed-skill doubles *team selection only*.
- Trusted transactionally refreshed published allowlist; verify public field keys match `phase1a_v1.json` and public updates contain no private payload.

**B4 — independent synthetic integration validation**
- Secure client adapter and authentication only after B2/B3 pass; maintain browser-local mode as the default.
- Two volunteer sessions + spectator/TV read + reconnect/conflict/revocation + fallback drills, using synthetic fixtures.
- No production switch until separately approved and rehearsed.

## B1 acceptance tests

The **static** standard-library tests (`tests/test_phase1b_schema.py`) check contract/key correspondence, RLS declarations and SQL grants in source, no direct write grants, no exposed private table references, and no active score RPC. They do *not* run SQL.

The **database** tests (`supabase/tests/phase1b_permissions.sql`) require Supabase PostgreSQL + pgTAP and check actual schema/table privileges, enabled RLS, public view fields/invoker mode, write denial, empty publication and audit trigger. The first isolated PostgreSQL migration and 25 privilege/projection checks passed in GitHub Actions ([evidence](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37807810943)). This validates B1 database structure and grants **only**; it is not proof of JWT-backed organizer/scorekeeper login, B2 transactional operations or hosted deployment. Later auth/RPC/concurrency tests are separate and mandatory.

Existing `tests/test_phase1a_contract.py`, `tests/ui_smoke.py`, `tests/safety.py` and `tests/rehearsal.py` remain mandatory regressions. No implementation changes to `index.html` are part of B1.

## Known limitations and deferred decisions

- No linked **hosted** Supabase project, real Auth accounts, permission-checked RPCs, server score validation, population of public data, Realtime, shared backups, authenticated/concurrency integration tests or live synchronization exist at B1. The isolated local PostgreSQL/pgTAP integration checks **have** passed.
- B1 event schema fixes regular/final best-of values to current rules; a future approved rules change requires a separate migration.
- A development RLS/SQL success does not automatically authorize a real participant import, spectator name publication, paid tier or event-day cutover.
- A later cloud design must model bracket builds/rebuilds and dependency repair explicitly; do not reuse v0.1 browser Undo as a database command.
