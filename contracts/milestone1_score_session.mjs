/**
 * Milestone 1 synthetic-only signed browser scoring workflow.
 * It is a full provider-neutral client lifecycle over an EXPLICITLY injected
 * disposable/local test transport, NOT the hosted FFTT3 client.
 *
 * A score is never retried, queued or silently confirmed. POST 200 is still
 * provisional; ONLY a separate authenticated own-decision snapshot can
 * establish the test result. Missing receipt = UNKNOWN, not rejected.
 * Any ambiguous write forces manual review; reconnect alone never resumes.
 * Private incident ID must be recorded by the tester before sending.
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
import {validateLocalScoreIntent} from './milestone1_signed_local_score_transport.mjs';
import {previewC10SingleDeviceFallback} from './phase1c_c10_recovery_plan.mjs';
import {PHASE} from './phase1c_disconnect_reference.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const fail=s=>{throw new AuthorityGateError(s);};
const roles=['organizer','scorekeeper'];
const blank=(status='signed-out')=>Object.freeze({
  status,role:null,revision:null,generation:null,matches:Object.freeze([]),
  pendingSubmissionId:null,decision:null,scoreReady:false,
  noAutomaticRetry:true,productionAuthorized:false,
});
const validRow=(r,eventId,generation)=>{
 if(!r||typeof r!=='object'||Array.isArray(r)
   ||r.event_id!==eventId||r.bracket_generation!==generation
   ||typeof r.match_id!=='string'||!UUID.test(r.match_id)
   ||!nonnegative(r.match_version)||!UUID.test(r.player_1_id||'')
   ||!UUID.test(r.player_2_id||'')||r.player_1_id===r.player_2_id
   ||typeof r.player_1_name!=='string'||r.player_1_name.length>160
   ||typeof r.player_2_name!=='string'||r.player_2_name.length>160
   ||typeof r.match_code!=='string'||r.match_code.length>80)
   fail('Invalid private fixture match');
 return Object.freeze({matchId:r.match_id,matchVersion:r.match_version,
   code:r.match_code,players:Object.freeze([
    Object.freeze({id:r.player_1_id,name:r.player_1_name}),
    Object.freeze({id:r.player_2_id,name:r.player_2_name}),
   ])});
};
const safeStatus=(status,fields={})=>Object.freeze({
 ...blank(status),...fields,scoreReady:status==='ready',
 noAutomaticRetry:true,productionAuthorized:false,
});
export function createMilestone1ScoreSession({
  eventId,readRole,readMatchdesk,readOwnSnapshot,sendScore,
  getSubmissionId,isAuthenticated,allowDisposableLocalSimulation=false,
  allowApprovedHostedSyntheticFixture=false
}={}){
 if(typeof eventId!=='string'||!UUID.test(eventId)
   ||[readRole,readMatchdesk,readOwnSnapshot,sendScore,getSubmissionId,isAuthenticated]
      .some(x=>typeof x!=='function'))fail('Invalid explicit synthetic score session');
 let view=blank(),epoch=0,pending=null,prepared=null,ack=null,busy=false,disposed=false;
 let lastVerified=null;
 const syntheticWriteGate=allowDisposableLocalSimulation===true||allowApprovedHostedSyntheticFixture===true;
 const alive=stamp=>!disposed&&stamp===epoch&&isAuthenticated();
 const lock=(status='paused')=>{
   epoch++;prepared=null;
   const hasUnknown=pending!==null;
   view=safeStatus(hasUnknown?'unknown':status,{
     pendingSubmissionId:pending?.submissionId??null,
     revision:lastVerified?.revision??null,generation:lastVerified?.generation??null,
     decision:null,
   });
   busy=false;
   return view;
 };
 const requireReady=()=>{if(disposed||!isAuthenticated()||!syntheticWriteGate
   ||view.status!=='ready'||pending!==null||busy)
   fail('Score write unavailable; synthetic local gate and fresh role required');};
 async function load(){
   if(disposed||busy||pending||prepared)fail('Cannot refresh with unresolved or prepared score');
   if(!isAuthenticated()){lock('signed-out');return view;}
   const stamp=++epoch;busy=true;view=blank('loading');
   try {
     const role=await readRole({eventId});
     if(!alive(stamp))return view;
     if(!roles.includes(role))fail('No signed event staff role');
     const s1=await readOwnSnapshot({eventId,submissionId:null});
     if(!alive(stamp))return view;
     if(s1.eventId!==eventId||s1.lifecycle!=='active'
       ||!nonnegative(s1.revision)||!nonnegative(s1.generation)
       ||s1.decision!==null)fail('Invalid event snapshot');
     const raw=await readMatchdesk({eventId});
     if(!alive(stamp))return view;
     if(!Array.isArray(raw)||raw.length>256)fail('Invalid pending Match Desk');
     const matches=Object.freeze(raw.map(r=>validRow(r,eventId,s1.generation)));
     const s2=await readOwnSnapshot({eventId,submissionId:null});
     if(!alive(stamp))return view;
     if(s2.eventId!==eventId||s2.revision!==s1.revision
       ||s2.generation!==s1.generation||s2.lifecycle!=='active'
       ||s2.decision!==null)fail('Event changed during role and Match Desk read');
     lastVerified=Object.freeze({revision:s2.revision,generation:s2.generation});
     view=safeStatus(syntheticWriteGate?'ready':'read-only',{
       role,revision:s2.revision,generation:s2.generation,matches});
     return view;
   }catch{
     if(alive(stamp))view=blank('denied');
     return view;
   }finally{if(stamp===epoch)busy=false;}
 }
 function prepareScore({matchId,winnerId,gameScores,tableNumber=1}={}){
   requireReady();
   if(prepared!==null)fail('Discard previous private prepared intent first');
   const row=view.matches.find(m=>m.matchId===matchId);
   if(!row||!row.players.some(p=>p.id===winnerId))
     fail('Winner must be assigned to a fresh pending fictional match');
   const intent=validateLocalScoreIntent({
      eventId,matchId,submissionId:getSubmissionId(),winnerId,gameScores,tableNumber,
      bracketGeneration:view.generation,expectedMatchVersion:row.matchVersion,
   });
   prepared=intent;
   view=safeStatus('prepared',{role:view.role,revision:view.revision,
      generation:view.generation,matches:view.matches,
      pendingSubmissionId:intent.submissionId});
   return Object.freeze({submissionId:intent.submissionId,matchId:intent.matchId,
      summary:'FICTIONAL LOCAL TEST ONLY: record this private ID before POST',
      mayTransmit:false});
 }
 function discardPrepared(){
   if(!prepared||pending)fail('Nothing safe to discard');
   prepared=null;
   return lock('needs-refresh'); // a new signed Match Desk is needed
 }
 async function submitPrepared({submissionId,manualIncidentLogConfirmed=false}={}){
   if(disposed||busy||!isAuthenticated()||!syntheticWriteGate
     ||view.status!=='prepared'||prepared===null||pending!==null
     ||prepared.submissionId!==submissionId)fail('No authorized prepared local score');
   if(manualIncidentLogConfirmed!==true)
     fail('Record the exact private ID and scores before allowing irreversible POST');
   const intent=prepared;prepared=null;
   pending=Object.freeze({submissionId:intent.submissionId,matchId:intent.matchId,
     baseRevision:lastVerified.revision,generation:intent.bracketGeneration,
     expectedMatchVersion:intent.expectedMatchVersion});
   ack=null;
   const stamp=++epoch;busy=true;
   view=safeStatus('sending',{role:view.role,revision:lastVerified.revision,
      generation:lastVerified.generation,pendingSubmissionId:submissionId});
   try{
     const receipt=await sendScore(intent);
     if(!alive(stamp))return view;
     if(receipt?.status!=='accepted'&&receipt?.status!=='rejected')
       fail('Unknown score decision');
     if(!nonnegative(receipt.revision)||receipt.revision<pending.baseRevision
       ||receipt.generation!==pending.generation
       ||(receipt.status==='accepted'&&receipt.revision<=pending.baseRevision))
       fail('Invalid score acknowledgement');
     ack=Object.freeze({status:receipt.status,revision:receipt.revision});
     view=safeStatus('needs-own-receipt',{
       pendingSubmissionId:submissionId,revision:pending.baseRevision,
       generation:pending.generation,
     });
     return view;
   }catch {
     if(alive(stamp))
       view=safeStatus('unknown',{pendingSubmissionId:submissionId,
         revision:pending.baseRevision,generation:pending.generation});
     return view;
   }finally{if(stamp===epoch)busy=false;}
 }
 async function inspectOwnDecision(){
   if(!pending||disposed||busy)fail('No isolated pending test decision to inspect');
   if(!isAuthenticated()){return lock('signed-out');}
   const stamp=++epoch;busy=true;
   view=safeStatus('checking-receipt',{pendingSubmissionId:pending.submissionId});
   try{
     const role=await readRole({eventId});
     if(!alive(stamp))return view;
     if(!roles.includes(role))fail('Role revoked');
     const s=await readOwnSnapshot({eventId,submissionId:pending.submissionId});
     if(!alive(stamp))return view;
     const d=s?.decision;
     if(s.eventId!==eventId||s.lifecycle!=='active'
       ||!nonnegative(s.revision)||s.revision<pending.baseRevision
       ||s.generation!==pending.generation||d===null||d===undefined
       ||d.id!==pending.submissionId||d.matchId!==pending.matchId
       ||d.generation!==pending.generation||d.eventRevision>s.revision
       ||!nonnegative(d.matchVersion)
       ||!['accepted','rejected'].includes(d.status)
       ||(d.status==='accepted'?d.reason!==null
         ||d.eventRevision<=pending.baseRevision
         ||d.matchVersion<=pending.expectedMatchVersion:
         d.reason!=='stale-match-version')
       ||(ack!==null&&(ack.status!==d.status||ack.revision!==d.eventRevision)))
       fail('Receipt absent, denied, foreign, stale or contradictory');
     lastVerified=Object.freeze({revision:s.revision,generation:s.generation});
     view=safeStatus('confirmed-'+d.status,{
       pendingSubmissionId:pending.submissionId,
       revision:s.revision,generation:s.generation,decision:d.status,
     });
     // Deliberately do NOT clear pending and DO NOT resume scores.
     // A separate human acknowledgment and fresh signed reload are needed.
     return view;
   }catch{
     if(alive(stamp))
       view=safeStatus('unknown',{pendingSubmissionId:pending.submissionId});
     return view;
   }finally{if(stamp===epoch)busy=false;}
 }
 function acknowledgeAndReset(){
   if(!view.status.startsWith('confirmed-')||!pending)
     fail('No signed own-receipt resolution to acknowledge');
   pending=null;ack=null;return lock('needs-refresh');
 }
 function pause(){return lock('paused');}
 function resume(){if(disposed)fail('Disposed');return lock('needs-refresh');}
 function fallbackChecklist(flags={}){
   if(!['paused','unknown','needs-refresh'].includes(view.status))
     fail('Fallback checklist only while cloud writes are stopped');
   const proposed={eventId,revision:lastVerified?.revision??0,
      generation:lastVerified?.generation??0,
      phase:PHASE.PAUSED,authority:'cloud',
      unresolvedCloudRequest:pending?.submissionId??null};
   return previewC10SingleDeviceFallback(proposed,{eventId,...flags});
 }
 return Object.freeze({
   get view(){return view;},load,prepareScore,discardPrepared,submitPrepared,inspectOwnDecision,
   acknowledgeAndReset,pause,resume,fallbackChecklist,
   dispose(){disposed=true;pending=null;ack=null;prepared=null;return lock('signed-out');},
 });
}
