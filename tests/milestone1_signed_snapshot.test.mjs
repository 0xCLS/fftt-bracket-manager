import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMilestone1ReadOnlySnapshotTransport} from '../contracts/milestone1_signed_snapshot_transport.mjs';
const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY='sb_publishable_synthetic_read_only_key';
const JWT='test.payload.signature';
const response=(status,body)=>({status,json:async()=>body});
const snapshot=(submission=SUB,decision={id:SUB,status:'accepted',match_id:MATCH,
  match_version:2,event_revision:4,generation:1,reason:null})=>
  ({event_id:EVENT,revision:4,generation:1,lifecycle:'active',
    submission_id:submission,decision});
function harness(body=snapshot(),status=200,overrides={}){
  const calls=[];let tokens=0;
  const transport=createMilestone1ReadOnlySnapshotTransport({
    publishableKey:KEY,
    getAccessToken:async()=>{tokens++;return JWT;},
    fetchImpl:async(url,init)=>{calls.push({url,init});
      if(overrides.throwFetch)throw new Error('backend secrets');
      if(overrides.badJson)return {status,json:async()=>{throw Error('private');}};
      return response(status,body);},
  });
  return {transport,calls,tokens:()=>tokens};
}
test('approved synthetic host, public key and explicit session transport required',()=>{
  const options={publishableKey:KEY,getAccessToken:async()=>JWT,fetchImpl:async()=>response(200,[])};
  assert.throws(()=>createMilestone1ReadOnlySnapshotTransport({...options,projectUrl:'https://attacker.invalid'}));
  assert.throws(()=>createMilestone1ReadOnlySnapshotTransport({...options,publishableKey:'sb_secret_admin'}));
  assert.throws(()=>createMilestone1ReadOnlySnapshotTransport({...options,publishableKey:'ey.header.jwt'}));
  assert.throws(()=>createMilestone1ReadOnlySnapshotTransport({...options,fetchImpl:null}));
  assert.throws(()=>createMilestone1ReadOnlySnapshotTransport({...options,getAccessToken:null}));
});
test('read uses exactly one signed, scoped read RPC without storing token',async()=>{
  const h=harness();
  const result=await h.transport.readSnapshot({eventId:EVENT,submissionId:SUB});
  assert.equal(result.status,'accepted');
  assert.equal(result.decisionVerifiedFromServer,false);
  assert.equal(result.cloudWritesEnabled,false);
  assert.equal(result.retryAllowed,false);
  assert.equal(h.calls.length,1);
  assert.equal(h.tokens(),1);
  const {url,init}=h.calls[0];
  assert.equal(new URL(url).pathname,'/rest/v1/rpc/fftt_score_decision_snapshot_v2');
  assert.equal(init.method,'POST');
  assert.equal(init.cache,'no-store');
  assert.equal(init.credentials,'omit');
  assert.equal(init.redirect,'error');
  assert.deepEqual(JSON.parse(init.body),{p_event_id:EVENT,p_submission_id:SUB});
  assert.equal(init.headers.Authorization,'Bearer '+JWT);
  await assert.rejects(()=>h.transport.submitScore(),/Score writes disabled/);
  assert.equal(h.calls.length,1);
});
test('no request without exact UUIDs or signed token',async()=>{
  const h=harness();await assert.rejects(()=>h.transport.readSnapshot({eventId:'BAD'}));
  await assert.rejects(()=>h.transport.readSnapshot({eventId:EVENT,submissionId:'invalid'}));
  assert.equal(h.calls.length,0);
  const b=createMilestone1ReadOnlySnapshotTransport({publishableKey:KEY,
    getAccessToken:()=> 'wrong',fetchImpl:async()=>{throw Error('must not call');}});
  await assert.rejects(()=>b.readSnapshot({eventId:EVENT,submissionId:SUB}));
});
test('missing decision stays unknown and unverified',async()=>{
  const h=harness(snapshot(SUB,null));const result=await h.transport.readSnapshot({eventId:EVENT,submissionId:SUB});
  assert.equal(result.status,'unknown');
  assert.equal(result.unresolved,true);
  assert.equal(result.cloudWritesEnabled,false);
});
test('only exact owner-scoped decision shape may be presented',async()=>{
  const bad=[
    {...snapshot(),actor_id:EVENT},
    {...snapshot(),submission_id:EVENT},
    {...snapshot(),decision:{...snapshot().decision,email:'private'}},
    {...snapshot(),decision:{...snapshot().decision,id:EVENT}},
    {...snapshot(),decision:{...snapshot().decision,status:'rejected',reason:null}},
    {...snapshot(),revision:0},
    {...snapshot(),event_id:SUB},
  ];
  for(const item of bad)await assert.rejects(()=>harness(item).transport.readSnapshot({eventId:EVENT,submissionId:SUB}));
});
test('HTTP authorization errors, rate limits, timeouts and invalid JSON fail closed',async()=>{
  for(const code of [400,401,403,404,409,429,500]){
    const h=harness({secret:'not for UI'},code);
    await assert.rejects(()=>h.transport.readSnapshot({eventId:EVENT,submissionId:SUB}),e=>
      !String(e).includes('not for UI')&&!String(e).includes('secret'));
    assert.equal(h.calls.length,1);
  }
  await assert.rejects(()=>harness(snapshot(),200,{throwFetch:true}).transport.readSnapshot({eventId:EVENT,submissionId:SUB}));
  await assert.rejects(()=>harness(snapshot(),200,{badJson:true}).transport.readSnapshot({eventId:EVENT,submissionId:SUB}));
});
test('source remains read-only: no write endpoint, persistence, retry or implicit fetch',()=>{
  const src=readFileSync(new URL('../contracts/milestone1_signed_snapshot_transport.mjs',import.meta.url),'utf8');
  assert.equal(src.includes('/rest/v1/rpc/fftt_submit_match_result'),false);
  assert.equal(src.includes('localStorage'),false);
  assert.equal(src.includes('setInterval('),false);
  assert.equal(src.includes('window.fetch('),false);
  assert.match(src,/async submitScore\(\)/);
});
