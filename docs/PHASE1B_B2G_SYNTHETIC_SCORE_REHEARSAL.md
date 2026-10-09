# Phase 1B B2g — Guarded synthetic match and concurrency rehearsal

**Environment:** `fftt-bracket-manager-dev` Supabase Free, ref `copmkalfkkrkzheohwuc`. **Scope:** one isolated synthetic event dated **2099-01-01**, *never* FFTT3, actual volunteers or registration records. The public GitHub Pages app remains browser-local. Branch and all files here are drafts and unmerged.

**Status (October 9, 2026 — hosted fixture INSERT COMPLETED and independently verified):** After the organizer approved the one-match synthetic fixture, the earlier connected-service block cleared. The exact guarded SQL template was fetched from GitHub, the exact development project and untouched baseline (revision 2) were independently rechecked, and a single trusted SQL transaction was executed with **only the in-memory authorization and event-UUID placeholders changed**. Verified **two fictional players, one active generation-1 championship bracket, one pending match `C-0-0` (version 0, no winner/scores), event revision 3, and one added immutable `bracket_built` audit**. No submitted scores, public results, other accounts or FFTT3 data were changed. Both synthetic scorekeepers could subsequently query the matchdesk in **read-only simulated SQL session contexts, not genuine signed JWT sessions**. The source SQL template remains disabled and should **not be rerun**; its revision-2 guard will reject reuse. All **14 offline safety guards previously passed** in [GitHub Actions run #37919171704](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37919171704). True hosted signed-Auth and two-client scoring tests remain pending.

## Historical pre-write baseline (verified October 9)

Live Supabase metadata was read directly before authoring the template. The *single* hosted event is named `B2e Synthetic Hosted Rehearsal — NOT FFTT3`, `event_date=2099-01-01`, `synthetic_only=true`, `lifecycle=active`, `bracket_generation=0` and `revision=2`. It has exactly one authorized organizer and two **administratively granted** scorekeepers; the outsider has no staff role. Two immutable grant audits exist, and there are zero players, brackets, matches, submissions, published results, or additional events.

The hosted PostgreSQL column/constraint metadata was checked for `fftt_private.players`, `brackets`, `matches`, `events`, `audit_events`, and `result_submissions`. The planned fixture follows the existing **already locally tested B2c** pairing (`tests/b2c_auth_concurrency.py`), not an invented tournament format.

## One-match fixture — approved, executed, and verified October 9

The **source** non-migration template `docs/B2G_TRUSTED_SYNTHETIC_FIXTURE_TEMPLATE.sql` remains safely disabled with `APPROVAL_NOT_GRANTED` and its zero UUID placeholder; these placeholders were replaced **in the one-time SQL sent to the trusted database only**, not committed to the source. The user's limited approval covered precisely this synthetic fixture and no score submissions. The template required a trusted database admin, the exact development event identity/date/status, revision 2, previously assigned staff/audits, and empty match/player/result/publication baseline; the whole transaction locked the event and committed atomically. The **original template must not be rerun** after this event revision advanced.

The independently verified resulting records are:

| Target | Verified synthetic change |
| --- | --- |
| Players | `Synthetic Fixture Alpha` and `Synthetic Fixture Beta`, provisional rating 3, checked in |
| Bracket | One active championship bracket, generation 1 |
| Match | One pending head-to-head at `C-0-0`, match version 0; no winner or scores |
| Event | Bracket generation 0 → 1, revision 2 → 3 |
| Audit | One immutable `bracket_built` record at event revision 3, `actor_id=NULL`, explicit trusted-administrator provenance |

The verified match UUID is retained **privately** in the canonical project changelog for later authorized tests; it is intentionally not stored in the public GitHub application. This is **one isolated pending match**, not an approved production bracket generator or a complete championship-and-consolation workflow. No Auth users/permissions, public results, or scores changed.

## Planned subsequent signed-Auth concurrency test — separate permission gate

The next *hosted* test is deliberately **not run by this fixture**. It requires four independent, organizer-controlled Supabase Auth logins, signed JWTs verified by the hosted gateway, and a separately authorized two-client result write test. The three Yahoo test users currently do **not** have organizer-accessible passwords; don't impersonate them with injected SQL claims or manufacture tokens.

The existing **local-only** `tests/b2c_auth_concurrency.py` already verifies, in disposable localhost GoTrue/PostgREST/PG CI, that one of two simultaneous submitted scores wins, the other conflicts; exact retries are idempotent; tampered retries fail; audit and submission receipts are singular; and staff revocation immediately invalidates previously accepted retries. It strictly refuses non-loopback environments. Never change that test's locality guard to run it hosted.

For a future hosted rehearsal, design a separate authorization-gated harness, **not** the existing local-only test, that checks: real sign-in; correct event role; empty-public privacy; one pending match; two concurrent incompatible scores; exactly one persisted winner/version/audit/receipt; deterministic stale retry denial; outsider/no-auth denial; organizer-only grant/revoke; role revocation; no accidental publication; and idempotent recovery from a failed client. A clear rollback/recovery strategy must be reviewed before score mutations. Bye propagation, correction workflows, bracket rebuild, and multi-device/offline fallback remain later distinct gates.

## Offline validation

```sh
python3 -m py_compile tests/test_b2g_synthetic_fixture.py
python3 -m unittest discover -s tests -p 'test_b2g_synthetic_fixture.py' -v
```

These offline tests validate the source template's blocked approval, zero UUID, exact host/project/event guards, empty-fixture prerequisites, fake names, limited mutation targets, auditable revision progression and absence of network/auth/secret usage. They **do not execute SQL** and never established the hosted fixture outcome by themselves; the **separate trusted transaction and subsequent live database reads** established the fixture result. They do not test signed JWTs or score submissions.

## Acceptance gates

- [x] All **14** offline B2g safety guards passed in CI on draft PR #9 ([run](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/37919171704)).
- [x] Compared against its B2f base: only the B2g SQL template, test file, CI workflow, dedicated runbook and ROADMAP changed. Branch remains a draft/unmerged PR.
- [x] Independently verified the pre-write event was revision 2, bracket generation 0, with no players/brackets/matches/score receipts.
- [x] **Organizer explicitly approved** exactly one trusted synthetic fixture insert transaction; transaction executed on October 9 after fresh matching preflight.
- [x] Verified event revision **3**, generation **1**, exactly two fictional players, one championship bracket, one pending match, **one new administrative bracket-build audit**, and no publication or score submission. Both scorekeepers could read one pending match via hosted SQL with **simulated**, not real signed, claims.
- [ ] Resolve safe sign-in for all four test accounts privately; no credential exchange in chat or GitHub.
- [ ] **Separate organizer approval** for real hosted signed-token two-client score submissions and account revocation/recovery experiments.
- [ ] Separate acceptance gates for byes, consolation, score corrections, publication and production volunteer rollout.

## HTTP boundary caveat carried forward

B2f's six real anonymous HTTP GET results passed. The **exact header-based** private-schema GET `Accept-Profile: fftt_private` is still unverified. A browser-based attempt on October 9 explicitly reported that it could not execute JavaScript `fetch` with custom headers; it is **not a pass**. The preexisting Python GET-only probe remains the preferred test when an outbound-network-capable operator environment is available, and must not be rewritten to bypass private-header checks.

**Source conflict / resolution:** B2e's initial authenticated grant path was not exercised; only trusted administrative setup was approved for role records. B2g preserves that distinction and does not claim authenticated organizer actions or complete the pending hosted JWT test.
