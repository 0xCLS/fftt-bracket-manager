#!/usr/bin/env node
/** Restore a private FFTT hosted-export JSON into a DISPOSABLE in-process PostgreSQL (PGlite), then prove the restore:
 *   1. row counts and per-table md5 fingerprints equal the ones recorded at export time;
 *   2. every foreign key is satisfied and the app's own read APIs work on the restored data;
 *   3. (--rehearse) the in-place launch upgrade preserves every count and fingerprint, then the rollback returns the
 *      schema fingerprint to the pre-upgrade value and (with a real event present) correctly refuses.
 * Needs `npm ci` in tests/e2e. Never contacts the network. The export file stays where it is (outside the repository):
 *   node tools/ops/restore_verify.mjs <export.json> [--rehearse]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createLocalDb} from '../../tests/e2e/localdb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const rehearse = args.includes('--rehearse');
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: restore_verify.mjs <export.json> [--rehearse]'); process.exit(2); }

const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
if (doc.format !== 'fftt-hosted-export-v1') throw new Error('unknown export format');
// Parents before children. Triggers and FK checks are off during the load (replica role); FKs are verified afterwards.
const ORDER = ['platform_organizers', 'events', 'event_staff', 'players', 'brackets', 'matches', 'consolation_reviews', 'doubles_finale',
  'registration_links', 'registration_sources', 'result_submissions', 'score_decisions_v2', 'audit_events', 'deleted_events'];

let failures = 0;
const check = (ok, label, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

const fingerprint = async (db, table) => {
  const q = table === 'auth_users'
    ? `select count(*)::int n, md5(coalesce(jsonb_agg(j order by j::text)::text,'')) fp from (select jsonb_build_object('id',u.id,'email',u.email,'created_at',u.created_at,'is_anonymous',u.is_anonymous) j from auth.users u) t`
    : `select count(*)::int n, md5(coalesce(jsonb_agg(j order by j::text)::text,'')) fp from (select to_jsonb(x) j from fftt_private.${table} x) t`;
  return (await db.admin(q))[0];
};
const fingerprintAll = async db => Object.fromEntries(await Promise.all(Object.keys(doc.tables).map(async t => [t, await fingerprint(db, t)])));
const schemaFp = async db => Object.fromEntries((await db.admin(fs.readFileSync(path.join(ROOT, 'tools/ops/schema_fingerprint.sql'), 'utf8'))).map(r => [r.kind, `${r.n}:${r.fingerprint}`]));

const db = await createLocalDb();
try {
  const baseSchema = await schemaFp(db);
  await db.admin('begin');
  await db.admin(`set local session_replication_role = replica`);
  for (const u of doc.tables.auth_users.rows) {
    await db.admin(`insert into auth.users(id,email,is_anonymous,created_at,aud,role,instance_id) values ($1,$2,$3,$4,'authenticated','authenticated','00000000-0000-0000-0000-000000000000')`,
      [u.id, u.email, u.is_anonymous, u.created_at]);
  }
  for (const t of ORDER) {
    const rows = doc.tables[t]?.rows ?? [];
    if (rows.length) await db.admin(`insert into fftt_private.${t} select * from jsonb_populate_recordset(null::fftt_private.${t}, $1::jsonb)`, [JSON.stringify(rows)]);
  }
  await db.admin('commit');

  console.log(`Restore of ${path.basename(file)} (taken ${doc.taken_at}) into a disposable database`);
  const restored = await fingerprintAll(db);
  for (const [t, v] of Object.entries(doc.tables)) {
    check(restored[t].n === v.count, `${t}: ${v.count} rows`, `restored ${restored[t].n}`);
    if (v.count) check(restored[t].fp === v.fingerprint, `${t}: fingerprint equal`);
  }

  // referential integrity, generically over every foreign key of the private schema
  const fks = await db.admin(`select c.conrelid::regclass::text tbl, c.confrelid::regclass::text ref, c.conname,
      (select string_agg(a.attname, ', ' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols,
      (select string_agg(a.attname, ', ' order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) refcols
    from pg_constraint c where c.contype = 'f' and c.connamespace = 'fftt_private'::regnamespace`);
  let orphans = 0;
  for (const fk of fks) {
    const cols = fk.cols.split(', '), refs = fk.refcols.split(', ');
    const on = cols.map((c, i) => `p.${refs[i]} = t.${c}`).join(' and ');
    const notNull = cols.map(c => `t.${c} is not null`).join(' and ');
    const n = (await db.admin(`select count(*)::int n from ${fk.tbl} t where ${notNull} and not exists (select 1 from ${fk.ref} p where ${on})`))[0].n;
    if (n) { orphans += n; console.log(`  orphan rows in ${fk.tbl} (${fk.conname}): ${n}`); }
  }
  check(orphans === 0, `all ${fks.length} foreign keys satisfied`);

  // the application's own read APIs work on the restored data, as each event's organizer
  const organizer = (await db.admin(`select user_id from fftt_private.platform_organizers limit 1`))[0]?.user_id;
  if (organizer) {
    for (const ev of await db.admin(`select id, event_name from fftt_private.events order by created_at`)) {
      const snap = await db.rpc(organizer, 'fftt_organizer_snapshot_v3', {p_event_id: ev.id}).catch(e => ({error: e.message}));
      const wantPlayers = doc.tables.players.rows.filter(p => p.event_id === ev.id).length;
      const wantMatches = doc.tables.matches.rows.filter(m => m.event_id === ev.id).length;
      check(!snap.error && snap.players?.length === wantPlayers, `organizer snapshot "${ev.event_name.slice(0, 40)}": ${wantPlayers} players`, snap.error ?? '');
      const exp = await db.rpc(organizer, 'fftt_export_event_v3', {p_event_id: ev.id}).catch(e => ({error: e.message}));
      check(!exp.error, `private export works for ${wantMatches} matches`, exp.error ?? '');
    }
  } else check(false, 'a platform organizer exists in the backup');
  check((await db.publicTournaments()).length === 0, 'nothing is published by a restore (public_visible stays off)');

  if (rehearse) {
    console.log('\nRehearsal: in-place upgrade on the restored clone');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fftt-rehearse-'));
    try {
      const gen = (flag, name) => {
        const out = path.join(tmp, name);
        const r = spawnSync('python3', [path.join(ROOT, 'tools/release/build_single_project_upgrade.py'), flag, out], {encoding: 'utf8'});
        if (r.status !== 0) throw new Error(r.stderr || r.stdout);
        return fs.readFileSync(out, 'utf8');
      };
      const upSql = gen('--out', 'upgrade.sql'), downSql = gen('--rollback-out', 'rollback.sql');
      await db.db.exec(upSql);
      const after = await fingerprintAll(db);
      for (const t of Object.keys(doc.tables)) check(after[t].n === restored[t].n && after[t].fp === restored[t].fp, `upgrade preserved ${t} (${after[t].n} rows, same fingerprint)`);
      await assertRejects(db.admin(`update fftt_private.events set synthetic_only = false where id = (select id from fftt_private.events limit 1)`), 'event mode is immutable after upgrade');
      const upSchema = await schemaFp(db);
      check(upSchema.function !== baseSchema.function || upSchema.constraint !== baseSchema.constraint, 'upgrade changed the schema (functions and constraints)');

      // rollback with no real event: the schema returns to the exact pre-upgrade fingerprint and no data changes
      await db.db.exec(downSql);
      const down = await schemaFp(db);
      for (const k of Object.keys(baseSchema)) check(down[k] === baseSchema[k], `rollback restored original schema fingerprint: ${k}`);
      const back = await fingerprintAll(db);
      check(Object.keys(doc.tables).every(t => back[t].fp === restored[t].fp && back[t].n === restored[t].n), 'rollback left every data fingerprint unchanged');

      // upgrade again, create a real event: rollback must now refuse and change nothing (real data is never deleted implicitly)
      await db.db.exec(upSql);
      check((await schemaFp(db)).function === upSchema.function, 're-applying the upgrade after a rollback gives the same upgraded schema');
      await db.rpc(organizer, 'fftt_create_event_v3', {p_name: 'REHEARSAL REAL EVENT (restore test)', p_date: '2026-11-22', p_table_count: 2});
      await assertRejects(db.db.exec(downSql), 'rollback refuses while a real event exists', /rollback refused/);
      check((await schemaFp(db)).function === upSchema.function, 'refused rollback changed nothing');
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
  }
} catch (e) { failures++; console.log('FAIL  unexpected error: ' + String(e.message).slice(0, 300)); }
finally { await db.db.close(); }

async function assertRejects(promise, label, re = null) {
  try { await promise; check(false, label, '(no error)'); } catch (e) { await db.db.exec('rollback').catch(() => {}); check(re ? re.test(String(e.message)) : true, label); }
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
