import {createMilestone1SyntheticLab} from './lab.mjs';
const $=id=>document.getElementById(id);
const lab=createMilestone1SyntheticLab();
const saved={A:null,B:null};
function message(who,text){$('message'+who).textContent=text;}
function render(who){
 const v=lab.devices[who].controller.view;
 $('state'+who).textContent=v.status.toUpperCase().replaceAll('-',' ');
 $('load'+who).disabled=!(v.status==='signed-out'||v.status==='needs-refresh'||v.status==='denied'||v.status==='read-only');
 $('prepare'+who).disabled=v.status!=='ready'||v.matches.length===0;
 $('send'+who).disabled=v.status!=='prepared'||!$('recorded'+who).checked;
 $('inspect'+who).disabled=!['needs-own-receipt','unknown','checking-receipt'].includes(v.status);
 $('ack'+who).disabled=!v.status.startsWith('confirmed-');
 const totals=lab.organizerView;
 $('rev').textContent=String(totals.revision);
 $('matchState').textContent=totals.completed?'Complete':'Pending';
 $('decisions').textContent=String(totals.acceptedCount+totals.rejectedCount);
 $('network').textContent=String(totals.networkRequests);
 $('publicCount').textContent=String(lab.publicView.publishedEvents);
}
function all(){render('A');render('B');}
async function run(who,operation){
 try{await operation();}
 catch{message(who,'Denied, not ready or invalid synthetic input. No additional score sent.');}
 finally{all();}
}
for(const who of ['A','B']){
 const controller=lab.devices[who].controller;
 $('load'+who).addEventListener('click',()=>run(who,async()=>{
  const v=await controller.load();
  message(who,v.status==='ready'?('Signed fictional Match Desk: '+v.matches.length+
    ' pending · event revision '+v.revision):'No authorized writable synthetic Match Desk.');
 }));
 $('prepare'+who).addEventListener('click',()=>run(who,()=>{
  const v=controller.view;
  const m=v.matches[0];
  if(!m)throw Error('No pending match');
  const winner=$('winner'+who).value==='alpha'?lab.p1:lab.p2;
  const prepared=controller.prepareScore({
    matchId:m.matchId,winnerId:winner,gameScores:$('scores'+who).value,tableNumber:1,
  });
  saved[who]=prepared.submissionId;
  $('incident'+who).textContent=prepared.submissionId;
  $('incidentWrap'+who).hidden=false;
  $('recorded'+who).checked=false;
  message(who,'Prepared in memory. Copy your private fictional ID before the one-time submit.');
 }));
 $('recorded'+who).addEventListener('change',()=>render(who));
 $('send'+who).addEventListener('click',()=>run(who,async()=>{
   if($('lost'+who).checked)lab.devices[who].loseNextAck();
   const v=await controller.submitPrepared({
     submissionId:saved[who],manualIncidentLogConfirmed:$('recorded'+who).checked,
   });
   if(v.status==='unknown')message(who,'UNKNOWN: response may have been committed. Never send again. Read own decision.');
   else message(who,'Provisional HTTP response. Use the separate own-receipt read; not yet confirmed.');
 }));
 $('inspect'+who).addEventListener('click',()=>run(who,async()=>{
  const v=await controller.inspectOwnDecision();
  message(who,v.status.startsWith('confirmed-')?
    'Synthetic own server decision: '+v.decision.toUpperCase()+
    '. No automatic next score; acknowledge and refresh.':
    'UNKNOWN or unavailable own decision. Stop; never retry the submitted score.');
 }));
 $('pause'+who).addEventListener('click',()=>{
  const v=controller.pause();
  message(who,v.status==='unknown'?
   'Simulated disconnection while outcome was pending. Manual receipt verification required.':
   'Paused synthetic device. No queue, no automatic resume.');
  all();
 });
 $('ack'+who).addEventListener('click',()=>run(who,()=>{
  controller.acknowledgeAndReset();
  $('incidentWrap'+who).hidden=true;
  $('recorded'+who).checked=false;
  message(who,'Decision acknowledged. Fresh signed desk required before preparing another score.');
 }));
}
$('reset').addEventListener('click',()=>window.location.reload());
$('fallbackA').addEventListener('click',()=>{
 const controller=lab.devices.A.controller;
 if(!['paused','unknown','needs-refresh'].includes(controller.view.status))
   controller.pause();
 const result=controller.fallbackChecklist({
   backupRevision:controller.view.revision??0,backupGeneration:controller.view.generation??1,
   organizerApproved:$('checkOrganizer').checked,
   otherDevicesStopped:$('checkDevices').checked,
   backupProtected:$('checkBackup').checked,
   manualLogReady:$('checkLog').checked,
   unresolvedOutcomeDocumented:$('checkUnknown').checked,
 });
 $('fallbackStatus').textContent=result.procedureChecklistSatisfied?
   'Checklist PREVIEW satisfied, but physical isolation is UNVERIFIED. Manual offline log and later organizer reconciliation are mandatory. No score transmitted.':
   'Checklist incomplete or unknown score not documented. Fallback cannot be approved by this page.';
 all();
});
all();
