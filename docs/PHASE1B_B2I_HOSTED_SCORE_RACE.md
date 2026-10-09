# Phase 1B B2i — Hosted two-scorekeeper scoring race: preparation only

**Status (October 9, 2026):** Planning and offline contract tests only. **No hosted score, staff, Auth, event, or match write is authorized by this document.** The isolated B2g fixture is the single pending match `C-0-0` between Synthetic Fixture Alpha and Beta for the synthetic event dated `2099-01-01`. B2h passed four **real Supabase-issued signed JWT** role/privacy checks through the trusted organizer's Mac, but no hosted signed scoring race has run. Public GitHub Pages, `main`, production and actual FFTT3 data are unchanged.

## Scope and owner approval gate

Prepare a **dedicated** hosted runner and offline verification, *not* a modification to the local-only `tests/b2c_auth_concurrency.py`. The B2c test already validated signed local HTTP score submission races, retry/idempotency, immutable audit, and staff revocation in an isolated disposable CI environment. Its localhost restriction must remain unchanged.

**Before any hosted score POST:** ask for separate explicit approval to mutate **this one synthetic match**. Approval must cover that the completed match may remain complete and may not be automatically restored. Scorekeeping test data can create immutable acceptance receipts/audits, a consolation review and a new event revision. Do not erase those records to force a second test. Also require explicit separate authorization before staff revocation, rollback, or corrective changes.

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

## Hardened operator template (still disabled)

The branch also contains `tests/b2i_hosted_race_operator_DISABLED.py`, which imports the existing **corrected B2h** JWT/Auth helper and the **pure B2i** acceptance oracle. Its `HOSTED_SCORE_WRITES_ENABLED = False` is a deliberate **source-level hard stop** checked immediately in `main`, before any secret key, Auth session or network request. Each potential score HTTP POST independently checks that hard stop again. A local approval phrase *alone* cannot override it. This file is **not** a runnable hosted score test until a separate organizer approval and reviewed follow-up commit explicitly open that hard gate.

For later review, the unenabled code specifies two independent authenticated scorekeepers and a two-worker barrier, builds unique submission UUIDs for opposing fictional winners, validates the exact `C-0-0` matchdesk row, accepts no automatic replay after ambiguous results and emits no tokens or private response bodies. It intentionally leaves the initial operator `main` in non-operating stop mode; it does not perform or claim SQL post-write verification. The offline unit suite includes additional blocked-path and payload checks.

## Acceptance gates

- [x] Create a fail-closed pure response-and-snapshot validator with no network/credentials; 16 offline unit tests added to B2i GitHub Actions.
- [x] Stage a **hard-disabled**, separate Mac-hosted signed-JWT scoring harness and 10 no-network guard tests; no score POST can run until an explicitly approved source change. This is preparatory, not tested hosted scoring.
- [ ] Independently recheck exact hosted preflight, including event/fixture/protected staff and publication.
- [ ] Request and receive **explicit organizer permission to submit two conflicting synthetic hosted match scores**.
- [ ] Only then conduct live race and independently verify post-conditions, idempotent retry and denial semantics.
- [ ] Keep volunteer self-service login UX, account recovery, byes/corrections, consolation bracket generation, public publication, and actual frontend cloud adapter as distinct future steps.

**Historical distinction:** the B2h Auth read-only runner PASSED; the separate B2c local signed scoring race PASSED. Neither constitutes a hosted B2i score-write PASS. The earlier B2f anonymous seven-case probe remains independently not executed.
