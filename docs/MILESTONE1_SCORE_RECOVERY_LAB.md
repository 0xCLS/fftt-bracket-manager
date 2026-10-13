# Milestone 1 — Consolidated Synthetic Score and Recovery Lab

_October 13, 2026 · integrated with the existing three-milestone roadmap, not a new C-phase._

## What works in this development batch

**One signed V2 score transport — disposable local Supabase only.**
- `contracts/milestone1_signed_local_score_transport.mjs` is hard-pinned to **`http://127.0.0.1:54321`**, which the Supabase CLI exposes only on the testing computer. The host is not configurable to the existing hosted development or real FFTT3 service.
- It requires an injected **existing user Auth JWT**, a public local key and an explicitly injected network function. It has exactly two allowed RPCs: `fftt_submit_match_result_v2` and caller-scoped `fftt_score_decision_snapshot_v2`. It cannot create accounts, grant roles, publish results, use a service/secret key, or call legacy score RPCs.
- A submission ID is **one-attempt only even on an HTTP timeout**. Strict request and response validation prevents malformed identifiers, extra private fields, and incorrect acceptance versions. A score POST acknowledgement is intentionally `receiptValidated:false` until a subsequent signed own-decision read.

**One provider-neutral score/recovery workflow.**
- `contracts/milestone1_score_session.mjs` validates signed role and an event-scoped pending Match Desk against two matching V2 event-revision snapshots *before* allowing a disposable local score attempt.
- **Two human steps are required:** (1) prepare the exact random request ID and review scores; (2) record the private ID and incident log, then explicitly send that prepared request once. No implicit submit, automatic score retry, local storage, queue or auto-sync.
- On network loss after a POST, the result is **UNKNOWN**; recovery is a *separate*, manually initiated authenticated **own-decision** read. Missing receipt cannot be called rejected. Conflicting receipt, revoked role, mismatched actor-scope or regressed version keeps scoring disabled.
- A received ACK is **provisional**, not evidence of a committed receipt. Even a confirmed local test decision does **not** immediately resume scoring: the tester must acknowledge it and perform a fresh role/desk/revision reload.
- Offline mode pauses writes and never queues them. Organizer-directed fallback is a **checklist preview only**: protected backup, physically stopped devices, manual log, documented uncertain outcome and later individual reconciliation are required. Checkbox input is not proof that other devices are stopped and cannot convert test-only state into production authority.

**Usable browser lab.**
- Open `rehearsals/m1/index.html` in a local static server to run two independent *simulated* scorekeeper panels sharing one fictional in-memory event. It presents prepare/record/send/check-receipt actions, lets Scorekeeper A lose an ACK after the server simulation commits, and shows Scorekeeper B's durable stale rejection.
- A summary panel shows the **fictional event revision and decision count**. The spectator panel always shows **zero published events**, even when the private in-memory match completes. No private names or scores leave the page.
- `rehearsals/m1/` has CSP `connect-src 'none'`; the browser lab makes **zero HTTP calls to Supabase or any other remote service**. Restarting it resets ONLY the volatile page simulation, never a hosted fixture.
- The existing hosted C8 Magic Link reader remains **read-only**, and the live application `main:index.html` remains unchanged.

## Consolidated verification

- `tests/milestone1_signed_local_score.test.mjs` covers loopback-only restrictions, JWT, strict score field mapping, single-use submissions on timeout/403/409/bad JSON, exact owner-scoped snapshot, and forbidden extra/private fields.
- `tests/milestone1_score_session.test.mjs` covers role-scope double reads, prepare-before-post, manual incident-record prerequisite, receipt validation, lost ACK, unknown/missing receipt, revocation, in-flight disconnect, stale decisions, and fallback/reconciliation checks.
- `tests/milestone1_score_lab_browser.py` uses real Chromium to rehearse both fictional scorekeepers, lost ACK after commit, a durable stale rejection, own-receipt resolution, public privacy, single-device fallback preview, and mobile layout. It intercepts all non-local URLs and fails if **any** external request is attempted.
- All run in the existing consolidated PR CI, alongside existing UI/safety/bracket tests and disposable PostgreSQL/GoTrue signed concurrency. These are test-only operations.

## Operational boundaries: what is NOT approved or done

1. **Both hosted B2i and hosted V2 fictional fixtures were already consumed and remain untouched.** This batch creates no new hosted synthetic fixtures, sends **no hosted score POST**, changes no Supabase roles/schema, and does not touch any real FFTT3 registration or match result.
2. The browser lab is *not* genuine shared realtime multi-device behavior; its two scorekeepers share a volatile local model within one page. The local-only signed scoring transport is *not* wired into the hosted browser app. Existing local signed GoTrue/PostgREST backend tests independently verify the real server's race behavior, but do **not** mean the browser lab used real signed sessions.
3. End-user Auth UX still needs a production-appropriate PKCE/signed flow, isolated real-browser/device tests and a documented incident-retention strategy that survives unexpected tab closure. Local UI checkboxes cannot physically isolate another device.
4. Prior to a hosted score-writing browser rehearsal, request **fresh explicit approval** for one **new** fictional 2099 fixture and strictly scoped new test writes. No authorization for production or publishing real player results is inferred.
5. Live automatic bracket/spectator synchronization, full trusted production recovery and event-day offline single-device cutover/reconciliation remain subsequent integration and acceptance requirements. Do not merge the draft PR or deploy production based on synthetic-green CI alone.

## Local operator walkthrough (zero hosted operations)

From a checkout of the approved integration branch:

```bash
python3 -m http.server 3001 --bind 127.0.0.1
```

Open `http://127.0.0.1:3001/rehearsals/m1/index.html`. Load the two fictional Match Desks, prepare both scores while the event is revision 0, copy/record each test-only submission ID, enable the human confirmation checkboxes, optionally simulate the first scorekeeper losing its HTTP response, submit once for both accounts, then inspect each account's own decision. Use the organizer fallback preview to inspect mandatory controls; it is not an approval or active fallback. Stop the server with Control+C.

Do not use the old hosted B2i or V2 runner. No real account or secret key is needed for this **fully local**, in-memory browser exercise.
