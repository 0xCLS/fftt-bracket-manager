# FFTT3 — Bracket Manager registration lookup and check-in (November 6, 2026)

Status: **IMPLEMENTED AND TESTED LOCALLY; NOT RELEASED.** Source: [PR #52](https://github.com/0xCLS/fftt-bracket-manager/pull/52) (draft). Nothing here has been applied to hosted Supabase, deployed to Staff production, or used on real registrations, rosters or staff grants. Hosted SQL, Cloudflare secrets and the Staff deploy each need their own explicit authorization (see [Release requirements](#release-requirements)).

## What changes for the people running the day

* **Event access without a Cloudflare edit.** The Staff registration Function no longer needs `REGISTRATION_EVENT_IDS`. A new real event reads its Google Sheet as soon as its Organizer saves **and enables** a source for that event in *Registration settings*. The November 8 rehearsal and November 22 events can share one sheet; each keeps its own roster, check-ins and opaque references.
* **A Bracket Manager can find a registered player and check them in.** On **Check-in** (Bracket Manager only) a **Registered players** card loads the event's sign-ups, searches by name, shows each person's suggested level, and shows who is already on the roster. One tap checks a plain registration in (adding the player to the roster at the suggested level). **Review & check in** opens a small dialog when a decision is needed: a missing level, other sign-ups that look like the same person (merge), or a roster player who already has this name (match them, never add twice). Registrations without a usable full name cannot be checked in from here; the card says to ask the Organizer to fix the sheet or add a walk-in. The roster table and **Add & check in** (walk-ins) below are unchanged, and the whole screen locks once the Championship bracket exists, exactly as before.
* The Bracket Manager sees **names, suggested levels and sign-up times only**: no e-mail or phone (not even masked), no sheet link, no mapping, no raw answers.

## Security model

| Question | Answer |
| --- | --- |
| Who may look up / check in? | Only a **current** `bracket_manager` of **that event**. Scorekeepers, unassigned or revoked staff, Organizers (who use their own workflow), and other events are refused by the Function **and** by the database. The role is read live on every call. |
| Does the Bracket Manager get the source RPC? | **No.** `fftt_registration_source_v5` and `fftt_set_registration_source_v5` stay Organizer-only (asserted in SQL and browser tests). The sheet id, tab and mapping never reach the desk. |
| Can the browser invent a registration, change a name or level, or reuse another person's request? | **No.** The browser sends only an opaque reference (plus an optional level 1–5, duplicate references and a roster link). The Function re-reads the event's own enabled sheet, finds that reference, and sends the database the **name and level it read**, with an HMAC proof. The database checks the proof, so a forged or altered request is refused. |
| What does a proof bind? | Purpose, event, the **signed-in user's id**, a 45-second expiry (the database accepts at most 120 s) and, for a check-in, the source fingerprint plus every reference, name and level. Another user, event, source, name, level or extra item changes the proof. The browser never receives a proof. |
| What if the Organizer changes the source in between? | The check-in names the source fingerprint (a hash of kind, spreadsheet id and tab). The database compares it with the **current** saved source: `source-changed` is refused. A disabled source (`source-not-enabled`) and a fictional source on a real event (or a live sheet on a synthetic event) are refused too. |
| Duplicates and identity substitution | Merging is allowed only for sign-ups the registration model itself grouped with the chosen one; the database links them to the same player (never a second one). A roster link is allowed only to a roster player of the **same name**; that player's own level, name and source are not rewritten. |
| Idempotency and races | The event row is locked for the whole call. Repeating a check-in changes nothing (`unchanged`, no new revision, no new audit row). A name already on the roster is refused (`duplicate-name`) until the person explicitly matches it. Roster full (64) and the bracket lock are enforced in the database. A lost reply is reported as **outcome unknown**: the screen refreshes from the database before anything is retried. |
| Event revision checks | The operation does not take an expected revision: it is idempotent per reference and every conflict (name, roster size, lock, source) is checked inside the locked transaction, so a stale screen cannot produce a wrong roster. The returned revision updates the snapshot. |
| Audit | One `registration_checkin` audit row per change with `via: bracket_manager`, the outcome (`created` / `linked` / `existing`), the player id and the number of merged sign-ups. No name, contact, answer or sheet id is stored in the audit row. |
| Walk-ins | Unchanged and separate: `fftt_event_day_walkin_v1`, full name and level chosen at the desk. Registration check-in does not weaken or replace it. |
| SQL hygiene | Private functions are `SECURITY DEFINER` with `search_path = ''`; helpers and the secret installer are executable by **no** API role; only the two public wrappers are granted to `authenticated` (not `anon`, not `public`); the secret table has RLS on and no API grant. HMAC-SHA256 uses the core `sha256()` (no extension) and is verified against RFC 4231 vectors on PGlite and native PostgreSQL 17. |
| What is **not** changed | Role-specific snapshots and publication permissions, Staff account administration (Organizer-only), source configuration (Organizer-only), the Organizer registration workflow, `fftt_checkin_registrants_v4`, `fftt_set_checkin_v3`, scoring and bracket permissions. |

### Retained deployment controls (still required)

`REGISTRATION_ENABLED` (global switch), `STAFF_ORIGIN` and `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (origin and project pinning), `REGISTRATION_GOOGLE_MODE` (`off` · `diagnostic` · `enabled`, the incident switch), `GOOGLE_SA_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` (read-only scope), `REGISTRATION_REF_SECRET` (opaque references), the synthetic-event rule (a live sheet is never served for a synthetic event; the fictional source never for a real one), per-event saved source + enable switch, authentication and event-scoped role checks.

### Retired

`REGISTRATION_EVENT_IDS`. The Function ignores it (set or not, valid or not). It is deleted from the Staff Cloudflare project only as a later, separately authorized cleanup (step 6 below), after the release is accepted: the previous Staff bundle, which is the rollback target, still requires it.

### Review of other rollout-era restrictions (bounded, November 6)

| Restriction | Finding | Action |
| --- | --- | --- |
| `REGISTRATION_EVENT_IDS` (Cloudflare event list) | Duplicated the database's event-scoped role check and the event's own saved, enabled source, and needed a manual Cloudflare edit and redeploy for every new event. | **Removed** (tests: new eligible event, obsolete setting ignored, Nov 8/Nov 22-style events on one sheet). |
| `event-not-enabled` Function answer | Only the allowlist produced it. | Removed with it. |
| `REGISTRATION_SHEET_ID`, `REGISTRATION_SHEET_RANGE` in the setup list | Not read by any code since V5's per-event source. | Removed from the active setup list (docs only). |
| `REGISTRATION_ENABLED`, `REGISTRATION_GOOGLE_MODE`, credentials, `REGISTRATION_REF_SECRET`, `STAFF_ORIGIN`, Supabase pinning | Global incident switches and secrets, not per-event steps. | **Kept.** |
| Per-event saved source + enable switch, Organizer-only source RPC | Meaningful: it is how an Organizer authorizes one event to read one sheet. | **Kept.** |
| Synthetic-event rule (live sheet never for a synthetic event; fictional source never for a real one) | Meaningful isolation boundary, enforced in the Function and the database. | **Kept**, and extended to the new check-in. |
| 20-second sheet cache, 30 requests/minute per user, 64-player roster, bracket lock | Operational limits and safety rules, not rollout gates. | **Kept.** |

## Release requirements

Authorization is needed separately for **each** of steps 2–6. Steps 0–1 change nothing hosted. Every step is additive and reversible, and the order below is the safe order: if the guard in step 1 fails, nothing hosted has been touched.

**Which project this is.** Production Staff is the Cloudflare Pages project **`fftt-staff`** (`https://fftt-staff.clslifestyle.com`, also `https://fftt-staff.pages.dev`). It is the only project that receives the registration Function, the proof secret or this bundle. These are **never** targets: `fftt3-staff-stg` (the old Staff staging project, still reachable at `fftt3-staff-stg.pages.dev`), `fftt3-games-stg` (Spectator staging), `fftt-games` (production Spectator/TV, static only) and `fftt-public` (the public homepage). Every `wrangler` command below names `--project-name fftt-staff` explicitly and is run from a clean worktree with `.wrangler/` removed, because without the flag wrangler falls back to a project name remembered in a local cache or config.

**Integration: nothing has to be merged.** Production already runs [PR #51](https://github.com/0xCLS/fftt-bracket-manager/pull/51)'s head `9f555bbdb832e35503c43101299560398affbcc3` (Staff deployment `c813b26b-39af-41eb-a2fa-8b2c1a461a1f`); PR #51 stays an unmerged draft, as the earlier releases did. PR #52 is stacked on that exact commit (it is an ancestor of PR #52's head), so the exact PR #52 commit is released the established way: a clean detached worktree of that commit, a production Staff export, a Staff-only `wrangler pages deploy` from the repository root so both Pages Functions are compiled in. No PR is merged or retargeted for the release. Checked on November 6, 2026: a clean production export of `9f555bb…` is byte-for-byte the live Staff manifest (41 files, same SHA-256 for every file), so the export recipe below reproduces what is live. The same export of PR #52 differs from live in exactly these served files, plus the Function code (`server/registration/*`, not a served file). The application code is identical from `ecb6f9fa935b5fab187e2cc1fbf90a3348673556` onward (later PR #52 commits change only the runbook, release tooling, tests and a comment in the SQL candidate; the exported bundle is byte-identical), but the release commit must be the **final PR #52 head recorded in the PR description**, because the guard and the installer below live in that commit:

| | file |
| --- | --- |
| added | `app/view_desk_registration.mjs` |
| changed | `app/app.css`, `app/staff_core.mjs`, `app/staff_ui.mjs`, `contracts/registration_client.mjs` |
| removed | none |

(The guard in step 1 prints this list for whatever commit is being released; compare it with this table.)

**0. Before anything (read-only).** Green full CI on the exact release commit (its run is linked from the PR description; `ecb6f9f…` passed [run 42172180808](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/42172180808)); a fresh private backup with disposable restore evidence ([backup and recovery](FFTT3_BACKUP_RECOVERY.md)); read-only reconfirmation that the hosted database carries the Bracket Manager role layer (`FFTT3_BRACKET_MANAGER_ROLE_20261030`) and the event-day delegation layer (`FFTT3_EVENT_DAY_DELEGATION_20261105`, recorded as applied on November 5, 2026). Record, to compare afterwards: the live Staff manifest (`curl -s https://fftt-staff.clslifestyle.com/MANIFEST.json`), the Spectator manifest (`https://fftt-games.clslifestyle.com/MANIFEST.json`, commit `f6cc0d68…` on November 6) and a SHA-256 of the homepage response (`curl -s https://fftt.clslifestyle.com/ | shasum -a 256`).

**1. Build the exact commit and run the target guard (local; nothing hosted changes).**

```
RELEASE=<full 40-character final PR #52 head SHA from the PR description>   # the CI-verified commit, never a branch name
git fetch origin && git worktree add --detach /private/tmp/fftt-release "$RELEASE"
cd /private/tmp/fftt-release && rm -rf .wrangler && git status --short   # must print nothing
python3 tools/staging/build_export.py --checkout . --commit "$RELEASE" --environment production \
  --origin https://fftt-staff.clslifestyle.com --spectator-origin https://fftt-games.clslifestyle.com \
  --target staff --out ../staff-bundle
python3 tools/ops/staff_release_guard.py --project fftt-staff --release-commit "$RELEASE" --bundle ../staff-bundle
```

The guard must print `GUARD PASSED`. It refuses any other project name (staging, Spectator, homepage, a typo), requires `fftt-staff.clslifestyle.com` and `fftt-staff.pages.dev` to serve the same production Staff deployment, requires the bundle to be the release commit, production, Staff-only (production origin only, no `server/`, `functions/`, `supabase/`, `tests/` or `docs/` file served), and prints the add/change/remove list to compare with the table above. Also confirm the Cloudflare login and project (read-only): `npx wrangler@4 whoami` shows the expected account, and `npx wrangler@4 pages project list` shows `fftt-staff` with the domain `fftt-staff.clslifestyle.com`. Run **both** the guard and these checks again immediately before steps 4 and 5 if any time has passed.

**2. Hosted SQL (the owner).** Run `supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql` once; it is one transaction and purely additive, so the Staff bundle that is live now is unaffected. Connect with libpq settings and `~/.pgpass` (mode `0600`) or a pg service, **not** a `postgresql://user:password@…` URL on the command line, which would put the database password in the process list:

```
psql -X -v ON_ERROR_STOP=1 -f supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql
```

**3. Install the proof secret in the database, without the value ever appearing in an argument, history, log, repository or chat.** Generate it into a private file that is outside every repository, with the value travelling only through a pipe; then install it with the same connection settings, redirecting the file into psql's standard input:

```
umask 077; mkdir -p ~/Documents/FFTT-private/secrets
openssl rand -hex 32 | tr -d '\n' > ~/Documents/FFTT-private/secrets/REGISTRATION_GATE_SECRET.txt
cd /private/tmp/fftt-release
psql -X -v ON_ERROR_STOP=1 -f tools/ops/install_registration_gate.sql < ~/Documents/FFTT-private/secrets/REGISTRATION_GATE_SECRET.txt
```

It prints `installed` and the length, never the value. `tools/ops/install_registration_gate.sql` reads the value with `\copy … from pstdin` (the COPY data stream, not SQL text), so it is not in the psql or shell process arguments, not in a psql variable, not in any statement text and therefore not in a server statement log, and not in shell history (the command line holds only file paths). It refuses, before storing anything and without echoing the value, a file that is empty, has more than one line, is shorter than 32 or longer than 200 characters, or contains anything but `A-Z a-z 0-9 + / = _ . -`. Do **not** use `-c`, `\set`, a here-string, a pasted value or the Supabase SQL editor for this step. Tested on throw-away PostgreSQL 16 and 17 with `log_statement = all`: the value appears in no log, output or error (`tests/registration_gate_installer_postgres.sh`). Re-running with a new file rotates the secret: repeat step 4 and the deploy of step 5 at once (between the two, desk calls are refused and nothing else is affected).

**4. Cloudflare secret, production Staff project only.** After the guard passes again:

```
cd /private/tmp/fftt-release
npx wrangler@4 pages secret put REGISTRATION_GATE_SECRET --project-name fftt-staff --env production < ~/Documents/FFTT-private/secrets/REGISTRATION_GATE_SECRET.txt
```

Wrangler reads the value from standard input when it is not typed (it trims only trailing whitespace, and the file has none), so there is again no secret in an argument or history. The output must say `Creating the secret for the Pages project "fftt-staff" (production)`; if it names any other project or environment, stop. The same command with `--project-name` of any other project is the mistake this runbook exists to prevent: never run it for `fftt-games`, `fftt3-staff-stg`, `fftt3-games-stg` or `fftt-public`. List the secret **names** (never values) before and after (`npx wrangler@4 pages secret list --project-name fftt-staff --env production`): exactly one name, `REGISTRATION_GATE_SECRET`, is added. Do not open, print or paste the value anywhere; after step 6 keep the private file only as the owner's recovery copy (mode `0600`, outside the repository), or delete it and rotate when needed.

**5. Staff production deploy of the exact commit (Staff only).** Cloudflare applies variable changes to new deployments only, so this deploy is what makes the new secret live. From the same clean worktree, at the repository root so `functions/` is compiled in (the output must say `Compiled Worker successfully` and `Uploading Functions bundle`):

```
cd /private/tmp/fftt-release
python3 tools/ops/staff_release_guard.py --project fftt-staff --release-commit "$RELEASE" --bundle ../staff-bundle   # again: must pass
npx wrangler@4 pages deploy ../staff-bundle --project-name fftt-staff --branch main --commit-hash "$RELEASE"
python3 tools/ops/verify_deployment.py --bundle ../staff-bundle --base https://fftt-staff.clslifestyle.com --kind staff
```

`verify_deployment.py` must print `ALL LIVE CHECKS PASSED` (every served file's SHA-256, headers, private paths not served, `GET /api/registrations` 405, token-less `POST` 401). Also confirm the live `MANIFEST.json` reports the release commit with target `staff` and environment `production`, that Spectator (`fftt-games`) and the homepage (`fftt-public`) responses equal what step 0 recorded, and that the previous good Staff deployment `c813b26b-39af-41eb-a2fa-8b2c1a461a1f` is still listed for rollback. Keep the existing registration variables as they are; do not replace the project's configuration.

**6. Later cleanup (separately authorized, not part of the release).** Only after the Organizer has accepted the release **and** a return to the previous bundle is no longer wanted, delete the obsolete `REGISTRATION_EVENT_IDS` variable from the `fftt-staff` project (dashboard: Settings → Variables and secrets → Production). The new bundle ignores it either way, and a variable change reaches only later deployments, so this is housekeeping that stops anyone editing it again, not a release step. Until then it stays: the previous bundle needs it, and leaving it is harmless to the new one.

Order safety: the SQL (step 2) is additive, so the live bundle is unaffected by it. A new bundle deployed without the SQL or the secret shows "Registration lookup is not set up for this event" and leaves the roster and walk-in screens working. A secret that differs between the database and Cloudflare makes only the desk lookup and check-in answer "forbidden"; the Organizer's registration workflow does not use it.

### Verification after release (signed in as each person; use the private rehearsal event, never create or alter the live Nov 22 event for a test)

* Bracket Manager of event A: **Check-in → Registered players** loads; one registered player checks in; the roster shows them at the suggested level; repeating changes nothing; the roster table's **Undo** still works. (This is also the proof that the two copies of the secret match.)
* The same Bracket Manager cannot reach event B (not assigned): refused. A Scorekeeper and an unassigned account: refused. A revoked Bracket Manager: refused with the same still-valid page.
* The Organizer's **Players** tab, Registration settings, CSV and check-in behave as before.
* After the Championship is built, the card reports that check-in is closed and its buttons are disabled.
* The page shows no e-mail, phone, sheet link or credential; `select * from fftt_private.registration_links` and the audit log show opaque references, names and levels only.
* Switching `REGISTRATION_GOOGLE_MODE` to `diagnostic` makes the lookup answer "not available" immediately; switching back resumes it.

### Rollback (reversible, deletes no event data)

Do these in this order, each with its own authorization:

1. Redeploy the previous good Staff bundle **first**, so no bundle calls the functions that are about to be removed: Cloudflare dashboard → `fftt-staff` → Deployments → **Rollback to this deployment** on `c813b26b-39af-41eb-a2fa-8b2c1a461a1f` (source `9f555bbdb832e35503c43101299560398affbcc3`, immutable URL `https://c813b26b.fftt-staff.pages.dev`), or redeploy that source as shown below. The new card disappears and the old roster/walk-in screen returns. That bundle still needs `REGISTRATION_EVENT_IDS`, which is why step 6 deletes it only after acceptance; if it was already deleted, set it again to the real event's id (plain text, `fftt-staff` Production) and redeploy before relying on the Organizer's registration loading.
   ```
   OLD=9f555bbdb832e35503c43101299560398affbcc3
   git worktree add --detach /private/tmp/fftt-rollback "$OLD"
   cd /private/tmp/fftt-rollback && rm -rf .wrangler
   python3 tools/staging/build_export.py --checkout . --commit "$OLD" --environment production \
     --origin https://fftt-staff.clslifestyle.com --spectator-origin https://fftt-games.clslifestyle.com \
     --target staff --out ../staff-rollback-bundle
   python3 /private/tmp/fftt-release/tools/ops/staff_release_guard.py --project fftt-staff --release-commit "$OLD" --bundle ../staff-rollback-bundle
   npx wrangler@4 pages deploy ../staff-rollback-bundle --project-name fftt-staff --branch main --commit-hash "$OLD"
   ```

2. Run `supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_ROLLBACK_DO_NOT_APPLY.sql` the same way as step 2 (it removes only the new functions and the stored secret table; players, links and audit rows already written stay; it is safe to run twice, and the candidate can be applied again afterwards).
3. Remove `REGISTRATION_GATE_SECRET` from the `fftt-staff` project (`npx wrangler@4 pages secret delete REGISTRATION_GATE_SECRET --project-name fftt-staff --env production`, or the dashboard) and delete the private secret file if it will not be reused. Without the SQL or the secret the Function answers "not set up"; nothing else depends on them.

Run the guard before any rollback command that names a project, exactly as in step 1 (with `--live-only` when no bundle is being built).

## Evidence (all fictional, all local)

* `tests/e2e/bm_registration_lookup.test.mjs` — real SQL in PGlite behind the real Function with a fake Google, two real-mode events sharing one sheet: independent rosters and check-ins; a new event with no deployment setting; Organizer, Bracket Manager, Scorekeeper, unassigned, revoked, demoted and cross-event matrix; forged, altered, retargeted, replayed, expired and wrongly keyed proofs; duplicates, ambiguous and incomplete registrations; levels; existing roster players; late arrival and bracket lock; disabled, missing, changed and unreadable sources; synthetic isolation; no sensitive data; privileges and `SECURITY DEFINER` hygiene; rollback and re-apply. Mutation-checked: removing the proof check, widening the role or dropping the bracket lock each fails the suite.
* `tests/fftt3_bm_registration.sql` (in `tests/gameday_single_project_postgres.sh`) — the same on native PostgreSQL, including the RFC 4231 vectors and the rollback.
* `tests/registration_gate.test.mjs` — the proof byte layout, the strict desk payload, the client and the Function's role boundaries without a database.
* `tests/e2e/gameday_desk_registration_browser.test.mjs` — real Chromium, desktop and phone: search, one-tap check-in, review, duplicate merge, missing level, incomplete name, privacy, lost reply, switched-off source, outage, missing secret, locked bracket, revocation.
* `tests/test_staff_release_guard.py` — the release guard refuses staging, Spectator, homepage and mistyped project names, a wrong or staging bundle and an unreachable live site; and the runbook's own commands are parsed: every `wrangler` secret/deploy command names `--project-name fftt-staff`, no command names a staging or homepage project, and no command carries the secret in an argument.
* `tests/registration_gate_installer_postgres.sh` — a throw-away PostgreSQL 16 and 17 with `log_statement = all`: the secret installer reads standard input only, stores exactly the file's value, rotates, refuses 16 kinds of bad file without echoing them, and leaves the value in no log or output.
