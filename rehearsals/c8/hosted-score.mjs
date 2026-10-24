/** Isolated organizer-approved 2099 HOSTED browser score & recovery rehearsal.
 * Existing C8 signed Magic Link session only; no new sign-in scheme.
 * No retry, no automatic publication, no secret keys or real FFTT3 data.
 */
import {createMilestone1HostedFixtureTransport}
 from '../../contracts/milestone1_hosted_fixture_transport.mjs';
import {createMilestone1ScoreSession} from '../../contracts/milestone1_score_session.mjs';
const $=id=>document.getElementById(id);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function installHostedSyntheticScore({auth,read,publishableKey}){
 const t=createMilestone1HostedFixtureTransport({
   publishableKey,getAccessToken:()=>auth.accessToken(),
   fetchImpl:(url,init)=>fetch(url,init),
   store:window.localStorage,
 });
 let controller=null,currentEvent=null,work=0;
 const say=message=>{$('hostStatus').textContent=message;};
 function invalidate(message='No hosted synthetic score prepared.'){
   ++work;
   if(controller)controller.dispose();
   controller=null;currentEvent=null;
   for(const id of ['hostWinner','hostPrepared','hostRecorded','hostScores']){
     if(id==='hostWinner')$(id).replaceChildren();
     if(id==='hostRecorded')$(id).checked=false;
     if(id==='hostPrepared')$(id).textContent='';
     if(id==='hostScores')$(id).value='11-7, 11-8, 11-9';
   }
   $('hostPrepareArea').hidden=true;
   $('hostSend').disabled=true;$('hostPrepare').disabled=true;
   $('hostRead').disabled=!auth.status.authenticated;
   say(message);
 }
 function onAuthChanged(){
   $('hostControls').hidden=!auth.status.authenticated;
   if(!auth.status.authenticated)invalidate('Signed out. No private hosted scoring state.');
   else $('hostRead').disabled=false;
   if(auth.status.authenticated&&t.oneAttemptAlreadyUsed){
     $('hostSend').disabled=true;
     say('This browser has already attempted the ONE approved fictional score. Never retry. Own-decision recovery is available below.');
   }
 }
 async function load(){
   invalidate('Verifying the exact approved fictional fixture and signed scorekeeper role…');
   const stamp=work, eventId=$('eventId').value.trim();
   $('hostRead').disabled=true;
   try{
     if(!auth.status.authenticated||!UUID.test(eventId))throw Error('No signed event');
     const current=await read.readMatchdesk({eventId});
     if(stamp!==work||!auth.status.authenticated)return;
     if(!Array.isArray(current)||current.length!==1||current[0].match_version!==0)
       throw Error('No unconsumed approved fictional match');
     await t.checkFixture({eventId,matchId:current[0].match_id});
     if(stamp!==work||!auth.status.authenticated)return;
     controller=createMilestone1ScoreSession({
       eventId,isAuthenticated:()=>auth.status.authenticated,
       readRole:async({eventId})=>{
         const role=await read.readStaffRole({eventId});
         return role==='scorekeeper'?role:null; // organizer remains a reader, not scorer
       },
       readMatchdesk:async({eventId})=>{
         const rows=await read.readMatchdesk({eventId});
         if(!Array.isArray(rows)||rows.length!==1)throw Error('Fixture changed');
         await t.checkFixture({eventId,matchId:rows[0].match_id});
         return rows;
       },
       readOwnSnapshot:args=>t.readOwnSnapshot(args),
       sendScore:intent=>t.submitScore(intent),
       getSubmissionId:()=>crypto.randomUUID(),
       allowApprovedHostedSyntheticFixture:true,
     });
     const view=await controller.load();
     if(stamp!==work||!auth.status.authenticated)return;
     if(view.status!=='ready'||view.matches.length!==1
       ||t.oneAttemptAlreadyUsed)
       throw Error('No available scorer or already attempted');
     currentEvent=eventId;
     const row=view.matches[0];$('hostWinner').replaceChildren();
     for(const p of row.players){
       const option=document.createElement('option');option.value=p.id;option.textContent=p.name;
       $('hostWinner').append(option);
     }
     $('hostPrepareArea').hidden=false;$('hostPrepare').disabled=false;
     say('Verified scorekeeper · revision 0 · new fictional final · record an ID before the one-time hosted score.');
   }catch{
     if(stamp===work)invalidate(t.oneAttemptAlreadyUsed?
       'Already attempted in this browser. DO NOT RESEND; use own-decision recovery.':
       'Signed role, fresh match or private event PIN invalid. NO hosted score sent.');
   }finally{if(stamp===work)$('hostRead').disabled=false;}
 }
 function prepare(){
   try{
     if(!controller||!currentEvent||t.oneAttemptAlreadyUsed)throw Error('Unavailable');
     const row=controller.view.matches[0];
     const detail=controller.prepareScore({matchId:row.matchId,
       winnerId:$('hostWinner').value,
       gameScores:$('hostScores').value.trim(),tableNumber:1});
     $('hostPrepared').textContent=detail.submissionId;
     $('hostRecorded').checked=false;$('hostSend').disabled=true;
     $('hostPrepare').disabled=true;
     say('PREPARED ONLY: copy the private submission ID and fictional scores to a secure external note. No score has been sent.');
   }catch{say('Cannot prepare. Re-read the exact synthetic match; no score was sent.');}
 }
 async function send(){
   if(!controller||t.oneAttemptAlreadyUsed||!$('hostRecorded').checked){
     say('Cannot send. Incident must be recorded and no prior attempt allowed.');return;
   }
   $('hostSend').disabled=true;$('hostPrepare').disabled=true;
   const stamp=work, submissionId=$('hostPrepared').textContent;
   say('ONE irreversible approved synthetic score request in progress. Do not reload, retry or close.');
   try{
     const view=await controller.submitPrepared({
       submissionId,manualIncidentLogConfirmed:true});
     if(stamp!==work||!auth.status.authenticated)return;
     say(view.status==='unknown'?
       'UNKNOWN: response lost or invalid. Never resend. Use own-decision lookup with your saved ID.':
       'Provisional score response received. NOT YET CONFIRMED. Use own-decision lookup.');
     $('hostRecoveryId').value=submissionId;
   }catch{
     if(stamp===work)say('Result UNKNOWN. Never retry; inspect private own-decision receipt.');
   }
 }
 async function recover(){
   const stamp=work,eventId=$('eventId').value.trim();
   const submissionId=$('hostRecoveryId').value.trim();
   $('hostRecover').disabled=true;
   say('Reading exactly your own signed V2 decision. This cannot send a score.');
   try{
     if(!auth.status.authenticated||!UUID.test(submissionId)
       ||!UUID.test(eventId))throw Error('Invalid private IDs');
     const role=await read.readStaffRole({eventId});
     if(role!=='scorekeeper')throw Error('Not a scorekeeper');
     const s=await t.readOwnSnapshot({eventId,submissionId});
     if(stamp!==work||!auth.status.authenticated)return;
     if(s.decision?.status==='accepted')
       say('SERVER CONFIRMED: your fictional result was ACCEPTED. Do not resubmit or reset this fixture.');
     else if(s.decision?.status==='rejected')
       say('SERVER CONFIRMED: your fictional result was REJECTED AS STALE. Do not resubmit.');
     else say('UNKNOWN: no own terminal decision visible. Absence does not prove rejection; manual investigation required. NO RETRY.');
   }catch{if(stamp===work)say('Own-decision unavailable or denied. Result UNKNOWN; no retry or private data shown.');}
   finally{$('hostRecover').disabled=false;}
 }
 $('hostRead').addEventListener('click',load);
 $('hostPrepare').addEventListener('click',prepare);
 $('hostRecorded').addEventListener('change',()=>{
   $('hostSend').disabled=!controller
    ||controller.view.status!=='prepared'
    ||!$('hostRecorded').checked||t.oneAttemptAlreadyUsed;
 });
 $('hostSend').addEventListener('click',send);
 $('hostRecover').addEventListener('click',recover);
 window.addEventListener('offline',()=>invalidate('Offline. Hosted scoring stopped; possible past result UNKNOWN.'));
 window.addEventListener('online',()=>invalidate('Connected again. No automatic score resumption or replay.'));
 document.addEventListener('visibilitychange',()=>{
   if(document.hidden)invalidate('Tab hidden. Any in-flight result UNKNOWN. Recover by private ID.');
 });
 return Object.freeze({onAuthChanged,invalidate});
}
