# Milestone 1 — Hosted V2 Signed Race and Independent Database Audit

_Date: October 13, 2026. Synthetic-only hosted development evidence. Not a production release._

## Acceptance: PASS

Christopher executed the **already approved, one-time Mac-local hosted race** using the pinned `tests/milestone1_v2_hosted_once.py` at the current draft integration commit `40baf6615726356e6dd7b39641b9fb06a5227efa` and shared safe runner status output. A **separate, read-only connected Supabase audit** then independently verified persisted state and authorization metadata. No private event/match UUIDs, account emails, JWTs, API keys or score-submission IDs are included here.

**User-observed signed HTTP result:** All four existing synthetic accounts were independently authenticated with GoTrue-issued user JWTs. Organizer and two scorekeepers had the expected event-scoped roles; a signed-in outsider and an anonymous caller were denied the private read. The two scorekeepers saw exactly the same one pending fictional match and generation-1 event snapshot at revision 0. Exactly two conflicting score POSTs were sent, once each:

| Role | HTTP | Durable decision |
| --- | --- | --- |
| Scorekeeper A | 200 | `rejected`, `stale-match-version` |
| Scorekeeper B | 200 | `accepted` |

Each scorekeeper subsequently read their own committed decision through the signed snapshot RPC but not the other's, and the outsider could not read the accepted decision. The operator reported `HOSTED MILESTONE 1 V2 RACE AND OWN-DECISION RECOVERY READS: PASS` and a locally persisted **one-time attempt marker**. The **new fixture is consumed**, just as the historical B2i match was; neither must be replayed or reset.

## Independent hosted SQL audit — verified PASS

The connected Supabase SQL audit was read-only against the existing synthetic-only `fftt-bracket-manager-dev` project, after the above score requests. The audit targeted the exact new synthetic event name/date rather than public or participant IDs.

| Integrity criterion | Independently verified persisted result |
| --- | --- |
| New event | Exactly one synthetic 2099-11-22 V2 event; lifecycle `active`, bracket generation 1, event revision **1** |
| Championship final | Exactly one complete match, match version **1**, table **1** |
| Fictional result | **Synthetic V2 Beta** wins; game scores **7–11, 8–11, 9–11** |
| Terminal decision ledger | Exactly **2** rows, **1 accepted + 1 rejected** for `stale-match-version` |
| Decision integrity | Two distinct authorized scorekeepers and two distinct submissions; both link to the completed match, generation 1, event revision 1 and match version 1 |
| Legacy acceptance receipt | Exactly **1** new accepted `result_submissions` row, linked to the accepted decision and matching revision/version |
| Append-only score audit | Exactly **1** new `result_accepted` audit at event revision 1, matching accepted actor and match |
| First championship loss | Exactly **1** new `eligible` consolation review, linked to the actual fictional losing player |
| Original consumed B2i event | Unchanged: event revision **4**, completed match version **1**, Synthetic Fixture Alpha wins **11–7, 11–8**, **1** historical accepted receipt, **4** historical audit rows, **1** original consolation review and **3** original staff grants |
| New event staff | Exactly **3** new-event-only staff grants, no new Auth accounts (still **4** accounts total) |
| Public exposure | Both public publication tables contain **0 rows** |
| API security | Legacy v1 score execution denied to authenticated browser roles; v2 score/snapshot denied to anon; direct private decision-table SELECT denied to authenticated roles |
| Unexpected data | No non-synthetic/earlier-date events, no extra decision statuses or extra results |

The backend-vs-client distinction matters: the signed **HTTP** output establishes per-actor own-decision access and outsider denial in this controlled rehearsal; SQL separately establishes the persisted decisions, audit linkage, privacy of raw table grants and correct match version. The independent SQL audit does **not** claim to independently decode or retain private JWTs or prove normal inbox-driven volunteer login.

**No replay, reset, correction, new publication, account change or production deployment was performed as part of the independent audit.**

## Milestone 1 status after this gate

- **Hosted synthetic backend gate: PASSED** for a real signed two-scorekeeper race, one accepted and one durable rejected decision, revocation/idempotency as previously locally tested, event/actor-scoped trusted receipt reads, audit and no publication.
- **Not yet production-ready:** Existing `main:index.html` remains a browser-local tournament app. The isolated prototype does not yet wire a safe signed **score-write client**, authoritative reconnect/unknown-result recovery, browser/device synchronization, spectator/TV privacy controls or organizer-controlled offline single-device fallback. These must be integrated and tested as one remaining Milestone 1 application batch.
- **Approvals remain separate** for any additional hosted database/account changes, new synthetic scoring fixtures, real FFTT3 players, production infrastructure, public player publication or production cutover.
- Draft [PR #19](https://github.com/0xCLS/fftt-bracket-manager/pull/19) remains unmerged and in review. The production `main` app is unchanged.

## Source conflict / resolution

Earlier documentation and the runbook describe a *pending* V2 race because they were created **before** the organizer's October 13 one-time execution. Those are historical operator instructions and must **never be followed again for the consumed fixture**. This dated post-race record and current roadmap/status supersede those earlier operational statuses, without rewriting the historical B2i result or the original candidate SQL provenance.
