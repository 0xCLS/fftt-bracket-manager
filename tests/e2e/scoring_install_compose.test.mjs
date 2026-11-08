/** The exact combined install transaction for the scoring-permissions migration, on a disposable database. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHostedEquivalentDb} from './hosted_equivalent.mjs';
import {compose, EXPECTED_HISTORY, NEW_VERSION, NEW_NAME, FUNCTION_FINGERPRINTS} from '../../tools/ops/compose_scoring_install.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const combined = compose(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261108150000_staff_scoring_permissions.sql'), 'utf8'));
const history = rows => `create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
  insert into supabase_migrations.schema_migrations(version) values ${rows.map(v => `('${v}')`).join(',')};`;
const md5 = (db, f) => db.admin(`select md5(pg_get_functiondef('${f}'::regprocedure)) m`).then(r => r[0].m);

test('combined install: exact history guard, atomic, registers only the new version, fingerprints as reviewed', {timeout: 240000}, async () => {
  // 1. drifted history (a missing entry) installs nothing
  let db = await createHostedEquivalentDb();
  try {
    await db.db.exec(history(EXPECTED_HISTORY.slice(0, 7)));
    await assert.rejects(db.db.exec(combined), /reviewed eight entries/);
    await db.db.exec('rollback');
    for (const [f, v] of Object.entries(FUNCTION_FINGERPRINTS)) assert.equal(await md5(db, f), v.before, `${f} untouched after a refused install`);
    assert.equal((await db.admin("select to_regprocedure('public.fftt_doubles_desk_v1(uuid)') is not null e"))[0].e, false);
  } finally { await db.db.close(); }
  // 2. exact history installs once, fingerprints match the reviewed 'after' values, replay refused
  db = await createHostedEquivalentDb();
  try {
    await db.db.exec(history(EXPECTED_HISTORY));
    await db.db.exec(combined);
    const rows = await db.admin('select version,name,statements from supabase_migrations.schema_migrations order by version');
    assert.equal(rows.length, 9); assert.deepEqual(rows.at(-1), {version: NEW_VERSION, name: NEW_NAME, statements: null});
    for (const [f, v] of Object.entries(FUNCTION_FINGERPRINTS)) {
      assert.ok(v.after, `${f}: the reviewed after-fingerprint is recorded`);
      assert.equal(await md5(db, f), v.after, `${f} equals the reviewed installed version`);
    }
    await assert.rejects(db.db.exec(combined), /reviewed eight entries/);
    await db.db.exec('rollback');
  } finally { await db.db.close(); }
});
