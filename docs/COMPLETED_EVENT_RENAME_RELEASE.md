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

## 4. Acceptance walkthrough on a fictional event — STATUS: BLOCKED (live), partially evidenced

**Planned event:** `FFTT Staff Acceptance Test — SYNTHETIC ONLY`, date `2099-11-09`, 2 tables, 4–6 fictional players. **Event ID: none — the event was NOT created.**

**Why:** the Claude-in-Chrome automation tab opened `https://fftt-staff.clslifestyle.com/app/staff` signed out (no session in that tab's storage). Entering a password is outside what automation may do, and an Organizer session cannot be borrowed from another tab. No credentials were requested or used, no role was impersonated and no real grant was changed.

**Read-only preflight completed (SQL `SELECT` only, 2026-11-09):**
- No event named `FFTT Staff Acceptance Test…` exists, so none needs reusing and no duplicate can arise.
- Seven events exist. Only `FFTT Showcase: Demo Tournament` is `public_visible = true`. `FFTT 3 (Rehearsal)` (`d1169a31-032d-4ac7-866b-dc6cab34d588`, active, generation 3, revision 86) and `FFTT 3` (`e81a2f62-84e6-4338-9847-d437897110c2`, draft, generation 0, revision 59) are not visible. These match the last recorded state exactly.
- Public selection (`app/public_core.mjs: pickEvent`) ranks only **published** events. A new event starts unpublished and **must stay unpublished** (the walkthrough must never use Publish/visibility); creating and activating it therefore cannot change the featured Spectator/TV event. If a publish toggle were ever needed, stop and report instead.

**Existing live Organizer findings (reported by the Organizer, not repeated):** navigation across all major Staff sections works; the bottom Record Result button reads **Close**; all four no-show reasons display; the returning-player warning displays; **Withdraw before play** is hidden after scoring; verified game-score loading clears normally; the stray `null` was reproduced twice in the live Record Result dialog (see B).

**Evidence for the nine acceptance items, from the disposable-database suites (NOT live-browser acceptance):**

| # | Item | Evidence (`gameday_rehearsal_walkovers.test.mjs` unless noted) |
| --- | --- | --- |
| 1 | Championship before scoring | `fresh()` builds generation 1 before any score |
| 2 | Pre-play withdrawal and regeneration | “pre-play withdrawal regenerates ONLY the unplayed bracket and keeps player registration” |
| 3 | Superseded bracket and audit preserved | same test (superseded generation and audit rows retained) |
| 4 | Save an individual fictional game | `gameday_v6_browser` / `correction_permissions_browser` |
| 5 | Pre-play withdrawal refused after a saved game | “a saved individual game prevents bracket regeneration…” |
| 6 | Saved game cannot be overwritten by a no-show | same test |
| 7 | Absence / early departure / injury / Other reasons | absence (“Did not arrive at table”) and injury reasons are asserted as stored in the audit log; early departure and Other travel the same free-text path but are **not separately asserted**; all four UI labels were confirmed live by the Organizer |
| 8 | Consolation eligibility: played loss vs unplayed walkover | “walkover victory is NOT a played win…” and “played win followed by withdrawal remains ineligible” |
| 9 | Existing scoring and corrections | `correction_permissions_browser`, `doubles_scoring`, `gameday_v6_browser` |

**Still to do live (needs a signed-in Organizer in the automation browser):** create the fictional event through Overview/Events, add 4–6 fictional players, and walk items 1–9 and the new X, `null` and rename behaviours on that event; then archive it (never delete scored history). **Untested roles:** Bracket Manager and Scorer signed-in sessions (no authorized sessions were available); only their server-side refusals and permitted actions are covered by disposable-database tests.

## 5. Real events

Only `SELECT` statements were run against the hosted project (function definitions, a check constraint, event metadata). No write, migration, deployment, secret, DNS or configuration change occurred. The November 8 rehearsal, the November 22 FFTT3 draft, the Showcase and all player records and results were not modified; their observed metadata matches the prior record.
