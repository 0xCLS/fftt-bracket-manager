# Phase 1B B2i — Hosted two-scorekeeper scoring race: preparation only

**Status (October 9, 2026 — B2i HOSTED RACE PASSED, independently audited):** The organizer executed **exactly one** previously approved, two-scorekeeper hosted race via the pinned Mac launcher. Terminal confirmed Scorekeeper A HTTP **200 accepted**, Scorekeeper B HTTP **400 rejected**, with no retry. Independent read-only Supabase inspection verified **Synthetic Fixture Alpha** won pending fixture `C-0-0` by **11–7, 11–8** (match version **0→1**, event revision **3→4**), with exactly one accepted receipt, one linked acceptance audit, and one consolation eligibility record for Synthetic Fixture Beta. No staff assignments or publication changed. Public GitHub Pages, `main`, production and actual FFTT3 data remain unchanged. **This fixture is consumed; NEVER rerun this launcher against it.** Hosted replay/idempotency, organizer revoke/grant, volunteer-owned login, corrections/byes and deployment remain separate pending gates.

## Observed hosted race and independently verified persistence (October 9, 2026)

**Execution evidence:** The organizer ran `Run_B2i_Approved_Score_Race.command` on their Mac with the pinned source commit `928d4e6eb93e7cfc586bd8fe9fd595cfa9e46e01` and exact separately approved event/match IDs. The CLI confirmed preflight of all four existing Auth accounts and individually verified server-issued JWTs, correct organizer/scorekeeper roles and one pending match, outsider/anonymous denial, real private-schema `Accept-Profile` denial, and zero public results. The two independent scorekeeper workers started their competing HTTPS submissions through a barrier. **Exactly one test run** was reported:

| Identity | Observed response | Proposed winner | Actual result |
| --- | --- | --- | --- |
| SCOREKEEPER_A | HTTP 200; `status=accepted` | Synthetic Fixture Alpha, 11–7, 11–8 | **Persisted** |
| SCOREKEEPER_B | HTTP 400; rejected | Synthetic Fixture Beta, 8–11, 7–11 | **Not persisted** |

**Independent connected Supabase SQL evidence:** The event is still exclusively `2099-01-01`, `synthetic_only=true`, one event with two fictional players and one now-**complete** generation-1 championship bracket/match. `C-0-0` persisted as **complete**, version **1**, winner **Synthetic Fixture Alpha**, score `11-7, 11-8`, table 1. Event revision became **4** (from 3). Exactly **one** `result_submissions` row reports `accepted` for **SCOREKEEPER_A**, with the correct match, generation 1, expected version 0, returned match version 1 and event revision 4. Exactly **one** `result_accepted` immutable audit at revision 4 links that same actor and match; the audit's winner and scores agree with the persisted match. Audit count is **four**: original two administrator staff grants (revisions 1–2), bracket-build provenance (revision 3), then score acceptance (revision 4). Exactly **one** eligible consolation review exists for **Synthetic Fixture Beta** (the losing player) and the exact match. **Zero** pending matches, zero published events/matches. Existing **one organizer, two active scorekeepers, no outsider grant, four Auth accounts** remain unchanged.

**Acceptance:** B2i's narrow objective—independently authenticated *hosted* simultaneous competing scores on one synthetic match, exactly one server-side acceptance and persisted durable outcome, rejection of the other, correct audit/receipt/consolation behavior and no accidental public exposure—is **PASS**.

**Scope and next gates:** Although local B2c tests cover idempotent retries/revocation, **no additional hosted score POST**, stale/exact retry, organizer staff grant/revoke, corrective action, new fixture, full bracket/bye propagation, ordinary volunteer-operated login, offline fallback or production rollout was authorized or performed here. Do not assume these are proven hosted. The **original B2i operator launcher must never be rerun** against this completed fixture; no automatic reset or deletion is permitted. Any fresh synthetic test fixture or write requires an explicit new approval. Keep the source commit and terminal outcome as provenance and the private match/event UUIDs in the canonical private maintenance log, not public code.

## Scope and owner approval gate

Prepare a **dedicated** hosted runner and offline verification, *not* a modification to the local-only `tests/b2c_auth_concurrency.py`. The B2c test already validated signed local HTTP score submission races, retry/idempotency, immutable audit, and staff revocation in an isolated disposable CI environment. Its localhost restriction must remain unchanged.

**Approval granted October 9:** Exactly **two competing HTTP POST scores** on this single synthetic test match are authorized, knowing an accepted result will close the fixture and create immutable audit/receipt/revision state. No repeat attempts, corrections, staff changes, reset or publication were authorized. A separate Mac-local exact confirmation is still required to start the two submissions; do not erase records to force a second race.

## Required preflight (from fresh independent hosted database reads)

- Hard-pin Supabase project ref `copmkalfkkrkzheohwuc`, event's exact private UUID and event date `2099-01-01`; verify `synthetic_only=true`, exact event title `B2e Synthetic Hosted Rehearsal — NOT FFTT3`, and **exactly one event**.
- Event revision **3**, bracket generation **1**, exactly one organizer and two authorized scorekeepers, no outsider role.
- Exactly **four** confirmed existing Auth identities, two fictional players, one active championship bracket and **one pending** `C-0-0` match, match version **0**, no winner/scores.
- Exactly three existing immutable audit records: two administrator staff grants and one administrator bracket build. Zero score receipts, completed matches, published events and public matches.
- Generate independent **real signed JWTs** from the existing accounts using the private, locally entered `sb_secret_` (same corrected raw GoTrue handling as B2h). Never put a private key, JWT, email address, real participant data or match UUID in the public repo or a screenshot.
- Stop immediately if any field differs, if token exchange/identity fails, or if already completed/submitted. Never rebuild the B2g fixture automatically.

## Proposed conflict: one match, two independent scorekeepers

Use two concurrent HTTPS clients and a start barrier, both with genuine, independently verified scorekeeper JWTs, to `POST /rest/v1/rpc/fftt_submit_match_result_v1` with the **same** event/match/generation and expected version 0, but unique submission UUIDs and incompatible results:

- Scorekeeper A: Synthetic Fixture Alpha wins, `p_game_scores="11-7, 11-8"`.
- Scorekeeper B: Synthetic Fixture Beta wins, `p_game_scores="8-11, 7-11"`.
- Both require exact `p_event_id`, `p_match_id`, `p_bracket_generation=1`, `p_expected_match_version=0`, `p_submission_id`, `p_winner_id`, `p_game_scores`, `p_table_number=1`. The server—not the client—chooses which submission commits first.

Pass requires **exactly one** HTTP 200 response containing `status=accepted` and exactly one competing 4xx response. A timeout, 5xx, two successes or any ambiguous outcome is **not a pass**; inspect database state without resubmission.

## Post-race independent evidence and recovery (must be designed before write)

- Confirm a single completed match, version **1**, event revision **4**, same championship bracket generation **1**, winner and score exactly matching the accepted submission.
- Exactly **one** accepted result receipt, **one** `result_accepted` audit, **one** consolation review candidate, **four** total immutable audit entries. Both staff grants remain; zero public events/matches.
- Exact **same actor and same payload** idempotent retry should return original acceptance without extra audit, receipt or revision; changed payload with reused submission ID must be rejected. A competitor's stale retry must be rejected.
- Signed-in outsider and anonymous caller cannot submit a score. Do not include organizer grant/revoke in the initial authorized race: a separate gate applies.
- Capture a safe test report with only labels, statuses, versions and counts; **never** log JWTs, private keys, one-time magic links or response bodies containing private player data.
- **On uncertain network outcome, stop all writes**; independently read the match, receipts and audit before retrying anything. Do not run a destructive reset or replay a second race on the same completed match. Preserve immutable history; any new fixture/correction/revocation requires new organizer approval.

## Staged, approved and individually pinned operator (not yet executed)

The historical `tests/b2i_hosted_race_operator_DISABLED.py` stays **unchanged and hard-disabled** with `HOSTED_SCORE_WRITES_ENABLED = False`. After explicit organizer approval, a **separate** `tests/b2i_hosted_race_operator_APPROVED.py` was added. It cannot execute unless called with `--execute-approved-one-match`, the organizer types the exact phrase `AUTHORIZE EXACT B2I SYNTHETIC SCORE RACE`, the entered private event and match UUIDs match **SHA256-pinned** exact synthetic identifiers, and all B2h signed-JWT staff/privacy and one-pending-match checks pass. Without the execution flag it reports dry-run and makes no network request.

The **approved** script uses two signed scorekeeper sessions and one two-worker barrier for exactly two incompatible scores with unique submission UUIDs, original match version 0, and the exact fictional players. It prints only actor labels, HTTP statuses, and accepted/rejected status; never JWTs, tokens or response bodies. A network timeout, 5xx or ambiguous result **stops all writes without replay**. The user reports the result; ChatGPT must independently inspect hosted match/receipt/audit/publication state before declaring a persisted B2i PASS. The original disabled runner and local-only B2c harness remain unchanged. In addition to 16 offline acceptance and 10 disabled-template guard tests, **11** newly staged approved-operator mock-only tests check event/match pins, local approval and exactly-two-call behavior.

## One-time Mac operator launcher (prepared; no live score POST yet)

A minimal `FFTT_B2i_Approved_One_Match_Race_Mac.zip` launcher has been prepared for delivery in ChatGPT. The archive contains a README and `Run_B2i_Approved_Score_Race.command`, **not the private secret key, test accounts, signed JWTs or generated magic-link tokens**. The launcher downloads exactly three reviewed Python files from **immutable application commit `928d4e6eb93e7cfc586bd8fe9fd595cfa9e46e01`**, compiles them locally, then invokes the approved operator with `--execute-approved-one-match`. A hidden local Supabase `sb_secret_` prompt is used exactly as in successful B2h; no key is transmitted to GitHub or ChatGPT.

The operator must enter the preexisting organizer email, **private** synthetic event and match UUIDs from the canonical private changelog, plus the printed `AUTHORIZE EXACT B2I SYNTHETIC SCORE RACE` phrase. The code pins **both** identifiers by SHA256 without exposing the exact private UUIDs in the public application, verifies real signed Auth permissions and unchanged one-match read desk, and submits at most **two** incompatible scores with zero retries. The source-level switch remains on **only in this separate approved operator**, not in the untouched `_DISABLED.py` template. The Mac ZIP was verified for valid archive contents, executable launcher permission and shell syntax.

CI for the pinned application commit: [B2i offline checks run #37970322182](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37970322182) **passed all 37 mock/pure-logic tests**; [browser regression run #37970322085](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37970322085) **passed**. These tests did **not** contact hosted Auth or submit scores. An independent read-only live database preflight confirmed on October 9: exactly one event dated 2099-01-01 at revision 3; confirmed four Auth users; one organizer, two scorekeepers, no outsider grant; two fictional players, one active championship bracket, one pending `C-0-0` match version 0 with no winner/scores; three earlier audits, no score receipt or accepted-result audit, and no public results.

**Execution boundary:** Although already specifically approved by the organizer, the actual score race is **not** claimed complete until the Mac operator runs. On any timeout/error or missing final success line, the owner **must not rerun**; request read-only authoritative database inspection first. Even when terminal reports exactly one accepted score, a separate persisted-state audit is required before treating B2i as a hosted PASS. No extra idempotent replay, staff revocation, correction, result publication or new fixture is authorized by this test.

## Acceptance gates

- [x] Create a fail-closed pure response-and-snapshot validator with no network/credentials; 16 offline unit tests added to B2i GitHub Actions.
- [x] Keep historical hard-disabled source plus 10 tests, and stage an **approved**, pinned and Mac-local gated operator with 11 additional mocked no-network tests. No hosted scoring has occurred yet.
- [x] Independent hosted preflight matched all protected fixture/staff/publication fields **before** the approved run.
- [x] **Organizer approved exactly two opposing fictional score POSTs** for the one synthetic pending match; no other writes or retries authorized.
- [x] One-time approved Mac execution: Scorekeeper A HTTP **200 accepted**, Scorekeeper B HTTP **400 rejected**, both with genuine Supabase Auth. Independently verified persisted winner/scores/version/revision, single receipt, audit actor/winner/score linkage, consolation eligibility, retained staff assignments and empty public results.
- [ ] Hosted exact idempotent retry, stale retry, and scorekeeper revocation tests remain **unperformed** and require fresh approval; do not reuse the completed fixture.
- [ ] Keep volunteer self-service login UX, account recovery, byes/corrections, consolation bracket generation, public publication, and actual frontend cloud adapter as distinct future steps.

**Historical distinction:** B2h Auth read-only PASS and B2c local signed race PASS preceded the now **independently confirmed hosted B2i score-write PASS**. The original B2f anonymous seven-case probe itself was not run. B2i verifies a narrow one-match concurrency case, not the whole tournament, production app, or volunteer self-service workflow.
