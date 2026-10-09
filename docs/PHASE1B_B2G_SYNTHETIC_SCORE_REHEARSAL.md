# Phase 1B B2g — Guarded synthetic match and concurrency rehearsal

**Environment:** `fftt-bracket-manager-dev` Supabase Free, ref `copmkalfkkrkzheohwuc`. **Scope:** one isolated synthetic event dated **2099-01-01**, *never* FFTT3, actual volunteers or registration records. The public GitHub Pages app remains browser-local. Branch and all files here are drafts and unmerged.

**Status (October 9, 2026):** An audit-aware, **disabled-by-default** fixture SQL template and offline safeguards are prepared. **No hosted match fixtures have been inserted, no match scores have been submitted, no passwords have been changed, and no hosted signed-JWT testing has passed.** The organizer must separately approve the first fixture-changing transaction. This milestone builds on B2e administrative assignments and B2f anonymous HTTP observations; it does not replace signed-in organizer or scorekeeper checks.

## Verified hosted baseline (read-only, October 9)

Live Supabase metadata was read directly before authoring the template. The *single* hosted event is named `B2e Synthetic Hosted Rehearsal — NOT FFTT3`, `event_date=2099-01-01`, `synthetic_only=true`, `lifecycle=active`, `bracket_generation=0` and `revision=2`. It has exactly one authorized organizer and two **administratively granted** scorekeepers; the outsider has no staff role. Two immutable grant audits exist, and there are zero players, brackets, matches, submissions, published results, or additional events.

The hosted PostgreSQL column/constraint metadata was checked for `fftt_private.players`, `brackets`, `matches`, `events`, `audit_events`, and `result_submissions`. The planned fixture follows the existing **already locally tested B2c** pairing (`tests/b2c_auth_concurrency.py`), not an invented tournament format.

## Planned one-match fixture — NOT executed

The non-migration file `docs/B2G_TRUSTED_SYNTHETIC_FIXTURE_TEMPLATE.sql` is not a deployment or automated migration. It has two placeholders: **authorization remains `APPROVAL_NOT_GRANTED`**, and **the event UUID is all zeros**. Unchanged, the SQL stops before writing even when executed as an administrator. It additionally requires trusted `postgres` or `supabase_admin` context and fails closed unless the exact event name/date/status, synthetic-only flag, initial event revision, role grants/audits, and empty match/player/result/publication baseline match the current known state. A single transaction locks the event row before the writes.

*Only if separately approved in a future step*, a trusted operator would replace the two placeholders and create:

| Target | Planned synthetic change |
| --- | --- |
| Players | `Synthetic Fixture Alpha` and `Synthetic Fixture Beta`, provisional rating 3, checked in |
| Bracket | One active championship bracket, generation 1 |
| Match | One pending head-to-head at `C-0-0`, match version 0; no winner or scores |
| Event | Bracket generation 0 → 1, revision 2 → 3 |
| Audit | One immutable `bracket_built` record at event revision 3, `actor_id=NULL`, explicit trusted-administrator provenance |

This intentionally creates **one test match** and is **not** an approved production bracket generator or a completed championship-and-consolation workflow. It does not modify Auth users/permissions, render public results, or simulate successful score submission.

## Planned subsequent signed-Auth concurrency test — separate permission gate

The next *hosted* test is deliberately **not run by this fixture**. It requires four independent, organizer-controlled Supabase Auth logins, signed JWTs verified by the hosted gateway, and a separately authorized two-client result write test. The three Yahoo test users currently do **not** have organizer-accessible passwords; don't impersonate them with injected SQL claims or manufacture tokens.

The existing **local-only** `tests/b2c_auth_concurrency.py` already verifies, in disposable localhost GoTrue/PostgREST/PG CI, that one of two simultaneous submitted scores wins, the other conflicts; exact retries are idempotent; tampered retries fail; audit and submission receipts are singular; and staff revocation immediately invalidates previously accepted retries. It strictly refuses non-loopback environments. Never change that test's locality guard to run it hosted.

For a future hosted rehearsal, design a separate authorization-gated harness, **not** the existing local-only test, that checks: real sign-in; correct event role; empty-public privacy; one pending match; two concurrent incompatible scores; exactly one persisted winner/version/audit/receipt; deterministic stale retry denial; outsider/no-auth denial; organizer-only grant/revoke; role revocation; no accidental publication; and idempotent recovery from a failed client. A clear rollback/recovery strategy must be reviewed before score mutations. Bye propagation, correction workflows, bracket rebuild, and multi-device/offline fallback remain later distinct gates.

## Offline validation

```sh
python3 -m py_compile tests/test_b2g_synthetic_fixture.py
python3 -m unittest discover -s tests -p 'test_b2g_synthetic_fixture.py' -v
```

These tests statically validate the blocked approval, zero UUID, exact host/project/event guards, empty-fixture prerequisites, fake names, limited five mutation targets, auditable revision progression, and absence of network/auth/secret usage. They **never run the SQL** and cannot establish a hosted fixture write or hosted score result. They supplement, not substitute for, actual review.

## Acceptance gates

- [ ] Offline B2g safety guards pass in CI on draft PR (record run).
- [ ] Confirm no unintended files changed, and correct stacked branch remains unmerged.
- [ ] Independently verify the existing hosted event stays revision 2, with no players/brackets/matches/score receipts.
- [ ] **Separate organizer approval** for **one trusted synthetic fixture insert transaction** after reviewing the exact template, existing staff grants and current baseline.
- [ ] Verify fixture state, administrative audit provenance and no publication after *approved* insertion.
- [ ] Resolve safe sign-in for all four test accounts privately; no credential exchange in chat or GitHub.
- [ ] **Separate organizer approval** for real hosted signed-token two-client score submissions and account revocation/recovery experiments.
- [ ] Separate acceptance gates for byes, consolation, score corrections, publication and production volunteer rollout.

## HTTP boundary caveat carried forward

B2f's six real anonymous HTTP GET results passed. The **exact header-based** private-schema GET `Accept-Profile: fftt_private` is still unverified. A browser-based attempt on October 9 explicitly reported that it could not execute JavaScript `fetch` with custom headers; it is **not a pass**. The preexisting Python GET-only probe remains the preferred test when an outbound-network-capable operator environment is available, and must not be rewritten to bypass private-header checks.

**Source conflict / resolution:** B2e's initial authenticated grant path was not exercised; only trusted administrative setup was approved for role records. B2g preserves that distinction and does not claim authenticated organizer actions or complete the pending hosted JWT test.
