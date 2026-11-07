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
