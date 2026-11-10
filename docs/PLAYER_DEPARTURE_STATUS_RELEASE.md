# #79 — Audited player departure/return (release candidate, NOT deployed)

**Status (Nov 10, 2026): source-only PR #86. Hosted SQL is NOT installed; no real events have been modified.**
This component is for the staff app's Organizer / Bracket Manager, not Scorers or public spectators.

## Workflow
1. **Before play:** use the already-installed "Withdraw before play…" operation only while there is no accepted result, saved game, Consolation or Doubles; it safely rebuilds the unplayed bracket and retains the original entry/history.
2. **After play begins:** Championship → "Player departures during play" → "Record event withdrawal…". Select the checked-in player, provide an early-departure/injury/other reason. This writes one scoped private ledger record and a revisioned \`player_departure_changed\` audit, without altering checked-in status, prior match results, game receipts, saved games, or bracket generation.
3. **Pending match:** staff must separately adjudicate the player's ready pending match via Match Desk → No-show… if no game has been saved. If a game is already saved, do not overwrite it as a walkover; handle the interruption through the established game/score reconciliation process. The event-level ledger is an administrative *record*, not an automatic W/O engine. The Consolation readiness checks remain authoritative.
4. **Returning participant:** a staff member may "Mark returned…" with a reason. This appends a fresh audit and clears the active departure flag; the prior departure/return history remains in \`audit_events\`. A recorded W/O stays accepted. Returning cannot restore an eliminated player to a bracket or reverse saved scores. Staff must review any requested W/O reversal separately; **no W/O reversal endpoint is authorized or introduced by this PR**.

## Privacy and safety
- New private \`fftt_private.player_departures_v1\` table, RLS enabled, no direct Data API table access. Only validated, role-gated RPCs are exposed to authenticated event Organizers / Bracket Managers. Scorer, anonymous and unrelated accounts denied.
- Staff client strictly parses returned identifiers, reason and timestamps; it does not expose the ledger to Scorers, spectators, TV or public.
- Server verifies current event-specific role, active lifecycle, player membership, generation and exact event revision under the existing event lock. Race/stale or invalid inputs are refused.
- No automatic match scoring, advancement or recalculation; accepted walkover decisions stay in \`result_submissions\` and \`audit_events\`.
- **Important limitation:** status is a staff coordination record, not yet a server-enforced eligibility ban. Scorers can still interact with existing ready matches until staff records the appropriate match-level outcome. Do not advertise it as automatic forfeiture or assume it resolves interrupted games.
- The new UI remains hidden on an old server (or a failed read) rather than guessing withdrawal eligibility.
- A data-preserving emergency rollback proposal revokes the new RPC access without deleting ledger or audit data. Restoring access and dropping the schema would be a separately authorized operation.

## Review / verification boundary
The new disposable-database browser test covers strict parsing, role isolation, stale revisions, recorded/returned records, audit reasons, preservation of existing matches/roster, and visibility/operation of the Staff controls. Existing #85 tests remain. Source and test are **not** evidence of a hosted installation. The comprehensive regression remains deferred until the final release decision under the existing CI gate; a separately approved fresh private backup, SQL rollout and production Staff deployment are required. Do not replay earlier installed migration files or use \`db push\`.

**Issue #79 remains open** until operational acceptance confirms this design is sufficient for event-day departures and determines whether a future automatic ban or controlled W/O reversal is required.
