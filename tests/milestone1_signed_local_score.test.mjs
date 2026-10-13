import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1LocalSignedScoreTransport,validateLocalScoreIntent,
 parseLocalOwnSnapshot} from '../contracts/milestone1_signed_local_score_transport.mjs';

const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const W='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const intent=()=>({eventId:E,matchId:M,submissionId:S,winnerId:W,
 bracketGeneration:1,expectedMatchVersion:0,tableNumber:1,
 gameScores:'11-7, 11-8, 11-9'});
const KEY='sb_publishable_localfake_123456789';
const JWT='header.payload.signature';
const ack=()=>({submission_id:S,status:'accepted',match_id:M,
 match_version:1,event_revision:1,generation:1,reason:null});
const snap=(decision=null)=>({event_id:E,revision:1,generation:1,
 lifecycle:'active',submission_id:decision?.id??null,decision});
const receipt=()=>({id:S,status:'accepted',match_id:M,match_version:1,
 event_revision:1,generation:1,reason:null});
function make(fetchImpl){
 return createMilestone1LocalSignedScoreTransport({publishableKey:KEY,
 getAccessToken:async()=>JWT,fetchImpl});
}
const resp=(body,status=200)=>({status,json:async()=>body});
test('fixed disposable loopback, public key and injected identity; hosted blocked',()=>{
 assert.throws(()=>createMilestone1LocalSignedScoreTransport({
  projectUrl:'https://copmkalfkkrkzheohwuc.supabase.co',publishableKey:KEY,
  getAccessToken:()=>JWT,fetchImpl:async()=>{}}),/loopback/);
 assert.throws(()=>createMilestone1LocalSignedScoreTransport({
  publishableKey:'sb_secret_adminkey',getAccessToken:()=>JWT,fetchImpl:async()=>{}}));
 assert.throws(()=>createMilestone1LocalSignedScoreTransport({
  publishableKey:KEY,getAccessToken:null,fetchImpl:async()=>{}}));
});
test('explicit exact signed V2 POST maps all eight score fields; one request',async()=>{
 const calls=[];
 const client=make(async(url,init)=>{calls.push({url,init});return resp(ack());});
 const result=await client.submitScore(intent());
 assert.deepEqual(result,{status:'accepted',revision:1,generation:1,matchVersion:1,
   receiptValidated:false});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'http://127.0.0.1:54321/rest/v1/rpc/fftt_submit_match_result_v2');
 assert.equal(calls[0].init.method,'POST');
 assert.equal(calls[0].init.headers.Authorization,'Bearer '+JWT);
 assert.equal(calls[0].init.credentials,'omit');
 assert.equal(calls[0].init.cache,'no-store');
 assert.deepEqual(JSON.parse(calls[0].init.body),{
  p_event_id:E,p_match_id:M,p_submission_id:S,p_winner_id:W,
  p_bracket_generation:1,p_expected_match_version:0,
  p_game_scores:'11-7, 11-8, 11-9',p_table_number:1});
 assert.equal(client.getTelemetry().scoreRequests,1);
 await assert.rejects(client.submitScore(intent()),/Duplicate submission/);
 assert.equal(calls.length,1);
});
test('timeout, 409, invalid JSON, malformed ACK all never retry same submission',async()=>{
 const transports=[
   make(async()=>{throw new Error('private network secrets');}),
   make(async()=>resp({private:'error'},409)),
   make(async()=>({status:200,json:async()=>{throw Error('broken');}})),
   make(async()=>resp({...ack(),email:'leak'})),
   make(async()=>resp({...ack(),status:'rejected',reason:'bad-score'})),
 ];
 for(const c of transports){
  await assert.rejects(c.submitScore(intent()));
  await assert.rejects(c.submitScore(intent()),/Duplicate submission/);
  assert.equal(c.getTelemetry().scoreRequests,1);
  assert.equal(c.getTelemetry().automaticRetries,0);
 }
});
test('status read scopes caller and strips untrusted private fields',async()=>{
 const calls=[];
 const c=make(async(url,init)=>{
  calls.push(url);
  const x=JSON.parse(init.body);
  assert.equal(x.p_event_id,E);
  assert.equal(x.p_submission_id,S);
  return resp(snap(receipt()));
 });
 const result=await c.readOwnSnapshot({eventId:E,submissionId:S});
 assert.equal(result.decision.status,'accepted');
 assert.equal(result.decision.id,S);
 assert.equal(result.scoreWritesEnabled,false);
 assert.equal(result.source,'synthetic-local-wire');
 assert.equal(c.getTelemetry().scoreRequests,0);
 assert.equal(calls.length,1);
 assert.equal(calls[0].endsWith('/fftt_score_decision_snapshot_v2'),true);
});
test('missing receipt remains null, never classified as rejected',async()=>{
 const c=make(async()=>resp({...snap(),submission_id:S}));
 const data=await c.readOwnSnapshot({eventId:E,submissionId:S});
 assert.equal(data.decision,null);
});
test('reject non-owner/cross-event/invalid receipt and extra data',()=>{
 for(const payload of [
   {...snap(receipt()),actor_id:W},
   {...snap(receipt()),event_id:W},
   {...snap(receipt()),decision:{...receipt(),id:W}},
   {...snap(receipt()),decision:{...receipt(),phone:'private'}},
   {...snap(receipt()),decision:{...receipt(),status:'rejected',reason:null}},
   {...snap(receipt()),revision:0},
   {...snap(receipt()),lifecycle:'archived'},
 ])assert.throws(()=>parseLocalOwnSnapshot(payload,{eventId:E,submissionId:S}));
});
test('strict event/winner/score/extra validation before network',async()=>{
 const errors=[
  {...intent(),eventId:W,submissionId:'bad'},
  {...intent(),gameScores:'(11,7)'},
  {...intent(),tableNumber:0},
  {...intent(),bracketGeneration:-1},
  {...intent(),extraPrivate:'forbidden'},
 ];
 for(const x of errors)assert.throws(()=>validateLocalScoreIntent(x));
 const c=make(async()=>{throw Error('should not connect')});
 await assert.rejects(c.submitScore({...intent(),gameScores:''}));
 assert.equal(c.getTelemetry().scoreRequests,0);
});
