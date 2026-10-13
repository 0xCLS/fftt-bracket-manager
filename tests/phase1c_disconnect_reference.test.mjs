import test from "node:test";
import assert from "node:assert/strict";

import {
  PHASE, AuthorityGateError,
  initialCloudState, canSendCloudIntent, beginCloudIntent,
  acknowledgeCloudIntent, connectivityLost, connectivityRestored,
  revisionNotice, verifiedServerSnapshot,
  beginSingleDeviceFallback, logIsolatedFallbackEdit,
  organizerReconciled,
} from "../contracts/phase1c_disconnect_reference.mjs";

const EVT = "12345678-1234-4234-9234-123456789abc";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB = "9f5521ee-83ac-4aab-aef6-d46773094cdc";
const fresh = () => initialCloudState({eventId:EVT,revision:4,generation:1});
const write = s => beginCloudIntent(s,{eventId:EVT,submissionId:SUB});
const lose = () => connectivityLost(fresh());
const backup = s => beginSingleDeviceFallback(s,{
  eventId:EVT,backupRevision:4,backupGeneration:1,
  organizerApproved:true,otherDevicesStopped:true,
  backupProtected:true,manualLogReady:true,
});
const reconcile = s => organizerReconciled(s,{
  eventId:EVT,organizerApproved:true,privateBackupReviewed:true,
  manualLogReviewed:true,allFallbackEditsReconciled:true,
  unresolvedCloudRequestChecked:true,serverRevision:5,serverGeneration:1,
});
function denied(call) {
  assert.throws(call, AuthorityGateError);
}

test("initial ready state is revisioned, cloud-only and never contains participant data",()=>{
  const s=fresh();
  assert.equal(s.phase,PHASE.READY);
  assert.ok(canSendCloudIntent(s));
  assert.deepEqual(Object.keys(s).filter(k=>/email|phone|rating|password|token/.test(k)),[]);
  assert.equal(s.revision,4);
});
test("reject invalid metadata including stale or fabricated event identities",()=>{
  denied(()=>initialCloudState({eventId:"a",revision:4,generation:1}));
  denied(()=>initialCloudState({eventId:EVT,revision:-1,generation:1}));
  denied(()=>initialCloudState({eventId:EVT,revision:4,generation:0.2}));
});
test("source state remains immutable through transitions",()=>{
  const initial=fresh();
  const s=write(initial);
  assert.notEqual(s, initial);
  assert.equal(initial.cloudRequest,null);
  assert.ok(Object.isFrozen(initial));
  assert.ok(Object.isFrozen(s));
});
test("cloud accepts ONE in-flight intent and never queues a second",()=>{
  const s=write(fresh());
  assert.equal(s.cloudRequest,SUB);
  assert.equal(canSendCloudIntent(s),false);
  denied(()=>beginCloudIntent(s,{eventId:EVT,submissionId:"75e92f6b-f84e-439f-9a90-e8c2a71afef2"}));
});
test("server accepted response advances authoritative revision; no optimistic claim",()=>{
  const outstanding=write(fresh());
  assert.equal(outstanding.revision,4);
  const acknowledged=acknowledgeCloudIntent(outstanding,{
    eventId:EVT,submissionId:SUB,result:"accepted",revision:5,generation:1,
  });
  assert.equal(acknowledged.revision,5);
  assert.equal(acknowledged.lastAcknowledgedRequest,SUB);
  assert.ok(canSendCloudIntent(acknowledged));
  denied(()=>beginCloudIntent(acknowledged,{eventId:EVT,submissionId:SUB}));
});
test("cannot claim save for unacknowledged, wrong or same-revision server outcome",()=>{
  const outstanding=write(fresh());
  const common={eventId:EVT,submissionId:SUB,result:"accepted",revision:5,generation:1};
  denied(()=>acknowledgeCloudIntent(fresh(),common));
  denied(()=>acknowledgeCloudIntent(outstanding,{...common,submissionId:"wrong"}));
  denied(()=>acknowledgeCloudIntent(outstanding,{...common,revision:4}));
  denied(()=>acknowledgeCloudIntent(outstanding,{...common,revision:5,generation:0}));
});
test("server rejection requires fresh snapshot and never presents saved",()=>{
  const s=acknowledgeCloudIntent(write(fresh()),{
    eventId:EVT,submissionId:SUB,result:"rejected",
  });
  assert.equal(s.phase,PHASE.RELOADING);
  assert.equal(canSendCloudIntent(s),false);
  const read=verifiedServerSnapshot(s,{eventId:EVT,revision:4,generation:1});
  assert.equal(read.phase,PHASE.READY);
});
test("network loss pauses writes and retains uncertain receipt identity",()=>{
  const s=connectivityLost(write(fresh()));
  assert.equal(s.phase,PHASE.PAUSED);
  assert.equal(s.unresolvedCloudRequest,SUB);
  assert.equal(s.cloudRequest,null);
  assert.equal(s.stale,true);
  assert.equal(canSendCloudIntent(s),false);
  denied(()=>beginCloudIntent(s,{eventId:EVT,submissionId:"e3e1da91-1fab-4cbb-9918-fc1014141477"}));
});
test("connectivity restoration alone never reopens scoring",()=>{
  const restored=connectivityRestored(lose());
  assert.equal(restored.phase,PHASE.RELOADING);
  assert.equal(restored.stale,true);
  assert.equal(canSendCloudIntent(restored),false);
  const good=verifiedServerSnapshot(restored,{eventId:EVT,revision:4,generation:1});
  assert.ok(canSendCloudIntent(good));
});
test("in-flight unknown result blocks reload until server resolves same request",()=>{
  const restored=connectivityRestored(connectivityLost(write(fresh())));
  denied(()=>verifiedServerSnapshot(restored,{eventId:EVT,revision:5,generation:1}));
  denied(()=>verifiedServerSnapshot(restored,{
    eventId:EVT,revision:5,generation:1,
    resolvedSubmission:{id:"other",status:"accepted",verifiedFromServer:true},
  }));
  const safe=verifiedServerSnapshot(restored,{
    eventId:EVT,revision:5,generation:1,
    resolvedSubmission:{id:SUB,status:"accepted",verifiedFromServer:true},
  });
  assert.ok(canSendCloudIntent(safe));
});
test("wrong event or regressed revision/generation never allows reload",()=>{
  const recovering=connectivityRestored(lose());
  denied(()=>verifiedServerSnapshot(recovering,{eventId:OTHER,revision:4,generation:1}));
  denied(()=>verifiedServerSnapshot(recovering,{eventId:EVT,revision:3,generation:1}));
  denied(()=>verifiedServerSnapshot(recovering,{eventId:EVT,revision:4,generation:0}));
});
test("realtime notice is not authoritative snapshot and forces reload",()=>{
  const s=revisionNotice(fresh(),EVT);
  assert.equal(s.phase,PHASE.RELOADING);
  assert.equal(canSendCloudIntent(s),false);
  denied(()=>revisionNotice(fresh(),OTHER));
});
test("no fallback in healthy cloud or before complete organizer safeguards",()=>{
  denied(()=>backup(fresh()));
  const paused=lose();
  for(const missing of ["organizerApproved","otherDevicesStopped","backupProtected","manualLogReady"]){
    const opts={eventId:EVT,backupRevision:4,backupGeneration:1,
      organizerApproved:true,otherDevicesStopped:true,backupProtected:true,
      manualLogReady:true};
    opts[missing]=false;
    denied(()=>beginSingleDeviceFallback(paused,opts));
  }
  denied(()=>beginSingleDeviceFallback(paused,{
    eventId:EVT,backupRevision:3,backupGeneration:1,organizerApproved:true,
    otherDevicesStopped:true,backupProtected:true,manualLogReady:true,
  }));
});
test("isolated fallback cannot become a cloud write queue",()=>{
  const s=backup(lose());
  assert.equal(s.authority,"isolated-single-device");
  assert.equal(canSendCloudIntent(s),false);
  denied(()=>beginCloudIntent(s,{eventId:EVT,submissionId:SUB}));
  denied(()=>logIsolatedFallbackEdit(s,{eventId:EVT,writtenToPrivateLog:false}));
  const edited=logIsolatedFallbackEdit(s,{eventId:EVT,writtenToPrivateLog:true});
  assert.equal(edited.fallbackEdits,1);
  assert.equal(edited.cloudRequest,null);
});
test("ambiguous score at outage requires organizer incident acknowledgement",()=>{
  const lost=connectivityLost(write(fresh()));
  denied(()=>backup(lost));
  const allowed=beginSingleDeviceFallback(lost,{
    eventId:EVT,backupRevision:4,backupGeneration:1,
    organizerApproved:true,otherDevicesStopped:true,backupProtected:true,
    manualLogReady:true,unresolvedOutcomeDocumented:true,
  });
  assert.equal(allowed.unresolvedCloudRequest,SUB);
});
test("connectivity restoration while fallback never merges local results automatically",()=>{
  let s=backup(lose());
  s=logIsolatedFallbackEdit(s,{eventId:EVT,writtenToPrivateLog:true});
  s=connectivityRestored(s);
  assert.equal(s.phase,PHASE.RECONCILING);
  assert.equal(s.fallbackEdits,1);
  assert.equal(canSendCloudIntent(s),false);
  denied(()=>verifiedServerSnapshot(s,{eventId:EVT,revision:5,generation:1}));
});
test("organizer reconciliation requires complete private record and manual review",()=>{
  const s=connectivityRestored(backup(lose()));
  const args={eventId:EVT,organizerApproved:true,
    privateBackupReviewed:true,manualLogReviewed:true,
    allFallbackEditsReconciled:true,unresolvedCloudRequestChecked:true,
    serverRevision:5,serverGeneration:1};
  for(const missing of ["organizerApproved","privateBackupReviewed",
    "manualLogReviewed","allFallbackEditsReconciled"]){
    denied(()=>organizerReconciled(s,{...args,[missing]:false}));
  }
  denied(()=>organizerReconciled(s,{...args,serverRevision:3}));
  const reviewed=organizerReconciled(s,args);
  assert.equal(reviewed.phase,PHASE.RELOADING);
  assert.equal(canSendCloudIntent(reviewed),false);
  const live=verifiedServerSnapshot(reviewed,{eventId:EVT,revision:5,generation:1});
  assert.equal(live.phase,PHASE.READY);
});
test("ambiguous in-flight score must be manually resolved before fallback cloud return",()=>{
  const unclear=connectivityLost(write(fresh()));
  const fallback=beginSingleDeviceFallback(unclear,{
    eventId:EVT,backupRevision:4,backupGeneration:1,
    organizerApproved:true,otherDevicesStopped:true,
    backupProtected:true,manualLogReady:true,
    unresolvedOutcomeDocumented:true,
  });
  const reconnected=connectivityRestored(fallback);
  const opts={eventId:EVT,organizerApproved:true,
    privateBackupReviewed:true,manualLogReviewed:true,
    allFallbackEditsReconciled:true,serverRevision:5,serverGeneration:1};
  denied(()=>organizerReconciled(reconnected,opts));
  const checked=organizerReconciled(reconnected,{
    ...opts,unresolvedCloudRequestChecked:true,
  });
  assert.equal(checked.phase,PHASE.RELOADING);
  assert.equal(checked.unresolvedCloudRequest,null);
});
test("no forbidden network, storage or implicit replay API in reference module",async()=>{
  const fs=await import("node:fs");
  const src=fs.readFileSync(new URL("../contracts/phase1c_disconnect_reference.mjs", import.meta.url),"utf8");
  for(const bad of ["fetch(", "localStorage", "XMLHttpRequest", "setTimeout(", "navigator.", "indexedDB", "sb_secret_", "import("]){
    assert.equal(src.includes(bad),false, "forbidden reference behavior: "+bad);
  }
});
