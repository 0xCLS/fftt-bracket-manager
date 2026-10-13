# Milestone 1 — Connected Browser Match Desk Integration

_2026-10-13 · single cohesive implementation batch in draft PR #19 · synthetic only_

## Delivered working components

- The existing localhost-only `rehearsals/c8/index.html` remains the **single login entry**. Its existing fixed C8 Magic Link callback stays unchanged; no new OAuth redirect, Auth setting or Supabase migration.
- A new **Connected event revision (V2)** area lets an existing individually authenticated organizer or scorekeeper enter a synthetic event UUID and click **Refresh connected desk**.
- The browser makes only signed event-role lookup, `fftt_score_decision_snapshot_v2` (read-only revision and null own submission), the event-scoped pending Match Desk read, and a second V2 snapshot. It requires a matching event revision/generation across both V2 reads or **rejects and clears the entire private view**. The display includes current role, event revision, bracket generation and allowlisted pending match names/versions only.
- The new `contracts/milestone1_connected_desk.mjs` ensures a read-only, closed-by-default state machine with no credentials, no persistence, no scoring route, no score replay, no fallback writes, no refresh token, no network retry and no cached private-state fallback. A pending response received after sign-out/disconnect cannot restore the view.
- Mobile-friendly connected control layout reuses the existing approved C8 rehearsal styling; the production `index.html` and its tournament UI remain byte-identical to `main`.

## Practical use (existing synthetic accounts only)

1. On the trusted Mac, from the integration branch repository root run `python3 tools/c8/local_readonly_server.py`. Open `http://localhost:3000/rehearsals/c8/index.html`.
2. Sign in using the **existing** synthetic organizer or scorekeeper Magic Link, following the established same-browser flow. Never share links or tokens. No new accounts or rate-limit retries.
3. Enter the private **previously approved synthetic event UUID** and click **Refresh connected desk**. The **already-consumed hosted V2 event** should show revision **1**, generation **1**, with **zero pending matches**. It is not a new scoring fixture.
4. Use **Pause / hide private view** or **Clear local session** to discard private data. After losing/recovering connectivity, or after a hidden tab resumes, **manually refresh**. No offline mutations or server writes are sent.
5. A second independently signed browser session can run the same read from a separate profile/device when expressly rehearsed. This page does **not** automatically subscribe to Realtime or broadcast private event data; it never publicly exposes the staff Match Desk.

## Regression gate

- `tests/milestone1_connected_desk.test.mjs`: signed double read, immutable allowlisted display, absent/denied role, stale event revision, unexpected private fields, disconnect/expiry, in-flight sign-out, no score path, no fallback path.
- `tests/milestone1_connected_browser.py`: **real Chromium with three isolated browser contexts and all remote Supabase requests intercepted**. Exercises organizer + scorekeeper revised event reads, outsider denial, mid-read revision race, network failure, deliberate offline pause, sign-out and mobile layout. No live Auth OTPs or hosted writes.
- Both are added to the existing consolidated PR workflow; no new workflow or automatic production deployment.

## Verified consolidated CI result

[GitHub Actions run #38430476452](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38430476452) **PASS on first attempt** at executable commit `e062a77fa0912953b18f0e8cc93cd5b71ee83e04`. Both existing CI jobs passed: **165/165** synthetic Node tests (including nine new connected-controller tests), eight static v2 SQL checks, seven hosted-runner source guards, a real Chromium rehearsal of two independent signed browser contexts plus outsider (all Supabase traffic mocked/intercepted; **no hosted requests**), and existing browser UI/tournament suites. The disposable job passed **81/81** base PostgreSQL pgTAP assertions, actual local V2 SQL decision/revision/authorization checks and the independently signed local GoTrue/PostgREST concurrent-score race. Browser test explicitly confirmed mobile layout, stale revision denial, network outage clearing, signed-role privacy, no JWT browser storage, and **zero browser score/admin calls**.

Documentation certification was added **after** the green execution and does not change executable source. This is not a production cutover or proof of actual real-device synchronization.

## Evidence limitations and next integrated work

This verifies a meaningful **read-only shared-state browser path**, not a full event snapshot or authoritative bracket history: the existing server Match Desk lists only pending matches; the consumed hosted fixture has no pending matches and public results remain unpublished. A stable revision across two reads **does not guarantee** the desk data and revision were produced by one atomic PostgreSQL snapshot, and it must **never** authorize a score write. The V2 own-decision parser intentionally reports `cloudWritesEnabled:false`.

The remaining Milestone 1 browser/operations batch must safely integrate real signed score-write submission behind a fresh authorized fictional fixture and separate write permission, server-proven receipt/reconnect, independent devices and explicitly organizer-controlled offline fallback. That is **not** covered by the current authorization, and neither B2i nor V2 consumed fixtures may be replayed.

The October 12 three-milestone roadmap remains authoritative. The full hosted V2 verification is preserved separately in [MILESTONE1_HOSTED_V2_AUDIT.md](MILESTONE1_HOSTED_V2_AUDIT.md).
