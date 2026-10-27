/** The backup/restore/rollback tooling, proven on a populated FICTIONAL tournament (never hosted data):
 * export in the exact format the hosted export query produces, restore into a fresh disposable database, compare counts and
 * fingerprints, rehearse the in-place upgrade and rollback; a tampered export must FAIL. Offline. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setupEvent, buildChampionship, playAllPlayable, buildConsolation} from './helpers.mjs';

const TABLES = ['audit_events', 'brackets', 'consolation_reviews', 'deleted_events', 'doubles_finale', 'event_staff', 'events', 'matches',
  'platform_organizers', 'players', 'registration_links', 'registration_sources', 'result_submissions', 'score_decisions_v2'];
const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/ops/restore_verify.mjs');

async function exportDoc(db) {
  const tables = {};
  for (const t of TABLES) {
    const [r] = await db.admin(`select count(*)::int n, md5(coalesce(jsonb_agg(j order by j::text)::text,'')) fp, coalesce(jsonb_agg(j order by j::text), '[]'::jsonb) data
      from (select to_jsonb(x) j from fftt_private.${t} x) t`);
    tables[t] = {count: r.n, fingerprint: r.fp, rows: r.data};
  }
  const [u] = await db.admin(`select count(*)::int n, md5(coalesce(jsonb_agg(j order by j::text)::text,'')) fp, coalesce(jsonb_agg(j order by j::text), '[]'::jsonb) data
    from (select jsonb_build_object('id',u.id,'email',u.email,'created_at',u.created_at,'is_anonymous',u.is_anonymous) j from auth.users u) t`);
  tables.auth_users = {count: u.n, fingerprint: u.fp, rows: u.data};
  return {format: 'fftt-hosted-export-v1', project: 'fictional', taken_at: new Date().toISOString(), read_only: true, tables};
}
const run = file => spawnSync('node', [TOOL, file, '--rehearse'], {encoding: 'utf8', timeout: 240000});

test('backup export -> disposable restore -> upgrade -> rollback, on a populated fictional tournament; tampering is detected', async () => {
  const ctx = await setupEvent({players: 8, tables: 2});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fftt-ops-'));
  try {
    await buildChampionship(ctx);
    await playAllPlayable(ctx, {only: 'championship'});
    await buildConsolation(ctx);
    const doc = await exportDoc(ctx.db);
    assert.ok(doc.tables.matches.count > 0 && doc.tables.audit_events.count > 0 && doc.tables.score_decisions_v2.count > 0);
    const good = path.join(dir, 'export.json');
    fs.writeFileSync(good, JSON.stringify(doc), {mode: 0o600});
    const ok = run(good);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /ALL CHECKS PASSED/);
    assert.match(ok.stdout, /rollback restored original schema fingerprint: function/);
    assert.match(ok.stdout, /rollback refuses while a real event exists/);

    const bad = structuredClone(doc);
    bad.tables.matches.rows[0].game_scores = '11-0, 11-0';           // silently altered backup
    const badFile = path.join(dir, 'tampered.json');
    fs.writeFileSync(badFile, JSON.stringify(bad));
    const fail = run(badFile);
    assert.notEqual(fail.status, 0, 'a tampered export must not verify');
    assert.match(fail.stdout, /FAIL {2}matches: fingerprint equal/);
  } finally { await ctx.db.db.close(); fs.rmSync(dir, {recursive: true, force: true}); }
});
