# Phase 1B B2i — Hosted two-scorekeeper scoring race: preparation only

**Status (October 9, 2026 — one-match score race approved; operator execution pending):** The organizer explicitly approved **exactly two opposing signed score submissions** against the single fictional pending match. A dedicated Mac operator script and mocked tests are staged, but **no live score has been submitted yet**. The isolated B2g fixture is the single pending match `C-0-0` between Synthetic Fixture Alpha and Beta for the synthetic event dated `2099-01-01`. B2h passed four **real Supabase-issued signed JWT** role/privacy checks through the trusted organizer's Mac, but no hosted signed scoring race has run. Public GitHub Pages, `main`, production and actual FFTT3 data are unchanged.

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
- [ ] Independently recheck exact hosted preflight, including event/fixture/protected staff and publication.
- [x] **Organizer approved exactly two opposing fictional score POSTs** for the single synthetic pending match; no other writes or retries authorized.
- [ ] Execute **only the two approved conflicting score POSTs** once on the organizer's Mac, then independently verify match/receipt/audit state. Extra idempotent and stale-retry write tests require separate approval.
- [ ] Keep volunteer self-service login UX, account recovery, byes/corrections, consolation bracket generation, public publication, and actual frontend cloud adapter as distinct future steps.

**Historical distinction:** the B2h Auth read-only runner PASSED; the separate B2c local signed scoring race PASSED. Neither constitutes a hosted B2i score-write PASS. The earlier B2f anonymous seven-case probe remains independently not executed.
