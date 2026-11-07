/** Game-progress V6 against disposable REAL SQL in PGlite, fictional accounts and matches only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEvent,buildChampionship,deskOf,submit} from './helpers.mjs';
import {projectPublicTournaments} from '../../contracts/gameday_public.mjs';
import {summarizeGameProgress} from '../../contracts/gameday_game_progress.mjs';

const mustFail=async (task, code, part) => {
  const e=await task.then(()=>null,x=>x);
  assert.ok(e,'request should fail');
  if(code) assert.equal(e.code,code,String(e));
  if(part) assert.match((e.detail??e.message) ?? '',new RegExp(part));
  return e;
};
const read=(ctx,row,who=ctx.skA)=>ctx.db.rpc(who,'fftt_game_progress_v1',
  {p_event_id:ctx.E,p_match_id:row.match_id});
const receipt=(ctx,who,id)=>ctx.db.rpc(who,'fftt_game_progress_decision_v1',
  {p_event_id:ctx.E,p_submission_id:id});
const save=(ctx,who,row,shot,index,a,b,{id=crypto.randomUUID(),reason=null,overrides={}}={})=>
  ctx.db.rpc(who,'fftt_save_completed_game_v1',{
    p_event_id:ctx.E,p_match_id:row.match_id,p_generation:shot.generation,
    p_expected_match_version:shot.match_version,p_expected_epoch:shot.epoch,
    p_expected_progress_version:shot.revision,p_expected_best_of:shot.best_of,
    p_expected_points_to_win:shot.points_to_win,p_submission_id:id,p_game_index:index,
    p_player_1_score:a,p_player_2_score:b,p_reason:reason,...overrides,
  });
const assign=(ctx,row,n=1)=>ctx.db.rpc(ctx.org,'fftt_assign_table_v3',
  {p_event_id:ctx.E,p_match_id:row.match_id,p_table_number:n});
const fresh=async (n=8)=>{const ctx=await setupEvent({players:n,tables:2});
  await buildChampionship(ctx);return ctx;};
const resultsCount=async ctx=>(await ctx.db.admin(
  "select count(*)::int as n from fftt_private.matches where event_id=$1 and status='complete'",
  [ctx.E]))[0].n;

test('G1 G2 deciding G3: saves never advance; public shows verified tally; only final confirmation progresses',async()=>{
  const ctx=await fresh();
  try {
    const row=(await deskOf(ctx,ctx.skA))[0];
    await assign(ctx,row);
    let shot=await read(ctx,row);
    assert.equal(shot.revision,0);
    assert.deepEqual(shot.games,[]);
    assert.equal(await resultsCount(ctx),0);
    assert.deepEqual(await ctx.db.publicTournaments(),[]);
    let r=await save(ctx,ctx.skA,row,shot,1,11,7);
    assert.equal(r.status,'accepted');
    shot=await read(ctx,row);
    assert.deepEqual(shot.games,[[11,7]]);assert.equal(shot.revision,1);
    assert.equal(await resultsCount(ctx),0);
    r=await save(ctx,ctx.skB,row,shot,2,8,11);
    assert.equal(r.status,'accepted');
    shot=await read(ctx,row);
    assert.deepEqual(summarizeGameProgress(shot.games,3,11).won,[1,1]);
    r=await save(ctx,ctx.skA,row,shot,3,11,9);
    assert.equal(r.status,'accepted');
    shot=await read(ctx,row);
    assert.equal(summarizeGameProgress(shot.games,3,11).decided,true);
    assert.equal(await resultsCount(ctx),0,'completed games never create an official winner');
    const pending=await ctx.snap();
    assert.equal(pending.matches.find(m=>m.id===row.match_id).winner_id,null);
    assert.equal(pending.consolation_candidates.length,0);
    await ctx.db.rpc(ctx.org,'fftt_set_visibility_v3',{p_event_id:ctx.E,p_visible:true});
    const pub=projectPublicTournaments(await ctx.db.publicTournaments())[0];
    const playing=pub.championship.find(m=>m.progress?.games.length===3);
    assert.ok(playing);
    assert.deepEqual(playing.progress.won,[2,1]);
    assert.equal(JSON.stringify(pub).includes('rating_status'),false);
    assert.equal(JSON.stringify(pub).includes('email'),false);
    // The authoritative final write cannot disagree with server-confirmed games.
    await mustFail(submit(ctx,ctx.skA,row,row.player_1_id,'11-7, 8-11, 11-8'),'P0001','game-progress-mismatch');
    assert.equal(await resultsCount(ctx),0);
    const final=await submit(ctx,ctx.skA,row,row.player_1_id,'11-7, 8-11, 11-9');
    assert.equal(final.status,'accepted');
    assert.equal(await resultsCount(ctx),1);
    assert.equal((await ctx.db.admin('select count(*)::int as n from fftt_private.match_game_progress where event_id=$1',[ctx.E]))[0].n,0,
      'final result clears superseded interim scores in same transaction');
    const published=projectPublicTournaments(await ctx.db.publicTournaments())[0];
    const done=published.championship.find(m=>m.status==='complete' && m.scores==='11-7, 8-11, 11-9');
    assert.equal(done.progress,null,'official result supersedes interim public projection');
  } finally {await ctx.db.db.close();}
});
test('2-0 match and best-of-one conclude without unnecessary games; stale and duplicate submissions are safe',async()=>{
  const ctx=await fresh();
  try{
    const row=(await deskOf(ctx,ctx.skA))[0];
    await assign(ctx,row);
    const initial=await read(ctx,row);
    const id=crypto.randomUUID();
    const first=await save(ctx,ctx.skA,row,initial,1,11,7,{id});
    assert.equal(first.status,'accepted');
    const identical=await save(ctx,ctx.skA,row,initial,1,11,7,{id});
    assert.deepEqual(identical,first,'exact duplicate returns immutable receipt, no second write');
    await mustFail(save(ctx,ctx.skA,row,initial,1,11,5,{id}),'P0001','submission-id-reused');
    assert.equal((await receipt(ctx,ctx.skA,id)).status,'accepted');
    const other=await receipt(ctx,ctx.skB,id);
    assert.equal(other.status,'unconfirmed');
    const stale=await save(ctx,ctx.skB,row,initial,1,11,9);
    assert.deepEqual([stale.status,stale.reason],['rejected','stale-progress']);
    let shot=await read(ctx,row);
    await save(ctx,ctx.skA,row,shot,2,11,9);
    shot=await read(ctx,row);
    assert.equal(summarizeGameProgress(shot.games,3,11).nextGame,null);
    await mustFail(save(ctx,ctx.skA,row,shot,3,11,5),'22023','scores-extra-games');
    assert.equal((await read(ctx,row)).games.length,2);
    assert.equal(await resultsCount(ctx),0);
  }finally{await ctx.db.db.close();}
});
test('authorization, win-by-two, audited organizer correction, and format invalidation',async()=>{
  const ctx=await fresh();
  try{
    const row=(await deskOf(ctx,ctx.skA))[0];
    await assign(ctx,row);
    let shot=await read(ctx,row);
    await mustFail(read(ctx,row,ctx.outsider),'42501');
    await mustFail(read(ctx,row,null),'42501');
    await mustFail(save(ctx,ctx.skA,row,shot,1,11,10),'22023','scores-game');
    await mustFail(save(ctx,ctx.skA,row,shot,1,12,9),'22023','scores-game');
    await mustFail(save(ctx,ctx.skA,row,shot,2,11,7),'22023','game-order');
    assert.equal((await read(ctx,row)).revision,0);
    await save(ctx,ctx.skA,row,shot,1,11,7);
    shot=await read(ctx,row);
    await mustFail(save(ctx,ctx.skB,row,shot,1,11,9),'42501');
    await mustFail(save(ctx,ctx.org,row,shot,1,11,9,{reason:'short'}),'22023','correction-reason');
    const corrected=await save(ctx,ctx.org,row,shot,1,11,9,{reason:'The printed score was entered incorrectly'});
    assert.equal(corrected.status,'accepted');
    shot=await read(ctx,row);
    assert.deepEqual(shot.games,[[11,9]]);
    const audit=await ctx.db.admin("select operation,reason from fftt_private.audit_events where event_id=$1 and operation in ('game_saved','game_corrected') order by id",[ctx.E]);
    assert.equal(audit.some(a=>a.operation==='game_saved'),true);
    assert.equal(audit.some(a=>a.operation==='game_corrected'&&a.reason),true);
    const beforeEpoch=shot.epoch;
    await ctx.db.rpc(ctx.org,'fftt_set_match_format_v4',{
      p_event_id:ctx.E,p_match_id:row.match_id,p_best_of:1,p_points:21});
    const changed=await read(ctx,row);
    assert.equal(changed.epoch,beforeEpoch+1);
    assert.deepEqual(changed.games,[],'format change invalidates all saved games');
    const stale=await save(ctx,ctx.skA,row,shot,2,8,11);
    assert.equal(stale.status,'rejected');
    assert.equal((await read(ctx,row)).revision,0);
    await save(ctx,ctx.skA,row,changed,1,22,20);
    assert.deepEqual((await read(ctx,row)).games,[[22,20]]);
    assert.equal(summarizeGameProgress([[22,20]],1,21).decided,true);
  } finally{await ctx.db.db.close();}
});
test('publication opt-in, hidden event, event isolation, and security revocation',async()=>{
  const ctx=await fresh();
  try{
    const row=(await deskOf(ctx,ctx.skA))[0];
    await assign(ctx,row);
    let shot=await read(ctx,row);
    await save(ctx,ctx.skA,row,shot,1,11,8);
    assert.deepEqual(await ctx.db.publicTournaments(),[],'not published by default');
    await ctx.db.rpc(ctx.org,'fftt_set_visibility_v3',{p_event_id:ctx.E,p_visible:true});
    const visible=await ctx.db.publicTournaments();
    assert.equal(visible.length,1);
    const json=JSON.stringify(visible);
    for(const key of ['rating','email','actor_id','submission_id','auth.'])assert.equal(json.includes(key),false,key);
    await ctx.db.rpc(ctx.org,'fftt_set_visibility_v3',{p_event_id:ctx.E,p_visible:false});
    assert.deepEqual(await ctx.db.publicTournaments(),[],'unpublish removes the entire event projection');
    const other=await ctx.db.rpc(ctx.org,'fftt_create_event_v3',
      {p_name:'Unrelated fictional event',p_date:'2026-12-06',p_table_count:2});
    await mustFail(ctx.db.rpc(ctx.skA,'fftt_game_progress_v1',
      {p_event_id:other.event_id,p_match_id:row.match_id}),'42501');
    await ctx.db.rpc(ctx.org,'fftt_set_staff_v3',{
      p_event_id:ctx.E,p_email:'scorekeeper-a@fftt-staging.invalid',p_action:'revoke',p_role:'scorekeeper'});
    await mustFail(read(ctx,row),'42501');
    await mustFail(receipt(ctx,ctx.skA,crypto.randomUUID()),'42501');
  }finally{await ctx.db.db.close();}
});
test('historical best-of-five match remains supported without enabling best-of-five configuration',async()=>{
  const ctx=await fresh(2);
  try{
    const row=(await deskOf(ctx,ctx.skA))[0];
    await ctx.db.admin('update fftt_private.matches set best_of=null,points_to_win=null where event_id=$1 and id=$2',[ctx.E,row.match_id]);
    await assign(ctx,row);
    let shot=await read(ctx,row);
    assert.equal(shot.best_of,5);
    for(const [i,pair]of [[11,7],[7,11],[11,5],[8,11],[11,9]].entries()){
      const saved=await save(ctx,ctx.skA,row,shot,i+1,pair[0],pair[1]);
      assert.equal(saved.status,'accepted');
      shot=await read(ctx,row);
    }
    assert.deepEqual(summarizeGameProgress(shot.games,5,11).won,[3,2]);
    assert.equal(await resultsCount(ctx),0);
    const final=await submit(ctx,ctx.skA,row,row.player_1_id,'11-7, 7-11, 11-5, 8-11, 11-9');
    assert.equal(final.status,'accepted');
  }finally{await ctx.db.db.close();}
});
