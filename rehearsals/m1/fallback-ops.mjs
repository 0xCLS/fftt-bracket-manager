/** Zero-network organizer fallback rehearsal over the tested fallback ledger. Fictional data only. */
import {createMilestone1FallbackOps,verifyMilestone1IncidentLog,STANDDOWN_METHOD,OFFLINE_DISPOSITION}
 from '../../contracts/milestone1_fallback_ops.mjs';
const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEVICES=[{id:'scorekeeper-a',label:'Scorekeeper A'},{id:'scorekeeper-b',label:'Scorekeeper B'},{id:'tv-display',label:'TV display'}];
const $=id=>document.getElementById(id);
const digestHex=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))]
 .map(b=>b.toString(16).padStart(2,'0')).join('');
let ops;
function make(){
 ops=createMilestone1FallbackOps({eventId:EVENT,revision:7,generation:1,devices:DEVICES,digestHex,
  evidenceMode:$('mode').value,
  readOrganizerRole:async()=>$('role').value,
  readSignedSnapshot:async()=>({eventId:EVENT,revision:Number($('rev').value),generation:1,
   lifecycle:'active',authenticated:true})});
}
function add(parent,tag,text,props={}){
 const el=document.createElement(tag);el.textContent=text;Object.assign(el,props);parent.append(el);return el;
}
async function render(message){
 const v=ops.view,sd=v.standDown,r=ops.cloudReadiness();
 if(message)$('message').textContent=message;
 $('phase').textContent=v.phase+' · '+v.authority;
 $('standdown').textContent=sd.requested?sd.acknowledged+'/'+sd.required+' acknowledged'+(sd.complete?' (complete)':''):'not requested';
 $('physical').textContent=v.physicalStandDownConfirmed?'ALL devices physically observed':
  'NOT physically confirmed ('+sd.simulatedOrSelfReported+' simulated/self-reported)';
 $('backup').textContent=v.backup.sealed?(v.backup.intact?'sealed · intact':'sealed · MISMATCH — do not trust'):'not sealed';
 $('unknowns').textContent=v.unknownScores.unresolved+' unresolved of '+v.unknownScores.total;
 $('offline').textContent=v.offlineResults.undispositioned+' awaiting disposition of '+v.offlineResults.total;
 $('writes').textContent=v.scoreWritesEnabled?'ERROR — SHOULD BE DISABLED':'DISABLED (always)';
 $('log').textContent=v.incidentLogEntries+' entries';
 const roster=$('roster');roster.replaceChildren();
 for(const d of DEVICES){
  const row=add(roster,'div','');
  add(row,'strong',d.label+' ');
  const sel=add(row,'select','',{id:'method-'+d.id});
  for(const m of Object.values(STANDDOWN_METHOD))add(sel,'option',m);
  add(row,'button','Acknowledge',{id:'ack-'+d.id,type:'button',onclick:()=>act(
   ()=>ops.acknowledgeStandDown({deviceId:d.id,method:sel.value}),d.label+' acknowledged as '+sel.value+'.')});
 }
 const rec=await ops.exportIncidentRecord();
 const offline=$('offlineList');offline.replaceChildren();
 for(const o of rec.offlineResults){
  const row=add(offline,'div',o.id+' · '+o.matchCode+' · winner slot '+o.winnerSlot+' · '+(o.disposition??'awaiting disposition')+' ');
  if(o.disposition===null){
   const sel=add(row,'select','',{id:'disp-'+o.id});
   for(const d of OFFLINE_DISPOSITION)add(sel,'option',d);
   add(row,'button','Record disposition',{id:'dispose-'+o.id,type:'button',onclick:()=>act(
    ()=>ops.dispositionOfflineResult({id:o.id,disposition:sel.value}),o.id+' dispositioned by hand. Nothing was uploaded.')});
  }
 }
 const unknown=$('unknownList');unknown.replaceChildren();
 for(const u of rec.unknownScores){
  const row=add(unknown,'div','Unknown score for '+u.matchCode+' · '+u.state+' ');
  if(u.state==='unknown')add(row,'button','Mark checked by organizer',{id:'check-unknown',type:'button',onclick:()=>act(
   ()=>ops.markUnknownCheckedByOrganizer({submissionId:u.submissionId,outcomeNote:'receipt checked in read-only audit'}),
   'Unknown score marked as independently checked by the organizer.')});
 }
 const releases=$('releases');releases.replaceChildren();
 for(const d of DEVICES)add(releases,'button','Release '+d.label,{id:'release-'+d.id,type:'button',onclick:()=>act(
  ()=>ops.releaseDevice({deviceId:d.id}),d.label+' released by organizer.')});
 const list=$('readiness');list.replaceChildren();
 for(const c of r.checks)add(list,'li',(c.pass?'✔ ':'✘ ')+c.id.replaceAll('-',' '));
 add(list,'li','Ready: '+(r.ready?'YES — a separate scoring gate must still be approved':'no')+' · score writes remain disabled');
}
async function act(action,ok){
 try{await action();await render(ok);}
 catch{await render('BLOCKED · a safety gate is not satisfied. Nothing was changed, uploaded or merged.');}
}
const on=(id,action,ok)=>$(id).addEventListener('click',()=>act(action,ok));
const unknownScores=()=>$('unknown').checked?[{submissionId:SUB,matchCode:'C-0-0'}]:[];
on('verify',()=>ops.checkOrganizer(),'Organizer role verified for this rehearsal.');
on('reverify',()=>ops.checkOrganizer(),'Organizer role re-verified.');
on('outage',()=>ops.declareOutage({unknownSubmissions:unknownScores()}),'Outage declared. Cloud writes are paused.');
on('requestStandDown',()=>ops.requestStandDown(),'Stand-down requested. Acknowledge each device below.');
on('seal',()=>ops.sealBackup($('backupText').value,{storedInProtectedLocation:$('protected').checked}),'Backup digest sealed (text is not stored).');
on('verifyBackup',async()=>{const r=await ops.verifyBackup($('backupText').value);if(!r.intact)throw Error('mismatch');},'Backup text matches the sealed digest.');
on('tamper',async()=>{$('backupText').value+=' ';},'Backup text altered; re-verify to see the mismatch.');
on('fallback',()=>ops.beginFallback({organizerApproved:$('approved').checked,manualLogReady:$('paperLog').checked}),
 'Isolated fallback begun. This did NOT stop any real device.');
on('record',()=>ops.recordOfflineResult({matchCode:$('code').value.trim(),winnerSlot:Number($('slot').value),
 gameScores:$('scores').value.trim(),writtenToPaperLog:$('paperLog').checked}),'Offline result recorded from the paper log. Nothing uploaded.');
on('reconnect',()=>ops.reconnect(),'Connection restored. Re-verify the organizer, then reconcile by hand.');
on('reconcile',()=>ops.reconcile({organizerApproved:$('approved').checked,privateBackupReviewed:$('backupReviewed').checked,
 manualLogReviewed:$('logReviewed').checked}),'Reconciliation signed off. A fresh authoritative read is still required.');
on('cloudRead',()=>ops.verifyCloudReadOnly(),'Fresh authoritative read verified. Release each device to finish.');
$('verifyLog').addEventListener('click',async()=>{
 const rec=await ops.exportIncidentRecord();
 const ok=await verifyMilestone1IncidentLog(rec.log,digestHex);
 await render(ok?'Incident log chain verified: '+rec.log.length+' entries intact.':'INCIDENT LOG CHAIN BROKEN.');
});
$('mode').addEventListener('change',()=>{make();render('Mode changed; rehearsal restarted.');});
$('reset').addEventListener('click',()=>{make();for(const el of document.querySelectorAll('input[type=checkbox]'))el.checked=false;
 $('role').value='organizer';render('Fictional simulation reset.');});
make();render();
