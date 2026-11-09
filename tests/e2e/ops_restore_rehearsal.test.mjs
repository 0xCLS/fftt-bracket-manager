/** The backup/restore/rollback tooling, proven on a populated FICTIONAL tournament (never hosted data):
 * export in the exact format the hosted export query produces, restore into a fresh disposable database, compare counts and
 * fingerprints, rehearse the in-place upgrade and rollback; a tampered export must FAIL. Offline. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setupEvent, buildChampionship, playAllPlayable, buildConsolation, roster} from './helpers.mjs';
import {createLocalDb, SQL_FILES} from './localdb.mjs';
import {APPLIED_PRE_V6_LAYERS, hostedIcuFingerprint} from '../../tools/ops/restore_verify_helpers.mjs';
import {createHostedEquivalentDb} from './hosted_equivalent.mjs';
import {PROJECT_REF, TABLES as CURRENT_TABLES} from '../../tools/ops/fftt_backup.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

const TABLES = ['audit_events', 'brackets', 'consolation_reviews', 'deleted_events', 'doubles_finale', 'event_staff', 'events', 'matches',
  'platform_organizers', 'players', 'registration_links', 'registration_sources', 'result_submissions', 'score_decisions_v2'];
const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/ops/restore_verify.mjs');

async function exportDoc(db, current = false) {
  const tables = {};
  for (const t of current ? CURRENT_TABLES.filter(t=>t!=='auth_users') : TABLES) {
    const [r] = await db.admin(`select count(*)::int n, md5(coalesce(jsonb_agg(j order by j::text)::text,'')) fp, coalesce(jsonb_agg(j order by j::text), '[]'::jsonb) data
      from (select to_jsonb(x) j from fftt_private.${t} x) t`);
    tables[t] = {count: r.n, fingerprint: r.fp, rows: r.data};
  }
  const [u] = await db.admin(`select count(*)::int n, md5(coalesce(jsonb_agg(j order by j::text)::text,'')) fp, coalesce(jsonb_agg(j order by j::text), '[]'::jsonb) data
    from (select jsonb_build_object('id',u.id,'email',u.email,'created_at',u.created_at,'is_anonymous',u.is_anonymous) j from auth.users u) t`);
  tables.auth_users = {count: u.n, fingerprint: u.fp, rows: u.data};
  const doc = {format: current ? 'fftt-hosted-export-v2' : 'fftt-hosted-export-v1',
    project: current ? PROJECT_REF : 'fictional',
    taken_at: new Date().toISOString(), read_only: true, tables};
  if (current) {
    doc.excluded_private_tables = ['registration_gate'];
    doc.schema_fingerprint = Object.fromEntries((await db.admin(
      fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/ops/schema_fingerprint.sql'), 'utf8')
    )).map(r => [r.kind, r.n + ':' + r.fingerprint]));
  }
  return doc;
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

test('a private pre-V6 real-mode backup is verified unchanged before and after the V6 proposal in a disposable clone', async () => {
  const db = await createLocalDb({
    sqlFiles: SQL_FILES.filter(f => !f.endsWith('/GAMEDAY_V6_GAME_PROGRESS_DO_NOT_APPLY.sql')),
    upgraded: true,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fftt-v6-backup-'));
  try {
    for (const layer of APPLIED_PRE_V6_LAYERS)
      await db.db.exec(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', layer), 'utf8'));
    const org = await db.addUser('organizer-v6-backup@fftt-staging.invalid', {platformOrganizer: true});
    const ev = await db.rpc(org, 'fftt_create_event_v3',
      {p_name:'Fictional V6 restore rehearsal', p_date:'2026-11-22', p_table_count:2});
    const E = ev.event_id;
    await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id:E, p_players:roster(8)});
    let snap = await db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id:E});
    for (const p of snap.players)
      await db.rpc(org, 'fftt_set_checkin_v3', {p_event_id:E, p_player_id:p.id, p_checked_in:true});
    snap = await db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id:E});
    await db.rpc(org,'fftt_build_championship_v3',{
      p_event_id:E, p_slots:seedSlots(enginePlayers(snap.players.filter(p=>p.checked_in))),
      p_expected_generation:snap.event.generation, p_confirm:false,
    });
    await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id:E, p_visible:true});
    const doc = await exportDoc(db);
    assert.ok(doc.tables.matches.count > 0 && doc.tables.players.count === 8);
    assert.ok(doc.tables.events.rows.some(e => e.public_visible === true && e.synthetic_only === false));
    assert.ok(doc.tables.matches.rows.every(m => !Object.hasOwn(m,'game_progress_epoch')));
    const file = path.join(dir,'pre-v6.json');
    fs.writeFileSync(file,JSON.stringify(doc),{mode:0o600});
    const ok = spawnSync('node',[TOOL,file,'--v6-preflight'],{encoding:'utf8',timeout:240000});
    assert.equal(ok.status,0,ok.stdout+'\n'+ok.stderr);
    assert.match(ok.stdout,/V6 preserves pre-existing matches rows and fields/);
    assert.match(ok.stdout,/V6 nullable public projection exists and anonymous save RPC is denied/);
    assert.match(ok.stdout,/private publication flags preserved \(1 published event record\(s\)\)/);
    assert.match(ok.stdout,/V6 preserves existing publication flags/);
    assert.match(ok.stdout,/ALL CHECKS PASSED/);
    const schemaBad = structuredClone(doc);
    schemaBad.schema_fingerprint = {column:'9:deadbeefdeadbeefdeadbeefdeadbeef'};
    const wrongSchema = path.join(dir,'wrong-schema.json');
    fs.writeFileSync(wrongSchema,JSON.stringify(schemaBad),{mode:0o600});
    const schemaFail=spawnSync('node',[TOOL,wrongSchema,'--v6-preflight'],
      {encoding:'utf8',timeout:240000});
    assert.notEqual(schemaFail.status,0,'hosted schema drift must fail before V6 DDL');
    const bad = structuredClone(doc);
    bad.tables.matches.rows[0].table_number = 9;
    const badFile=path.join(dir,'tampered.json');
    fs.writeFileSync(badFile,JSON.stringify(bad),{mode:0o600});
    const fail=spawnSync('node',[TOOL,badFile,'--v6-preflight'],{encoding:'utf8',timeout:240000});
    assert.notEqual(fail.status,0,'changed private match backup must fail before V6 DDL');
    assert.match(fail.stdout,/fingerprint equal/);
  } finally {
    await db.db.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('the offline pre-V6 clone reproduces Nov 7 hosted catalog fingerprints (metadata only)', {timeout:240000}, async () => {
  const db = await createLocalDb({
    sqlFiles: SQL_FILES.filter(f => !f.endsWith('/GAMEDAY_V6_GAME_PROGRESS_DO_NOT_APPLY.sql')),
    upgraded:true,
  });
  try {
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    for (const layer of APPLIED_PRE_V6_LAYERS)
      await db.db.exec(fs.readFileSync(path.join(root,layer), 'utf8'));
    const actual=Object.fromEntries((await db.admin(
      fs.readFileSync(path.join(root,'tools/ops/schema_fingerprint.sql'),'utf8')
    )).map(r=>[r.kind,r.n+':'+r.fingerprint]));
    const hosted={
      column:'151:df735ac6847db1eb884dc34bea642c69',
      constraint:'90:d3ed208a07acd25de71f56adf6c249e1',
      function:'106:a4ca89f0d56aaeb20d6b58074996699a',
      rls:'15:dd2d0917dbf6a868fe727c1a26db5b07',
      trigger:'5:bcc594f6c3aa032a17f5baa91166e6f0',
      view:'2:0af5911ec4d090918f71f4a4e02ac8b3',
    };
    assert.deepEqual(actual,hosted,'offline catalog differs from Nov 7 live metadata (no user data fetched)');
  } finally {await db.db.close();}
});


test('CURRENT hosted backup restores all 20 groups including a saved individual game and its append-only receipt', {timeout:240000}, async () => {
  const db = await createHostedEquivalentDb({corrections:true});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fftt-current-restore-'));
  try {
    const org = await db.addUser('organizer-current@fftt-staging.invalid', {platformOrganizer:true});
    const ev = await db.rpc(org,'fftt_create_event_v3',{
      p_name:'Fictional current backup', p_date:'2026-11-22', p_table_count:2});
    const E = ev.event_id;
    await db.rpc(org,'fftt_upsert_players_v3',{p_event_id:E,p_players:roster(4)});
    let snap = await db.rpc(org,'fftt_organizer_snapshot_v3',{p_event_id:E});
    for (const p of snap.players) await db.rpc(org,'fftt_set_checkin_v3',{
      p_event_id:E,p_player_id:p.id,p_checked_in:true});
    snap = await db.rpc(org,'fftt_organizer_snapshot_v3',{p_event_id:E});
    await db.rpc(org,'fftt_build_championship_v3',{
      p_event_id:E,p_slots:seedSlots(enginePlayers(snap.players)),
      p_expected_generation:snap.event.generation,p_confirm:false});
    const desk = await db.rpc(org,'fftt_matchdesk_v2',{p_event_id:E},{rows:true});
    const m = desk[0];
    assert.ok(m,'a real match is available');
    await db.rpc(org,'fftt_assign_table_v3',{p_event_id:E,p_match_id:m.match_id,p_table_number:1});
    const progress = await db.rpc(org,'fftt_game_progress_v1',{p_event_id:E,p_match_id:m.match_id});
    const saved = await db.rpc(org,'fftt_save_completed_game_v1',{
      p_event_id:E,p_match_id:m.match_id,p_generation:progress.generation,
      p_expected_match_version:progress.match_version,
      p_expected_epoch:progress.epoch,p_expected_progress_version:progress.revision,
      p_expected_best_of:progress.best_of,p_expected_points_to_win:progress.points_to_win,
      p_submission_id:crypto.randomUUID(),p_game_index:1,
      p_player_1_score:11,p_player_2_score:5,p_reason:null});
    assert.equal(saved.status,'accepted');

    const doc = await exportDoc(db,true);
    assert.equal(Object.keys(doc.tables).length,20);
    assert.equal(doc.tables.match_game_progress.count,1);
    assert.equal(doc.tables.game_progress_decisions.count,1);
    assert.equal(doc.tables.showcase_reset_baseline.count,0);
    const file = path.join(dir,'current.json');
    fs.writeFileSync(file,JSON.stringify(doc),{mode:0o600});
    const good=spawnSync(process.execPath,[TOOL,file,'--current-preflight'],{encoding:'utf8',timeout:240000});
    assert.equal(good.status,0,good.stdout+'\n'+good.stderr);
    assert.match(good.stdout,/saved individual games preserved by current restore/);
    assert.match(good.stdout,/append-only game decisions preserved by current restore/);
    assert.match(good.stdout,/private tables keep deny-direct-read RLS/);
    assert.match(good.stdout,/ALL CHECKS PASSED/);

    const truncated=structuredClone(doc);
    delete truncated.tables.showcase_reset_decisions;
    const missing=path.join(dir,'missing.json');
    fs.writeFileSync(missing,JSON.stringify(truncated),{mode:0o600});
    const rejected=spawnSync(process.execPath,[TOOL,missing,'--current-preflight'],{encoding:'utf8',timeout:240000});
    assert.notEqual(rejected.status,0,'a missing current table must be rejected');

    const tampered=structuredClone(doc);
    tampered.tables.match_game_progress.rows[0].games=[[11,6]];
    const altered=path.join(dir,'altered.json');
    fs.writeFileSync(altered,JSON.stringify(tampered),{mode:0o600});
    const failed=spawnSync(process.execPath,[TOOL,altered,'--current-preflight'],{encoding:'utf8',timeout:240000});
    assert.notEqual(failed.status,0,'a tampered saved individual game must not verify');
    assert.match(failed.stdout,/FAIL  match_game_progress: fingerprint equal/);
  } finally {
    await db.db.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('disposable CURRENT schema matches November 9 read-only hosted metadata, including all five new tables', {timeout:240000}, async () => {
  const db = await createHostedEquivalentDb({corrections:true});
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const actual = Object.fromEntries((await db.admin(
      fs.readFileSync(path.join(root,'tools/ops/schema_fingerprint.sql'),'utf8')
    )).map(r => [r.kind, r.n + ':' + r.fingerprint]));
    const hosted = {
      column:'186:bf380937c9a3bfe6224368720b51522c',
      constraint:'106:49fe836a309da3938668536e16d4a06f',
      function:'124:76aa9fd56adb797cbd894c7420ef7423',
      rls:'20:f1a000f9e223f61b2c39b6b82c9a98a3',
      trigger:'12:93b786db8b1e3ba709d04c5d6e087490',
      view:'2:2b5bc9be73f733c02abefea565150d03',
    };
    assert.deepEqual(actual,hosted,
      'current live schema metadata differs from the disposable reviewed SQL; refuse release');
  } finally {await db.db.close();}
});

test('original hosted ICU en-US aggregate fingerprint verifies a restored fictional registration link set', {timeout:240000}, async () => {
  const db = await createHostedEquivalentDb({corrections:true});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fftt-icu-link-proof-'));
  try {
    const refs = ['AA','aA','ab','Ab','B','b','1','10','2'];
    const collator = new Intl.Collator('en-US', {usage:'sort',sensitivity:'variant',numeric:false,ignorePunctuation:false});
    assert.deepEqual([...refs].sort((a,b)=>collator.compare(JSON.stringify({ref:a}),JSON.stringify({ref:b}))),
      ['1','10','2','aA','AA','ab','Ab','b','B']);
    const hostedSynthetic = (await db.admin('select md5($1::jsonb::text) as fp',
      [JSON.stringify(['1','10','2','aA','AA','ab','Ab','b','B'].map(ref=>({ref})))]))[0].fp;
    assert.equal(hostedSynthetic, '8167c8ebf324f627a452fbe2e76f2733',
      'synthetic hosted-en-US aggregate fingerprint pinned from read-only PostgreSQL');

    const org = await db.addUser('icu-proof-organizer@fftt-staging.invalid', {platformOrganizer:true});
    const ev = await db.rpc(org,'fftt_create_event_v3',{
      p_name:'Fictional ICU registration proof',p_date:'2026-11-22',p_table_count:2});
    await db.rpc(org,'fftt_upsert_players_v3',{p_event_id:ev.event_id,p_players:roster(2)});
    const player = (await db.rpc(org,'fftt_organizer_snapshot_v3',{p_event_id:ev.event_id})).players[0].id;
    for (const suffix of refs) await db.admin(
      'insert into fftt_private.registration_links(event_id,ref,player_id,linked_by,linked_at) values ($1,$2,$3,$4,$5)',
      [ev.event_id,'FictionalLink2026_'+suffix,player,org,'2026-11-09T12:00:00.000Z']);

    const doc = await exportDoc(db, true);
    assert.equal(doc.tables.registration_links.count,refs.length);
    const originalPglite = doc.tables.registration_links.fingerprint;
    const hostedIcu = await hostedIcuFingerprint(db,'registration_links');
    assert.notEqual(hostedIcu,originalPglite,
      'fictional mixed-case refs demonstrate different database collations');
    doc.tables.registration_links.fingerprint = hostedIcu;
    const good=path.join(dir,'hosted-icu-export.json');
    fs.writeFileSync(good,JSON.stringify(doc),{mode:0o600});
    const valid=spawnSync(process.execPath,[TOOL,good,'--current-preflight'],{encoding:'utf8',timeout:240000});
    assert.equal(valid.status,0,valid.stdout+'\n'+valid.stderr);
    assert.match(valid.stdout,/PASS  registration_links: fingerprint equal/);
    assert.match(valid.stdout,/ALL CHECKS PASSED/);

    const changed=structuredClone(doc);
    changed.tables.registration_links.rows[0].ref='fixture-tampered';
    const altered=path.join(dir,'tampered-icu-export.json');
    fs.writeFileSync(altered,JSON.stringify(changed),{mode:0o600});
    const fail=spawnSync(process.execPath,[TOOL,altered,'--current-preflight'],{encoding:'utf8',timeout:240000});
    assert.notEqual(fail.status,0,'altered text must fail the original hosted fingerprint');
    assert.match(fail.stdout,/FAIL  registration_links: fingerprint equal/);
  } finally {
    await db.db.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
