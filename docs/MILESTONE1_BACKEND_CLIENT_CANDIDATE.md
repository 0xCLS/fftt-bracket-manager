# Milestone 1 — Atomic score decisions and secure client integration candidate

_October 13, 2026 · synthetic-only development branch · NOT A DEPLOYMENT_

**Later approved hosted update, October 13:** The exact SQL from this original candidate was subsequently **applied to fftt-bracket-manager-dev only**, under explicit organizer approval, and a new synthetic 2099 fixture was created. The two approved hosted score submissions **were subsequently sent exactly once and independently verified**, on October 13. [Completed hosted evidence](MILESTONE1_HOSTED_V2_AUDIT.md). Current procedures and limitations: [Hosted V2 runbook](MILESTONE1_HOSTED_V2_RUNBOOK.md). Statements below describing the *initial unapplied candidate* are preserved as earlier stage evidence, not current hosted status.

This is **one cohesive backend/client development batch** within the October 12 three-milestone roadmap. It does not create a new phase, approve a hosted migration, or turn on public cloud scoring.

## Implementation delivered on the integration branch

**Durable accepted/rejected score backend design**
- `supabase/proposals/MILESTONE1_DURABLE_SCORING_V2_DO_NOT_APPLY.sql` is a complete reviewable PostgreSQL candidate, **NOT in migrations/**. It **had not** been run against hosted Supabase at the time this candidate was drafted; the later approved isolated development deployment is recorded above.
- Adds an append-only, RLS-protected private `score_decisions_v2` ledger with unique `(event_id, actor_id, submission_id)`, fingerprint and match/event versions, and exactly two terminal outcomes: accepted, or rejected for **provably stale match version**.
- `submit_match_result_v2` locks the synthetic event **before** checking the current DB staff grant and own previous decision, preserving revocation and idempotency invariants. A replay with a different payload is denied, and previously accepted B2b receipts can be recognized without re-scoring.
- On successful new scoring, delegates to the already-tested B2b engine to validate games/winner, advance a match, update event revision, determine first-actual-match consolation eligibility and append the audit record. Adds the durable accepted decision in the **same database transaction**. On provably stale score input, inserts only a durable rejected decision. Other failures remain errors/UNKNOWN; there is no blanket catch that converts them to a false rejection.
- `fftt_score_decision_snapshot_v2` locks the same event before an active-role check and an actor-scoped decision read. An absent decision is **UNKNOWN**. It projects only the event version/lifecycle and the current actor's optional decision; no contacts, internal ratings, staff roster or private scores.
- The migration candidate explicitly **revokes the v1 score endpoint during the same transaction as v2 creation** so the old route cannot bypass the new decision ledger after a future approved cutover. No publication writer, bracket build/rebuild or fixture creation is introduced.

**Client components, deliberately separated from the live application**
- `contracts/milestone1_signed_snapshot_transport.mjs`: a pinned, signed **read-only** development-project snapshot transport with strict request/response parsing, error containment and no automatic retries or token persistence. At initial drafting, the new RPC was **not deployed**. It is now deployed *only* to the isolated synthetic hosted project. The read-only transport remains unusable for production scoring and cannot enable browser writes.
- `contracts/milestone1_synthetic_score_coordinator.mjs`: executable, provider-neutral **synthetic in-memory** score/recovery coordinator around the C1 offline-authority state machine and C11 decision shape. This has no real HTTP, browser storage, Supabase keys or imported app UI; all mock scoring happens through an explicitly injected fake transport. A 4xx response, timeout, missing/invalid decision, role denial or in-flight disconnect cannot silently claim saved scores. Reconnect inspection cannot produce `verifiedFromServer:true` or resume cloud writes.
- Existing public `index.html`, C8 test sign-in flow, browser-local backups, scoring engine, published projections and historical PRs remain untouched.

## Disposable PostgreSQL integration fixture

- `tests/milestone1_v2_disposable.sql` is a **transaction-rolled-back** fixture for ephemeral Postgres. It creates only fictional 2099 actors, players, one event and one match within a temporary test transaction.
- The existing consolidated PR workflow now starts **local-only Supabase PostgreSQL**, verifies baseline B1–B2d pgTAP first, applies the unapplied v2 proposal **only to the disposable local container**, and runs the v2 fixture. It never links or connects to the organizer's hosted Supabase project.
- The fixture exercises sequential competing staff decisions, stable replay/tamper denial, own accepted/rejected snapshots, unrelated actor isolation, outsider/revoked denial, no direct private table rights, v1 cutover, one audited match advance and correct event revision. It is **NOT equivalent to a simultaneous two-connection race or independently signed GoTrue HTTP authorization**; both remain future tests.
- The local CI outcome must be recorded before claiming even disposable PostgreSQL validation.

## Validation boundaries

- Run the consolidated zero-network Node suite including synthetic race, accepted/rejected decisions, ambiguous ACKs, non-retry, role denial, delayed responses, signed snapshot allowlist and privacy.
- Run standalone Python static proposal safeguards including exact scope, no migration placement, same-event lock order, actor ownership, terminal rejection categories, append-only restrictions and atomic v1→v2 cutover requirements.
- Run existing Phase 1A and UI/browser safety/regression tests in the same normal PR workflow; minimize repeated Actions runs.
- **Static checks and in-memory tests do not prove PostgreSQL transaction behavior or verified hosted role policy.** Before deploying this SQL, perform disposable PostgreSQL + real signed GoTrue/Auth/JWT HTTP integration, including:
  1. v1 endpoint inaccessible after v2 cutover, new v2 wrapper callable only by active staff
  2. simultaneous independently authenticated scorekeeper submissions: exactly one accepted, one durable stale rejection; no double match advance or duplicate audit
  3. repeated same-id/fingerprint returns same own decision, tampered replay fails; cross-actor/cross-event lookup cannot reveal another receipt
  4. revoke-vs-score event-lock race, expired JWT, malicious role claim and outsider/anonymous access denial
  5. lost HTTP response **after** commit vs dropped **before** commit, consistent event revision and own decision, no unwarranted automatic retry
  6. invalid game scores, missing players/byes, stale generations, downstream bracket collisions and inactive lifecycle cannot be silently turned into durable stale-match rejections
  7. v1 legacy accepted receipt preservation; no replay or reset of the consumed B2i hosted fixture
  8. snapshot consistency at READ COMMITTED with event-lock ordering; no private data/public publication

**Signed concurrent HTTP rehearsal:** `tests/milestone1_v2_signed_http.py` reuses the previously validated **local-only** GoTrue helper. It creates four throwaway synthetic Auth identities with independently verified JWTs and tests organizer-issued grants, signed simultaneous scorekeeper v2 submissions, one persisted accepted and one persisted rejected decision, actor-scoped snapshot reads, unauthorized actor failures, no v1 bypass, score audit integrity and immediate revocation despite older signed tokens. It refuses non-loopback hosts. This uses only the freshly started CI Supabase stack, never hosted credentials, events or B2i fixture. **Verification PASS:** [one consolidated CI run #38380704428](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38380704428) succeeded on its first attempt at commit `a74d6504d3fe5bfd10a7dbabf74e1fb81e5561b7`. It completed the full 156/156 Node suite, eight SQL static checks, existing UI/backup/bracket rehearsals, 81/81 baseline pgTAP assertions, disposable v2 database checks, and real locally signed GoTrue/PostgREST HTTP concurrency. Two independently authenticated scorekeepers produced one accepted and one durable rejected decision; v1 writes were denied, and signed owner-only snapshots and revocation checks passed. All entities were fictional and local.

**Review issue:** A transaction-wide event lock serializes v2 scoring, staff revocation, and snapshot reads, but this needs actual isolation/concurrency testing on disposable PostgreSQL. No future production authorization can be inferred from the parser's field shape alone. The implicit C8 Magic Link rehearsal is not a PKCE/CSRF production login.

**Unverified after this local success:** The approved hosted migration is now present, but the fresh hosted signed one-time score race and independent DB audit were **subsequently completed and passed**; browser-level end-to-end write UX and server-proven client recovery, manual fallback/reconciliation, real separate devices, broad adversarial bracket scenarios, and any production operation. The live `index.html` remains byte-identical to main. Do not interpret local GoTrue concurrency as deployment permission.

## Approvals still required

The isolated hosted v2 schema migration and v1→v2 browser RPC cutover were subsequently explicitly approved and completed on October 13. Exactly one new-event-only synthetic fixture and its event-specific grants were created; historical grants were untouched. The two approved hosted score POSTs were executed once; the guarded Mac operator and independent SQL audit both passed. The fixture is permanently consumed. Other staff/identity changes, production operation and real-data activity remain unapproved. No existing B2i hosted score request or fixture may be replayed. Real FFTT3 registration data, volunteer production onboarding, public real-player results and production cloud-score rollout all remain **NOT APPROVED**.

Next cohesive integration action: integrate the now-verified hosted synthetic backend with a secure browser score/recovery experience, authorized multi-device synchronization and controlled fallback in a separate demo, without touching production or adding further scoring fixtures. Do not fragment into C-number phases or replay the consumed B2i fixture.
