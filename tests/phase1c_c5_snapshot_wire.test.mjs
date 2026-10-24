import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeC5SnapshotWire,c1ReadOnlyEnvelope
} from "../contracts/phase1c_c5_snapshot_wire.mjs";
import {
  initialCloudState, connectivityLost, connectivityRestored,
  beginCloudIntent, verifiedServerSnapshot, AuthorityGateError, PHASE
} from "../contracts/phase1c_disconnect_reference.mjs";

const EVENT="12345678-1234-4234-9234-123456789abc";
const OTHER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATCH="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUB="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const plain=()=>({
  event_id:EVENT,revision:4,generation:1,lifecycle:"active",
  resolved_submission:null
});
const withReceipt=()=>({
  ...plain(),
  resolved_submission:{
    id:SUB,status:"accepted",match_id:MATCH,match_version:1,
    event_revision:4,generation:1,
  }
});
const read=(raw=plain(),requestedSubmissionId=null)=>
  decodeC5SnapshotWire(raw,{eventId:EVENT,requestedSubmissionId});
function blocked(callback){assert.throws(callback,AuthorityGateError);}
function pausedPending(){
  const initial=initialCloudState({eventId:EVENT,revision:3,generation:1});
  const sent=beginCloudIntent(initial,{eventId:EVENT,submissionId:SUB});
  return connectivityRestored(connectivityLost(sent));
}

test("normal C5 event snapshot decodes exact revision/generation and no receipt",()=>{
  const out=read();
  assert.equal(out.eventId,EVENT);
  assert.equal(out.revision,4);
  assert.equal(out.generation,1);
  assert.equal(out.resolvedSubmission,null);
  assert.equal(out.pendingUnresolved,false);
  assert.ok(Object.isFrozen(out));
});
test("accepted owned receipt decodes safely without claiming server provenance",()=>{
  const out=read(withReceipt(),SUB);
  assert.equal(out.resolvedSubmission.id,SUB);
  assert.equal(out.resolvedSubmission.status,"accepted");
  assert.equal(out.resolvedSubmission.matchId,MATCH);
  assert.equal(out.resolvedSubmission.verifiedFromServer,false);
  assert.equal(out.resolvedSubmission.eventRevision,4);
  assert.ok(Object.isFrozen(out.resolvedSubmission));
});
test("no receipt for a pending submission stays unresolved, not rejected",()=>{
  const out=read(plain(),SUB);
  assert.equal(out.pendingUnresolved,true);
  assert.equal(out.resolvedSubmission,null);
  assert.equal("rejected" in out,false);
});
test("client cannot treat missing signed receipt as resolved in C1",()=>{
  const snapshot=read(plain(),SUB);
  const pending=pausedPending();
  blocked(()=>verifiedServerSnapshot(pending,c1ReadOnlyEnvelope(snapshot)));
  assert.equal(pending.phase,PHASE.RELOADING);
});
test("even a well-shaped accepted JSON cannot spoof a verified server receipt",()=>{
  const snapshot=read(withReceipt(),SUB);
  blocked(()=>verifiedServerSnapshot(pausedPending(),c1ReadOnlyEnvelope(snapshot)));
  assert.equal(snapshot.resolvedSubmission.verifiedFromServer,false);
});
test("user cannot pass an arbitrary request id or cross-event query",()=>{
  blocked(()=>decodeC5SnapshotWire(plain(),{eventId:"not-a-uuid"}));
  blocked(()=>decodeC5SnapshotWire(plain(),{eventId:OTHER}));
  blocked(()=>decodeC5SnapshotWire(plain(),{eventId:EVENT,requestedSubmissionId:"no"}));
});
test("unknown/private event keys fail closed",()=>{
  for(const field of ["email","private_staff","game_scores","contact_number","audit","score"]){
    blocked(()=>read({...plain(),[field]:"SECRET"}));
  }
});
test("missing essential event fields fail closed",()=>{
  for(const field of ["event_id","revision","generation","lifecycle","resolved_submission"]){
    const s=plain();delete s[field];
    blocked(()=>read(s));
  }
});
test("server event object must be an ordinary object, not array/null/string",()=>{
  for(const value of [null,[],1,"json",true,new Date()])blocked(()=>read(value));
});
test("refuse malformed revisions and generations including booleans",()=>{
  for(const value of [-1,1.2,NaN,Infinity,true,"4",2**60]){
    blocked(()=>read({...plain(),revision:value}));
    blocked(()=>read({...plain(),generation:value}));
  }
});
test("draft, complete and archived do not authorize scoring reconnect",()=>{
  for(const lifecycle of ["draft","complete","archived","unexpected",null]){
    blocked(()=>read({...plain(),lifecycle}));
  }
});
test("only correctly requested receipt may be decoded",()=>{
  blocked(()=>read(withReceipt())); // not requested
  blocked(()=>read(withReceipt(),OTHER));
  blocked(()=>read({...withReceipt(),resolved_submission:{...withReceipt().resolved_submission,id:OTHER}},SUB));
});
test("receipt can never impersonate another match's identity",()=>{
  const s=withReceipt();
  s.resolved_submission.match_id="not-a-uuid";
  blocked(()=>read(s,SUB));
});
test("receipt outcome rejected, unknown, failed or null must never be inferred",()=>{
  for(const status of ["rejected","unknown","failed",null,""]){
    const s=withReceipt();s.resolved_submission.status=status;
    blocked(()=>read(s,SUB));
  }
});
test("extra receipt metadata or missing core fields are prohibited",()=>{
  for(const field of ["actor_id","email","winner_id","game_scores","request_fingerprint"]){
    const s=withReceipt();s.resolved_submission[field]="SECRET";
    blocked(()=>read(s,SUB));
  }
  for(const field of ["id","status","match_id","match_version","event_revision","generation"]){
    const s=withReceipt();delete s.resolved_submission[field];
    blocked(()=>read(s,SUB));
  }
});
test("receipt versions cannot exceed server state or be unsafe",()=>{
  for(const [field,value] of [
    ["match_version",true],["match_version",-1],["generation",2],
    ["event_revision",5],["event_revision",-1],["event_revision",2**60],
  ]){
    const s=withReceipt();s.resolved_submission[field]=value;
    blocked(()=>read(s,SUB));
  }
});
test("oversized event sequence numbers fail closed rather than precision truncation",()=>{
  blocked(()=>read({...plain(),revision:BigInt(2**63)}));
});
test("decoded envelope retains only safe fields and never changes phase by itself",()=>{
  const r=read(withReceipt(),SUB);
  assert.deepEqual(Object.keys(c1ReadOnlyEnvelope(r)),
    ["eventId","revision","generation","resolvedSubmission"]);
  assert.equal(r.resolvedSubmission.verifiedFromServer,false);
});
test("client-supplied extra verifiedFromServer:true field is rejected",()=>{
  const r=withReceipt();
  r.resolved_submission.verifiedFromServer=true;
  blocked(()=>read(r,SUB));
});
test("receipt with mismatched UUID case is denied (exact requested string)",()=>{
  const s=withReceipt();
  s.resolved_submission.id=SUB.toUpperCase();
  blocked(()=>read(s,SUB));
});
test("decoder source has no network/secret, storage or write endpoints",async()=>{
  const fs=await import("node:fs");
  const src=fs.readFileSync(new URL("../contracts/phase1c_c5_snapshot_wire.mjs",import.meta.url),"utf8");
  for(const key of ["fetch(", "XMLHttpRequest", "localStorage","sessionStorage",
    "indexedDB","service_role","sb_secret_","Authorization:",
    "fftt_submit_match_result_v1","window.","document.","setInterval("]){
    assert.ok(!src.includes(key),"No executable network/storage operation: "+key);
  }
});
