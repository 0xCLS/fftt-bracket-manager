# FFTT3 — guarded walkover and pre-play withdrawal release

**Status: SOURCE PREPARATION ONLY.** PR #80 merged the code to `main` as `29a12d49a7bea4d3e969e6933f9c60118527f44e`. Its server-authoritative SQL is **not installed** and the updated Staff UI is **not deployed**. This plan does not itself approve a hosted change.

## Released source and intended behavior

- Walkovers count as bracket resolutions, not real played matches, for Consolation eligibility. A walkover loser is not eligible solely because of an unplayed match; a walkover winner may qualify on their first subsequent played loss.
- A saved individual game cannot be overwritten as a no-show.
- Organizer/Bracket Manager may withdraw someone and regenerate an unplayed Championship bracket, but **only** before any accepted result, saved game/receipt or Consolation/Doubles competition exists. Registration and prior superseded bracket/audit history stay intact.
- Staff can distinguish an absent player, early departure or injury, and the singles score dialog says **Close**.
- The scored November 8 rehearsal is historical and is **not eligible for pre-play regeneration**. Never fabricate its unfinished results. Do not alter the November 22 event during acceptance tests.

## Release prerequisites (all required)

1. The consolidated prerequisite PR #81 must be **reviewed, merged and checked** without bypassing GitHub's release-risk gate. One owner-authorized successful comprehensive run on **its exact final commit** is required; earlier full CI #42641895268 establishes the merged PR #80 source only.
2. The hosted database history must still be exactly the nine reviewed versions:
   `20261008183821`, `20261008183851`, `20261008195706`,
   `20261008201142`, `20261009044012`, `20261013101523`,
   `20261108101146`, `20261108114950`, `20261108150000`.
   No unexpected versions, schema drift or changes to the source-pinned proposal may be ignored.
3. On the Organizer's private Mac, run the updated `./tools/ops/fftt-backup` with a scoped read-only Management API token. Require current format `fftt-hosted-export-v2`, **20 groups** (19 non-secret private tables plus limited referenced Auth identities), full current-schema parity, **successful disposable restore**, SHA-256 proof and a verified, encrypted off-device copy. No raw backup, baseline fixture or credentials in Git, CI, email or ChatGPT.
4. Independently confirm the existing production event IDs, event-state/score counts, current role grants and affected function fingerprints through **read-only** catalog queries. Pause if an event or software state is unexpected.
5. The Organizer must separately and explicitly approve **one target-specific hosted SQL installation**, then a coordinated **Staff deployment**. Test approval and merge approval are not release authorization.

## Guarded, offline SQL composition (no hosted execution)

The approved proposal source is `supabase/proposals/FFTT3_REHEARSAL_WALKOVER_WITHDRAWAL_20261109_DO_NOT_APPLY.sql`. The offline installer helper `tools/ops/compose_walkover_install.mjs` rejects a changed Git-blob source hash and produces a single mode-600 SQL file under `/private/tmp` containing:

- A transaction-wide exact **nine-entry** hosted migration-history guard.
- The reviewed SQL proposal and its separate three-function body fingerprint guards, rights and row safety checks.
- One new migration-history entry (`20261109170000`, `fftt_rehearsal_walkover_withdrawal`) with **no private SQL body stored**.
- One `COMMIT`; any error must abort the whole transaction. A replay or schema/history drift fails closed.

Offline composition command (ONLY after source review): `node tools/ops/compose_walkover_install.mjs /private/tmp/fftt-walkover-install-private.sql`. Verify its printed source/combined SHA-256; retain the file privately. **Do not run the composed file against the hosted database without separate explicit approval and a current restore-proved backup.** Never substitute `db push`, `migration repair`, a partial copy/paste from the source, or an unguarded SQL execution.

## Verification and rollout order

- Test the combined transaction in **disposable PostgreSQL**: wrong history installs nothing; correct nine-entry history installs once; a replay is refused; the two new RPCs remain denied to anonymous callers and are subject to event roles; all pre-existing event data stays unchanged.
- After separate explicit approval, apply the **single pinned transaction once** to the identified project. Never retry an uncertain hosted write without read-only reconciliation.
- Read-only confirm **ten** recorded migration versions, affected function fingerprints, anonymous grant denial, and unchanged historical rehearsal / November 22 event counts and results.
- Only then deploy the Staff bundle from the exact merged source, not any newer unreviewed version; verify asset hash and production identity before allowing event-day operation. TV/Spectator/public surfaces are not part of this Staff-only deployment.
- Conduct a signed-in **fictional/practice-event** role walkthrough with Organizer, Bracket Manager and Scorer; never create fake score results on the live November 22 event or rewrite the historical rehearsal.
- If a write or deployment fails, preserve evidence and stop. The SQL transaction rolls back automatically on an error before commit. **A post-commit rollback is a separate high-risk operation and is not preapproved**; prepare a reviewed rollback or safe roll-forward based on the protected backup and current event state.

## History

This document tracks proposed release mechanics. It does not retroactively modify the November 8 rehearsal, supersede its event record, or claim deployment. The canonical historical notes remain in `0xCLS/forging-fellowship-table-tennis`.
