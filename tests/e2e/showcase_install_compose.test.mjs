/** Optional owner-local test of the exact combined installation transaction (disposable DB only). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createLocalDb} from './localdb.mjs';
import {compose, EXPECTED_HISTORY, NEW_VERSION} from '../../tools/ops/compose_showcase_install.mjs';
const path = process.env.FFTT_SHOWCASE_BACKUP;
const eid = 'e6bd40cf-4107-43ea-8c87-057dc38ef31b';
const sha = 'c16a477419af1f277792665a0e9ca94bd513effc66de1c7639dab51da84a0c44';
const migration = fs.readFileSync(new URL('../../supabase/migrations/20261108114950_showcase_reset.sql', import.meta.url), 'utf8');

async function seed(db, data) {
  const rows = k => data.tables[k].rows.filter(r => r.event_id === eid);
  const event = data.tables.events.rows.find(r => r.id === eid);
  const org = await db.addUser('showcase-organizer@example.invalid', {platformOrganizer: true});
  event.created_by = org;
  const brackets = rows('brackets'); brackets.forEach(b => b.created_by = org);
  const matches = rows('matches'); matches.forEach(m => m.game_progress_epoch = 0);
  const reviews = rows('consolation_reviews'); reviews.forEach(r => r.reviewed_by = org);
  const q = (sql, p) => db.db.query(sql, p);
  await q('insert into fftt_private.events select (jsonb_populate_record(null::fftt_private.events,$1::jsonb)).*', [JSON.stringify(event)]);
  for (const [t, r] of [['players', rows('players')], ['brackets', brackets], ['matches', matches], ['consolation_reviews', reviews]]) {
    await q(`insert into fftt_private.${t} select * from jsonb_populate_recordset(null::fftt_private.${t},$1::jsonb)`, [JSON.stringify(r)]);
  }
  await db.admin("insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer')", [eid, org]);
  return org;
}
const history = db => db.db.exec(`
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
  insert into supabase_migrations.schema_migrations(version) values ${EXPECTED_HISTORY.map(v => `('${v}')`).join(',')};`);

test('combined install transaction: exact history guard, atomic install, fixture stays out of history',
  {skip: !path || !process.env.FFTT_SHOWCASE_INSTALLER}, async () => {
  const bytes = fs.readFileSync(path); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha);
  const fragment = fs.readFileSync(process.env.FFTT_SHOWCASE_INSTALLER, 'utf8');
  const combined = compose(migration, fragment);
  const count = (db, sql) => db.admin(sql).then(r => r[0].n);
  const installed = db => count(db, "select count(*)::int as n from pg_proc where proname='fftt_reset_showcase_v1'");

  // 1. Drifted history (an extra, unreviewed entry) installs nothing, leaving no partial state.
  let db = await createLocalDb();
  try {
    await seed(db, JSON.parse(bytes)); await history(db);
    await db.db.exec("insert into supabase_migrations.schema_migrations(version) values ('20261108999999')");
    await assert.rejects(db.db.exec(combined), /reviewed seven entries/);
    await db.db.exec('rollback');
    assert.equal(await installed(db), 0);
    assert.equal(await count(db, "select count(*)::int as n from pg_tables where tablename='showcase_reset_baseline'"), 0);
  } finally { await db.db.close(); }

  // 2. Exact history installs everything once, registers only the new version, and refuses a replay.
  db = await createLocalDb();
  try {
    const org = await seed(db, JSON.parse(bytes)); await history(db);
    await db.db.exec(combined);
    assert.equal(await installed(db), 1);
    assert.equal(await count(db, 'select count(*)::int as n from fftt_private.showcase_reset_baseline'), 1);
    const rows = await db.admin('select version,name,statements from supabase_migrations.schema_migrations order by version');
    assert.equal(rows.length, 8);
    assert.deepEqual(rows.at(-1), {version: NEW_VERSION, name: 'showcase_reset', statements: null});
    assert.ok(rows.every(r => !JSON.stringify(r).includes('Morgan Reed')), 'fixture content never enters migration history');
    await assert.rejects(db.db.exec(combined), /reviewed seven entries/);
    await db.db.exec('rollback');
    const r = await db.rpc(org, 'fftt_reset_showcase_v1', {p_confirmation: 'RESET SHOWCASE', p_request_id: crypto.randomUUID()});
    assert.equal(r.status, 'reset');
  } finally { await db.db.close(); }
});
