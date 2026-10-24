import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1HostedFixtureTransport}
  from '../contracts/milestone1_hosted_fixture_transport.mjs';

const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PUB='sb_publishable_fake_testing_12345678';
const JWT='fake.header.signature';
const EVENT_HASH='52c86dee4d72893b490ab991924335962a34fb39a26ffc11239f034390e549e7';
const MATCH_HASH='37e0555d5dd57fd9c93d12e93cdff6da45d26c1d63243d12eab1c0b9efc68015';
const asBuf=h=>Uint8Array.from(h.match(/../g),z=>parseInt(z,16)).buffer;
function fakeCrypto(){
 return {subtle:{digest:async(_,data)=>{
  const value=new TextDecoder().decode(data);
  return asBuf(value===E?EVENT_HASH:value===M?MATCH_HASH:'00'.repeat(32));
 }}};
}
function mem(){
 let value=null;
 return {getItem:()=>value,setItem:(_,v)=>{value=v;},get used(){return value!==null;}};
}
const intent=()=>({
 eventId:E,matchId:M,submissionId:S,winnerId:P,
 bracketGeneration:1,expectedMatchVersion:0,tableNumber:1,
 gameScores:'11-7, 11-8, 11-9'
});
function make({store=mem(),fetchImpl=async()=>({status:200,json:async()=>null})}={}){
 return createMilestone1HostedFixtureTransport({
  publishableKey:PUB,getAccessToken:()=>JWT,fetchImpl,store});
}
async function withFakeCrypto(f){
 const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 try{
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:fakeCrypto()});
  return await f();
 }finally{
  if(original)Object.defineProperty(globalThis,'crypto',original);
  else delete globalThis.crypto;
 }
}
test('server host never configurable; reject secret/legacy key and no per-role admin path',()=>{
 assert.throws(()=>createMilestone1HostedFixtureTransport({publishableKey:'sb_secret_any',
  getAccessToken:()=>JWT,fetchImpl:async()=>{},store:mem()}));
 assert.throws(()=>createMilestone1HostedFixtureTransport({publishableKey:'legacy.jwt.token',
  getAccessToken:()=>JWT,fetchImpl:async()=>{},store:mem()}));
});
test('fixture PIN blocks original/foreign UUID without any network or marker',async()=>{
 let calls=0;const store=mem();
 const t=make({store,fetchImpl:async()=>{calls++;}});
 await assert.rejects(t.checkFixture({eventId:E,matchId:M}));
 await assert.rejects(t.submitScore(intent()));
 await assert.rejects(t.readOwnSnapshot({eventId:E,submissionId:S}));
 assert.equal(calls,0);assert.equal(store.used,false);
});
test('fake digest only in unit test: exact signed hosted score POST once, crash marker before call',async()=>{
 await withFakeCrypto(async()=>{
  const store=mem();let calls=0;
  const t=make({store,fetchImpl:async(url,init)=>{
   calls++;
   assert.equal(url,'https://copmkalfkkrkzheohwuc.supabase.co/rest/v1/rpc/fftt_submit_match_result_v2');
   assert.equal(init.method,'POST');
   assert.equal(init.headers.Authorization,'Bearer '+JWT);
   assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');
   assert.equal(store.used,true);
   assert.deepEqual(JSON.parse(init.body),{
    p_event_id:E,p_match_id:M,p_bracket_generation:1,
    p_expected_match_version:0,p_submission_id:S,p_winner_id:P,
    p_game_scores:'11-7, 11-8, 11-9',p_table_number:1});
   return {status:200,json:async()=>({submission_id:S,status:'accepted',match_id:M,
    match_version:1,event_revision:1,generation:1,reason:null})};
  }});
  await t.checkFixture({eventId:E,matchId:M});
  const outcome=await t.submitScore(intent());
  assert.equal(outcome.status,'accepted');
  assert.equal(outcome.receiptValidated,false);
  assert.equal(calls,1);
  await assert.rejects(t.submitScore(intent()),/already used/i);
  const afterReload=make({store,fetchImpl:async()=>{calls++;}});
  await assert.rejects(afterReload.submitScore(intent()),/already used/i);
  assert.equal(calls,1);
 });
});
test('network timeout consumes non-secret marker; no automatic retry',async()=>{
 await withFakeCrypto(async()=>{
  let sent=0;const store=mem();
  const t=make({store,fetchImpl:async()=>{sent++;throw Error('offline');}});
  await assert.rejects(t.submitScore(intent()),/NEVER retry/);
  assert.equal(store.used,true);assert.equal(sent,1);
  await assert.rejects(t.submitScore(intent()),/already used/);
  assert.equal(sent,1);
 });
});
test('separate own-snapshot read after reload returns only owned verified fixture decision',async()=>{
 await withFakeCrypto(async()=>{
  const t=make({fetchImpl:async(url,init)=>{
    assert.ok(url.endsWith('/fftt_score_decision_snapshot_v2'));
    assert.deepEqual(JSON.parse(init.body),{p_event_id:E,p_submission_id:S});
    return {status:200,json:async()=>({
      event_id:E,revision:1,generation:1,lifecycle:'active',submission_id:S,
      decision:{id:S,status:'accepted',match_id:M,match_version:1,
       event_revision:1,generation:1,reason:null}
    })};
  }});
  const s=await t.readOwnSnapshot({eventId:E,submissionId:S});
  assert.equal(s.decision?.status,'accepted');
  assert.equal(s.scoreWritesEnabled,false);
  assert.equal(t.stats.scoreRequests,0);
 });
});
test('absent own receipt remains UNKNOWN, never a rejection',async()=>{
 await withFakeCrypto(async()=>{
  const t=make({fetchImpl:async()=>({status:200,json:async()=>({
    event_id:E,revision:0,generation:1,lifecycle:'active',
    submission_id:S,decision:null,
  })})});
  const s=await t.readOwnSnapshot({eventId:E,submissionId:S});
  assert.equal(s.decision,null);
  assert.equal(t.stats.autoRetries,0);
 });
});
