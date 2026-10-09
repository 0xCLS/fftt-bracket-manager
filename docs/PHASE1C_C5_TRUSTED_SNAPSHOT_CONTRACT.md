# Phase 1C C5 — Trusted event-revision and own-receipt snapshot: PROPOSAL ONLY

**Status (October 9, 2026):** A proposed **unapplied** PostgreSQL read-only snapshot RPC, pure client JSON decoder and no-network security checks are staged on a stacked draft branch. **No Supabase migration, real authenticated snapshot endpoint, live browser adapter, score write, retry, participant import, staff change, event change, or production cutover has occurred.** This milestone establishes a reviewable design for the missing server-authoritative reconnect gate; it does **not** resolve the C3 reconnect restriction in the deployed system.

## Existing verified source facts

Read-only metadata inspection of isolated Supabase Free development project `copmkalfkkrkzheohwuc` confirmed:

- `fftt_private.events`: `id uuid`, `revision bigint`, `bracket_generation integer`, `lifecycle text`, `synthetic_only boolean`.
- `fftt_private.result_submissions`: primary key `(event_id,actor_id,submission_id)`, plus `match_id`, `generation`, `expected_match_version`, `response jsonb`. The completed B2i synthetic score produced one immutable `accepted` receipt, with `response` keys **`event_revision`, `match_id`, `match_version`, `status`**.
- `fftt_private.staff_role_for_event(uuid)` is the established SECURITY DEFINER, STABLE, empty-search-path role helper. It uses `auth.uid()`, checks the signed `authenticated` claim, requires an active, unrevoked role on the exact synthetic event, and raises `42501` for unauthorized callers. Existing `public.fftt_staff_role_v1` calls this helper; `anon` cannot execute existing public staff RPCs.
- **Critical design constraint:** the transactional scoring system persists the **accepted** result receipt. The rejected competing B2i POST did **not** insert a result receipt. A missing `result_submissions` row might mean rejected, an unsaved/failed network request, not-yet-committed processing, wrong actor or a stale read. Therefore a **null receipt cannot be classified as rejected** or authorize retry.

The one completed B2i rehearsal has event revision **4**, match version **1**, one accepted receipt and zero public results. This test fixture must **not** be reset, replayed or silently used for further writes.

## Proposed signed Auth RPC (NOT deployed)

`supabase/proposals/PHASE1C_C5_SNAPSHOT_DRAFT_DO_NOT_APPLY.sql` is intentionally **not** placed in the Supabase migrations directory. Do **not** copy/apply it to hosted infrastructure on the basis of this draft PR; a separate explicit organizer approval and security review are required.

The proposal contains two functions: a public `fftt_event_snapshot_v1(p_event_id uuid, p_submission_id uuid DEFAULT NULL)` read wrapper, and a restricted SECURITY DEFINER internal `fftt_private.event_snapshot_for_staff_v1`. Both are STABLE with `search_path TO ''`, fully qualified SQL identifiers, and explicit `EXECUTE` grants for **authenticated** only; anonymous and PUBLIC execution privileges are revoked transactionally. The private function calls the existing signed Auth/current-staff helper **before** reading the event or receipt. Result lookup is bound to *the authenticated user's* `auth.uid()`, exact event and requested submission UUID; **no client-supplied actor ID** exists. The SQL has no mutation statement, no dynamic SQL, and returns no player contact, ratings, scores, winner, staff directory, audit rows or third-party receipts.

**Minimum wire response for active synthetic events:**

```json
{
  "event_id": "12345678-1234-4234-9234-123456789abc",
  "revision": 4,
  "generation": 1,
  "lifecycle": "active",
  "resolved_submission": null
}
```

When `p_submission_id` matches an **accepted receipt belonging to the calling staff user only**, `resolved_submission` can instead contain exactly `id`, `status:"accepted"`, `match_id`, `match_version`, `event_revision`, and `generation`. No response field, including `verifiedFromServer`, may be supplied from user/browser input and treated as authorization.

**Unknown, missing or malformed receipt:** `resolved_submission:null` (if no durable acceptance exists), or a server error for malformed persisted values. **Never** return `rejected` merely from absence. All unresolved offline score submissions remain blocked pending manual investigation. Correctly proving rejection requires a separate trustworthy persisted rejection/decision mechanism and a new reviewed protocol—not a guessed default.

## Pure client parser and limits

`contracts/phase1c_c5_snapshot_wire.mjs` exports `decodeC5SnapshotWire` and `c1ReadOnlyEnvelope`. It validates the exact event UUID, strictly allowlisted top-level and nested receipt fields, nonnegative JS-safe revision/generation integers, active lifecycle, exact queried submission UUID, status `accepted` only, and receipt revision/generation no newer than the containing event. Missing receipts are marked `pendingUnresolved=true`; unexpected keys, forged `verifiedFromServer`, extra private fields, bad JSON shapes, future receipt revisions or archived/draft events fail closed.

The decoder **always marks `verifiedFromServer:false`**, even for perfectly formed `accepted` JSON. It does not carry JWTs, access tokens or signatures, perform fetch, connect to a database or store user details. **It must not be treated as security proof.** A separately audited future signed-JWT + TLS transport must establish verified origin and authorized actor, confirm fresh event/revision/receipt against hosted data, and only then produce the C1 `verifiedFromServer:true` provenance signal. **C3's `fetchAuthoritativeSnapshot` remains disabled and must NOT be enabled by this proposal.**

For a reconnect without any in-flight score, C1 still needs a genuine authenticated authoritative event snapshot. For an uncertain in-flight score, C1 requires a positive accepted/rejected decision for that exact request; C5 currently can prove **accepted only**. The proposed RPC alone therefore does **not** solve every recovery path, and the single-device fallback remains organizer-controlled without automatic merge.

## Tests, threat model and approval gates

- `tests/phase1c_c5_snapshot_wire.test.mjs`: **21** deterministic tests for exact-field allowlists, caller-request binding, unsafe revisions, event lifecycle, null receipts, accepted-only semantics, and C1's refusal to trust a mocked browser-supplied verification flag.
- `tests/test_phase1c_c5_snapshot_sql_static.py`: **13** static checks including an actual PostgreSQL SQL syntax **parse** using `pglast`, definer/search-path/grant contract, event and actor scoping, explicit null-safe receipt checks, no private result columns, and absence of SQL table writes. These checks do **not** deploy the SQL or prove real PostgreSQL permission/RLS behavior.
- `.github/workflows/phase1c-c5-snapshot-contract.yml`: runs all 34 no-network tests with no Supabase secrets and no hosted SQL execution.

**Still required before any hosted deployment:** independent SQL security review; disposable PostgreSQL migrations; revoke-after-token and cross-event tests using real signed users; own-versus-other-scorekeeper receipt probes; anonymous/outsider denial; consistency/revision race tests; control of roles/permissions before exposure; signed HTTPS schema and normalized JSON mapping; browser Auth with individually authorized accounts; secure handling of incomplete score outcomes; approval for the specific hosted **schema mutation**, with rollback plan and independent post-deploy checks. Updating a function or executing the proposal against the live development project is **not** approved by earlier B2h/B2i score-test authorization.

## Relation to other phases

C1 = reference pause/fallback gate; C2 = mock client; C3 = read-only hosted protocol mapper without snapshot endpoint; C4 = standalone localhost browser simulation; **C5 = draft SQL and parser/security acceptance contract only**. All remain unmerged drafts; the public `index.html`, `main`, GitHub Pages, localStorage/JSON backup, actual FFTT3 players and completed 2099 B2i fixture are untouched.
