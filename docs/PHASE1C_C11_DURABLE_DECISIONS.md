# Phase 1C C11 — Durable decisions and trusted snapshot boundary (DRAFT)

**Scope (October 13, 2026):** Synthetic executable model and strict wire decoder, **no hosted SQL or Auth calls**. No real scores, account creation, email, credentials, fixture replay, live app edit, schema migration or production cutover. C10 previously passed [mock CI #38366408265](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38366408265); C9 independent hosted volunteer sign-in still blocked by the observed 429 rate limit.

## Problem from observed B2i and prior C5 proposal
C5's `fftt_private.result_submissions` ledger stores **accepted** decisions. A denied concurrent attempt did not create a receipt. On reconnect, `null` may mean a rejected score, never-arrived request, still-in-flight operation, or incorrect actor. Mapping `null` to `rejected` or retrying automatically risks duplicate/incorrect results. C5 proposal is not deployed, and its client decoder correctly refuses to claim verified server provenance.

## C11 minimum desired server invariant (future review, NOT implemented)

For each submitted score on one event/match, the server should enforce:

1. **Signed actor:** `actor_id` is derived *only* from verified server Auth context (`auth.uid()`), never caller JSON. Within a locked transaction re-evaluate active/unrevoked staff grant, exact synthetic event, match eligibility, active lifecycle and expected generation/match version.
2. **Scoped stable idempotency:** Uniqueness by `(event_id, actor_id, submission_id)`; a stable fingerprint binds the request to the exact match, expected version, generation and scores. A repeat matching fingerprint returns the same durable terminal decision, *without reapplying*. A mismatch causes an incident/error, never an overwrite.
3. **Atomic accepted outcome:** Persist the score, match version, monotonic event revision and **accepted** decision record in **one transaction**. No separate "score written, receipt missing" state is allowed after COMMIT.
4. **Atomic terminal rejection:** An actionable `rejected` decision must also be inserted and committed **durably**, with a narrowly defined stable reason such as `stale-match-version`. This is **not** what the current B2i database guarantees. Derive rejection under the same serialization/lock as the acceptance check, and ensure terminal rejection is not recorded before permission/event validation.
5. **Transient failure:** Timeout, lost transport, transaction abort or nonexistent decision remains **unknown**; never label it rejected. Durable outcome query for the exact current actor/event/submission must distinguish committed rejected from missing/unknown. No silent retries or fallback merge.
6. **Snapshot consistency:** Return event revision/generation and caller-owned decision from one authoritative consistent database transaction/snapshot. Keep receipts private; no third-party decisions, staff directories, player contact or ratings. Revocation should deny subsequent requests, not trust a stale JWT role claim.
7. **Trust boundary:** Only a reviewed HTTPS + signed user session + enforced backend authorizations + freshly checked transaction/decision origin may supply evidence to C1's write-recovery gate. Mere JSON parsing or mocked headers **cannot** set `verifiedFromServer:true`. Deployable design needs CSRF/PKCE, session expiry, ownership, race and authorization tests and explicit organizer approval.

### Unsafe/missing pieces to resolve before hosted deployment

- Real `fftt_private.result_submissions` currently lacks a guaranteed durable rejection row. A future migration needs either a **separate terminal-decision ledger** or a carefully reviewed extension; an extension can break existing assumptions on `response` shape, append-only audit triggers and uniqueness. Backfill historical rejected B2i attempts is **not permitted** without evidence.
- PostgreSQL `READ COMMITTED` can observe a revision and receipt at different instants when separate statements are used. The future endpoint needs a proven consistent snapshot (e.g., one transaction with appropriate isolation or a single statement with appropriate locking) plus cross-transaction tests.
- Never log/reveal JWTs, private UUIDs, raw response payloads, emails, registration data or player scores.
- Supabase Data API authorization still requires least-privilege grants/RLS/SECURITY DEFINER review even with a publishable key; no service-role key in client.
- A persisted rejection is **not** permission to automatically replay a stale score; user must obtain an up-to-date match state and decide anew under reviewed workflow.
- A durable accepted receipt resolves *one* request only. Other pending intents, bracket changes and version/regeneration must still be validated before resuming.
- `C3.fetchAuthoritativeSnapshot` and `submitScore` stay disabled, as does the C1 authenticated cloud-resume path until an independently reviewed production-grade implementation exists.

## Code artifacts

- `contracts/phase1c_c11_durable_decision_model.mjs` models one in-memory **serial** match with stable fingerprints, accepted and durable terminal rejected decisions, a lost-ack ambiguity, pre-commit drop, owner-scoped lookup and deterministic duplicate suppression. This is only a toy transaction model: it **does not** prove PostgreSQL atomicity, JWT verification, or true multi-device concurrency.
- `contracts/phase1c_c11_decision_wire.mjs` accepts strict `event_id`, revision, generation, active lifecycle, requested `submission_id`, and an optional terminal decision (accepted/rejected + restricted reason). Both accepted and rejected JSON are **unverified** and C11 always disables writes, retries and replay. A null decision is unknown.
- `tests/phase1c_c11_durable_decision.test.mjs` tests stable same-request idempotency, a simulated race, own-versus-other actor, lost acknowledgement, missing decision, corrupted/foreign data and fail-closed parsing. No network or persistent side effects.

## Verification and approval gate

**Synthetic C11 contract CI PASS:** [GitHub Actions #38367053633](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38367053633) completed successfully on October 13, 2026 for commit `d839c24995297607bd9d9e6d2d8c1cd9214daa8a`. This establishes only correctness of the **simulated protocol** and pre-existing C1/C5/C10 tests, not an actual signed/Auth or database-backed trusted snapshot implementation.

Before a hosted dev schema proposal: inspect existing Auth/role helper, score RPC, table constraints, triggers and grants; produce independent SQL/transaction/security review, rollback preserving B2i evidence, a fresh isolated synthetic test fixture proposal, and explicit permission for exact migrations and tests. **No database changes in C11.**
