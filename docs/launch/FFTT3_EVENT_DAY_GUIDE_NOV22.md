# FFTT3 — event-day operating guide · Sunday, November 22, 2026, 1:00 PM

One page per role. Keep it short; follow it literally. **The paper sheet is always the source of truth if the screen and paper disagree.**

## Roles
* **Organizer (1, laptop):** registration/check-in, bracket building, corrections, publication, the backup. The only person who changes anything structural.
* **Scorekeeper A and B (2 phones, signed in separately):** Match Desk only — assign tables, record results.
* **Greeter (optional):** walk-in names on paper to the Organizer (full first and last name + level 1–5).
* **Owner (on call):** Cloudflare/Supabase/Google access for emergencies only.

## T-60 min (noon) — Organizer
1. Sign in; open **FFTT3** (the real event, not the rehearsal). Check date, table count and formats on Overview. Public view must read **off**.
2. Players → **Load registrations**. Resolve duplicate groups ("Same person" / "Different people"). Confirm every suggested level that you agree with; edit the rest. Names are full first + last.
3. **Take a private backup** (hosted export query → private file → `restore_verify.mjs`) and keep it open on the laptop.
4. Scorekeepers sign in and open Match Desk; confirm each sees only Match Desk.
5. Put the TV page on the projector; leave public view off until step in "Publishing".

## T-0 — check-in (until the start)
* Registrants: **Check in** next to the name (one tap) or tick several and **Check in N selected**. Undo is next to a checked-in name.
* Walk-ins: type the **full first and last name**, choose the level 1–5, **Add and check in**. The same name twice is refused: ask whether it is the same person.
* The checked-in count on Players must equal the paper tally when you build the bracket.

## Starting the bracket
1. Championship tab → review the preview → **Build** (warns before replacing an existing bracket; replacing after scores exist is destructive, so confirm with the paper sheet first).
2. Consolation is built **after** the first round finishes (Consolation tab → review who is eligible → Build).
3. Doubles finale is set after consolation (Doubles Finale tab: choose the mixed-skill partners).

## Publishing (organizer decision; real names are visible to everyone)
Only after the participant notice/publication policy is confirmed: Overview → **Publish to spectators**. One tap to **Hide from the public** at any time. The public only ever sees names, scores, formats and tables.

## After every round — Organizer (1 minute)
Results & Export → **Private backup** (the app's own download; it contains levels and the audit trail, so keep it private). It is the quickest recovery copy if the connection fails; the hosted export in the T-60 step is the second, restorable one.

## During play — scorekeepers
* Match Desk → pick a ready match → choose a free **table** → play → **Record result**: tap the winner, enter game scores (e.g., `11-7, 9-11, 11-8`). If the screen says the match changed or is already recorded, **stop**: the other scorekeeper already entered it — tell the Organizer, do not re-enter.
* **No-show/walkover:** Record a no-show (reason required).
* Spotted a wrong score *after* saving? **Do not retype it.** Tell the Organizer (corrections are organizer-only and leave an audit entry).
* Offline banner = the app is paused: write the result on the paper sheet; the app sends it once when the phone reconnects. Never enter it twice.

## Problems and fast fixes
| Symptom | Do |
| --- | --- |
| "Registration could not be read / Connection off" | Check-in by walk-in or the CSV import (Players → Import a private CSV, stays in the browser). Ask the owner to check `REGISTRATION_GOOGLE_MODE`. |
| A scorekeeper cannot sign in | Re-type the password carefully (show/hide eye in the field). E-mailed reset codes can be slow or rate-limited on the Free plan — do not wait for one: use another scorekeeper's phone for scoring, or the Organizer records results on the Match Desk. |
| Scorekeeper's phone is lost/stolen | Staff tab → **Revoke** that person (immediate), grant a replacement. |
| TV frozen or says **stale** | Refresh the TV page; if it still says stale, the network is down — keep playing, the TV catches up. Hide public view if it shows anything wrong. |
| Two phones show different things | Pull to refresh. The database is the authority; the paper sheet is the tie-breaker. |
| Someone appears twice / wrong name | Organizer edits the name/level on Players (before check-in) or corrects the result; do not delete players mid-bracket. |

## Manual scoring fallback (paper) — "system down" procedure
1. **Declare it** (Organizer says "paper"): scorekeepers stop typing; nobody tries to fix the app in the middle of a match.
2. Every match gets a **paper score sheet**: names (full), table, game scores, winner, scorekeeper initials, time. Keep the printed bracket sheet at the desk; the Organizer advances winners **by hand** on it (same byes as the screen's last published bracket).
3. Matches continue in bracket order; tables are assigned verbally; the Organizer keeps one list: *match → table → status*.
4. When the app is back: the **Organizer** enters each paper result in order (Match Desk), oldest first; the app rejects an already-recorded match — compare it with the paper and, if different, use **Correct a result** with the reason "paper sheet". Then compare the final standings and the champion with the paper bracket before announcing anything.
5. If the app stays down, the **final results come from the paper** (champion, runner-up, consolation winner, doubles winners). Use the latest private export / printed results text from Results & Export as the starting point for the written results.
6. After the event: reconcile, take a final backup, then file the paper sheets.

## End of event
1. Confirm every match is complete (Match Desk "Ready to play (0)"), the doubles finale is recorded, then Results & Export → Event status → **Mark event complete** (scoring and tables stop; only audited organizer corrections remain).
2. Results & Export → results text (public-safe), CSV, **private backup**. Save the private backup to the private folder and a second private place; **never post the private backup**.
3. Hide from the public when the organizer decides, archive later; do not delete.
4. Switch `REGISTRATION_GOOGLE_MODE` back to `diagnostic` (owner) once check-in is closed.

## Numbers to remember
Event: Sunday Nov 22, 1:00 PM. Rehearsal: Nov 8, 10:00 AM. Formats: regular Bo3 to 11; championship final defaults to Bo3 to 11 (confirm approved format; only Bo1/Bo3 selectable); consolation single game to 21; doubles Bo3 to 11. Levels 1–5 are private (never shown publicly).
