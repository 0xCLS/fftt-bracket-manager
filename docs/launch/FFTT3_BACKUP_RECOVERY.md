# FFTT3 — private backup, restore proof and rollback

**Status:** procedure written and executed on October 27, 2026 against the existing project `fftt-bracket-manager-dev` (read-only) and a disposable local database. Nothing in this procedure writes to the hosted project.

## Why this shape
Supabase Free has no downloadable managed backups, and this Mac has no `pg_dump`/`psql`/Docker (and the hosted database password is not held by the assistant). The backup therefore uses the one door that is already open and owner-controlled: a **read-only query in the Supabase SQL editor**, whose result is saved privately and **proven restorable** by loading it into a throw-away PostgreSQL (PGlite) built from the repository's SQL.

## What a backup contains (and does not)
* All 14 private FFTT tables (`events`, `players`, `matches`, `brackets`, `event_staff`, `platform_organizers`, `score_decisions_v2`, `result_submissions`, `audit_events`, `consolation_reviews`, `doubles_finale`, `registration_links`, `registration_sources`, `deleted_events`), row for row.
* The Auth identities the staff grants refer to: **id, email, created_at, is_anonymous only** (no password hashes, tokens or secrets), so grants stay meaningful after a restore.
* Not included: Cloudflare secrets, Google credentials, the Supabase Auth password hashes, any Google Form answer (registration answers are never stored).
* Contains staff e-mail addresses and, for a real event, **player names and results** → it is private data. **Never commit it, never paste it in chat, never email it.**

## One-command Mac backup (recommended; V6 preparation)

From the repository checkout, run `./tools/ops/fftt-backup`. The script calls only
Supabase's dedicated `/database/query/read-only` endpoint using a project-scoped
`database_read` token. It never links the Supabase CLI, runs hosted SQL writes, or
accepts database passwords. Before the first run, store such a token securely with
`./tools/ops/fftt-backup --setup` (macOS Keychain prompt; never pass a token as a
command-line argument). An existing `SUPABASE_ACCESS_TOKEN` environment value
takes precedence; a private mode-600 `~/.supabase/access-token` is an optional fallback.

The command writes private mode-600 JSON and a non-sensitive report beneath
`~/Documents/FFTT-private/backups` (mode 700), captures the hosted schema
fingerprint, and auto-installs pinned local test dependencies only if needed. It
verifies a disposable pre-V6 real-mode restore and attempts V6 **only on the
clone**, checking original rows, fingerprint integrity, authorization and
publication flags. If schema definitions differ, the restore or API read fails,
it leaves the private backup marked **UNVERIFIED** and blocks release.

For an independently checked second copy, set `FFTT_BACKUP_MIRROR_DIR` to a
private directory on encrypted removable storage or an owner-controlled
encrypted cloud storage mount. Alternatively run `./tools/ops/fftt-backup
--mirror-dir /absolute/path/to/private/mirror`. Without a verified second
copy, the result is `LOCAL_VERIFIED`, not complete release-readiness.
Never upload raw backup JSON to GitHub, chat, email or CI.

This is a logical FFTT app-data backup. It excludes Auth password hashes,
Cloudflare secrets and public projection caches (which must be rebuilt and
re-reviewed in recovery). The Management API's dedicated read-only endpoint
is currently Beta; a permission failure or missing endpoint blocks the
automation rather than falling back to write-capable SQL.

## Explicit secret exclusion and future schema changes

The live schema currently has 15 private tables: 14 application tables
in this JSON export, plus `fftt_private.registration_gate`.
The latter contains a `secret bytea` proof credential and is deliberately
**not exported**. Its key must be protected or re-established using a
separate owner-controlled procedure if the hosted database is ever rebuilt.
The backup tool checks an unprivileged read-only inventory of all private
tables and refuses success if an unfamiliar table appears. This is **not**
a full Supabase Auth, Cloudflare or proof-secret disaster-recovery export.

## Legacy manual backup (fallback)
1. Open the SQL editor of `fftt-bracket-manager-dev`, paste the contents of `tools/ops/hosted_export.sql`, **Run**. (Read-only; it changes nothing.)
2. Copy the result into one JSON document (`format: "fftt-hosted-export-v1"`, `tables: {name: {count, fingerprint, rows}}`) and save it as a **mode-600 file in a private folder outside any Git repository**, e.g. `~/Documents/FFTT-private/backups/hosted-export-<purpose>-<UTC-timestamp>.json` (folder mode 700). Record its `shasum -a 256`.
3. Keep at least: one pre-migration copy, one taken right before the Nov 22 doors open, and one after the final result is entered. Copy the newest one to a second private place (an encrypted USB drive or the owner's private cloud storage) — a laptop-only backup is not a backup.

## Prove the backup (always, before relying on it)
```
cd tests/e2e && npm ci && cd ../..
node tools/ops/restore_verify.mjs ~/Documents/FFTT-private/backups/<file>.json --rehearse
```
It restores into a fresh disposable database and checks: every table's **row count and md5 fingerprint equal the values recorded at export time**; every foreign key is satisfied; the application's own organizer snapshot and private export work for each restored event; nothing becomes public by itself; then (`--rehearse`) the in-place upgrade preserves every table, event mode becomes immutable, the **rollback returns the schema fingerprint to the pre-upgrade value**, the upgrade can be re-applied, and the rollback **refuses** once a real event exists. A tampered or truncated file fails.

**Result on October 27, 2026 (real hosted data, taken 19:11 UTC, 73,118 bytes):** all 15 table counts and fingerprints equal (4 events, 18 players, 25 matches, 5 brackets, 20 score decisions, 18 result submissions, 13 staff grants, 1 platform organizer, 52 audit events, 8 consolation reviews, 1 doubles finale, 6 auth identities; 0 saved registration sources, 0 registration links, 0 deleted events), all 35 foreign keys satisfied, the organizer snapshot/export worked for all four events, `ALL CHECKS PASSED`. The same tool is exercised in CI on a fictional tournament (`tests/e2e/ops_restore_rehearsal.test.mjs`, including a tampered-file failure case).

## Schema equality check (done before any migration)
`tools/ops/schema_fingerprint.sql` reads only catalogs. Run it on the hosted project and compare with `node tools/ops/local_schema_fingerprint.mjs` (database built from the repo). On October 27 all six fingerprints were **identical** (148 columns, 88 constraints, 93 functions including every body hash and API grant, 14 RLS tables, 4 triggers, 2 views), i.e. the hosted schema is exactly what the migration was tested against.

## Restoring into the hosted project (disaster recovery)
Restoring means loading the JSON back into the same 14 tables. Because the hosted schema is reproducible from the repo, the safest order is:
1. **Stop writes:** set the Staff Function env `REGISTRATION_GOOGLE_MODE=diagnostic`, tell scorekeepers to use paper (see the event-day guide). Do not drop anything yet.
2. Locally (no new Supabase project, nothing paid), run `restore_verify.mjs` on the chosen backup to confirm it is good.
3. If tables must be reloaded in the hosted project, do it in **one transaction** from the SQL editor: `begin; set local session_replication_role = replica; truncate <the 14 tables> restart identity cascade; insert into fftt_private.<table> select * from jsonb_populate_recordset(null::fftt_private.<table>, '<rows json>'::jsonb); … commit;` then run `tools/ops/schema_fingerprint.sql` and the export query again; every fingerprint must equal the backup's. The load mechanics (replica role, `jsonb_populate_recordset`, parent-before-child order) are exercised by `restore_verify.mjs`; the hosted truncate-and-reload itself has **not** been rehearsed on the hosted project (there is no second project to rehearse on). This is a deliberate, destructive step: **ask the organizer first** and take a fresh backup of the current (damaged) state beforehand.
4. Re-check Staff sign-in for the organizer and both scorekeepers; reopen the event; resume with a fresh backup.

## Rolling back the in-place migration
`python3 tools/release/build_single_project_upgrade.py --rollback-out <new file>` generates `ROLLBACK` SQL pinned to the same reviewed sources. It restores the 12 original function bodies, the original `events_synthetic_only_check`, and removes the mode-immutability trigger. It **refuses to run (and changes nothing)** if any real (non-synthetic) event exists, because deleting real tournament data is never implicit.
* **Before any real event exists** (right after the migration, before the organizer creates FFTT3): run the rollback SQL in the SQL editor; then run `schema_fingerprint.sql` — it must equal the pre-migration fingerprint (tested locally on a restored copy of the real data: all six kinds identical, all data fingerprints unchanged).
* **After the real event exists:** do **not** roll the schema back. Roll **forward**: fix the issue, or restore from a private backup per above. The old Staff bundle cannot read V4/V5 snapshots, so a Cloudflare rollback alone is not a data rollback.
* The Cloudflare deployments are rolled back separately (see the cutover runbook references).
