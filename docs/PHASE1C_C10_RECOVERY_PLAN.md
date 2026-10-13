# Phase 1C C10 — Synthetic authoritative-state and recovery planner

**Status (October 13, 2026): draft C10 branch only.** C9 mock-only role tests passed in [GitHub Actions #38365235139](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38365235139). Real C9 independent scorekeeper/outsider logins remain NOT VERIFIED; scorekeeper email request returned HTTP 429. No additional hosted email, Supabase mutation, scoring, publication, new users, credentials or production deployment is authorized by this work.

## Existing architectural facts

- **C1** defines cloud authority, pause-on-disconnect, one unresolved score, physically controlled single-device fallback, organizer reconciliation and an independent verified snapshot requirement.
- **C2** is fake-transport-only; it must never advertise a successful authoritative save after a timeout or reconnect without an actual proven backend receipt.
- **C3** supports live **read-only** staff/public operations; `fetchAuthoritativeSnapshot` and `submitScore` intentionally throw.
- **C5** proposed an authenticated event revision and *caller-owned accepted* receipt RPC, but **that SQL is not deployed**. Its decoder always marks `verifiedFromServer:false`, including accepted-looking receipts.
- **B2i** consumed the single hosted synthetic test match. No rerun, reset or cleanup is approved. Its accepted receipt is immutable. An absent receipt is **not** a durable rejected result.

## C10 implementation

`contracts/phase1c_c10_recovery_plan.mjs` is a pure deterministic non-authoritative assessment of C1 state and optional C5-shaped **mock** snapshot. It returns only fixed, privacy-safe outcomes and ALWAYS `cloudWritesEnabled:false`, `retryAllowed:false`, `automaticReplayAllowed:false`, `snapshotVerified:false`. It has no network, browser, timers, credentials, storage, SQL or score operations. The live frontend imports none of C10.

| Scenario | Result | Consequence |
| --- | --- | --- |
| Offline / cloud paused | `offline-wait-for-reconnect` | No writes or automatic retry |
| Reconnected but no trusted snapshot | `awaiting-authenticated-snapshot` | No writes |
| Valid event revision-only C5 JSON | `event-revision-unverified` | No trusted provenance, remain blocked |
| Null receipt for an uncertain score | `submission-outcome-unknown` | Manual review, never infer rejection |
| Accepted-looking C5 receipt | `accepted-receipt-unverified` | Still not proven; never mark saved/resume |
| Cross-event, corrupted, stale or private payload | `invalid-or-regressed-snapshot` | Fail closed |
| Single-device fallback or reconciliation | `organizer-reconciliation-required` | No auto-merge or cloud replay |

`previewC10SingleDeviceFallback` reuses C1's strict organizer checklist with no mutation. Passing the checklist is **not physical proof** that other devices are stopped and is **not permission** to start fallback. Actual fallback requires organizer decision, protected private backup, manual result log, and known revision/generation, plus explicit documented uncertainty if an in-flight score may already have committed.

## Verification

`tests/phase1c_c10_recovery_plan.test.mjs` simulates network interruption, stale/cache revisions, ambiguous submissions, accepted-but-unproven receipts, cross-event leaks, rejected/forged response fields, revision regression, completed events, organizer checklist, and privacy-safe decisions. Branch-only mock CI runs with no Supabase credentials; its status must be independently checked before claiming PASS.

## Remaining gates — not authorized here

1. Independently review the C5 SQL, hosted role isolation and deployment rollback plan; request explicit permission **before** applying any development migration.
2. Build a real signed-Auth/TLS snapshot transport returning server-trusted provenance, with fresh actor/event validation, read consistency and durable accepted/rejected decision semantics. C5 cannot independently prove rejection.
3. Test expired/revoked staff sessions, cross-event reads, concurrent revision races, offline/online conflicts and idempotency using *new approved synthetic fixtures*; do not replay B2i.
4. Demonstrate an organizer-supervised paper/private-backup single-device fallback and manual reconciliation on a separate rehearsal.
5. Production sign-in/scorekeeper onboarding, browser PKCE/logout, real FFTT3 imports and public results are separate decisions.

**Important implementation limitation:** C1 is a provider-neutral reference. Its `verifiedServerSnapshot` relies on the caller to supply genuinely verified provenance. C10 deliberately does **not** call it, including when no score is outstanding. An untrusted snapshot must never be promoted to an authoritative snapshot merely because a parser accepts its JSON.
