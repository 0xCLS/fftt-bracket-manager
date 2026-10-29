import test from 'node:test';
import assert from 'node:assert/strict';
import {Milestone1SyntheticCoordinator} from '../contracts/milestone1_synthetic_score_coordinator.mjs';
import {SyntheticC11DecisionLedger} from '../contracts/phase1c_c11_durable_decision_model.mjs';
const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MATCH='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR_A='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTOR_B='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUB_A='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SUB_B='ffffffff-ffff-4fff-8fff-ffffffffffff';
const DIGEST='e'.repeat(64);
const intent=id=>({eventId:EVENT,matchId:MATCH,submissionId:id,
  winnerId:ACTOR_A,bracketGeneration:1,expectedMatchVersion:0,
  tableNumber:1,gameScores:'11-7, 11-8'});
function shared(){
 const ledger=new SyntheticC11DecisionLedger({eventId:EVENT,matchId:MATCH,
   revision:3,generation:1,matchVersion:0});
 let scoreCalls=0,readCalls=0;
 function transport(actor,{role='scorekeeper',delivery='received',malformed=null}={}){
   return {
     assertCurrentRole:async()=>role,
     submitSynthetic:async x=>{
       scoreCalls++;
       const answer=ledger.submit({trustedActorId:actor,eventId:x.eventId,
         matchId:x.matchId,submissionId:x.submissionId,
         payloadFingerprint:DIGEST,expectedMatchVersion:x.expectedMatchVersion,
         delivery});
       if(answer.outcome==='unknown')throw Error('simulated response lost');
       const d=answer.decision;
       return malformed??{submission_id:d.id,status:d.status,match_id:d.match_id,
         match_version:d.match_version,event_revision:d.event_revision,
         generation:d.generation,reason:d.reason};
     },
     readSyntheticSnapshot:async({eventId,submissionId})=>{
       readCalls++;
       const decision=submissionId===null?null:
         ledger.readOwnDecision({trustedActorId:actor,eventId,submissionId});
       return {event_id:eventId,revision:ledger.view.revision,
         generation:ledger.view.generation,lifecycle:'active',
         submission_id:submissionId,
         decision:decision??null};
     },
   };
 }
 return {ledger,transport,calls:()=>scoreCalls,reads:()=>readCalls};
}
function client(transport){return new Milestone1SyntheticCoordinator({
  eventId:EVENT,revision:3,generation:1,transport,
});}
test('two synthetic scorekeepers race: exactly one accepted and one durable stale decision',async()=>{
 const h=shared(),a=client(h.transport(ACTOR_A)),b=client(h.transport(ACTOR_B));
 const [first,second]=await Promise.all([a.submitSynthetic(intent(SUB_A)),b.submitSynthetic(intent(SUB_B))]);
 assert.equal(first.simulationStatus,'accepted');
 assert.equal(second.simulationStatus,'rejected');
 assert.equal(first.claimedPersisted,false);
 assert.equal(second.retryAllowed,false);
 assert.equal(h.ledger.view.revision,4);
 assert.equal(h.ledger.view.matchVersion,1);
 assert.equal(h.ledger.view.receiptCount,2);
 assert.equal(a.status.phase,'cloud-ready');
 assert.equal(b.status.phase,'cloud-reloading');
 assert.equal(b.status.simulationCanSubmit,false);
 await assert.rejects(()=>b.submitSynthetic(intent(SUB_B)));
 assert.equal(h.calls(),2);
});
test('response lost AFTER commit: unknown, no retry, owner-only receipt is not trusted client-side',async()=>{
 const h=shared(),a=client(h.transport(ACTOR_A,{delivery:'lost-after-commit'}));
 const out=await a.submitSynthetic(intent(SUB_A));
 assert.equal(out.simulationStatus,'unknown');
 assert.equal(out.retryAllowed,false);
 assert.equal(h.ledger.view.receiptCount,1);
 assert.equal(a.status.phase,'cloud-paused');
 assert.equal(a.status.hasUnknownOutcome,true);
 await assert.rejects(()=>a.submitSynthetic(intent(SUB_A)));
 a.online();
 assert.equal(a.status.phase,'cloud-reloading');
 const recovery=await a.inspectRecovery();
 assert.equal(recovery.outcome,'accepted');
 assert.equal(recovery.verified,false);
 assert.equal(recovery.canResume,false);
 assert.equal(a.status.simulationCanSubmit,false);
 assert.equal(h.calls(),1);
});
test('delivery lost BEFORE commit: no durable receipt is UNKNOWN, never rejected',async()=>{
 const h=shared(),a=client(h.transport(ACTOR_A,{delivery:'dropped-before-commit'}));
 assert.equal((await a.submitSynthetic(intent(SUB_A))).simulationStatus,'unknown');
 assert.equal(h.ledger.view.receiptCount,0);
 a.online();
 const recovery=await a.inspectRecovery();
 assert.equal(recovery.outcome,'unknown');
 assert.equal(recovery.canResume,false);
});
test('outsider role denied before any synthetic scoring',async()=>{
 const h=shared(),a=client(h.transport(ACTOR_A,{role:null}));
 const out=await a.submitSynthetic(intent(SUB_A));
 assert.equal(out.simulationStatus,'unknown');
 assert.equal(a.status.simulationCanSubmit,false);
 assert.equal(h.calls(),0);
 assert.equal(h.ledger.view.receiptCount,0);
});
test('corrupt or forged terminal HTTP result is uncertain, not a server-approved rejection',async()=>{
 const h=shared(),a=client(h.transport(ACTOR_A,{malformed:{
   submission_id:SUB_B,status:'rejected',match_id:MATCH,match_version:0,
   event_revision:3,generation:1,reason:'stale-match-version',
 }}));
 const out=await a.submitSynthetic(intent(SUB_A));
 assert.equal(out.simulationStatus,'unknown');
 assert.equal(a.status.hasUnknownOutcome,true);
 assert.equal(a.status.simulationCanSubmit,false);
});
test('connection loss before input, stale notice and cross-event attempt prohibit all writes',async()=>{
 const h=shared(),a=client(h.transport(ACTOR_A));
 await assert.rejects(()=>a.submitSynthetic({...intent(SUB_A),eventId:MATCH}));
 assert.equal(h.calls(),0);
 a.offline();
 await assert.rejects(()=>a.submitSynthetic(intent(SUB_A)));
 assert.equal(h.calls(),0);
 a.online();
 assert.equal((await a.inspectRecovery()).canResume,false);
 const b=client(h.transport(ACTOR_B));
 b.notice(EVENT);
 await assert.rejects(()=>b.submitSynthetic(intent(SUB_B)));
});
test('delayed accepted acknowledgement after disconnect never unpauses the client',async()=>{
 let resolveSubmission,submissionCalls=0;
 const t={assertCurrentRole:async()=> 'scorekeeper',
  submitSynthetic:async()=>{submissionCalls++;
   return await new Promise(resolve=>{resolveSubmission=resolve;});},
  readSyntheticSnapshot:async()=>null};
 const a=client(t),task=a.submitSynthetic(intent(SUB_A));
 for(let i=0;i<5&&!resolveSubmission;i++)await Promise.resolve();
 assert.equal(typeof resolveSubmission,'function');
 a.offline();
 resolveSubmission({submission_id:SUB_A,status:'accepted',match_id:MATCH,
    match_version:1,event_revision:4,generation:1,reason:null});
 assert.equal((await task).simulationStatus,'unknown');
 assert.equal(a.status.phase,'cloud-paused');
 assert.equal(a.status.hasUnknownOutcome,true);
 assert.equal(submissionCalls,1);
});
test('strict constructor and intent controls',async()=>{
 assert.throws(()=>client({}));
 const h=shared(),a=client(h.transport(ACTOR_A));
 await assert.rejects(()=>a.submitSynthetic({...intent(SUB_A),tableNumber:0}));
 await assert.rejects(()=>a.submitSynthetic({...intent(SUB_A),submissionId:'bad-id'}));
 assert.equal(h.calls(),0);
});
