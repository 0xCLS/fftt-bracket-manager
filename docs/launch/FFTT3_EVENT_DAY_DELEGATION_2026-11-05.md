# FFTT3 — event-day operations delegation

Status: **DRAFT CANDIDATE, NOT LIVE** (November 5, 2026). Implementation: [draft PR #45](https://github.com/0xCLS/fftt-bracket-manager/pull/45) based on the current production-source PR #22 branch. This document is not an authorization to migrate Supabase, deploy Staff, grant permissions, check in live players, or publish names.

## Purpose

Let the Organizer participate in the tournament rather than operate the application throughout play. The Bracket Manager directs the two-table tournament; Scorekeepers handle the Match Desk on their own accounts.

### Permission boundary

| Capability | Bracket Manager (candidate) | Scorekeeper |
| --- | --- | --- |
| View scoped, contact-free roster and existing check-in status | Yes | No |
| Check in / undo a *preloaded* roster player before bracket creation | Yes | No |
| Add one named, leveled, checked-in walk-in before bracket creation | Yes | No |
| First-time Championship and Consolation build | Yes | No |
| Assign free tables / record ordinary results | Yes | Yes |
| Record no-show (reason required) | Yes | No |
| Correct a saved game while its match is open (reason optional) | Yes | Yes |
| Correct a finalized singles result (version required; reason optional) | Yes | No |
| Record Mixed-Skill Doubles games and the doubles result from the Match Desk (game by game) | Yes | Yes |
| Correct a finalized Mixed-Skill Doubles result (reason optional) | Yes | No |
| Choose or change the doubles partners | Yes | No |
| Adjust a single unplayed match format | Yes | No |
| Select / record Doubles Finale | Yes | Match Desk scoring only |
| View/download public-safe results and mark a *finished* event complete | Yes | No |
| Search registered players by name and check one in from the event's own sign-up sheet (names, suggested levels, duplicate review; proof-verified server-side; before bracket creation) — see [the November 6 note](FFTT3_BRACKET_MANAGER_REGISTRATION_2026-11-06.md) | Candidate (PR #52) | No |
| Read Google registration answers, contact fields (even masked), the sheet link or mapping, opaque source references | No | No |
| Staff invites/grants, event settings, public visibility, private backups | No | No |
| Rebuild existing brackets, modify or delete original player records, archive/delete | No | No |

The existing `bracket_manager` event grant is reused, with no new broad administrator role. **November 6 addendum (candidate, not live):** the Check-in screen also gains a *Registered players* lookup, with its own database authorization and provenance proof; source configuration stays Organizer-only. See [FFTT3_BRACKET_MANAGER_REGISTRATION_2026-11-06.md](FFTT3_BRACKET_MANAGER_REGISTRATION_2026-11-06.md). Revocation, cross-event isolation and server-authoritative results remain in place. The Organizer retains sign-in and sensitive controls for **pre-event preparation or emergency escalation only**, not routine match flow.

## Before the event

1. Organizer imports/reconciles the registered roster and reviews private skill levels, duplicates, match formats, two table configuration and publication notice.
2. Organizer privately confirms individual staff identities, working devices, per-event Bracket Manager and separate Scorekeeper grants. No shared account. The Nov 8 rehearsal and Nov 22 event need separate grants.
3. Organizer creates and verifies a protected backup, leaves print brackets / scorecards and a clear paper-mode escalation procedure.
4. Bracket Manager signs in independently and selects the intended event. Check-in shows preloaded player **names and internal levels**, not private contact/source data.
5. Bracket Manager checks in **only arrivals**, uses **Add & check in** for full-name walk-ins before the bracket is built, and builds the Championship once attendance is settled.

## During play

- Bracket Manager calls matches, runs Championship/Consolation, handles no-shows and exceptions, assigns available tables, coordinates two Scorekeepers, sets mixed-skill Doubles teams and verifies results. 
- Scorekeepers open only **Match Desk**, verify name, table, format, winner and scores, then **Review result → Confirm and send** once.
- Wrong score: a Scorekeeper stops and reports it to Bracket Manager. Bracket Manager checks the paper record, enters a reason and performs the audited correction. Never re-submit a result with uncertain server acceptance.
- No-show: Bracket Manager verifies the absence and records the required reason; no-score walkover advances the other player.
- Lost network: Bracket Manager announces **paper mode**, everyone stops online writes; on return, verify authoritative server receipts before deliberate reconciliation. No automatic replay.
- Late arrivals after Championship creation: **do not rebuild** the bracket. Escalate to a pre-agreed non-destructive participation alternative (e.g., friendly exhibition), or organizer decision outside the tournament bracket.

## Closing

After Championship, any built Consolation, and any arranged Doubles are complete, Bracket Manager reviews standings, downloads public-safe text/CSV, and selects **Mark event complete**. This blocks new scores and table assignments; public visibility is unchanged. Organizer is responsible for a final private backup / any archival later, without needing to interrupt play.

## Release and rehearsal gate

1. Obtain green exact-commit CI with disposable PostgreSQL tests and independent signed-user denial checks (Organizer, Bracket Manager, two Scorekeepers, outsider and revoked accounts).
2. Confirm SQL is applied on a restored, populated **disposable** copy and rollback preserves every existing event, score, staff grant and registration source.
3. **Separate explicit authorization for hosted SQL and Staff production deploy** is required. Use fresh private backup / proven restore and synchronized app + SQL release with safe rollback.
4. Test on the existing, private **`FFTT3 Rehearsal: Nov 8`** (never recreate it), with actual roster, independent devices, two tables, physical network and paper-mode recovery. Do not touch the live Nov 22 event until its own authorized event-day check-in.
5. Keep the spectator rehearsal view off until explicit names/publication approval; never put contacts, ratings or private backup into public outputs.

**Until this gate passes**, existing live Bracket Manager and Scorekeeper restrictions remain exactly as before. In particular the current Bracket Manager cannot perform delegated check-ins, forfeits, corrections, match-format overrides or closeout.
