# FFTT3 — guarded walkover and pre-play withdrawal release

**Status: SOURCE MERGES AND EXACT-HEAD TESTS COMPLETE; HOSTED RELEASE NOT AUTHORIZED.** PR #80 merged as `29a12d49a7bea4d3e969e6933f9c60118527f44e`, and backup/release prerequisite PR #81 merged as `83cc9a585a633d41f140dcf127052813ba9f5341`. The guarded server SQL is **not installed**, and the updated Staff UI is **not deployed**. Merges and this plan do not authorize a hosted change.

## Released source and intended behavior

- Walkovers count as bracket resolutions, not real played matches, for Consolation eligibility. A walkover loser is not eligible solely because of an unplayed match; a walkover winner may qualify on their first subsequent played loss.
- A saved individual game cannot be overwritten as a no-show.
- Organizer/Bracket Manager may withdraw someone and regenerate an unplayed Championship bracket, but **only** before any accepted result, saved game/receipt or Consolation/Doubles competition exists. Registration and prior superseded bracket/audit history stay intact.
- Staff can distinguish an absent player, early departure or injury, and the singles score dialog says **Close**.
- The scored November 8 rehearsal is historical and is **not eligible for pre-play regeneration**. Never fabricate its unfinished results. Do not alter the November 22 event during acceptance tests.

## Release prerequisites (all required)

1. **Complete.** PR #81 was reviewed and merged into `main` as `83cc9a585a633d41f140dcf127052813ba9f5341` from exact tested head `801162cbe83ccdc87a7f6a1c42ec5e26ddb84b34`. [Comprehensive #42664018612](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/42664018612) passed all three major jobs; [focused CI #42662280815, attempt 2](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/42662280815) passed (65/65 and release-risk gate). The reviewed current-backup and installer sources are now on `main`.
2. The hosted database history must still be exactly the nine reviewed versions:
   `20261008183821`, `20261008183851`, `20261008195706`,
   `20261008201142`, `20261009044012`, `20261013101523`,
   `20261108101146`, `20261108114950`, `20261108150000`.
   No unexpected versions, schema drift or changes to the source-pinned proposal may be ignored.
3. On the Organizer's private Mac, run the updated `./tools/ops/fftt-backup` with a scoped read-only Management API token. Require current format `fftt-hosted-export-v2`, **20 groups** (19 non-secret private tables plus limited referenced Auth identities), full current-schema parity, **successful disposable restore**, SHA-256 proof and a verified, encrypted off-device copy. No raw backup, baseline fixture or credentials in Git, CI, email or ChatGPT.
4. Independently confirm the existing production event IDs, event-state/score counts, current role grants and affected function fingerprints through **read-only** catalog queries. Pause if an event or software state is unexpected.
5. The Organizer must separately and explicitly approve **one target-specific hosted SQL installation**, then a coordinated **Staff deployment**. Test approval and merge approval are not release authorization.

## November 9, 2026 — Read-only hosted preflight checkpoint

The connected target project `copmkalfkkrkzheohwuc` (`fftt-bracket-manager-dev`) reported **ACTIVE_HEALTHY**. Direct read-only SQL verified the **exact nine reviewed migration names and versions** (ending in `20261108150000`), 20 private tables, and that neither new `public.fftt_withdraw_preplay_v7` nor private `withdraw_preplay_v7` is installed.

The three source-required original function body fingerprints match exactly:

| Existing function | Live md5(pg_get_functiondef) |
| --- | --- |
| `fftt_private.submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,integer)` | `20b83f89b587ca69cf7781ddc25a3951` |
| `fftt_private.forfeit_match_v3(uuid,uuid,bigint,uuid,text)` | `1695adccb33e750d2f23f9c254f3acc7` |
| `fftt_private.correct_result_v3(uuid,uuid,bigint,uuid,text,text)` | `8b22b8caf9bfa783ec8d6abe1e7c1fff` |

Only non-personal event metadata and aggregate counts were queried:

| Existing real event | Lifecycle/generation/revision | Players | Matches/completed | Saved games / game decision receipts |
| --- | --- | ---: | ---: | ---: |
| Nov 8 rehearsal, `d1169a31-032d-4ac7-866b-dc6cab34d588` | `active` / 3 / 86 | 12 | 52 / 13 | 0 / 13 |
| Nov 22 FFTT3, `e81a2f62-84e6-4338-9847-d437897110c2` | `draft` / 0 / 59 | 0 | 0 / 0 | 0 / 0 |

Across all seven stored events, the database had 45 completed matches, two saved-game rows and 16 game-progress decisions. The Nov 8 attendance record is distinct from its 12-player software roster. This is a **read-only point-in-time checkpoint**, not a private backup. Recheck the target, version history, function fingerprints and event metadata immediately before any authorized write; any drift blocks the operation.

**Unmet prerequisite:** Create a fresh `fftt-hosted-export-v2` owner-local 20-group backup, prove an isolated current-schema restore and verify an AES-256 encrypted off-device copy. No backup was created in this preflight. Production SQL and Staff deployment remain separately approval-gated.

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
