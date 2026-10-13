# Phase 1C C2 — Mock shared-client score/connection controller

**Status (October 9, 2026):** A new pure-logic JavaScript client wrapper plus **19 no-network integration-style tests** are staged on an **unmerged draft branch stacked on C1**. This is **NOT the deployed application, a working Supabase adapter, or production-grade authentication**. There are no network credentials/requests, actual score submissions, event edits, database migrations, or browser-local storage changes.

## Purpose and relationship to verified B2i

The B2i synthetic hosted rehearsal **already PASSED** real signed scorekeeper conflict testing, and its one pending match is now **complete and must never be replayed**. C2 does **not** repeat B2i. C1's provider-neutral authority gate defines what happens when shared scoring is online, stale, disconnected, in isolated fallback or under organizer reconciliation. C2 adds a *mockable client integration layer* so these boundaries can be exercised against a fake server without touching B2i, live GitHub Pages or FFTT3 data.

References: [Phase 1A contract](PHASE1A_SHARED_EVENT_CONTRACT.md), [C1 tested authority gate](PHASE1C_C1_OFFLINE_AUTHORITY.md), [B2i hosted evidence](PHASE1B_B2I_HOSTED_SCORE_RACE.md).

## Files

- `contracts/phase1c_mock_shared_client.mjs`: Exports `MockableSharedMatchClient`. It imports C1's pure authority state machine. An injected `transport` supplies `readMatchdesk`, `submitScore` and `fetchAuthoritativeSnapshot`. **No transport implementation is provided or invoked outside tests.**
- `tests/phase1c_mock_shared_client.test.mjs`: 19 Node standard-library tests with fake transports for accepted/conflict/unknown-result/delayed-response scenarios, private matchdesk-field checks, snapshot staleness, isolated fallback and manual reconciliation.
- `.github/workflows/phase1c-mock-shared-client.yml`: Runs only the mock test suite, with Node 22 and **no Supabase/project secrets or network calls**.

## Controller boundaries

| Trigger | Required testable behavior |
| --- | --- |
| Matchdesk read | Read only in fresh cloud-ready state. Reject cross-event rows, malformed versions and unknown fields including email/phone/rating. Discard late responses after disconnect. |
| Submit score | Require correct event/bracket generation and one in-flight submission at a time. The injected transport must later be implemented with genuine, scoped signed Auth. No optimistic save. |
| HTTP `200 accepted` | Only mark saved when server-style response confirms the exact in-flight `submission_id`, newer `event_revision` and non-regressed `bracket_generation`. A successful-looking response missing these becomes **uncertain**, not saved. |
| HTTP 4xx conflict | Return rejected, mark view stale, require server refetch before any other score. |
| HTTP 5xx, timeout or network exception | Return uncertain, pause writes, retain submission ID for **server-verified** resolution; never automatically retry. |
| Disconnect during a request | Delayed acknowledgement cannot re-enable scoring or overwrite the paused state. |
| Reconnect/Realtime notification | Never treat a notification or restored Wi-Fi as sufficient to resume; require a verified authoritative event/revision/generation, and receipt outcome for any uncertain write. |
| Organizer-selected isolated fallback | Requires explicit outage/other-device-paused/private-backup/manual-log acknowledgements; no cloud submission while active. Reconnect enters organizer reconciliation rather than auto-sync. |
| Manual reconciliation | Review all private local changes and ambiguous receipts; reload non-regressed authoritative server state after approval before allowing cloud score intents. |

**Mocked test limitations:** The fake `transport` is deliberately *not* an Auth/JWT verifier, an HTTP client, a Supabase database connection, a Realtime subscriber, a player-data repository or an actual offline JSON exporter. For a real adapter, every result must be bound to server-authenticated user/session, event and RPC endpoint permissions, and must use the backend's concrete result/receipt schema. The mock's `accepted` response shape is a **logical future transport envelope**, not a claim that hosted `fftt_submit_match_result_v1` currently returns all of those exact fields. A future protocol mapper may be needed.

**Human-only authority controls:** This model can require flags that the organizer says other devices have stopped or that a private backup was reviewed; it cannot force remote devices offline, stop volunteers physically or adjudicate scores. Do not expose a public UI toggle that bypasses independent organizer authorization.

## Validation

```sh
node --check contracts/phase1c_mock_shared_client.mjs
node --test tests/phase1c_mock_shared_client.test.mjs
node --test tests/phase1c_disconnect_reference.test.mjs
```

All tests are designed to run without packages, network, credentials, or localStorage. **Passing mock CI does not establish real multi-device reconnection, browser storage separation, volunteer login or production capability.**

## Next safe steps and hard gates

1. Review actual hosted RPC JSON shapes and field allowlists; write a **read-only** test-only protocol mapper that translates real public REST responses into the mock controller's logical envelope. Do not submit another score or edit the consumed B2i fixture.
2. Build browser-only harness tests for a simulated two-device score desk and synthetic delay/offline UI indicators on a **draft branch**. Avoid rewriting or attaching the current `index.html`, its v0.1 localStorage key, Undo behavior or existing JSON backups before a separate UI integration review.
3. Exercise true hosted outage/reconnect plus organizer-controlled backup/reconciliation on **new, specifically approved synthetic fixture(s)** before treating the integration as operational. Real volunteer sign-in UX, bracket/bye/correction coverage and production cutover remain distinct.
4. Do not use real FFTT3 registrants, contact details or private player sheets. No merging to `main`, deploying GitHub Pages, creating paid infrastructure, publishing participant results, or changing staff grants based on C2 mock tests.

**Current state:** C2 demonstrates the planned **client orchestration semantics only**. C1 is an authority reference, B2h and B2i are the actual prior hosted signed-Auth/rehearsal evidence, and the public app remains **single-browser local-only**.
