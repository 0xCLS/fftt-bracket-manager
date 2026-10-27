# FFTT3 — hosted cutover runbook (single project, in place)

**Status:** ready to run after the organizer's ONE consolidated approval. Nothing here has been run against the hosted project except read-only queries. Existing infrastructure only: Supabase `fftt-bracket-manager-dev` (`copmkalfkkrkzheohwuc`), Cloudflare Pages `fftt3-staff-stg` and `fftt3-games-stg`. No new project, repository or paid resource.

## What the approval covers
1. **Apply the reviewed in-place SQL** (`tools/release/build_single_project_upgrade.py`, 12 pinned functions + drop `events_synthetic_only_check` + mode-immutability trigger) to the hosted project.
2. **Create the real FFTT3 event** (real mode, separate from the four fictional events) and set its organizer/scorekeepers.
3. **Enable the read-only Google Sheets registration source for that one event** (`REGISTRATION_EVENT_IDS`, `REGISTRATION_REF_SECRET`, `REGISTRATION_GOOGLE_MODE=enabled`), including the first read of real registration rows.
4. **Deploy** the verified Staff and Spectator builds to the two existing Pages projects.
Not covered (separate approvals): publishing real player names to spectators/TV; merging PR #19.

## Preconditions (all must hold; abort otherwise)
* Latest CI run on the release commit is green; PR #19 stays a draft.
* A fresh private backup exists and `node tools/ops/restore_verify.mjs <file> --rehearse` printed `ALL CHECKS PASSED` (see `FFTT3_BACKUP_RECOVERY.md`).
* Schema before = repo: run `tools/ops/schema_fingerprint.sql` on the hosted project; the six lines must equal `node tools/ops/local_schema_fingerprint.mjs`:

  | kind | n | fingerprint (before) | fingerprint (after) |
  | --- | --- | --- | --- |
  | column | 148 | `a047290880a407c51d33994b7648b1f1` | `a047290880a407c51d33994b7648b1f1` |
  | constraint | 88 → 87 | `7b9418844e2cb5fe3d5293eb4fc11942` | `85f32e206b41d9694edf3ae9cf5ce658` |
  | function | 93 → 94 | `1ab09a249c80ccbd3d40fce8c0751a6c` | `ef010512268bfa6b01f1d9ec290c69a9` |
  | rls | 14 | `8c7d33b5af650bdeff6aa31e9493c4b1` | `8c7d33b5af650bdeff6aa31e9493c4b1` |
  | trigger | 4 → 5 | `6023c6e8e4e1738692894dd021ac01f1` | `bcc594f6c3aa032a17f5baa91166e6f0` |
  | view | 2 | `0af5911ec4d090918f71f4a4e02ac8b3` | `0af5911ec4d090918f71f4a4e02ac8b3` |
  (Verified identical on October 27: hosted "before" = repo "before".)
* Hosted Auth: public sign-ups **off**, anonymous sign-ins **off**, e-mail confirmation **on** (verified read-only on October 27).
* The Staff build deployed together with the SQL is the one built from the release commit (below). The previous Staff bundle fails closed on V4/V5 snapshots, so SQL and bundles go live **within minutes of each other**; do it in a quiet window, not during an event.

## Step 1 — generate and pin the SQL
```
python3 tools/release/build_single_project_upgrade.py --out /private/tmp/fftt-upgrade.sql
python3 tools/release/build_single_project_upgrade.py --rollback-out /private/tmp/fftt-rollback.sql
shasum -a 256 /private/tmp/fftt-upgrade.sql /private/tmp/fftt-rollback.sql
```
Expected on the release commit (the generator is source-pinned by Git blob SHA; any drift aborts):
* upgrade: `9812087552ccd97aad3af135514e88fc037c3d7b8097db303b495f2cb35c35f6`
* rollback: `2bf97f3e0f8971534d6fb0d11e7358f4434326298481084220857b54df3ab366`

## Step 2 — fresh backup, then migrate
1. Take the pre-migration backup (`tools/ops/hosted_export.sql`), save privately, run `restore_verify.mjs --rehearse` on it.
2. Paste `/private/tmp/fftt-upgrade.sql` into the Supabase SQL editor and run it **once**. It is a single `begin … commit` block; its preflight raises (and changes nothing) if the CHECK is missing or any non-synthetic data already exists, so it cannot run twice.
3. If it errors, nothing is applied (transaction). Stop, keep the error text (no secrets in it), do not retry blindly.

## Step 3 — verify the migration (hosted)
* `tools/ops/schema_fingerprint.sql` equals the **after** column above (constraint 87, function 94, trigger 5).
* Re-run `tools/ops/hosted_export.sql`: every table's `n` and `fp` equals the pre-migration backup (4 events, 18 players, 25 matches, 20 score decisions, 13 staff grants, 52 audit events, …). Any difference → run the rollback SQL (Step R) and investigate.
* `select event_name, synthetic_only from fftt_private.events;` shows the four fictional events, all `true`. `update fftt_private.events set synthetic_only=false …` must fail with `fftt_event_mode_immutable` (try it inside `begin … rollback`).
* The existing Staff site (old bundle) still signs in and shows the completed rehearsal event: no regression for existing events.

## Step 4 — deploy the verified bundles (existing projects, from a clean detached worktree)
**Release commit:** `efcdc0003e24ac183be0ab4b010c79a0d6ba88c8` (the last CI-verified code commit; later commits on the branch are documentation only and are not deployed). Dry-run build on October 27: Staff 36 files, Spectator 17 files, every file hash equal to its `MANIFEST.json`, manifest `commit` = this SHA, target `staging`.

```
git worktree add --detach /private/tmp/fftt-release <RELEASE_SHA_FULL>
cd /private/tmp/fftt-release && rm -rf .wrangler
python3 tools/staging/build_export.py --checkout . --commit <RELEASE_SHA_FULL> --environment staging --origin https://fftt3-staff-stg.pages.dev --spectator-origin https://fftt3-games-stg.pages.dev --target staff --out ../staff-bundle
python3 tools/staging/build_export.py --checkout . --commit <RELEASE_SHA_FULL> --environment staging --origin https://fftt3-games-stg.pages.dev --target spectator --out ../spectator-bundle
# staff: run from the repo root so functions/ is included; spectator: from a directory WITHOUT functions/
npx wrangler@4 pages deploy ../staff-bundle --project-name fftt3-staff-stg --branch main --commit-hash <RELEASE_SHA_FULL>
(cd .. && npx wrangler@4 pages deploy spectator-bundle --project-name fftt3-games-stg --branch main --commit-hash <RELEASE_SHA_FULL>)
```
(Use the exact recipe recorded in the project memory if the flags differ; `wrangler login` is an owner click if the OAuth token expired.) Then verify both live sites against the local bundles (read-only; exit code 0 only if everything passes):
```
python3 tools/ops/verify_deployment.py --bundle ../staff-bundle --base https://fftt3-staff-stg.pages.dev --kind staff
python3 tools/ops/verify_deployment.py --bundle ../spectator-bundle --base https://fftt3-games-stg.pages.dev --kind spectator
```
It compares every served file's SHA-256 and the live `MANIFEST.json` with the local build, checks CSP/nosniff/no-referrer/no-store/noindex/HSTS, that `server/`, `functions/`, SQL, tests, docs and dotfiles are not served, that `/api/registrations` answers 405 (GET) and 401 (no token) on the staff origin, and that the spectator origin serves no Function and no staff page. (Run against today's live sites with the `00068134` bundles it printed `ALL LIVE CHECKS PASSED` for both, so the rollback references below are exactly what is live now.)
**Rollback references (keep):** Staff `944c112b-25ad-4ef2-9d81-c47acf1eb477` (live now) → before it `6ffe2598-b0f7-47fa-b411-0a89034eb269`; Spectator `d877dd90-7e75-476c-8c27-204ac84e1352` → before it `a367d9f9-af87-4518-a42f-c152ea1a2823`. There is no `wrangler` rollback command: redeploy an old export or use the dashboard's "Rollback to this deployment".

## Step 5 — create the real event and grant staff (in the Staff app, signed in as the Organizer)
1. Events → **New event** → name `FFTT3` (or the organizer's exact name), date **2026-11-22**, tables = the real count. It is created in **real mode** (`synthetic_only=false`); the creator becomes its Organizer. Verify in the SQL editor: `select id, event_name, synthetic_only, lifecycle from fftt_private.events where synthetic_only = false;` → exactly one row. **Copy its UUID.**
2. Staff tab → grant **scorekeeper** to each volunteer by e-mail. The grant works only for an existing, e-mail-confirmed Auth user: the owner creates those users in Supabase → Authentication → Users (the owner types the passwords; the assistant never handles them). Scorekeeper A and B need their own accounts. Revoke is immediate.
3. Do **not** add fictional players here. Leave check-in empty and the event **not public** until Step 7.

## Step 6 — turn on Google registration for that one event (Cloudflare → Pages → `fftt3-staff-stg` → Settings → Variables and Secrets, **Production**)
| Name | Type | Value |
| --- | --- | --- |
| `REGISTRATION_EVENT_IDS` | plain text | the real FFTT3 event UUID from Step 5 (only this one) |
| `REGISTRATION_REF_SECRET` | **secret** | the 64-character value in `~/Documents/FFTT-private/secrets/REGISTRATION_REF_SECRET.txt` (generated locally on October 27; never pasted into chat or GitHub) — or set with `npx wrangler@4 pages secret put REGISTRATION_REF_SECRET --project-name fftt3-staff-stg < that file` |
| `REGISTRATION_GOOGLE_MODE` | plain text | change `diagnostic` → `enabled` **last** |
| `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` | secret | **unchanged** (already saved; do not re-enter) |
Pages applies variable changes to **new deployments only**: redeploy the staff bundle once after saving (same build, same command as Step 4). Leave `REGISTRATION_SOURCE` as is; the database refuses the fictional fixture on a real event anyway.
Then, as the Organizer: Players → Registration settings → paste the response sheet link → **Check sheet** → review the column mapping → **Test connection** → check **Enable** → **Save**. The response sheet stays shared as Viewer with the service account only; the Outreach Tracker is never shared.

## Step 7 — acceptance and go/no-go (see `FFTT3_ACCEPTANCE_CHECKLIST.md`)
Run the Organizer / Scorekeeper A / Scorekeeper B / outsider checks on real devices. **Load registrations** (read-only) and reconcile duplicates before any check-in. Publishing names to spectators/TV is a separate organizer decision (Overview → **Publish to spectators**); until then spectators see nothing.

## Step R — rollback / incident switches (fastest first)
1. **Stop reading Google:** Cloudflare `REGISTRATION_GOOGLE_MODE` → `diagnostic` (and redeploy) or switch the event's source off in Registration settings. Check-in by hand and CSV import still work.
2. **Hide from the public:** Overview → **Hide from the public** (immediate).
3. **Pause staff:** Staff tab → revoke a scorekeeper (immediate); a revoked token is refused on the next call.
4. **Roll back the schema** (only while **no real event exists**): run `/private/tmp/fftt-rollback.sql`, then the fingerprint query must equal the **before** column. After the real event exists, roll forward or restore from a backup instead.
5. **Roll back Cloudflare:** redeploy the earlier export (rollback references above). Note a pre-V4 Staff bundle cannot read the V4/V5 database; roll the Pages deployment back only to a bundle that matches the database.
