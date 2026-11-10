# Staff improvements: Record Result X, "null" fix, completed-event rename — release and acceptance record

**Status: SOURCE ONLY (PR). NOT DEPLOYED. NOT INSTALLED.** Nothing in this record is live. The hosted SQL (completed-event rename) has **not** been installed and the Staff bundle has **not** been deployed. Production SQL installation and Staff deployment each remain a separate Organizer authorization.

## 1. What changed

| Change | Files | Needs hosted SQL? |
| --- | --- | --- |
| **A. Top-right X on Record Result dialogs** (singles and Mixed-Skill Doubles scoring) | `app/staff_ui.mjs`, `app/app.css` | No (Staff deploy only) |
| **B. Literal `null` defect fix** | `app/staff_ui.mjs` | No (Staff deploy only) |
| **C. Organizer-only rename of a Completed event** | `supabase/proposals/FFTT3_COMPLETED_EVENT_RENAME_*`, `contracts/gameday_api.mjs`, `app/staff_core.mjs`, `app/staff_ui.mjs` | **Yes** — SQL first, then Staff |

### A. Record Result X
- `openDialog(build, {label, closeButton})` adds an accessible `×` button (`aria-label="Close"`, 44×44 px, sticky top-right so it stays reachable in the scrolling mobile sheet). It is attached to the dialog itself, **outside** the re-rendered body, so it remains available while saving, in error states, and during **result review**.
- It calls the **same `close()`** as the retained bottom **Close** button. `close()` is `dlg.close()`; the existing `close` listener restores focus to the opener, and the existing prepared-score cancel runs. Nothing is sent by closing; saved games and the unfinished match are server-side and untouched. Escape (native `cancel`) is unchanged.
- Initial keyboard focus stays on the first working control, not the X.
- Applied to the singles Record Result dialog and the Mixed-Skill Doubles scoring dialog. The scoring form itself is not redesigned. Confirm dialogs, walkover, correction and withdrawal dialogs are unchanged (they already have Cancel).

### B. Stray `null`
**Root cause:** `clear(body).append(…, count > 0 ? h('p', …) : null, …)` in the singles dialog. `Element.append(null)` coerces `null` to the **text "null"**, whereas the project's `h()` helper skips null children. With no saved game (`count === 0`) the literal word appeared above the Close / Review buttons. The same unsafe `clear(body).append(…)` pattern existed in the singles review, the doubles form and the doubles review.
**Fix:** those four renders now use the existing null-safe `fill(body, …)` helper (`dom.mjs`). No scoring logic changed. **Regression test:** `tests/e2e/staff_dialog_x_null_rename_browser.test.mjs` fails on the old code with *"dialog text must not contain a literal "null""* and passes on the fix (verified both ways).

### C. Completed-event rename
- **Server (`fftt_private.rename_completed_event_v1` + `public.fftt_rename_completed_event_v1(p_event_id, p_expected_name, p_name)`):** `v3_begin` row-locks the event (`FOR UPDATE`), requires role `organizer` for **that event** and lifecycle exactly `complete`. Name is trimmed, 1–120 characters, no control characters. **Optimistic concurrency:** the caller sends the name it saw; a different current name raises `conflict/name-changed` and nothing is overwritten. An unchanged name is a no-op (no revision bump, no audit). The function updates **only** `events.event_name`; lifecycle, date, tables, visibility, players, brackets, matches, scores, standings and results are never touched. The revision advances once.
- **Audit:** one `event_updated` row (existing operation — `audit_events_operation_check` is deliberately **not** altered) with `before_state {name,date,tables}`, `after_state {name,date,tables,completed_rename:true}`, `actor_id = auth.uid()`, `created_at`, and the new `event_revision`.
- **Authorization:** `anon` has no execute right; `authenticated` does, but the role/lifecycle check inside is the authority. Scorer, Bracket Manager, outsider and an organizer of a *different* event are refused (`42501`). Draft, active and archived events are refused (`conflict/lifecycle`); an archived event must be restored first. The ordinary `fftt_update_event_v3` still refuses completed events, so **date, table count, scoring and lifecycle editing are not broadened**.
- **UI:** only inside **Overview › Set up your tournament**. For an Organizer on a Completed event the date and tables fields are disabled, an explanatory note is shown and the button reads **Rename completed event**. No title pencil and no separate Edit Event popup. Public/Spectator surfaces read the same `event_name`, so a published completed event would show its new name.

## 2. Required deployment prerequisites (none performed)

**Order matters: SQL first, then Staff.** A Staff build deployed before the SQL would show the rename control but the call would fail. Deploying only the X + `null` fix needs no SQL.

1. Separate Organizer authorization for each of: SQL installation, Staff deployment.
2. PR reviewed and merged; **protected-path policy requires an exact-head comprehensive proof** (`tools/ci_v2.py` classifies this PR as manual-proof: Staff, SQL, `tools/`, tests). That run is a separate, owner-authorized dispatch; it was **not** run here.
3. Current protected backup (the verified 20-group export procedure in `docs/REHEARSAL_WALKOVER_RELEASE.md`) or the Organizer's written decision that none is needed for this additive, data-free function pair.
4. Read-only preflight immediately before the write: project `copmkalfkkrkzheohwuc` `ACTIVE_HEALTHY`; migration history is **exactly the ten** versions ending `20261109170000`; neither rename function exists; helper fingerprints (`md5(pg_get_functiondef(...))`) are `v3_begin` `a7061f99d79968d48fdec8ff9af670ab`, `v3_bump` `9e8f28db66107c8d0a7e628aad850cd2`, `v3_audit` `81a8b66934bc556a0f8517ad24bc746c`, `v3_err` `3f6144b0c5d60393f14839c9e4950e33` (these were read from the hosted project, read-only, on 2026-11-09 and are the proposal's own real-mode guard); event counts for the November 8 and November 22 events match the last record.
5. **One** guarded transaction, never replayed, never `db push`: `BEGIN` → exact-ten-version history guard (same shape as `tools/ops/compose_walkover_install.mjs`) → the body of `FFTT3_COMPLETED_EVENT_RENAME_20261109_DO_NOT_APPLY.sql` (without its own `begin`/`commit`) → `insert into supabase_migrations.schema_migrations(version,name)` for a new version (for example `20261109190000` / `fftt_completed_event_rename`; **no SQL body stored**) → `COMMIT`. The proposal already refuses a replay (`already installed`) and refuses drifted helpers.
6. Immediately verify read-only: eleven versions; both functions exist; `anon` cannot execute either, `authenticated` can; the public wrapper is `SECURITY INVOKER`, the private function `SECURITY DEFINER` with empty `search_path`; the three scoring function fingerprints from the walkover release are unchanged; every table count and both real events unchanged.
7. Then deploy Staff from the exact merged commit with the existing guarded procedure (`tools/ops/staff_release_guard.py`), and run the role acceptance below on a **fictional** event.
8. **Rollback:** Staff → redeploy `41d5acf0-88f3-4ee3-85ce-634c55b7fe3a` (source `29a12d49`). SQL → `FFTT3_COMPLETED_EVENT_RENAME_ROLLBACK_20261109_DO_NOT_APPLY.sql` drops only the two new functions (renames already made stay, audited). Post-commit SQL rollback is a separate authorization.

## 3. Verification evidence (this PR)

Disposable PGlite, real FFTT SQL layered like the hosted project, fictional data only; no hosted project, event or secret was touched:

- `tests/e2e/completed_event_rename.test.mjs` — **5/5 pass**: only the name changes and everything else (players, matches, brackets, submissions, date, tables, visibility, generation) is byte-identical; exactly one audit row with old/new name, actor, timestamp and revision; trimmed names; 120-character limit; empty/blank/121-character/control-character names refused; stale expected-name refused; no-op rename; anon/Scorer/Bracket Manager/outsider/other-event-organizer refused; draft/active/archived refused; ordinary update path still refuses completed events; install replay and hosted-helper drift refused; rollback removes only the two functions; neighbour event untouched; the install passes the real-mode fingerprint guard on the hosted-equivalent layering.
- `tests/e2e/staff_dialog_x_null_rename_browser.test.mjs` — **3/3 pass** in headless Chromium through the real Staff UI: no literal `null`; X is named, top-right, ≥40 px, not the initial focus; X/bottom Close/Escape all close without sending and restore focus; a saved game survives an X close and reopens as Saved; X is available during review and closes it without confirming; the same for Mixed-Skill Doubles; Organizer rename from Overview with disabled date/tables, a concurrent-rename conflict surfaced and not overwritten, audit actor/old/new verified, players/results/date/tables/lifecycle unchanged.
- Related existing suites re-run and passing: `correction_permissions_browser` 3/3, `gameday_rehearsal_walkovers` 6/6, `gameday_fast_ui_browser` 4/4, `gameday_events_browser` 4/4, `gameday_v6_browser` 1/1, `gameday_polish_browser` 7/7, `gameday_ui_audit` 2/2, `doubles_scoring` 4/4, `test_ci_v2.py` 9/9.
- **Not run:** the legacy comprehensive suites (not required by a gate for this work); they are required as the exact-head proof before merge/release (see 2.2).

## 4. Live Organizer acceptance on a fictional event — COMPLETED (Organizer role only)

Performed on 2026-11-10 in the Organizer's authenticated Chrome session against the **currently deployed** Staff build (`fftt-staff.clslifestyle.com`, deployment `41d5acf0…`, source `29a12d49`), entirely through the Staff interface. The X, `null` fix and rename were **not** part of what was exercised live (not deployed / SQL not installed); see 4.4.

### 4.1 Event
- **Name:** `FFTT Staff Acceptance Test — SYNTHETIC ONLY` · **Date:** 2099-11-09 · **Tables:** 2 · **ID: `be622bf2-ebd5-4706-8d4a-2f046cd78249`**
- **Initial state (read-only SQL right after creation):** `draft`, `public_visible = false`, bracket generation 0, revision 0. A pre-creation check found no event of that name (no duplicate possible).
- **Players:** six fictional names (Ada Quill, Ben Marlow, Cy Fennel, Dee Larkin, Eli Brandt, Fay Holloway), entered by hand via Players › Paste a list, all checked in. No registration source was loaded.
- **Never published.** `public_visible` stayed `false` throughout; the Publish/visibility control was never used. Building the bracket moved the event to `active` automatically (not a publish).
- **Final state:** **archived** through Overview › Your events › Archive (confirmation named the event), `public_visible = false`, generation 2, revision 17, 6 players, 5 completed matches and the full audit trail preserved. Nothing was deleted.

### 4.2 Results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Championship generated before any scoring | **PASS** | “Championship bracket built.” Two opening matches plus byes; generation 1 |
| 2 | Pre-play withdrawal + regeneration (Organizer) | **PASS** | Withdrew Ada Quill with a reason → generation 2; registration kept (6 players, 5 checked in) |
| 3 | Superseded bracket and audit preserved | **PASS** | `brackets`: gen 1 `superseded`, gen 2 `active`; audit `bracket_rebuilt` + `checkin_changed` both carry the reason |
| 4 | Save an individual game | **PASS** | Game 1 11–7 “Saved… confirmed by the server”; survived closing and reopening the dialog |
| 5 | Pre-play withdrawal refused once a game is saved | **PASS (server)** | Server refused: “A score, saved game, or Consolation result exists. The bracket cannot be regenerated…”; generation unchanged. **UI gap, see 4.3-b** |
| 6 | Saved game cannot be overwritten by a no-show | **PASS** | “This match has saved games… do not overwrite the game scores with a walkover.” |
| 7 | Walkover reasons | **PARTIAL PASS** | *Other*: empty details refused (“Describe the reason…”), recorded with details; *injury* recorded (audit `Unable to continue (injury)`). *Absence* and *early departure* were **not** recorded in this run (the Organizer confirmed all four labels earlier) |
| 8 | Consolation eligibility | **PASS** | After Eli’s played loss: only Eli. Fay (unplayed walkover loss) never listed. After Dee (walkover winner) lost the Final, her first **played** match: entrants = Eli + Dee |
| 9 | Existing scoring and corrections | **PASS (partial scope)** | Corrected a saved game (11–7 → 11–9, reason “Fictional scoring slip”, audit `game_corrected`); saved Game 2; review → confirm; typed-score results; walkovers; Consolation bracket built |

**Not exercised:** correction of a *finalized* match result, Mixed-Skill Doubles scoring and finale, marking the event Complete, Results & Export, and the exports. These keep their disposable-database/browser coverage in section 3.

### 4.3 Observations on the deployed build (no data was harmed)
- **a. Stray `null` confirmed live.** The literal text “null” appeared above Close/Review result in every Record Result dialog that had no saved game (reproduced on four different matches); it was absent once a game was saved. This is defect B; the PR fixes it. It also shows the live review dialog has no close control besides **Back — edit**, and the scoring dialog has no X (the PR adds one).
- **b. “Withdraw before play…” is still offered after a game is saved** (the control is hidden only once a *completed* match exists: `played === 0` in `app/staff_ui.mjs`). The server correctly refuses, so this is a UX gap, not a safety defect. **Not changed in this PR**; hiding it when saved games exist needs game-progress data on the Championship tab and would be a separate change.
- **c. One transient load error.** On the first open of the Final’s dialog: “Completed-game records are unavailable. Nothing was changed; check the connection and migration.” The dialog correctly blocked the action; closing and reopening loaded normally. Not reproduced; cause unknown (browser console was not being captured at that moment).
- **d. Misleading review text.** When scores are typed directly (without “Save Game n”) the review dialog still says “The completed games are already saved.” Existing wording, not changed here.

### 4.4 Roles and features NOT tested
- **Bracket Manager and Scorer: no browser acceptance.** No authenticated sessions for those roles were available; none were impersonated, and no real grant was altered. Their server-side permissions are covered only by disposable-database tests (section 3).
- The **Record Result X, the `null` fix and the completed-event rename** have **not** been exercised on the live system: the SQL is not installed and the new Staff build is not deployed. They are verified only by the disposable tests in section 3.

## 5. Real events

Read-only `SELECT` statements were run against the hosted project (function definitions, a check constraint, event metadata and the acceptance event's own audit rows). The only writes were the Staff-interface actions on the fictional event in section 4; no migration, deployment, secret, DNS or configuration change occurred. The November 8 rehearsal (active, generation 3, revision 86, 12 players, 13 completed), the November 22 FFTT3 draft (generation 0, revision 59, no players) and the Showcase (active, public, revision 17, 20 players, 14 completed) were re-read after the walkthrough and are unchanged; all player records and results are untouched.
