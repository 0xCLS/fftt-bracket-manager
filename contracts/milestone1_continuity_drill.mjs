/** FFTT M1 organizer-only OFFLINE CONTINUITY DRILL, fictional events only.
 * Reuses reviewed C1 authority transition, does not implement cloud writes,
 * local match edits, backup downloads, device stop, score replay or upload.
 * All "confirmations" are a training checklist and cannot physically
 * verify other devices. Produces only privacy-safe state summaries.
 */
import {AuthorityGateError,PHASE,initialCloudState,beginCloudIntent,
 connectivityLost,connectivityRestored,beginSingleDeviceFallback,
 logIsolatedFallbackEdit,organizerReconciled,verifiedServerSnapshot}
 from './phase1c_disconnect_reference.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=()=>{throw new AuthorityGateError('Organizer authority or manual reconciliation not verified');};
export function createMilestone1ContinuityDrill({
 eventId,revision,generation,readOrganizerRole,readSignedSnapshot,
 now=()=>Date.now(),approvalLifetimeMs=15*60*1000,
}={}){
 if(!UUID.test(eventId||'')||typeof readOrganizerRole!=='function'
   ||typeof readSignedSnapshot!=='function'||typeof now!=='function'
   ||!Number.isSafeInteger(approvalLifetimeMs)||approvalLifetimeMs>900000
   ||approvalLifetimeMs<60000)fail();
 let state=initialCloudState({eventId,revision,generation});
 let organizerUntil=0,organizerVerified=false,busy=false;
 const view=()=>Object.freeze({
   phase:state.phase,authority:state.authority,
   fallbackEdits:state.fallbackEdits,reconciliationRequired:state.reconciliationRequired,
   unresolvedDecision:Boolean(state.unresolvedCloudRequest),
   cloudWritesEnabled:false,scoreSubmissionAvailable:false,
   automaticReplayAllowed:false,physicalIsolationVerified:false,
   isSyntheticTrainingOnly:true,
 });
 const authorized=()=>organizerVerified&&now()<organizerUntil;
 async function checkOrganizer(){
   if(busy)fail();busy=true;organizerVerified=false;
   try{
     if(state.phase===PHASE.FALLBACK||state.phase===PHASE.PAUSED)fail();
     if(await readOrganizerRole({eventId})!=='organizer')fail();
     organizerVerified=true;organizerUntil=now()+approvalLifetimeMs;
     return view();
   }finally{busy=false}
 }
 function outage({outstandingSubmissionId=null}={}){
   if(state.phase!==PHASE.READY)fail();
   if(outstandingSubmissionId!==null){
     if(!UUID.test(outstandingSubmissionId))fail();
     state=beginCloudIntent(state,{eventId,submissionId:outstandingSubmissionId});
   }
   state=connectivityLost(state);return view();
 }
 function fallback(confirmations={}){
   if(!authorized()||state.phase!==PHASE.PAUSED)fail();
   // C1 must reject healthy cloud, missing protected backup/staff stand-down,
   // generation/revision mismatch and undocumented UNKNOWN result.
   state=beginSingleDeviceFallback(state,{
     eventId,backupRevision:confirmations.backupRevision,
     backupGeneration:confirmations.backupGeneration,
     organizerApproved:confirmations.organizerApproved===true,
     otherDevicesStopped:confirmations.otherDevicesStopped===true,
     backupProtected:confirmations.backupProtected===true,
     manualLogReady:confirmations.manualLogReady===true,
     unresolvedOutcomeDocumented:confirmations.unresolvedOutcomeDocumented===true,
   });
   return view();
 }
 function localEdit({writtenToPrivateLog=false}={}){
   if(!authorized())fail();
   state=logIsolatedFallbackEdit(state,{eventId,writtenToPrivateLog});
   return view();
 }
 function reconnect(){
   if(state.phase!==PHASE.FALLBACK&&state.phase!==PHASE.PAUSED)fail();
   state=connectivityRestored(state);
   // Organizer must reauthenticate before reconciliation; no silent resume.
   organizerVerified=false;organizerUntil=0;
   return view();
 }
 async function reconcile(confirmations={}){
   if(state.phase!==PHASE.RECONCILING||!authorized()||busy)fail();
   busy=true;
   try{
     const signed=await readSignedSnapshot({eventId});
     if(!signed||signed.eventId!==eventId
       ||!Number.isSafeInteger(signed.revision)
       ||!Number.isSafeInteger(signed.generation)
       ||signed.lifecycle!=='active'||signed.authenticated!==true)fail();
     // Reconciliation is a MANUAL sign-off, not automatic uploading.
     state=organizerReconciled(state,{
       eventId,organizerApproved:confirmations.organizerApproved===true,
       privateBackupReviewed:confirmations.privateBackupReviewed===true,
       manualLogReviewed:confirmations.manualLogReviewed===true,
       allFallbackEditsReconciled:confirmations.allFallbackEditsReconciled===true,
       unresolvedCloudRequestChecked:confirmations.unresolvedCloudRequestChecked===true,
       serverRevision:signed.revision,serverGeneration:signed.generation,
     });
     return view();
   }finally{busy=false}
 }
 async function verifyCloudReadOnly(){
   if(state.phase!==PHASE.RELOADING||state.authority!=='cloud'
     ||!authorized()||busy)fail();
   busy=true;
   try{
     const signed=await readSignedSnapshot({eventId});
     if(!signed||signed.eventId!==eventId||signed.authenticated!==true
       ||signed.lifecycle!=='active')fail();
     state=verifiedServerSnapshot(state,{
       eventId,revision:signed.revision,generation:signed.generation,
       resolvedSubmission:null,
     });
     // Even after a verified simulated cloud resumption, no writer exists.
     return view();
   }finally{busy=false}
 }
 return Object.freeze({get view(){return view()},checkOrganizer,outage,
   fallback,localEdit,reconnect,reconcile,verifyCloudReadOnly});
}
