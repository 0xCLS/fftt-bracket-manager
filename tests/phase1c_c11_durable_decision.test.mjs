import test from "node:test";
import assert from "node:assert/strict";
import {SyntheticC11DecisionLedger,C11ModelError} from "../contracts/phase1c_c11_durable_decision_model.mjs";
import {decodeC11DecisionWire} from "../contracts/phase1c_c11_decision_wire.mjs";
import {AuthorityGateError} from "../contracts/phase1c_disconnect_reference.mjs";
const EVENT="12345678-1234-4234-9234-123456789abc";
const MATCH="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ID1="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ID2="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DIGEST="a".repeat(64);
const DIGEST2="b".repeat(64);
const ledger=()=>new SyntheticC11DecisionLedger({eventId:EVENT,matchId:MATCH,revision:4,generation:1,matchVersion:0});
const request=(trustedActorId,submissionId,payloadFingerprint=DIGEST,extra={})=>({
 trustedActorId,eventId:EVENT,matchId:MATCH,submissionId,payloadFingerprint,expectedMatchVersion:0,...extra
});
const raw=(decision=null,extra={})=>({
 event_id:EVENT,revision:5,generation:1,lifecycle:"active",submission_id:ID1,decision,...extra
});
const receipt=(status="accepted")=>({
 id:ID1,status,match_id:MATCH,match_version:1,event_revision:5,generation:1,
 reason:status==="accepted"?null:"stale-match-version"
});
function deny(fn){assert.throws(fn,AuthorityGateError);}
function blocked(x){assert.equal(x.cloudWritesEnabled,false);assert.equal(x.retryAllowed,false);assert.equal(x.automaticReplayAllowed,false);assert.equal(x.decisionVerifiedFromServer,false);}
test("one serialized synthetic match race: exactly one accepted, competing stale score is durably rejected",async()=>{
 const l=ledger();
 const [a,b]=await Promise.all([
  Promise.resolve().then(()=>l.submit(request(A,ID1))),
  Promise.resolve().then(()=>l.submit(request(B,ID2,DIGEST2)))
 ]);
 assert.equal(a.outcome,"accepted");
 assert.equal(b.outcome,"rejected");
 assert.equal(b.decision.reason,"stale-match-version");
 assert.equal(l.view.revision,5);
 assert.equal(l.view.matchVersion,1);
 assert.equal(l.view.receiptCount,2);
 assert.equal(l.readOwnDecision({trustedActorId:B,eventId:EVENT,submissionId:ID2}).status,"rejected");
});
test("same actor+request ID and fingerprint repeat reads same terminal decision, never increments version",()=>{
 const l=ledger();const a=l.submit(request(A,ID1));
 const again=l.submit(request(A,ID1));
 assert.deepEqual(again.decision,a.decision);
 assert.equal(l.view.receiptCount,1);
 assert.equal(l.view.revision,5);
 assert.throws(()=>l.submit(request(A,ID1,DIGEST2)),C11ModelError);
});
test("lost acknowledgement after commit remains unknown to client but queryable in synthetic ledger",()=>{
 const l=ledger();const r=l.submit(request(A,ID1,DIGEST,{delivery:"lost-after-commit"}));
 assert.equal(r.outcome,"unknown");assert.equal(r.retryAllowed,false);
 assert.equal(l.view.receiptCount,1);
 assert.equal(l.readOwnDecision({trustedActorId:A,eventId:EVENT,submissionId:ID1}).status,"accepted");
});
test("dropped request before commit has no receipt; absence cannot establish rejection",()=>{
 const l=ledger();const r=l.submit(request(A,ID1,DIGEST,{delivery:"dropped-before-commit"}));
 assert.equal(r.outcome,"unknown");assert.equal(r.retryAllowed,false);
 assert.equal(l.readOwnDecision({trustedActorId:A,eventId:EVENT,submissionId:ID1}),null);
 assert.equal(l.view.receiptCount,0);
});
test("synthetic per-actor receipt isolation and cross-event rejection",()=>{
 const l=ledger();l.submit(request(A,ID1));
 assert.equal(l.readOwnDecision({trustedActorId:B,eventId:EVENT,submissionId:ID1}),null);
 assert.throws(()=>l.readOwnDecision({trustedActorId:A,eventId:B,submissionId:ID1}),C11ModelError);
 assert.throws(()=>l.submit(request(A,ID2,DIGEST,{eventId:B})),C11ModelError);
});
test("invalid fingerprint, ID or precondition never stores receipt",()=>{
 const l=ledger();for(const data of [
 request(A,ID1,"bogus"),request("wrong",ID1),request(A,ID1,DIGEST,{expectedMatchVersion:-1}),
 request(A,ID1,DIGEST,{matchId:B}),request(A,ID1,DIGEST,{delivery:"other"})
 ]) assert.throws(()=>l.submit(data),C11ModelError);
 assert.equal(l.view.receiptCount,0);
});
test("accepted-looking and rejected-looking JSON are still unverified",()=>{
 for(const status of ["accepted","rejected"]) {
  const x=decodeC11DecisionWire(raw(receipt(status)),{eventId:EVENT,requestedSubmissionId:ID1});
  blocked(x);assert.equal(x.status,status);assert.equal(x.unresolved,false);
 }
});
test("missing decision is UNKNOWN, never rejected or safe to retry",()=>{
 const x=decodeC11DecisionWire(raw(),{eventId:EVENT,requestedSubmissionId:ID1});
 blocked(x);assert.equal(x.status,"unknown");assert.equal(x.unresolved,true);
});
test("no submission requested permits only null decision",()=>{
 const empty={...raw(null),submission_id:null};
 const x=decodeC11DecisionWire(empty,{eventId:EVENT});
 blocked(x);
 deny(()=>decodeC11DecisionWire({...empty,decision:receipt()},{eventId:EVENT}));
});
test("rejects forged server proof, private field, foreign actor, mismatched query and invalid reason",()=>{
 const good=raw(receipt());
 for(const response of [
 {...good,verifiedFromServer:true},
 {...good,email:"private"},
 {...good,event_id:B},
 {...good,submission_id:ID2},
 {...good,decision:{...receipt(),actor_id:A}},
 {...good,decision:{...receipt(),id:ID2}},
 {...good,decision:{...receipt(),reason:"stale-match-version"}},
 {...good,decision:{...receipt("rejected"),reason:null}},
 {...good,decision:{...receipt(),status:"pending"}},
 {...good,revision:4},
 {...good,generation:0},
 {...good,lifecycle:"complete"},
 ]) deny(()=>decodeC11DecisionWire(response,{eventId:EVENT,requestedSubmissionId:ID1}));
});
test("future/gapped/unsafe revisions and corrupted decision data fail closed",()=>{
 const good=raw(receipt());
 for(const response of [
 {...good,revision:-1},{...good,revision:2**60},
 {...good,decision:{...receipt(),match_version:-1}},
 {...good,decision:{...receipt(),event_revision:6}},
 {...good,decision:{...receipt(),generation:2}},
 {...good,decision:{...receipt(),match_id:"bad"}},
 ])deny(()=>decodeC11DecisionWire(response,{eventId:EVENT,requestedSubmissionId:ID1}));
});
test("C11 contracts contain no hosted network, browser storage, score RPC or secrets",async()=>{
 const fs=await import("node:fs");
 for(const path of ["phase1c_c11_durable_decision_model.mjs","phase1c_c11_decision_wire.mjs"]) {
  const src=fs.readFileSync(new URL("../contracts/"+path,import.meta.url),"utf8");
  for(const term of ["fetch(","XMLHttpRequest","localStorage","sessionStorage","indexedDB","supabase.co","service_role","sb_secret_","fftt_submit_match_result_v1","document.","window."]){
   assert.equal(src.includes(term),false,path+" contains prohibited operation "+term);
  }
 }
});
