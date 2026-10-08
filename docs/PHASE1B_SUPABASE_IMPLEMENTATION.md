# Phase 1B — Supabase Prototype and Security Milestones

_Status: October 8, 2026. Milestone **B1 schema foundation staged on a feature branch only**; no remote project provisioned, migrations applied, SQL policies exercised against Postgres, authenticated score submission implemented, or app connected. All future milestones must use synthetic data exclusively. Production cutover is **not approved**._

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

## B1: Physical data model (prepared; not applied)

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

## Increment sequence and gates

**B1 — isolated schema and privilege foundation** (this branch)
- [x] Review Phase 1A, current engine and FFTT3 private format/rating sources.
- [x] Stage schema migration, public allowlist projection, static guardrail test and pgTAP permission test.
- [ ] Create/connect isolated Free project, apply migration to local or remote *development* database, and execute pgTAP tests there.
- [ ] Verify `anon`, unaffiliated authenticated, organizer and scorekeeper access in a real authenticated database context. No role is assumed functional at B1.
- [ ] Verify existing browser/Phase 1A regressions on the PR head before merging.

**B2 — authenticated, transactional score command and private reads**
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

The **database** tests (`supabase/tests/phase1b_permissions.sql`) require Supabase PostgreSQL + pgTAP and check actual schema/table privileges, enabled RLS, public view fields/invoker mode, write denial, empty publication and audit trigger. The first successful PostgreSQL run must be recorded before reporting B1 security validated. Later auth/RPC/concurrency tests are separate and mandatory.

Existing `tests/test_phase1a_contract.py`, `tests/ui_smoke.py`, `tests/safety.py` and `tests/rehearsal.py` remain mandatory regressions. No implementation changes to `index.html` are part of B1.

## Known limitations and deferred decisions

- No linked Supabase project, Auth accounts, permission-checked RPCs, server score validation, population of public data, Realtime, shared backups, integration tests or live synchronization exist at B1.
- B1 event schema fixes regular/final best-of values to current rules; a future approved rules change requires a separate migration.
- A development RLS/SQL success does not automatically authorize a real participant import, spectator name publication, paid tier or event-day cutover.
- A later cloud design must model bracket builds/rebuilds and dependency repair explicitly; do not reuse v0.1 browser Undo as a database command.
