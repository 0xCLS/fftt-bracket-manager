# Milestone 1 — Atomic score decisions and secure client integration candidate

_October 13, 2026 · synthetic-only development branch · NOT A DEPLOYMENT_

This is **one cohesive backend/client development batch** within the October 12 three-milestone roadmap. It does not create a new phase, approve a hosted migration, or turn on public cloud scoring.

## Implementation delivered on the integration branch

**Durable accepted/rejected score backend design**
- \`supabase/proposals/MILESTONE1_DURABLE_SCORING_V2_DO_NOT_APPLY.sql\` is a complete reviewable PostgreSQL candidate, **NOT in migrations/**. It has **NOT** been run against hosted Supabase.
- Adds an append-only, RLS-protected private \`score_decisions_v2\` ledger with unique \`(event_id, actor_id, submission_id)\`, fingerprint and match/event versions, and exactly two terminal outcomes: accepted, or rejected for **provably stale match version**.
- \`submit_match_result_v2\` locks the synthetic event **before** checking the current DB staff grant and own previous decision, preserving revocation and idempotency invariants. A replay with a different payload is denied, and previously accepted B2b receipts can be recognized without re-scoring.
- On successful new scoring, delegates to the already-tested B2b engine to validate games/winner, advance a match, update event revision, determine first-actual-match consolation eligibility and append the audit record. Adds the durable accepted decision in the **same database transaction**. On provably stale score input, inserts only a durable rejected decision. Other failures remain errors/UNKNOWN; there is no blanket catch that converts them to a false rejection.
- \`fftt_score_decision_snapshot_v2\` locks the same event before an active-role check and an actor-scoped decision read. An absent decision is **UNKNOWN**. It projects only the event version/lifecycle and the current actor's optional decision; no contacts, internal ratings, staff roster or private scores.
- The migration candidate explicitly **revokes the v1 score endpoint during the same transaction as v2 creation** so the old route cannot bypass the new decision ledger after a future approved cutover. No publication writer, bracket build/rebuild or fixture creation is introduced.

**Client components, deliberately separated from the live application**
- \`contracts/milestone1_signed_snapshot_transport.mjs\`: a pinned, signed **read-only** development-project snapshot transport with strict request/response parsing, error containment and no automatic retries or token persistence. The new RPC is **NOT deployed**: live requests will fail closed until separately approved.
- \`contracts/milestone1_synthetic_score_coordinator.mjs\`: executable, provider-neutral **synthetic in-memory** score/recovery coordinator around the C1 offline-authority state machine and C11 decision shape. This has no real HTTP, browser storage, Supabase keys or imported app UI; all mock scoring happens through an explicitly injected fake transport. A 4xx response, timeout, missing/invalid decision, role denial or in-flight disconnect cannot silently claim saved scores. Reconnect inspection cannot produce \`verifiedFromServer:true\` or resume cloud writes.
- Existing public \`index.html\`, C8 test sign-in flow, browser-local backups, scoring engine, published projections and historical PRs remain untouched.

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

**Review issue:** A transaction-wide event lock serializes v2 scoring, staff revocation, and snapshot reads, but this needs actual isolation/concurrency testing on disposable PostgreSQL. No future production authorization can be inferred from the parser's field shape alone. The implicit C8 Magic Link rehearsal is not a PKCE/CSRF production login.

## Approvals still required

Hosted schema migration, v1→v2 RPC permission cutover, staff/identity changes, and any test with new hosted score writes require explicit separate approval. No existing B2i hosted score request or fixture may be replayed. Real FFTT3 registration data, volunteer production onboarding, public real-player results and production cloud-score rollout all remain **NOT APPROVED**.

Next cohesive integration action after local PR tests pass: execute the disposable signed-Auth/PostgreSQL suite and correct any discovered issues in this **same integration PR**, then request a single clearly scoped decision on the reviewed hosted change set. Do not fragment into C12/C13 or run hosted database changes without permission.
