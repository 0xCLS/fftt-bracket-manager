import {createMilestone1ContinuityDrill}
 from '../../contracts/milestone1_continuity_drill.mjs';
const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const $=id=>document.getElementById(id);
const checked=id=>$(id).checked;
let drill;
function make(){
 drill=createMilestone1ContinuityDrill({
  eventId:EVENT,revision:7,generation:1,
  readOrganizerRole:async()=>$('role').value,
  readSignedSnapshot:async()=>({
   eventId:EVENT,revision:8,generation:1,lifecycle:'active',
   authenticated:true,
  }),
 });
}
function show(message){
 const v=drill.view;
 $('message').textContent=message;
 $('phase').textContent=v.phase+' · '+v.authority;
 $('edits').textContent=String(v.fallbackEdits);
 $('review').textContent=v.reconciliationRequired?'Yes — never auto-sync':'No';
 $('writes').textContent=v.cloudWritesEnabled?'ERROR — SHOULD BE DISABLED':'DISABLED (always)';
}
function on(id,action,ok){
 $(id).addEventListener('click',async()=>{
  try{await action();show(ok);}
  catch{show('BLOCKED · organizer authority, protected backup, incident log or review gate missing. No cloud writes attempted.');}
 });
}
make();
on('verify',()=>drill.checkOrganizer(),'Fictional organizer role verified for this local drill.');
on('outage',()=>drill.outage({outstandingSubmissionId:checked('unknown')?SUB:null}),
 'Simulated outage. Cloud writes remain paused, including any unknown in-flight score.');
on('fallback',()=>drill.fallback({
 backupRevision:7,backupGeneration:1,
 organizerApproved:checked('approved'),otherDevicesStopped:checked('stoodDown'),
 backupProtected:checked('backup'),manualLogReady:checked('log'),
 unresolvedOutcomeDocumented:checked('documented'),
}),'Simulated isolated fallback. This does NOT verify physical device stand-down.');
on('edit',()=>drill.localEdit({writtenToPrivateLog:checked('log')}),
 'One fictional manually logged offline edit; NO cloud upload.');
on('reconnect',()=>drill.reconnect(),
 'Connection restored in simulation; manual reconciliation and fresh role required.');
on('reverify',()=>drill.checkOrganizer(),
 'Fictional organizer role rechecked. No automatic cloud resume.');
on('reconcile',()=>drill.reconcile({
 organizerApproved:checked('approved'),
 privateBackupReviewed:checked('backupReviewed'),
 manualLogReviewed:checked('logReviewed'),
 allFallbackEditsReconciled:checked('editsReviewed'),
 unresolvedCloudRequestChecked:checked('unknownReviewed'),
}),'Manual reconciliation simulated; cloud remains paused pending fresh verified read.');
on('verified',()=>drill.verifyCloudReadOnly(),
 'Fresh authoritative read simulated. All cloud score writes remain DISABLED.');
$('restart').addEventListener('click',()=>{
 make();for(const el of document.querySelectorAll('input[type=checkbox]'))el.checked=false;
 $('role').value='scorekeeper';
 show('Fictional simulation reset. No hosted fixture, database or cloud state touched.');
});
