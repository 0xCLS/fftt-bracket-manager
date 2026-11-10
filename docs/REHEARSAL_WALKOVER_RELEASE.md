# FFTT3 — guarded walkover and pre-play withdrawal release

**Status: GUARDED HOSTED SQL INSTALLED AND VERIFIED ON 2026-11-09; STAFF DEPLOYED AND ASSET-VERIFIED ON 2026-11-09 (Cloudflare deployment `41d5acf0-88f3-4ee3-85ce-634c55b7fe3a`); SIGNED-IN ROLE ACCEPTANCE STILL PENDING.** PR #80 merged as `29a12d49a7bea4d3e969e6933f9c60118527f44e`, PR #81 merged as `83cc9a585a633d41f140dcf127052813ba9f5341`, and private-backup verifier PR #82 merged as `99cdecb6df40b5eeeee916e66ac180ae1f0f8149`. The Organizer separately authorized exactly one target-specific source-pinned SQL installation on project `copmkalfkkrkzheohwuc`. It completed and is recorded as migration `20261109170000`. The Organizer then separately approved the coordinated Staff deployment, recorded below. No tournament history was edited.

## Follow-on source PR (not deployed): Record Result X, `null` fix, completed-event rename

A separate source-only PR adds the top-right X on Record Result dialogs, fixes the stray literal `null`, and adds an Organizer-only rename of Completed events (additive SQL proposal, not installed). See [`COMPLETED_EVENT_RENAME_RELEASE.md`](COMPLETED_EVENT_RENAME_RELEASE.md) for details, deployment prerequisites and the acceptance status. A live **Organizer** walkthrough on a fictional, archived event (`be622bf2-ebd5-4706-8d4a-2f046cd78249`) was completed on 2026-11-10 and is recorded there; **Bracket Manager and Scorer browser acceptance remains pending** (no authenticated sessions for those roles).

## November 9, 2026 — Production Staff deployment: COMPLETED (asset-verified)

**Deployed:** Staff only, to Cloudflare Pages project `fftt-staff` (production branch `main`; `fftt-staff.clslifestyle.com` and `fftt-staff.pages.dev`), built from exact commit `29a12d49a7bea4d3e969e6933f9c60118527f44e` (identical tree to the tested PR #80 head `191e1ca`). **Deployment ID `41d5acf0-88f3-4ee3-85ce-634c55b7fe3a`** (`https://41d5acf0.fftt-staff.pages.dev`). The previous good Staff deployment for rollback remains listed: `10ed3cf8-ef91-44af-8e95-f1db531548bf` (source `3af6444b37f6f55d955941db87a649e68fcf465f`).

**Procedure.** Clean detached worktree at the exact commit; `tools/staging/build_export.py --environment production --target staff` with the production Staff/Spectator origins; `tools/ops/staff_release_guard.py` passed before the build review and again immediately before upload (project exactly `fftt-staff`; both hostnames then served the same production Staff manifest at `3af6444`); the bundle was independently re-hashed (43 manifest files, all SHA-256 match, no unlisted or private/server-only file, origin profile Staff-only). The guard's delta was exactly three changed files: `app/staff_core.mjs`, `app/staff_ui.mjs`, `contracts/gameday_api.mjs`; none added or removed. One `wrangler pages deploy` from the repository root (Functions compiled in). No secret, variable, DNS, Auth, SQL or Supabase change was made; the 13 production secret names were listed read-only and left as they were.

**Live verification.**

- Both hostnames serve manifest commit `29a12d49a7bea4d3e969e6933f9c60118527f44e`, target `staff`, environment `production`, 43 files; `staff_release_guard.py --live-only` passes.
- `tools/ops/verify_deployment.py` against `https://fftt-staff.clslifestyle.com`: **ALL LIVE CHECKS PASSED** (every served file's SHA-256, CSP/HSTS/nosniff/no-store/noindex headers, private paths not served, `GET /api/registrations` 405, token-less `POST` 401). On `fftt-staff.pages.dev` every check passes except that the token-less `POST` answers 403 rather than 401: the Function pins `STAFF_ORIGIN` to the custom domain and refuses another origin, which is the safer response and not a regression.
- The served `staff_ui.mjs` contains the new pre-play withdrawal control ("Withdraw before play" / "Withdraw and regenerate unplayed bracket") and the singles dialog "Close" label. The existing game-saving and correction code remains in the bundle (the diff is three files, the rest are unchanged and hash-verified). The Staff sign-in page loads and reports its address as approved.
- Spectator/TV (`fftt-games`, deployment `c5f7270d-879a-4d04-905b-c9471e02752f`, manifest commit `4d500b60b049f29840a59124a3f66647c0123bef`) and the public homepage (`fftt-public`, deployment `f828e348-b2b7-4fea-9337-64903acb38bd`) are unchanged: the Spectator manifest is byte-identical to the pre-release capture and the homepage response SHA-256 is identical.
- Read-only database check after deployment: exactly 10 migration versions ending `20261109170000`; installed function fingerprints still `ec324798…` (submit), `314b5f7f…` (forfeit), `910d89a3…` (correct); both withdrawal functions deny `anon`. November 8 rehearsal `d1169a31-032d-4ac7-866b-dc6cab34d588`: active, generation 3, revision 86, 12 players, 52 matches (13 complete / 21 bye / 18 pending). November 22 FFTT3 `e81a2f62-84e6-4338-9847-d437897110c2`: draft, generation 0, revision 59, no players or matches. Both are unchanged from the pre-deployment record.

**Remaining acceptance limitation.** A signed-in walkthrough (Organizer, Bracket Manager, Scorer) on a fictional/practice event has **not** been performed: the deploying session has no staff credentials, and credentials must not be supplied to automation. The Organizer should run it using only a practice event (for example the synthetic showcase event), never the live November 22 event or the historical November 8 rehearsal: confirm login and navigation, the singles dialog reads **Close**, **Withdraw before play** appears only while no result, saved game or Consolation/Doubles competition exists, and saving games and corrections still work for each role. If a defect appears, redeploy `10ed3cf8-ef91-44af-8e95-f1db531548bf` (source `3af6444`) per the standard Staff rollback; the database is left as is and is not rolled back without separate approval.

## November 9, 2026 — Owner-approved hosted installation: COMPLETED

**Target:** Supabase project `fftt-bracket-manager-dev` (`copmkalfkkrkzheohwuc`) only. The Organizer separately approved this exact target after the 20-group private export was officially restore-verified, encrypted with AES-256, independently downloaded from Google Drive, successfully decrypted, and its backup/report SHA-256 checks passed.

**One transaction, exactly once.** Immediately before execution, the project was confirmed `ACTIVE_HEALTHY`; exactly nine migration names/versions were present, all three original function MD5 fingerprints matched the pinned proposal, no withdrawal RPC existed, 20 private tables remained, and the two real events matched their prior generation/revision and counts. The source Git blob `1d545444bf4aa2c8f737f6c632bc599812b8fe27` was independently compared to the source-pinned composer in the reviewed repository `main` (`152b906adf42fe6a0769a4434a5755acdb6bddac` before bookkeeping updates). Using the exact offline-composer algorithm, a **single** `BEGIN`/history-guard/approved proposal/insert-migration/`COMMIT` was sent through the connected project-specific SQL execution tool. It returned without error and was independently checked with subsequent read-only SQL. No `db push`, history repair, ad-hoc migration or retry occurred.

**Post-install evidence:**

- Precisely **10 hosted migration versions**, with the new last row `20261109170000` / `fftt_rehearsal_walkover_withdrawal`.
- `fftt_private.withdraw_preplay_v7` and `public.fftt_withdraw_preplay_v7` both exist. Both deny **anon** execution and allow **authenticated** execution; the private helper remains `SECURITY DEFINER` with empty `search_path`, and the public wrapper remains `SECURITY INVOKER` with empty `search_path`. Event-specific role and state checks remain part of the server function; granting `authenticated` execution alone is not blanket event authorization.
- Three updated installed function definitions, measured using read-only `md5(pg_get_functiondef(...))`: submit `ec324798cd69b8a572f9b95ea05989c4`, forfeit `314b5f7fe07a883bb9a858163574d621`, correct `910d89a38c513e0fb1e06111e9f542c1`.
- Exactly **20 private tables** and all **19 non-secret application table counts** unchanged from the protected pre-install aggregate snapshot; no installed SQL modified event/player/match data.
- November 8 rehearsal: event `d1169a31-032d-4ac7-866b-dc6cab34d588`, active / generation 3 / revision 86; 12 software players, 52 matches, 13 completed, 13 submissions, 13 game decisions, zero saved-game rows, six staff grants — all unchanged.
- November 22 FFTT3: event `e81a2f62-84e6-4338-9847-d437897110c2`, draft / generation 0 / revision 59; no software players, matches, scores or saved games, four staff grants — all unchanged.

**Remaining separate action (superseded):** at the time of the SQL installation the Staff deployment and the role walkthrough were pending and not authorized by the SQL approval. The Staff deployment has since been separately approved and performed (see the section above); only the signed-in practice-event role walkthrough remains. Do not rerun the one-time guarded transaction; its original nine-version precondition must fail on the now-10-version target.

## Released source and intended behavior

- Walkovers count as bracket resolutions, not real played matches, for Consolation eligibility. A walkover loser is not eligible solely because of an unplayed match; a walkover winner may qualify on their first subsequent played loss.
- A saved individual game cannot be overwritten as a no-show.
- Organizer/Bracket Manager may withdraw someone and regenerate an unplayed Championship bracket, but **only** before any accepted result, saved game/receipt or Consolation/Doubles competition exists. Registration and prior superseded bracket/audit history stay intact.
- Staff can distinguish an absent player, early departure or injury, and the singles score dialog says **Close**.
- The scored November 8 rehearsal is historical and is **not eligible for pre-play regeneration**. Never fabricate its unfinished results. Do not alter the November 22 event during acceptance tests.

## Release prerequisites (all required)

1. **Complete.** PR #81 was reviewed and merged into `main` as `83cc9a585a633d41f140dcf127052813ba9f5341` from exact tested head `801162cbe83ccdc87a7f6a1c42ec5e26ddb84b34`. [Comprehensive #42664018612](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/42664018612) passed all three major jobs; [focused CI #42662280815, attempt 2](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/42662280815) passed (65/65 and release-risk gate). The reviewed current-backup and installer sources are now on `main`.
2. **Complete for the one-time installation.** The hosted database history was verified to contain exactly these nine reviewed *pre-install* versions:
   `20261008183821`, `20261008183851`, `20261008195706`,
   `20261008201142`, `20261009044012`, `20261013101523`,
   `20261108101146`, `20261108114950`, `20261108150000`.
   No unexpected version, schema drift or changed pinned SQL was accepted. The successful transaction added exactly one **tenth** version, `20261109170000`; the nine-version guard is now deliberately non-replayable.
3. **Complete and independently confirmed by the Organizer (Nov 9).** Original owner-local read-only `fftt-hosted-export-v2` includes **20 groups** (19 non-secret private tables plus limited referenced Auth identities); the fixed, merged verifier produced a separate official `LOCAL_VERIFIED` proof, preserving the original failed report and export bytes. Source export SHA-256: `d068084ae28f08edb0a20d33231f33079873a1c5c65718bd5883a33e006431be`. An AES-256 encrypted `.dmg` (SHA-256 `2bd5f0525be8fe3c5e94fbf5f0924fed7b1ef7d9551c05626510d166c9490b88`) was copied to the selected Drive mount with matching local checksum, then **independently downloaded from Google Drive** by the Organizer and verified: download SHA-256, `hdiutil verify`, passphrase-protected attachment, original contained backup SHA-256, all 20 group identifiers, and valid official restore receipt all **PASS**. No raw backup, credentials or personal records entered GitHub, CI, email or ChatGPT. The tool's earlier `CLOUD SYNC: UNCONFIRMED` statement was **superseded by the Organizer's independent remote download verification**, not by its local mounted copy.
4. **Complete.** Independent read-only pre- and post-write catalog checks confirmed matching event IDs, states, player/match/result/score receipt counts, staff grants and source-pinned function fingerprints. Nineteen non-secret application table counts matched exactly.
5. **SQL approval and installation complete.** The Organizer explicitly approved one installation on project `copmkalfkkrkzheohwuc`; it was applied and independently verified, without replay. **Staff deployment remains separately approval-gated**. No source-only approval authorizes deploying Cloudflare/Staff or changing event results.

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

**Historical pre-install checkpoint (Nov 9):** This earlier *read-only* preflight did not itself create a backup, but the Organizer subsequently completed and proved the 20-group current-format owner-local backup and AES-256 Drive-download recovery described in prerequisite 3. **Do not re-export the private file merely to repeat completed evidence.** At this checkpoint, SQL still required explicit approval and immediate prewrite schema/history/event checks. Those safeguards subsequently passed and the guarded SQL was installed once as recorded above. Staff deployment alone remains separately approval-gated.

## November 9 — Recovery completed; repeated read-only target preflight

After the Organizer independently downloaded the encrypted archive from Google Drive and confirmed **SHA-256 PASS**, `hdiutil verify` **PASS**, password-protected mount **PASS**, original 20-group data SHA-256 **PASS** and official restore receipt **PASS**, the connected target `copmkalfkkrkzheohwuc` was queried **read-only** again. Still exactly 20 private tables and the same nine migration versions, with original function hashes `20b83f89b587ca69cf7781ddc25a3951` / `1695adccb33e750d2f23f9c254f3acc7` / `8b22b8caf9bfa783ec8d6abe1e7c1fff`. Both new withdrawal RPCs remain absent. Event-level metadata remained equal to the prior November 9 snapshot: the Nov 8 rehearsal is active (generation 3, revision 86, 12 app players, 52 matches, 13 completed, 13 result submissions, 13 game decisions, 6 staff grants); the Nov 22 event is draft (generation 0, revision 59, zero app players/matches/scores, 4 staff grants). Neither event was modified in this check.

**Historical pre-install checkpoint:** At this earlier point, SQL still required explicit approval. That later approval was granted and the guarded installation completed as documented above; Staff deployment remains unapproved.

## Guarded offline SQL composition — one-time installer provenance (do not replay)

The approved proposal source is `supabase/proposals/FFTT3_REHEARSAL_WALKOVER_WITHDRAWAL_20261109_DO_NOT_APPLY.sql`. The offline installer helper `tools/ops/compose_walkover_install.mjs` rejects a changed Git-blob source hash and produces a single mode-600 SQL file under `/private/tmp` containing:

- A transaction-wide exact **nine-entry** hosted migration-history guard.
- The reviewed SQL proposal and its separate three-function body fingerprint guards, rights and row safety checks.
- One new migration-history entry (`20261109170000`, `fftt_rehearsal_walkover_withdrawal`) with **no private SQL body stored**.
- One `COMMIT`; any error must abort the whole transaction. A replay or schema/history drift fails closed.

**Historical one-time composer:** `node tools/ops/compose_walkover_install.mjs /private/tmp/fftt-walkover-install-private.sql`. The approved equivalent guarded transaction has **already been installed once** on the named hosted project. **Do not compose/replay this installation against that now-10-version project**; its exact-nine-version guard must fail. Never substitute `db push`, `migration repair`, partial SQL or an unguarded SQL execution.

## Verification and rollout order

- Test the combined transaction in **disposable PostgreSQL**: wrong history installs nothing; correct nine-entry history installs once; a replay is refused; the two new RPCs remain denied to anonymous callers and are subject to event roles; all pre-existing event data stays unchanged.
- **Completed Nov 9:** applied the one source-pinned transaction only once after separate Organizer approval, followed by immediate read-only verification. Never replay it.
- **Completed Nov 9:** verified all **ten** migration versions, affected function fingerprints, anonymous execution denial, and unchanged historical rehearsal / November 22 event counts and results.
- Only then deploy the Staff bundle from the exact merged source, not any newer unreviewed version; verify asset hash and production identity before allowing event-day operation. TV/Spectator/public surfaces are not part of this Staff-only deployment.
- Conduct a signed-in **fictional/practice-event** role walkthrough with Organizer, Bracket Manager and Scorer; never create fake score results on the live November 22 event or rewrite the historical rehearsal.
- If a write or deployment fails, preserve evidence and stop. The SQL transaction rolls back automatically on an error before commit. **A post-commit rollback is a separate high-risk operation and is not preapproved**; prepare a reviewed rollback or safe roll-forward based on the protected backup and current event state.

## History

This document preserves the reviewed proposed release mechanics **and** records the subsequently approved, completed and verified SQL installation. It does not retroactively modify the November 8 rehearsal, supersede its event record, or claim that Staff has been deployed. The canonical historical notes remain in `0xCLS/forging-fellowship-table-tennis`.
