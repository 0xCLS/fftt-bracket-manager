/** Real Staff client + one-shot transport over fake HTTP and disposable SQL, fictional data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './harness.mjs';
import {roster} from './helpers.mjs';
const stage=async (org,n=8)=>{
  assert.ok((await org.core.actions.addPlayers(roster(n))).ok);
  assert.ok((await org.core.actions.setCheckinAll(true)).ok);
  assert.ok((await org.core.actions.buildChampionship()).ok);
};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const score=(d,row,snapshot,i,a,b)=>d.core.saveCompletedGame({
  matchId:row.matchId,snapshot,gameIndex:i,player1Score:a,player2Score:b,
});
const first=async (org,a)=>{
  const row=a.core.state.desk[0];
  assert.ok((await org.core.actions.assignTable(row.matchId,1)).ok);
  await a.core.refresh({force:true});
  const read=await a.core.readGameProgress(row.matchId);
  assert.ok(read.ok,read.message);
  return [row,read.data];
};
test('mobile scorer G1/G2/G3 preserves server-confirmed scores and only final result advances',async()=>{
  const w=await createWorld();const org=w.device('org','org'),a=w.device('a','a'),b=w.device('b','b');
  try{
    await org.signIn();await stage(org);await a.signIn();await b.signIn();
    let [row,shot]=await first(org,a);
    const before=a.scoreTransport.stats.scoreRequests;
    assert.ok((await score(a,row,shot,1,11,7)).ok);
    assert.equal(a.scoreTransport.stats.scoreRequests-before,1);
    shot=(await a.core.readGameProgress(row.matchId)).data;
    assert.deepEqual(shot.games,[[11,7]]);
    await b.core.refresh({force:true}); // table assignment made after B opened the desk
    const bshot=(await b.core.readGameProgress(row.matchId)).data;
    assert.ok((await score(b,row,bshot,2,8,11)).ok);
    shot=(await a.core.readGameProgress(row.matchId)).data;
    assert.deepEqual(shot.games,[[11,7],[8,11]]);
    assert.ok((await score(a,row,shot,3,11,9)).ok);
    shot=(await a.core.readGameProgress(row.matchId)).data;
    assert.deepEqual(shot.games,[[11,7],[8,11],[11,9]]);
    await org.core.refresh({force:true});
    assert.equal(org.core.state.snapshot.matches.find(m=>m.id===row.matchId).status,'pending');
    const prepared=a.core.prepareScore({matchId:row.matchId,winnerId:row.players[0].id,
      games:'11-7, 8-11, 11-9',table:1});
    assert.ok(prepared.ok,prepared.message);
    const done=await a.core.confirmScore(prepared);
    assert.ok(done.ok,done.message);
    await org.core.refresh({force:true});
    assert.equal(org.core.state.snapshot.matches.find(m=>m.id===row.matchId).status,'complete');
  }finally{await w.fake.local.db.close();}
});
test('two scorekeepers with same revision cannot overwrite the first saved game',async()=>{
  const w=await createWorld();const org=w.device('org','org'),a=w.device('a','a'),b=w.device('b','b');
  try{
    await org.signIn();await stage(org);await a.signIn();await b.signIn();
    const [row,shot]=await first(org,a);
    await b.core.refresh({force:true}); // both users see the assigned table before racing
    const other=(await b.core.readGameProgress(row.matchId)).data;
    const [x,y]=await Promise.all([score(a,row,shot,1,11,7),score(b,row,other,1,9,11)]);
    assert.equal([x,y].filter(z=>z.ok).length,1);
    const loser=[x,y].find(z=>!z.ok);
    assert.equal(loser.rejected,true);
    const now=(await a.core.readGameProgress(row.matchId)).data;
    assert.equal(now.games.length,1);
    assert.equal(now.revision,1);
    assert.equal(a.core.state.gamePending,null);
    assert.equal(b.core.state.gamePending,null);
  }finally{await w.fake.local.db.close();}
});
test('lost game-save ACK resolves from own server receipt, exactly once',async()=>{
  const w=await createWorld();const org=w.device('org','org'),a=w.device('a','a');
  try{
    await org.signIn();await stage(org);await a.signIn();
    const [row,shot]=await first(org,a);
    const before=a.scoreTransport.stats.scoreRequests;
    w.fake.loseNextReply('a','/rpc/fftt_save_completed_game_v1');
    const saved=await score(a,row,shot,1,11,7);
    assert.ok(saved.ok,saved.message);
    assert.equal(a.scoreTransport.stats.scoreRequests-before,1);
    assert.equal(a.core.state.gamePending,null);
    assert.deepEqual((await a.core.readGameProgress(row.matchId)).data.games,[[11,7]]);
  }finally{await w.fake.local.db.close();}
});
test('unknown save survives reload, blocks repeats and demands manual reconciliation',async()=>{
  const w=await createWorld();const org=w.device('org','org'),a=w.device('a','a');
  try{
    await org.signIn();await stage(org);await a.signIn();
    const [row,shot]=await first(org,a);
    w.fake.failNext('a','/rest/v1/rpc/fftt_save_completed_game_v1',503);
    const unknown=await score(a,row,shot,1,11,7);
    assert.equal(unknown.unknown,true);
    assert.ok(a.core.state.gamePending);
    assert.equal(a.scoreTransport.stats.scoreRequests,1);
    const blocked=await score(a,row,shot,1,11,7);
    assert.equal(blocked.unknown,true);
    assert.equal(a.scoreTransport.stats.scoreRequests,1,'never silently retries');
    a.reload();await a.signIn();
    assert.ok(a.core.state.gamePending,'durable incident marker restored');
    const receipt=await a.core.checkPendingGame();
    assert.equal(receipt.unknown,true);
    a.core.dismissPendingGame();
    await pause(5);await a.core.refresh({force:true});
    const current=(await a.core.readGameProgress(row.matchId)).data;
    assert.equal(current.revision,0,'no server write landed');
    const retry=await score(a,row,current,1,11,7);
    assert.ok(retry.ok,retry.message);
  }finally{await w.fake.local.db.close();}
});

test('definitive withdrawn-player refusal clears only the game incident and permits later scoring', async()=>{
  const w=await createWorld(), org=w.device('org','org'), a=w.device('a','a');
  try {
    await org.signIn(); await stage(org); await a.signIn();
    let [row,shot]=await first(org,a);
    assert.ok((await score(a,row,shot,1,11,7)).ok);
    shot=(await a.core.readGameProgress(row.matchId)).data;
    w.fake.failNext('a','/rest/v1/rpc/fftt_save_completed_game_v1',400,
      {code:'P0001',message:'fftt_conflict',details:'player-withdrawn',hint:null});
    const refused=await score(a,row,shot,2,11,8);
    assert.equal(refused.rejected,true); assert.match(refused.message,/No game was saved.*withdrawn/);
    assert.equal(a.core.state.gamePending,null);
    assert.deepEqual((await a.core.readGameProgress(row.matchId)).data.games,[[11,7]]);
    const saved=await score(a,row,shot,2,11,8); assert.ok(saved.ok,saved.message);
    assert.deepEqual((await a.core.readGameProgress(row.matchId)).data.games,[[11,7],[11,8]]);
  } finally {await w.fake.local.db.close();}
});

test('malformed withdrawal conflict keeps the incident and blocks later writes', async()=>{
  const w=await createWorld(), org=w.device('org','org'), a=w.device('a','a');
  try {
    await org.signIn(); await stage(org); await a.signIn(); const [row,shot]=await first(org,a);
    w.fake.failNext('a','/rest/v1/rpc/fftt_save_completed_game_v1',400,
      {message:'fftt_conflict',details:'player-withdrawn'});
    assert.equal((await score(a,row,shot,1,11,7)).unknown,true);
    const pending=a.core.state.gamePending; assert.ok(pending);
    const count=a.scoreTransport.stats.scoreRequests;
    assert.equal((await score(a,row,shot,1,11,7)).unknown,true);
    assert.equal(a.scoreTransport.stats.scoreRequests,count); assert.equal(a.core.state.gamePending.submissionId,pending.submissionId);
  } finally {await w.fake.local.db.close();}
});

test('definitive refusal never clears a different or unreadable pending record', async()=>{
  const {createGamePendingLedger}=await import('../../app/staff_core.mjs');
  let value=null, broken=false;
  const storage={getItem(){if(broken) throw Error('unavailable');return value;},setItem(k,v){value=v;},removeItem(){value=null;}};
  const ledger=createGamePendingLedger(storage), record={submissionId:'one',matchId:'match',gameIndex:1,at:1};
  assert.equal(ledger.write('event',record),true);
  assert.equal(ledger.clearIfMatches('event','other','match'),false);
  assert.equal(ledger.read('event').submissionId,'one');
  broken=true; assert.equal(ledger.clearIfMatches('event','one','match'),false);
  broken=false; assert.equal(ledger.read('event').submissionId,'one');
  assert.equal(ledger.clearIfMatches('event','one','match'),true); assert.equal(ledger.read('event'),null);
});

test('doubles game refusal clears the matching pending record and permits a later save', {timeout:120000}, async()=>{
  const {playAllPlayable}=await import('./helpers.mjs');
  const w=await createWorld(), db=w.fake.local, org=w.device('org','org'), a=w.device('a','a');
  try {
    const fs=await import('node:fs');
    for (const path of ['proposals/FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql',
      'proposals/FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql',
      'proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql',
      'migrations/20261108114950_showcase_reset.sql','migrations/20261108150000_staff_scoring_permissions.sql']) {
      await db.db.exec(fs.readFileSync(new URL('../../supabase/'+path,import.meta.url),'utf8'));
    }
    await org.signIn(); await stage(org); await a.signIn();
    const snap=()=>db.rpc(w.ids.org,'fftt_organizer_snapshot_v3',{p_event_id:w.eventId});
    await playAllPlayable({db,E:w.eventId,org:w.ids.org,skA:w.ids.a,skB:w.ids.a,snap},{only:'championship'});
    const s=await snap(), finalists=new Set(s.matches.filter(m=>m.is_final).flatMap(m=>[m.player_1_id,m.player_2_id]));
    const partners=s.players.map(p=>p.id).filter(id=>!finalists.has(id));
    await db.rpc(w.ids.org,'fftt_set_doubles_teams_v3',{p_event_id:w.eventId,p_partner_1:partners[0],p_partner_2:partners[1]});
    await a.core.refresh({force:true}); const read=await a.core.readDoublesProgress(); assert.ok(read.ok,read.message);
    const args={snapshot:read.data,gameIndex:1,team1Score:read.data.points_to_win,team2Score:7};
    w.fake.failNext('a','/rest/v1/rpc/fftt_save_doubles_game_v1',400,{code:'P0001',message:'fftt_conflict',details:'player-withdrawn',hint:null});
    const refused=await a.core.saveDoublesGame(args); assert.equal(refused.rejected,true); assert.match(refused.message,/No game was saved.*withdrawn/);
    assert.equal(a.core.state.gamePending,null); assert.deepEqual((await a.core.readDoublesProgress()).data.games,[]);
    const saved=await a.core.saveDoublesGame(args); assert.ok(saved.ok,saved.message);
    assert.deepEqual((await a.core.readDoublesProgress()).data.games,[[read.data.points_to_win,7]]);
  } finally {await db.db.close();}
});
