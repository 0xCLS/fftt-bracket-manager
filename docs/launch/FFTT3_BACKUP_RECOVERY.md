# FFTT3 — private backup, restore proof and rollback

**Status:** procedure written and executed on October 27, 2026 against the existing project `fftt-bracket-manager-dev` (read-only) and a disposable local database. Nothing in this procedure writes to the hosted project.

## Why this shape
Supabase Free has no downloadable managed backups, and this Mac has no `pg_dump`/`psql`/Docker (and the hosted database password is not held by the assistant). The backup therefore uses the one door that is already open and owner-controlled: a **read-only query in the Supabase SQL editor**, whose result is saved privately and **proven restorable** by loading it into a throw-away PostgreSQL (PGlite) built from the repository's SQL.

## What a backup contains (and does not)
* All 14 private FFTT tables (`events`, `players`, `matches`, `brackets`, `event_staff`, `platform_organizers`, `score_decisions_v2`, `result_submissions`, `audit_events`, `consolation_reviews`, `doubles_finale`, `registration_links`, `registration_sources`, `deleted_events`), row for row.
* The Auth identities the staff grants refer to: **id, email, created_at, is_anonymous only** (no password hashes, tokens or secrets), so grants stay meaningful after a restore.
* Not included: Cloudflare secrets, Google credentials, the Supabase Auth password hashes, any Google Form answer (registration answers are never stored).
* Contains staff e-mail addresses and, for a real event, **player names and results** → it is private data. **Never commit it, never paste it in chat, never email it.**

## Take a backup (about 2 minutes)
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
