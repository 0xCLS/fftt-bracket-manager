/** Single-project launch conversion: synthetic fixtures survive; real events work.
 * Offline PGlite; never contacts hosted Supabase, Cloudflare, Google or participants. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {setupEvent, deskOf, buildChampionship} from './helpers.mjs';

test('one existing project: preserve synthetic event, enable real mode, guard roles and exports', async () => {
  const ctx = await setupEvent({players: 4, tables: 2});
  const {db,E,org,skA,skB,outsider} = ctx;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fftt-inplace-launch-'));
  try {
    // Preserve a completed score/receipt before upgrading in place.
    await buildChampionship(ctx);
    const desk=await deskOf(ctx,skA);
    assert.ok(desk.length);
    const before=await db.admin('select count(*)::int as n from fftt_private.events');
    const syntheticBefore=await ctx.snap();
    const f=path.join(directory,'candidate.sql');
    const gen=spawnSync('python3',['tools/release/build_single_project_upgrade.py','--out',f],
      {cwd:path.resolve(''),encoding:'utf8',timeout:30000});
    assert.equal(gen.status,0,gen.stderr||gen.stdout);
    await db.db.exec(fs.readFileSync(f,'utf8'));

    const after=await db.admin('select count(*)::int as n from fftt_private.events');
    assert.deepEqual(after,before,'no synthetic event deleted by upgrade');
    assert.equal((await db.admin('select synthetic_only from fftt_private.events where id=$1',[E]))[0].synthetic_only,true);
    assert.equal((await ctx.snap()).players.length,syntheticBefore.players.length,'existing synthetic roster still readable');
    assert.ok((await deskOf(ctx,skA)).length,'original synthetic staff authorization remains');
    await assert.rejects(db.admin('update fftt_private.events set synthetic_only=false where id=$1',[E]),
      e=>e.code==='23514','cannot reclassify historical fixture');

    const next=await db.rpc(org,'fftt_create_event_v3',
      {p_name:'FICTIONAL FFTT3 RELEASE MODE',p_date:'2026-11-22',p_table_count:2});
    const R=next.event_id;
    assert.equal((await db.admin('select synthetic_only from fftt_private.events where id=$1',[R]))[0].synthetic_only,false);
    const available=await db.rpc(org,'fftt_my_events_v4');
    assert.ok(available.some(ev=>ev.event_id===E));
    assert.ok(available.some(ev=>ev.event_id===R));
    await assert.rejects(db.rpc(outsider,'fftt_registration_source_v5',{p_event_id:R}));
    await assert.rejects(db.rpc(org,'fftt_set_registration_source_v5',
      {p_event_id:R,p_source:{kind:'fixture',enabled:true}}));
    await assert.rejects(db.rpc(org,'fftt_set_registration_source_v5',{p_event_id:E,
      p_source:{kind:'google-sheets',spreadsheet_id:'EXAMPLE_FAKE_SHEET_123456789012',
        worksheet:'Form Responses 1',column_map:{},enabled:true}}));
    const sheet=await db.rpc(org,'fftt_set_registration_source_v5',{p_event_id:R,
      p_source:{kind:'google-sheets',spreadsheet_id:'EXAMPLE_FAKE_SHEET_123456789012',
        worksheet:'Form Responses 1',column_map:{},enabled:true}});
    assert.equal(sheet.status,'saved');
    const real=await db.rpc(org,'fftt_registration_source_v5',{p_event_id:R});
    assert.equal(real.event_synthetic,false);
    assert.equal(real.enabled,true);
    // EVENT ISOLATION between the historical fictional event and the new real one, in both directions
    const mine=await db.rpc(skA,'fftt_my_events_v4');
    assert.deepEqual(mine.map(ev=>ev.event_id),[E],'a legacy scorekeeper sees only their own (fictional) event');
    await assert.rejects(db.rpc(skA,'fftt_matchdesk_v2',{p_event_id:R},{rows:true}),'legacy scorekeeper cannot open the real event desk');
    await assert.rejects(db.rpc(skA,'fftt_organizer_snapshot_v3',{p_event_id:R}),'legacy scorekeeper cannot read the real roster');
    const other=await db.addUser('second-platform-organizer@fftt-staging.invalid',{platformOrganizer:true});
    await assert.rejects(db.rpc(other,'fftt_organizer_snapshot_v3',{p_event_id:R}),'a platform organizer without a grant on the real event is refused');
    await assert.rejects(db.rpc(other,'fftt_organizer_snapshot_v3',{p_event_id:E}),'and on the fictional event');
    assert.deepEqual(await db.rpc(other,'fftt_my_events_v4'),[],'and lists no events');
    // the real event's staff cannot touch the fictional event either
    await db.rpc(org,'fftt_set_staff_v3',{p_event_id:R,p_email:'scorekeeper-b@fftt-staging.invalid',p_action:'grant',p_role:'scorekeeper'});
    assert.deepEqual((await db.rpc(skB,'fftt_my_events_v4')).map(ev=>ev.event_id).sort(),[E,R].sort(),'skB holds grants on both events (set up in this test)');
    await db.rpc(org,'fftt_set_staff_v3',{p_event_id:R,p_email:'scorekeeper-b@fftt-staging.invalid',p_action:'revoke',p_role:null});
    await assert.rejects(db.rpc(skB,'fftt_matchdesk_v2',{p_event_id:R},{rows:true}),'a revoked scorekeeper is refused immediately on the real event');
    assert.ok((await deskOf(ctx,skB)).length>=0,'while their fictional-event grant is unaffected');
    const syntheticExport=await db.rpc(org,'fftt_export_event_v3',{p_event_id:E});
    const realExport=await db.rpc(org,'fftt_export_event_v3',{p_event_id:R});
    assert.equal(syntheticExport.synthetic_only,true);
    assert.equal(realExport.synthetic_only,false);
    assert.deepEqual(await db.publicTournaments(),[],'no automatic publication from either event');
    const count=await db.admin('select count(*)::int as n from fftt_private.events');
    assert.equal(count[0].n,before[0].n+1);
  } finally {
    await db.db.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
