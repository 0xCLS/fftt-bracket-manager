# Consolidated Staff update — scoring permissions, doubles scoring, archived switcher, Reset card position

**Status: RELEASED on November 8, 2026.** Merged as PR #75 (merge commit `3af6444b37f6f55d955941db87a649e68fcf465f`; approved head `7affacba8858c406e27553d4a6573d0d323aaa3e`; comprehensive CI run 42500628517 passed). The migration was installed once on project `copmkalfkkrkzheohwuc` (combined transaction SHA-256 `d3a49f74cf75b2ce83854fec8db70aba8749af1860f9cd785bdc39cc8cf23a20`), and Staff was deployed once to `fftt-staff` as deployment `10ed3cf8-ef91-44af-8e95-f1db531548bf` (previous good deployment `ef1b694a-2494-454c-b2f1-7461d407a88b`). Production acceptance was read-only/static: nine history entries ending `20261108150000`; the four replaced functions and six new functions match the reviewed after-fingerprints with no `anon` execute right; a post-install export is value-identical to the restore-proved pre-install backup for all 20 private tables (only `doubles_finale` gained its six new columns, all null except the generated epoch); served Staff asset hashes verified; Spectator/TV and homepage unchanged. **No score or correction was recorded on any real event, and a signed-in practice-event walk-through by each role is still outstanding.** The original pre-release text below is kept as the record of what was reviewed. The backup of record is outside Git. Rollback guidance is unchanged.

## What is included
| Workstream | Source | Result |
| --- | --- | --- |
| A. Archived events | PR #71 (net change) | Archived events leave the everyday Staff switcher; they stay in Overview → Your events → Archived and can be restored; an open archived event stays visible and selected. Zero, one and several visible events are handled. |
| B. Reset Showcase position | PR #74 | Overview order: …Your events, then Reset Showcase last. Visibility, Organizer-only access, typed confirmation and the reset itself are unchanged. |
| C. Correction permissions | this release | See matrix. Reasons are optional everywhere. |
| D. Mixed-Skill Doubles scoring | this release | Game-by-game scoring from the Match Desk, same experience as singles. |

PR #72 (the narrow CI exception for PR #71) is not used or needed. PR #73 (baseline reconciliation) is separate and is not merged here.

## Permissions (enforced by the database; hidden buttons are never the authority)
| Action | Scorekeeper | Bracket Manager | Organizer |
| --- | --- | --- | --- |
| Record games of an open singles match | Yes | Yes | Yes |
| Correct a saved game while the match is open | **Yes (new)** | **Yes (new)** | Yes (reason no longer required) |
| Correct a finalized singles result | No | Yes (reason now optional) | Yes (reason now optional) |
| Record Mixed-Skill Doubles games, correct saved games, record the doubles result | **Yes (new)** | **Yes (new)** | **Yes (new)** |
| Correct a finalized doubles result | No | **Yes (new)** | Yes (new RPC with optional reason) |
| Choose or change doubles partners | No (unchanged) | Yes | Yes |

A written reason is never required by the interface, client validation or database. If given it is stored in the audit row (singles games and doubles games up to 500 characters; finalized results up to 300, no control characters). A brand-new game may not carry a correction reason.

Every correction writes an append-only audit row: actor, timestamp, event, match (null for the doubles finale), the original and corrected values, and the optional reason. Existing guards are unchanged: event-scoped staff, open/finalized status rules, score validation, revision/epoch checks, stale-submission rejection with a receipt, idempotent append-only receipts, bracket-advancement protections (including refusing a winner change once the next match is complete).

## Migration review: `supabase/migrations/20261108150000_staff_scoring_permissions.sql`
SHA-256 `a0f88d5090fb7d1c348b016b298205c1df2bbc06bb71369c9f3da129f6d90d72`. Additive; one transaction; leaves existing rows' values untouched.

* **Fail-closed guard:** aborts unless the four functions it replaces are byte-for-byte the reviewed installed versions. Fingerprints `md5(pg_get_functiondef)` were compared read-only against the production project on November 8 and match exactly: `game_progress_save_v1` `3df36a95…7388`, `correct_result_v3` `84590563…b026`, public `fftt_correct_result_v3` `bb83b39b…ffcf`, `record_doubles_result_v3` `8d727d06…ca72a`.
* **Replaces** those four functions (saved-game corrections for all three staff roles with an optional reason; finalized singles correction with an optional reason; finalized doubles result changeable by a Bracket Manager and checked against saved games). The public `fftt_correct_result_v3` gains `p_reason text default null` so a direct caller may omit it (still exactly one overload).
* **Adds** six nullable columns to `fftt_private.doubles_finale` (saved doubles games, revision, team key, epoch, updater) and three public + three private functions: `fftt_doubles_desk_v1`, `fftt_save_doubles_game_v1`, `fftt_correct_doubles_result_v1`. Extends the audit-operation check with `doubles_game_saved`, `doubles_game_corrected`, `doubles_result_corrected`.
* **No new private table**, so the private backup/restore allowlists are unaffected beyond the V6 gap already noted in the showcase release record. Receipts reuse the append-only `game_progress_decisions` ledger keyed by the event ID. Saved doubles games are never published: the public finale still comes only from the winner and final scores, so Spectator/TV are unchanged. The production `doubles_finale` row (1 row on November 8) keeps its values and only gains the new nullable columns.
* **Privileges:** replaced functions keep their existing grants (asserted unchanged); new functions are revoked from `public`/`anon`/`authenticated` and granted to `authenticated` only. Staleness: saved doubles games are tied to a team key that includes a per-row epoch, so changing partners or recreating the finale cannot revive old games, and revisions never rewind.

## Verification performed (focused, disposable only)
* `tests/e2e/correction_permissions.test.mjs` — each role, forbidden direct API calls (outsider, other-event staff, anonymous), optional/omitted/blank reasons, audit before/after, stale and idempotent requests, bracket advancement, other-event isolation, unchanged privileges, fail-closed on drift.
* `tests/e2e/doubles_scoring.test.mjs` — partners denied to scorers; names-only desk; saves/corrections by all three roles; stale, wrong team key and idempotent replay; partner change invalidates saved games; official result must equal saved games; finalized correction by Bracket Manager and Organizer only; public finale unchanged while games are saved.
* `tests/e2e/correction_permissions_browser.test.mjs` — the same permissions through the real Staff UI (scorekeeper games and doubles, Bracket Manager and Organizer finalized corrections, no reason typed).
* `tests/e2e/gameday_fast_ui_browser.test.mjs` (archived switcher, PR #71) and `tests/e2e/showcase_reset_ui.test.mjs` (card order, PR #74).
* `tests/e2e/scoring_rollback.test.mjs` (rollback restores the exact previous bodies and privileges), `tests/e2e/scoring_install_compose.test.mjs`, `tests/staff_scoring_permissions_disposable.sql` (grants on real PostgreSQL in CI).

## Installation (executed once on November 8, 2026; kept as the reviewed procedure)
Same target-specific path as the showcase reset; never `db push` or `migration repair`. Order: **database first, then one Staff deployment** (an older Staff build keeps working against the new database; a new Staff build against the old database only loses the new doubles card and the new correction rights).

1. Preconditions: green comprehensive run for the exact merged commit; written owner approval for project `copmkalfkkrkzheohwuc`.
2. Read-only: history is exactly the eight reviewed versions ending `20261108114950`; the four function fingerprints above.
3. Fresh private backup with disposable restore proof.
4. `node tools/ops/compose_scoring_install.mjs /private/tmp/<name>.sql` (prints the migration and combined SHA-256; the file is mode 600).
5. Apply once with `supabase db query --remote=copmkalfkkrkzheohwuc --yes -f <file>` (one transaction; any error rolls everything back; never retry blindly).
6. Verify read-only: nine history entries ending `20261108150000` with null statements; the four replaced functions match `FUNCTION_FINGERPRINTS[...].after` in `tools/ops/compose_scoring_install.mjs`; new functions not executable by `anon`; existing private tables unchanged.
7. Deploy Staff once to `fftt-staff` with the existing guard and verification, then verify production acceptance without recording any score on a real event.

**Rollback:** `supabase/proposals/STAFF_SCORING_PERMISSIONS_ROLLBACK_DO_NOT_APPLY.sql` (SHA-256 `725bcd76fbef32cae43d23252f9e75c864880490bef693df5d483fdd42b44323`) restores the exact previous function bodies and removes the new functions; it keeps the nullable columns and the audit constraint on purpose. After a real event has started prefer rolling forward. Redeploy the previous Staff build first (`fftt-staff` deployment recorded at release time).

After the release is verified, the Scorer Guide and Bracket Manager guide in the knowledge repository must be updated with the new permissions and the doubles flow (the in-repo event-day guide and delegation matrix are updated in this change).
