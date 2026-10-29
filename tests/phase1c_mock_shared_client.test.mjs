import test from "node:test";
import assert from "node:assert/strict";
import {MockableSharedMatchClient} from "../contracts/phase1c_mock_shared_client.mjs";
import {PHASE, AuthorityGateError} from "../contracts/phase1c_disconnect_reference.mjs";

const EVENT="12345678-1234-4234-9234-123456789abc";
const OTHER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB="9f5521ee-83ac-4aab-aef6-d46773094cdc";
const row=()=>({
  event_id:EVENT,bracket_generation:1,
  match_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  match_code:"C-0-0",match_version:0,bracket:"championship",
  round_number:0,slot:0,
  player_1_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  player_2_id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  player_1_name:"Synthetic Alpha",player_2_name:"Synthetic Beta",
  table_number:null,is_championship_final:false,
});
const intent=()=>({
  eventId:EVENT,matchId:row().match_id,submissionId:SUB,
  bracketGeneration:1,expectedMatchVersion:0,
  winnerId:row().player_1_id,gameScores:"11-7, 11-8",
});
const accepted=()=>({
  httpStatus:200,body:{
    status:"accepted",submission_id:SUB,event_revision:5,
    bracket_generation:1,match_version:1,
  },
});
function client(overrides={}){
  let calls=0;
  const transport={
    readMatchdesk:async()=>[row()],
    fetchAuthoritativeSnapshot:async()=>({eventId:EVENT,revision:4,generation:1}),
    submitScore:async()=>{calls++; return accepted();},
    ...overrides,
  };
  const c=new MockableSharedMatchClient({eventId:EVENT,revision:4,generation:1,transport});
  return {c,transport,calls:()=>calls};
}
const denies=fn=>assert.throws(fn,AuthorityGateError);
const rejects=fn=>assert.rejects(fn,AuthorityGateError);

test("new client has a bounded, non-sensitive ready status",()=>{
  const {c}=client();
  assert.deepEqual(c.status,{
    phase:PHASE.READY,stale:false,cloudWritesEnabled:true,
    unresolvedSubmission:false,hasPendingSubmission:false,
    fallbackEdits:0,revision:4,
  });
  assert.equal(Object.keys(c.status).some(k=>/password|email|token|rating/.test(k)),false);
});
test("transport must be explicitly supplied: no default network",()=>{
  denies(()=>new MockableSharedMatchClient({eventId:EVENT,revision:4,generation:1}));
});
test("safe matchdesk allows only event-scoped fields",async()=>{
  const {c}=client();
  const rows=await c.readMatchdesk();
  assert.equal(rows.length,1);
  assert.equal(rows[0].match_code,"C-0-0");
  assert.ok(Object.isFrozen(rows[0]));
});
test("matchdesk rejects private email and foreign event records",async()=>{
  for(const bad of [{...row(),email:"private@example.test"},{...row(),event_id:OTHER}]){
    const {c}=client({readMatchdesk:async()=>[bad]});
    await rejects(()=>c.readMatchdesk());
  }
});
test("in-flight matchdesk read after network loss is discarded",async()=>{
  let resolve;
  const {c}=client({readMatchdesk:()=>new Promise(ok=>{resolve=ok;})});
  const read=c.readMatchdesk();
  c.loseConnection();
  resolve([row()]);
  await rejects(()=>read);
});
test("server-authoritative score ack required before persisted becomes true",async()=>{
  const {c,calls}=client();
  const result=await c.submitScore(intent());
  assert.deepEqual(result,{status:"accepted",persisted:true,retryAllowed:false});
  assert.equal(c.status.revision,5);
  assert.equal(c.status.cloudWritesEnabled,true);
  assert.equal(calls(),1);
});
test("same submission ID is not automatically replayed",async()=>{
  const {c,calls}=client();
  await c.submitScore(intent());
  await rejects(()=>c.submitScore(intent()));
  assert.equal(calls(),1);
});
test("different events or bracket generations cannot submit",async()=>{
  const {c,calls}=client();
  await rejects(()=>c.submitScore({...intent(),eventId:OTHER}));
  await rejects(()=>c.submitScore({...intent(),bracketGeneration:2}));
  assert.equal(calls(),0);
});
test("while one submission is awaiting transport, second score cannot enter",async()=>{
  let resolve;
  let calls=0;
  const {c}=client({submitScore:()=>{calls++;return new Promise(ok=>{resolve=ok;});}});
  const first=c.submitScore(intent());
  assert.equal(c.status.hasPendingSubmission,true);
  await rejects(()=>c.submitScore({...intent(),submissionId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}));
  resolve(accepted());
  const result=await first;
  assert.equal(result.status,"accepted");
  assert.equal(calls,1);
});
test("a reported 4xx conflict never claims persisted and requires reload",async()=>{
  const {c}=client({submitScore:async()=>({httpStatus:409,body:{code:"conflict"}})});
  const res=await c.submitScore(intent());
  assert.equal(res.status,"rejected");
  assert.equal(res.persisted,false);
  assert.equal(c.status.phase,PHASE.RELOADING);
  assert.equal(c.status.cloudWritesEnabled,false);
});
test("a 5xx or timeout is uncertain, preserves submitted identity, never retries",async()=>{
  for(const submitScore of [async()=>({httpStatus:503}),async()=>{throw new Error("timeout");}]){
    let attempts=0;
    const {c}=client({submitScore:async v=>{attempts++;return submitScore(v);}});
    const outcome=await c.submitScore(intent());
    assert.deepEqual(outcome,{status:"uncertain",persisted:false,retryAllowed:false});
    assert.equal(attempts,1);
    assert.equal(c.status.phase,PHASE.PAUSED);
    assert.equal(c.status.unresolvedSubmission,true);
    assert.equal(c.status.cloudWritesEnabled,false);
  }
});
test("accepted-like response with wrong ID or missing new revision is uncertain",async()=>{
  for(const body of [
    {...accepted().body,submission_id:"wrong"},
    {...accepted().body,event_revision:4},
    {...accepted().body,bracket_generation:0},
  ]){
    const {c}=client({submitScore:async()=>({httpStatus:200,body})});
    const result=await c.submitScore(intent());
    assert.equal(result.status,"uncertain");
    assert.equal(c.status.phase,PHASE.PAUSED);
  }
});
test("disconnect during HTTP call cannot turn late ack into a saved score",async()=>{
  let resolve;
  const {c}=client({submitScore:()=>new Promise(ok=>{resolve=ok;})});
  const call=c.submitScore(intent());
  c.loseConnection();
  resolve(accepted());
  const result=await call;
  assert.equal(result.status,"uncertain");
  assert.equal(c.status.unresolvedSubmission,true);
  assert.equal(c.status.revision,4);
});
test("reconnect alone leaves outstanding score unresolved and blocked",async()=>{
  const {c}=client({submitScore:async()=>{throw new Error("lost");}});
  await c.submitScore(intent());
  c.restoreConnection();
  assert.equal(c.status.phase,PHASE.RELOADING);
  await rejects(()=>c.reloadAuthoritativeState());
  assert.equal(c.status.cloudWritesEnabled,false);
});
test("server receipt resolves ambiguous result on exact event/submission only",async()=>{
  const {c}=client({
    submitScore:async()=>{throw new Error("offline");},
    fetchAuthoritativeSnapshot:async()=>({
      eventId:EVENT,revision:5,generation:1,
      resolvedSubmission:{id:SUB,status:"accepted",verifiedFromServer:true},
    }),
  });
  await c.submitScore(intent());
  c.restoreConnection();
  const status=await c.reloadAuthoritativeState();
  assert.equal(status.cloudWritesEnabled,true);
  assert.equal(status.revision,5);
  assert.equal(status.unresolvedSubmission,false);
});
test("server revision notice cannot directly override model or silently reload",async()=>{
  const {c}=client();
  c.receiveRevisionNotice(EVENT);
  assert.equal(c.status.phase,PHASE.RELOADING);
  assert.equal(c.status.cloudWritesEnabled,false);
  const reloaded=await c.reloadAuthoritativeState();
  assert.equal(reloaded.cloudWritesEnabled,true);
});
test("read error pauses instead of falling back to stale data",async()=>{
  const {c}=client({readMatchdesk:async()=>{throw new Error("disconnected");}});
  await rejects(()=>c.readMatchdesk());
  assert.equal(c.status.phase,PHASE.PAUSED);
  assert.equal(c.status.stale,true);
});
test("offline fallback cannot POST score or accept an outdated server snapshot",async()=>{
  let calls=0;
  let authoritativeRevision=4;
  const {c}=client({
    submitScore:async()=>{calls++;return accepted();},
    fetchAuthoritativeSnapshot:async()=>({
      eventId:EVENT,revision:authoritativeRevision,generation:1,
    }),
  });
  c.loseConnection();
  c.startFallback({
    eventId:EVENT,backupRevision:4,backupGeneration:1,
    organizerApproved:true,otherDevicesStopped:true,
    backupProtected:true,manualLogReady:true,
  });
  c.recordManualFallbackEdit({eventId:EVENT,writtenToPrivateLog:true});
  await rejects(()=>c.submitScore(intent()));
  assert.equal(calls,0);
  c.restoreConnection();
  assert.equal(c.status.phase,PHASE.RECONCILING);
  assert.equal(c.status.cloudWritesEnabled,false);
  denies(()=>c.finishOrganizerReconciliation({
    eventId:EVENT,organizerApproved:false,
  }));
  const flagged=c.finishOrganizerReconciliation({
    eventId:EVENT,organizerApproved:true,privateBackupReviewed:true,
    manualLogReviewed:true,allFallbackEditsReconciled:true,
    unresolvedCloudRequestChecked:true,serverRevision:5,serverGeneration:1,
  });
  assert.equal(flagged.phase,PHASE.RELOADING);
  assert.equal(flagged.cloudWritesEnabled,false);
  // The transport still reports revision 4, below the reviewed version 5.
  // It MUST fail closed rather than silently discarding fallback changes.
  await rejects(()=>c.reloadAuthoritativeState());
  assert.equal(c.status.cloudWritesEnabled,false);
  authoritativeRevision=5;
  const online=await c.reloadAuthoritativeState();
  assert.equal(online.cloudWritesEnabled,true);
  assert.equal(calls,0);
});
test("reference source never sends HTTP or touches browser state",async()=>{
  const fs=await import("node:fs");
  const src=fs.readFileSync(new URL("../contracts/phase1c_mock_shared_client.mjs",import.meta.url),"utf8");
  for(const bad of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage",
    "supabase.co", "sb_secret_", "Authorization:", "window.", "document.",
    "indexedDB", "setInterval("]) {
    assert.equal(src.includes(bad),false,"no embedded real transport: "+bad);
  }
});
