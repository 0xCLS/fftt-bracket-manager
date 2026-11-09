/** Nov 8 rehearsal regressions against disposable PGlite + real FFTT SQL. No hosted writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupEvent, buildChampionship, deskOf, submit, scoreFor} from './helpers.mjs';
import {createLocalDb} from './localdb.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20261109041500_rehearsal_walkover_withdrawal.sql', import.meta.url), 'utf8');
const mustFail = async (promise, code, reason) => {
  const error = await promise.then(() => null, e => e);
  assert.ok(error, 'operation must be rejected');
  if (code) assert.equal(error.code, code, String(error));
  if (reason) assert.match(error.detail ?? error.message, new RegExp(reason), String(error));
};
const fresh = async (n = 8) => {
  const ctx = await setupEvent({players:n, tables:2});
  await ctx.db.db.exec(migration);
  await buildChampionship(ctx);
  return ctx;
};
const withdraw = async (ctx, absent, who=ctx.org, generation=null, reason='Left before tournament play') => {
  const snap = await ctx.snap();
  const remaining = snap.players.filter(p => p.checked_in && p.id !== absent);
  const slots = seedSlots(enginePlayers(remaining));
  return ctx.db.rpc(who, 'fftt_withdraw_preplay_v7', {
    p_event_id:ctx.E, p_player_id:absent, p_expected_generation:generation ?? snap.event.generation,
    p_slots:slots, p_reason:reason
  });
};
const recordWalkover = (ctx, row, absent, reason='Did not arrive at table') =>
  ctx.db.rpc(ctx.org,'fftt_forfeit_match_v3',{
    p_event_id:ctx.E,p_match_id:row.match_id,
    p_expected_match_version:row.match_version,p_absent_player_id:absent,p_reason:reason
  });

test('walkover victory is NOT a played win; losing first actual match qualifies for consolation',async()=>{
  const ctx=await fresh();
  try {
    const opening=await deskOf(ctx,ctx.skA);
    const one=opening[0], two=opening[1];
    const woWinner=one.player_1_id, noShow=one.player_2_id;
    assert.equal((await recordWalkover(ctx,one,noShow)).status,'accepted');
    let snap=await ctx.snap();
    assert.equal(snap.consolation_candidates.some(c=>c.player_id===noShow),false,'unplayed W/O loss is not eligible');
    assert.equal(snap.players.find(p=>p.id===noShow).first_champ_loss,false);
    assert.equal(snap.consolation_candidates.some(c=>c.player_id===woWinner),false);
    const otherWin=two.player_1_id;
    assert.equal((await submit(ctx,ctx.skA,two,otherWin,scoreFor(3,11))).status,'accepted');
    const next=(await deskOf(ctx,ctx.skA)).find(r=>
      [r.player_1_id,r.player_2_id].includes(woWinner)&&[r.player_1_id,r.player_2_id].includes(otherWin));
    assert.ok(next,'walkover winner must meet other opening-round winner');
    const winnerScore=otherWin===next.player_1_id?scoreFor(3,11):'7-11, 9-11';
    assert.equal((await submit(ctx,ctx.skA,next,otherWin,winnerScore)).status,'accepted');
    snap=await ctx.snap();
    assert.equal(snap.consolation_candidates.some(c=>c.player_id===woWinner),true,'first played loss eligible after W/O win');
    assert.equal(snap.players.find(p=>p.id===woWinner).first_champ_loss,true);
    assert.equal(snap.consolation_candidates.some(c=>c.player_id===noShow),false);
    assert.equal(snap.consolation_candidates.some(c=>c.player_id===otherWin),false);
    const audit=await ctx.db.admin("select operation,reason from fftt_private.audit_events where event_id=$1 and operation='match_forfeited'",[ctx.E]);
    assert.equal(audit.length,1);
    assert.match(audit[0].reason,/Did not arrive/);
  }finally{await ctx.db.db.close();}
});

test('played win followed by withdrawal remains ineligible; no-show reason retained',async()=>{
  const ctx=await fresh();
  try{
    const opening=await deskOf(ctx,ctx.skA);
    const row=opening[0], other=opening[1], winner=row.player_1_id;
    assert.equal((await submit(ctx,ctx.skA,row,winner,scoreFor(3,11))).status,'accepted');
    assert.equal((await submit(ctx,ctx.skA,other,other.player_1_id,scoreFor(3,11))).status,'accepted');
    const next=(await deskOf(ctx,ctx.skA)).find(r=>
      [r.player_1_id,r.player_2_id].includes(winner) &&
      [r.player_1_id,r.player_2_id].includes(other.player_1_id));
    assert.ok(next,'a played-match winner must reach a following match');
    assert.equal((await recordWalkover(ctx,next,winner,'Unable to continue (injury)')).status,'accepted');
    const snap=await ctx.snap();
    assert.equal(snap.consolation_candidates.some(c=>c.player_id===winner),false);
    const audit=await ctx.db.admin("select reason from fftt_private.audit_events where event_id=$1 and operation='match_forfeited'",[ctx.E]);
    assert.equal(audit[0].reason,'Unable to continue (injury)');
  }finally{await ctx.db.db.close();}
});

test('pre-play withdrawal regenerates ONLY the unplayed bracket and keeps player registration',async()=>{
  const ctx=await fresh(8);
  try{
    const before=await ctx.snap();
    const absent=before.players[0];
    const g=before.event.generation;
    const r=await withdraw(ctx,absent.id);
    assert.equal(r.status,'rebuilt');
    assert.equal(r.generation,g+1);
    const after=await ctx.snap();
    assert.equal(after.event.generation,g+1);
    assert.equal(after.players.length,before.players.length,'registrations preserved');
    assert.equal(after.players.find(p=>p.id===absent.id).checked_in,false);
    assert.equal(after.matches.some(m=>m.player_1_id===absent.id||m.player_2_id===absent.id),false);
    assert.equal(after.players.filter(p=>p.checked_in).length,7);
    const history=await ctx.db.admin("select generation,status from fftt_private.brackets where event_id=$1 order by generation",[ctx.E]);
    assert.ok(history.some(x=>x.generation===g&&x.status==='superseded'));
    assert.ok(history.some(x=>x.generation===g+1&&x.status==='active'));
    const audit=await ctx.db.admin("select operation,reason from fftt_private.audit_events where event_id=$1 and operation='bracket_rebuilt' order by created_at desc limit 1",[ctx.E]);
    assert.equal(audit[0].reason,'Left before tournament play');
    await mustFail(withdraw(ctx,after.players.find(p=>p.checked_in).id,ctx.skA),'42501');
    await mustFail(withdraw(ctx,after.players.find(p=>p.checked_in).id,ctx.outsider),'42501');
    await mustFail(withdraw(ctx,after.players.find(p=>p.checked_in).id,ctx.org,g),'P0001','generation');
  }finally{await ctx.db.db.close();}
});

test('an accepted result makes pre-play bracket regeneration impossible',async()=>{
  const ctx=await fresh();
  try{
    const row=(await deskOf(ctx,ctx.skA))[0];
    assert.equal((await submit(ctx,ctx.skA,row,row.player_1_id,scoreFor(3,11))).status,'accepted');
    const before=await ctx.snap();
    await mustFail(withdraw(ctx,before.players.find(p=>p.checked_in).id),'P0001','preplay-results-exist');
    const after=await ctx.snap();
    assert.equal(after.event.generation,before.event.generation);
    assert.deepEqual(after.players.map(p=>p.checked_in),before.players.map(p=>p.checked_in));
  }finally{await ctx.db.db.close();}
});

test('a saved individual game prevents bracket regeneration AND prevents a no-show overwriting it',async()=>{
  const ctx=await fresh();
  try{
    const row=(await deskOf(ctx,ctx.skA))[0];
    await ctx.db.rpc(ctx.org,'fftt_assign_table_v3',{p_event_id:ctx.E,p_match_id:row.match_id,p_table_number:1});
    const progress=await ctx.db.rpc(ctx.skA,'fftt_game_progress_v1',{p_event_id:ctx.E,p_match_id:row.match_id});
    const saved=await ctx.db.rpc(ctx.skA,'fftt_save_completed_game_v1',{
      p_event_id:ctx.E,p_match_id:row.match_id,p_generation:progress.generation,
      p_expected_match_version:progress.match_version,p_expected_epoch:progress.epoch,
      p_expected_progress_version:progress.revision,p_expected_best_of:progress.best_of,
      p_expected_points_to_win:progress.points_to_win,p_submission_id:crypto.randomUUID(),
      p_game_index:1,p_player_1_score:11,p_player_2_score:5,p_reason:null
    });
    assert.equal(saved.status,'accepted');
    const before=await ctx.snap();
    await mustFail(withdraw(ctx,before.players.find(p=>p.checked_in).id),'P0001','preplay-results-exist');
    await mustFail(recordWalkover(ctx,row,row.player_2_id),'P0001','game-already-saved');
    assert.equal((await ctx.snap()).event.generation,before.event.generation);
    const retained=await ctx.db.rpc(ctx.skA,'fftt_game_progress_v1',{p_event_id:ctx.E,p_match_id:row.match_id});
    assert.deepEqual(retained.games,[[11,5]]);
  }finally{await ctx.db.db.close();}
});


test('delegated Bracket Manager can withdraw before play but cannot alter another event or retain scored results',async()=>{
  const db=await createLocalDb({upgraded:true});
  try{
    const roleSql=fs.readFileSync(new URL('../../supabase/proposals/FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql',import.meta.url),'utf8');
    const delegationSql=fs.readFileSync(new URL('../../supabase/proposals/FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql',import.meta.url),'utf8');
    await db.db.exec(roleSql);
    await db.db.exec(delegationSql);
    await db.db.exec(migration);
    const org=await db.addUser('organizer@rehearsal-fiction.invalid',{platformOrganizer:true});
    const bm=await db.addUser('manager@rehearsal-fiction.invalid');
    const scorer=await db.addUser('scorer@rehearsal-fiction.invalid');
    const E=(await db.rpc(org,'fftt_create_event_v3',{p_name:'Fictional rehearsal',p_date:'2026-11-08',p_table_count:2})).event_id;
    const other=(await db.rpc(org,'fftt_create_event_v3',{p_name:'Fictional next event',p_date:'2026-11-22',p_table_count:2})).event_id;
    await db.rpc(org,'fftt_set_staff_v3',{p_event_id:E,p_email:'manager@rehearsal-fiction.invalid',p_action:'grant',p_role:'bracket_manager'});
    await db.rpc(org,'fftt_set_staff_v3',{p_event_id:E,p_email:'scorer@rehearsal-fiction.invalid',p_action:'grant',p_role:'scorekeeper'});
    await db.rpc(org,'fftt_upsert_players_v3',{p_event_id:E,p_players:[
      {name:'Fictional Alice',rating:3,rating_status:'provisional'},
      {name:'Fictional Bob',rating:2,rating_status:'provisional'},
      {name:'Fictional Cathy',rating:4,rating_status:'provisional'},
      {name:'Fictional David',rating:1,rating_status:'provisional'}
    ]});
    let snap=await db.rpc(bm,'fftt_bracket_manager_snapshot_v1',{p_event_id:E});
    for(const p of snap.players) await db.rpc(bm,'fftt_set_checkin_v3',{p_event_id:E,p_player_id:p.id,p_checked_in:true});
    snap=await db.rpc(bm,'fftt_bracket_manager_snapshot_v1',{p_event_id:E});
    await db.rpc(bm,'fftt_build_championship_v3',{p_event_id:E,
      p_slots:seedSlots(enginePlayers(snap.players)),p_expected_generation:0,p_confirm:false});
    snap=await db.rpc(bm,'fftt_bracket_manager_snapshot_v1',{p_event_id:E});
    const leaving=snap.players[0].id;
    const args={p_event_id:E,p_player_id:leaving,p_expected_generation:snap.event.generation,
      p_slots:seedSlots(enginePlayers(snap.players.filter(p=>p.id!==leaving))),
      p_reason:'Left before match calls'};
    await mustFail(db.rpc(scorer,'fftt_withdraw_preplay_v7',args),'42501');
    await mustFail(db.rpc(bm,'fftt_withdraw_preplay_v7',{...args,p_event_id:other}),'42501');
    assert.equal((await db.rpc(bm,'fftt_withdraw_preplay_v7',args)).status,'rebuilt');
    const fresh=await db.rpc(bm,'fftt_bracket_manager_snapshot_v1',{p_event_id:E});
    assert.equal(fresh.event.generation,snap.event.generation+1);
    assert.equal(fresh.players.find(p=>p.id===leaving).checked_in,false);
    assert.equal((await db.rpc(org,'fftt_organizer_snapshot_v3',{p_event_id:other})).event.generation,0);
  }finally{await db.db.close();}
});
