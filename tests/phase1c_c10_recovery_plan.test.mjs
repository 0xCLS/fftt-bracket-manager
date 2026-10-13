import test from "node:test";
import assert from "node:assert/strict";
import {
  PHASE, initialCloudState, beginCloudIntent,
  connectivityLost, connectivityRestored,
  verifiedServerSnapshot, beginSingleDeviceFallback, AuthorityGateError,
} from "../contracts/phase1c_disconnect_reference.mjs";
import {decodeC5SnapshotWire,c1ReadOnlyEnvelope} from "../contracts/phase1c_c5_snapshot_wire.mjs";
import {
  C10_DECISION,assessC10Recovery,previewC10SingleDeviceFallback
} from "../contracts/phase1c_c10_recovery_plan.mjs";

const EVENT="12345678-1234-4234-9234-123456789abc";
const OTHER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MATCH="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fresh=()=>initialCloudState({eventId:EVENT,revision:3,generation:1});
const unknown=()=>connectivityRestored(connectivityLost(
  beginCloudIntent(fresh(),{eventId:EVENT,submissionId:SUB})));
const unambiguous=()=>connectivityRestored(connectivityLost(fresh()));
const wire=(receipt=null)=>({
  event_id:EVENT,revision:4,generation:1,lifecycle:"active",
  resolved_submission:receipt,
});
const receipt=()=>({
  id:SUB,status:"accepted",match_id:MATCH,match_version:1,event_revision:4,generation:1,
});
const snapshotCode=(state,payload)=>assessC10Recovery(state,payload);
const blocked=decision=>{
  assert.equal(decision.cloudWritesEnabled,false);
  assert.equal(decision.retryAllowed,false);
  assert.equal(decision.automaticReplayAllowed,false);
  assert.equal(decision.snapshotVerified,false);
  assert.equal("eventId" in decision,false);
  assert.equal("submissionId" in decision,false);
};
test("offline connection loss and restoration alone cannot enable writes",()=>{
 const paused=connectivityLost(fresh());
 const a=snapshotCode(paused,wire());blocked(a);assert.equal(a.code,C10_DECISION.OFFLINE);
 const b=snapshotCode(connectivityRestored(paused));blocked(b);
 assert.equal(b.code,C10_DECISION.WAIT_FOR_SNAPSHOT);
});
test("valid-looking event revision remains unverified client data",()=>{
 const state=unambiguous(),decision=snapshotCode(state,wire());
 blocked(decision);assert.equal(decision.code,C10_DECISION.UNVERIFIED_REVISION);
 assert.equal(state.phase,PHASE.RELOADING);
});
test("missing receipt never means rejected, even if event revision advanced",()=>{
 const d=snapshotCode(unknown(),wire());
 blocked(d);assert.equal(d.code,C10_DECISION.UNKNOWN_SUBMISSION);
 assert.equal(d.manualReviewRequired,true);
});
test("accepted receipt has no server provenance and does not unlock cloud",()=>{
 const state=unknown(),payload=wire(receipt());
 const d=snapshotCode(state,payload);
 blocked(d);assert.equal(d.code,C10_DECISION.UNVERIFIED_ACCEPTANCE);
 const decoded=decodeC5SnapshotWire(payload,{eventId:EVENT,requestedSubmissionId:SUB});
 assert.equal(decoded.resolvedSubmission.verifiedFromServer,false);
 assert.throws(()=>verifiedServerSnapshot(state,c1ReadOnlyEnvelope(decoded)),AuthorityGateError);
});
test("mismatched event, bad versions, forged receipt and private fields fail closed",()=>{
 const cases=[
  {...wire(),event_id:OTHER},
  {...wire(),revision:2},
  {...wire(),generation:0},
  {...wire(),email:"not allowed"},
  wire({...receipt(),status:"rejected"}),
  wire({...receipt(),verifiedFromServer:true}),
  wire({...receipt(),id:OTHER}),
 ];
 for(const payload of cases) {
  const d=snapshotCode(unknown(),payload);blocked(d);
  assert.equal(d.code,C10_DECISION.INVALID_SNAPSHOT);
 }
});
test("completed/draft lifecycle cannot imply score-resume permission",()=>{
 for(const lifecycle of ["draft","complete","archived"]) {
  const d=snapshotCode(unambiguous(),{...wire(),lifecycle});blocked(d);
  assert.equal(d.code,C10_DECISION.INVALID_SNAPSHOT);
 }
});
test("safe decisions never copy an arbitrary private value",()=>{
 const state=unknown(),payload={...wire(),private_email:"unique.private@example.invalid"};
 const output=JSON.stringify(snapshotCode(state,payload));
 assert.equal(output.includes("unique.private"),false);
 assert.equal(output.includes(EVENT),false);
 assert.equal(output.includes(SUB),false);
});
test("active-ready state is not a recovery instruction",()=>{
 const d=snapshotCode(fresh(),wire(receipt()));blocked(d);
 assert.equal(d.code,C10_DECISION.NOT_RECOVERING);
});
test("fallback and reconciliation always require organizer review",()=>{
 let paused=connectivityLost(fresh());
 const flags={eventId:EVENT,backupRevision:3,backupGeneration:1,
  organizerApproved:true,otherDevicesStopped:true,backupProtected:true,manualLogReady:true};
 assert.equal(previewC10SingleDeviceFallback(paused,{...flags,otherDevicesStopped:false}).procedureChecklistSatisfied,false);
 assert.equal(previewC10SingleDeviceFallback(paused,flags).procedureChecklistSatisfied,true);
 const fallback=beginSingleDeviceFallback(paused,flags);
 const f=snapshotCode(fallback,wire());blocked(f);
 assert.equal(f.code,C10_DECISION.MANUAL_RECONCILIATION);
 const reconnect=connectivityRestored(fallback);
 const r=snapshotCode(reconnect,wire());blocked(r);
 assert.equal(r.code,C10_DECISION.MANUAL_RECONCILIATION);
});
test("uncertain in-flight score needs explicit manual incident documentation for fallback",()=>{
 const paused=connectivityLost(beginCloudIntent(fresh(),{eventId:EVENT,submissionId:SUB}));
 const flags={eventId:EVENT,backupRevision:3,backupGeneration:1,organizerApproved:true,
  otherDevicesStopped:true,backupProtected:true,manualLogReady:true};
 assert.equal(previewC10SingleDeviceFallback(paused,flags).procedureChecklistSatisfied,false);
 assert.equal(previewC10SingleDeviceFallback(paused,{...flags,unresolvedOutcomeDocumented:true}).procedureChecklistSatisfied,true);
});
test("status planner has no browser, Supabase API, score mutation or storage operation",async()=>{
 const fs=await import("node:fs");
 const src=fs.readFileSync(new URL("../contracts/phase1c_c10_recovery_plan.mjs",import.meta.url),"utf8");
 for(const term of ["fetch(","XMLHttpRequest","localStorage","sessionStorage","navigator.","document.","window.","supabase.co","sb_secret_","submitScore","setTimeout(","indexedDB"]){
  assert.equal(src.includes(term),false,"Forbidden operation found: "+term);
 }
});
