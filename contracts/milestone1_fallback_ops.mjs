/** FFTT M1 organizer fallback OPERATIONS ledger, fictional events only.
 * Wraps the reviewed continuity drill (and through it the C1 authority model)
 * and replaces its bare checkbox booleans with evidence the organizer must
 * produce: a sealed + re-verified backup digest, a per-device stand-down
 * roster that separates SIMULATED from PHYSICALLY OBSERVED confirmation, a
 * tracked list of unknown scores, a tamper-evident incident log and a
 * per-result manual reconciliation. It has NO cloud write, merge, upload,
 * retry or score path; offline results are never automatically applied.
 * Code can record that the organizer attested a device stopped; it cannot
 * physically stop or inspect any device.
 */
import {AuthorityGateError,PHASE} from './phase1c_disconnect_reference.mjs';
import {createMilestone1ContinuityDrill} from './milestone1_continuity_drill.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const DEVICE=/^[a-z0-9][a-z0-9-]{1,31}$/;
const LABEL=/^[A-Za-z0-9 ._()#-]{1,40}$/;
const MATCH=/^[Cc]-[0-9]+-[0-9]+$/;
const SCORES=/^\d{1,2}-\d{1,2}(, \d{1,2}-\d{1,2}){0,6}$/;
const NOTE=/^[A-Za-z0-9 .,:;_/()#+-]{1,160}$/;
// Incident notes must never carry player contact details.
const CONTACT=/@|\d{3}[-. )]*\d{3}[-. ]*\d{4}|\d{7,}/;
export const STANDDOWN_METHOD=Object.freeze({
 SIMULATED:'simulated',
 DEVICE_SELF_REPORT:'device-self-report',
 PHYSICALLY_OBSERVED:'organizer-physically-observed',
});
export const OFFLINE_DISPOSITION=Object.freeze([
 'entered-in-cloud-by-organizer','cloud-already-authoritative-discard-offline','discarded-invalid',
]);
const METHODS=Object.values(STANDDOWN_METHOD);
const fail=()=>{throw new AuthorityGateError('Organizer fallback operation not verified');};
const note=(text)=>{
 if(text===undefined||text===null||text==='')return '';
 if(typeof text!=='string'||!NOTE.test(text)||CONTACT.test(text))fail();
 return text;
};
/** Audit a saved incident log: every entry must chain from the one before it. */
export async function verifyMilestone1IncidentLog(log,digestHex){
 if(!Array.isArray(log)||log.length>10000||typeof digestHex!=='function')return false;
 let prev='0'.repeat(64);
 for(let i=0;i<log.length;i++){
  const e=log[i];
  if(!e||e.seq!==i+1||e.prev!==prev||typeof e.kind!=='string'||typeof e.detail!=='string')return false;
  if(await digestHex([e.prev,e.seq,e.at,e.kind,e.detail].join('|'))!==e.hash)return false;
  prev=e.hash;
 }
 return true;
}
export function createMilestone1FallbackOps({
 eventId,revision,generation,readOrganizerRole,readSignedSnapshot,digestHex,
 devices,evidenceMode='training',now=()=>Date.now(),approvalLifetimeMs,
}={}){
 if(typeof digestHex!=='function'||!['training','live'].includes(evidenceMode)
   ||!Array.isArray(devices)||devices.length<1||devices.length>12
   ||new Set(devices.map(d=>d?.id)).size!==devices.length
   ||devices.some(d=>!DEVICE.test(d?.id||'')||!LABEL.test(d?.label||'')))fail();
 let lastSnapshot=null;
 const drill=createMilestone1ContinuityDrill({
  eventId,revision,generation,readOrganizerRole,now,
  ...(approvalLifetimeMs===undefined?{}:{approvalLifetimeMs}),
  readSignedSnapshot:async(args)=>{
   const s=await readSignedSnapshot(args);
   if(Number.isSafeInteger(s?.revision)&&Number.isSafeInteger(s?.generation))
    lastSnapshot=Object.freeze({revision:s.revision,generation:s.generation});
   return s;
  },
 });
 const roster=new Map(devices.map(d=>[d.id,{label:d.label,ack:null,released:false}]));
 const unknowns=new Map(),offline=new Map();
 let backup=null,backupIntact=false,backupCheckedIn=null,standDownRequested=false;
 let nextOffline=1,returned=false,verifiedOnce=false,queue=Promise.resolve(),entries=[],head='0'.repeat(64);
 const phase=()=>drill.view.phase;
 const hex=async text=>{const h=await digestHex(text);if(!SHA.test(h))fail();return h;};
 /** Serialized, hash-chained append; each entry commits to everything before it. */
 const record=(kind,detail='')=>{
  const at=now(),seq=entries.length+1;
  const entry={seq,at,kind,detail:note(detail)||''};
  entries.push(null); // reserve order synchronously
  queue=queue.then(async()=>{
   const prev=head;
   const hash=await hex([prev,seq,at,kind,entry.detail].join('|'));
   entries[seq-1]=Object.freeze({...entry,prev,hash});head=hash;
  });
  return queue;
 };
 // Fresh signed role window: authority transfer and cloud-facing steps only.
 const needOrganizer=()=>{if(!drill.organizerAuthorized)fail();};
 // Local paper-backed steps cannot re-verify offline; they need a prior verified organizer session.
 const needSession=()=>{if(!verifiedOnce)fail();};
 const standDownState=()=>{
  const acks=[...roster.values()].map(r=>r.ack);
  const acknowledged=acks.filter(Boolean).length;
  const observed=acks.filter(a=>a?.method===STANDDOWN_METHOD.PHYSICALLY_OBSERVED).length;
  return Object.freeze({requested:standDownRequested,required:roster.size,acknowledged,
   complete:standDownRequested&&acknowledged===roster.size,
   physicallyConfirmed:standDownRequested&&observed===roster.size,
   evidenceMode,simulatedOrSelfReported:acknowledged-observed});
 };
 const unresolvedUnknowns=()=>[...unknowns.values()].filter(u=>u.state==='unknown');
 const undispositioned=()=>[...offline.values()].filter(o=>o.disposition===null);
 const view=()=>Object.freeze({
  ...drill.view,
  evidenceMode,
  standDown:standDownState(),
  physicalStandDownConfirmed:standDownState().physicallyConfirmed,
  backup:Object.freeze({sealed:backup!==null,intact:backupIntact,
   checkedDuring:backupCheckedIn}),
  unknownScores:Object.freeze({total:unknowns.size,unresolved:unresolvedUnknowns().length}),
  offlineResults:Object.freeze({total:offline.size,undispositioned:undispositioned().length}),
  incidentLogEntries:entries.length,
  scoreWritesEnabled:false,automaticMergeAllowed:false,
 });
 return Object.freeze({
  get view(){return view()},
  async checkOrganizer(){const v=await drill.checkOrganizer();verifiedOnce=true;await record('organizer-verified');return v;},
  /** Outage declared by the organizer; outstanding submissions become tracked unknowns. */
  async declareOutage({unknownSubmissions=[]}={}){
   needSession();
   if(!Array.isArray(unknownSubmissions)||unknownSubmissions.length>32)fail();
   const checked=unknownSubmissions.map(u=>{
    if(!UUID.test(u?.submissionId||'')||!MATCH.test(u?.matchCode||''))fail();return u;});
   if(new Set(checked.map(u=>u.submissionId)).size!==checked.length)fail();
   // The C1 model tracks one outstanding request; the ledger tracks all.
   drill.outage({outstandingSubmissionId:checked[0]?.submissionId??null});
   for(const u of checked)unknowns.set(u.submissionId,{matchCode:u.matchCode,state:'unknown'});
   await record('outage-declared','unknown scores: '+checked.length);
   return view();
  },
  /** An unknown score discovered after the outage began. Never retried. */
  async recordUnknownScore({submissionId,matchCode}={}){
   needSession();
   if(![PHASE.PAUSED,PHASE.FALLBACK,PHASE.RECONCILING].includes(phase()))fail();
   if(!UUID.test(submissionId||'')||!MATCH.test(matchCode||'')||unknowns.has(submissionId))fail();
   unknowns.set(submissionId,{matchCode,state:'unknown'});
   await record('unknown-score-recorded',matchCode);
   return view();
  },
  /** Resolve ONLY from a signed server decision; absence is never rejection. */
  async resolveUnknownScore({submissionId,serverDecision}={}){
   needOrganizer();
   const u=unknowns.get(submissionId);
   if(!u||u.state!=='unknown'||serverDecision?.verifiedFromServer!==true
     ||serverDecision.submissionId!==submissionId
     ||!['accepted','rejected'].includes(serverDecision.status))fail();
   u.state=serverDecision.status;
   await record('unknown-score-resolved',u.matchCode+' '+serverDecision.status);
   return view();
  },
  /** Organizer verified the receipt out-of-band; recorded as such, not as server proof. */
  async markUnknownCheckedByOrganizer({submissionId,outcomeNote}={}){
   needSession();
   const u=unknowns.get(submissionId);
   if(!u||u.state!=='unknown'||!note(outcomeNote))fail();
   const detail=u.matchCode+' '+outcomeNote;
   note(detail); // validate the whole log line BEFORE changing any state
   u.state='checked-by-organizer';
   await record('unknown-score-checked-by-organizer',detail);
   return view();
  },
  async requestStandDown(){
   needSession();
   if(phase()!==PHASE.PAUSED||standDownRequested)fail();
   standDownRequested=true;
   await record('stand-down-requested','devices: '+roster.size);
   return view();
  },
  /** Live mode accepts only physical observation; training also accepts simulation. */
  async acknowledgeStandDown({deviceId,method}={}){
   needSession();
   const d=roster.get(deviceId);
   if(phase()!==PHASE.PAUSED||!standDownRequested||!d||d.ack!==null||!METHODS.includes(method))fail();
   if(evidenceMode==='live'&&method!==STANDDOWN_METHOD.PHYSICALLY_OBSERVED)fail();
   d.ack=Object.freeze({method,at:now()});
   await record('stand-down-ack',deviceId+' '+method);
   return view();
  },
  /** Seal a digest of the organizer's private backup text; the text is never retained. */
  async sealBackup(payloadText,{storedInProtectedLocation}={}){
   needSession();
   if(phase()!==PHASE.PAUSED||backup!==null||storedInProtectedLocation!==true
     ||typeof payloadText!=='string'||payloadText.length<2||payloadText.length>8_000_000)fail();
   backup=Object.freeze({revision,generation,bytes:new TextEncoder().encode(payloadText).length,
    sha256:await hex(payloadText),sealedAt:now(),protectedStorageAttested:true});
   backupIntact=true;backupCheckedIn=phase();
   await record('backup-sealed','size '+Math.ceil(backup.bytes/1024)+' KiB');
   return Object.freeze({...backup});
  },
  /** Re-hash a presented backup; any difference withdraws backup trust. */
  async verifyBackup(payloadText){
   needSession();
   if(backup===null||typeof payloadText!=='string')fail();
   const ok=await hex(payloadText)===backup.sha256
    &&new TextEncoder().encode(payloadText).length===backup.bytes;
   backupIntact=ok;backupCheckedIn=ok?phase():null;
   await record(ok?'backup-verified':'backup-MISMATCH');
   return Object.freeze({intact:ok});
  },
  async beginFallback({organizerApproved,manualLogReady}={}){
   needOrganizer();
   const sd=standDownState();
   if(backup===null||!backupIntact
     ||!sd.complete||evidenceMode==='live'&&!sd.physicallyConfirmed)fail();
   drill.fallback({
    backupRevision:backup.revision,backupGeneration:backup.generation,
    organizerApproved:organizerApproved===true,otherDevicesStopped:sd.complete,
    backupProtected:backup.protectedStorageAttested,
    manualLogReady:manualLogReady===true,
    // every outstanding submission is individually recorded in the ledger
    unresolvedOutcomeDocumented:true,
   });
   await record('fallback-begun',sd.physicallyConfirmed?'physical stand-down confirmed':'stand-down NOT physically confirmed');
   return view();
  },
  /** One manually logged result. Disposition is mandatory later; nothing is uploaded. */
  async recordOfflineResult({matchCode,winnerSlot,gameScores,writtenToPaperLog}={}){
   needSession();
   if(phase()!==PHASE.FALLBACK||!MATCH.test(matchCode||'')||![1,2].includes(winnerSlot)
     ||!SCORES.test(gameScores||'')||writtenToPaperLog!==true)fail();
   drill.localEdit({writtenToPrivateLog:true});
   const id='O-'+nextOffline++;
   offline.set(id,{matchCode,winnerSlot,gameScores,disposition:null});
   await record('offline-result-recorded',id+' '+matchCode);
   return Object.freeze({id,view:view()});
  },
  async reconnect(){drill.reconnect();await record('connectivity-restored');return view();},
  async dispositionOfflineResult({id,disposition,outcomeNote}={}){
   needSession();
   const o=offline.get(id);
   if(phase()!==PHASE.RECONCILING||!o||o.disposition!==null
     ||!OFFLINE_DISPOSITION.includes(disposition))fail();
   const detail=id+' '+disposition+(outcomeNote?' '+note(outcomeNote):'');
   note(detail); // validate the whole log line BEFORE changing any state
   o.disposition=disposition;
   await record('offline-result-disposition',detail);
   return view();
  },
  async reconcile({organizerApproved,privateBackupReviewed,manualLogReviewed}={}){
   needOrganizer();
   if(phase()!==PHASE.RECONCILING||!backupIntact||backupCheckedIn!==PHASE.RECONCILING
     ||undispositioned().length>0||unresolvedUnknowns().length>0)fail();
   await drill.reconcile({
    organizerApproved,privateBackupReviewed,manualLogReviewed,
    allFallbackEditsReconciled:true, // derived: every result has a recorded disposition
    unresolvedCloudRequestChecked:true, // derived: no unknown score remains unresolved
   });
   await record('reconciliation-signed-off');
   return view();
  },
  async verifyCloudReadOnly(){
   await drill.verifyCloudReadOnly();
   returned=true;
   await record('cloud-read-verified',lastSnapshot?'revision '+lastSnapshot.revision:'');
   return view();
  },
  async releaseDevice({deviceId}={}){
   needOrganizer();
   const d=roster.get(deviceId);
   if(!d||!returned||d.released||phase()!==PHASE.READY)fail();
   d.released=true;
   await record('device-released',deviceId);
   return view();
  },
  /** All gates for returning to cloud scoring. Never itself enables a score writer. */
  cloudReadiness(){
   const v=drill.view;
   const checks=[
    ['organizer-authority-current',drill.organizerAuthorized],
    ['cloud-authority-restored',v.phase===PHASE.READY&&v.authority==='cloud'],
    ['backup-intact-and-reverified-after-reconnect',backupIntact&&returned],
    ['every-offline-result-dispositioned',undispositioned().length===0],
    ['no-unknown-score-unresolved',unresolvedUnknowns().length===0],
    ['server-revision-not-regressed',lastSnapshot!==null&&backup!==null
      &&lastSnapshot.revision>=backup.revision&&lastSnapshot.generation>=backup.generation],
    ['every-scoring-device-released-by-organizer',[...roster.values()].every(r=>r.released)],
   ].map(([id,pass])=>Object.freeze({id,pass:pass===true}));
   return Object.freeze({ready:checks.every(c=>c.pass),checks:Object.freeze(checks),
    scoreWritesEnabled:false,requiresSeparateScoringGate:true});
  },
  async verifyLog(){await queue;return verifyMilestone1IncidentLog(entries,digestHex);},
  /** Private incident record for the organizer's own file. No event UUID or contact data. */
  async exportIncidentRecord(){
   await queue;
   return Object.freeze({
    eventRef:(await hex(eventId)).slice(0,8),evidenceMode,
    backup:backup?Object.freeze({revision:backup.revision,generation:backup.generation,
     bytes:backup.bytes,sha256:backup.sha256,intact:backupIntact}):null,
    standDown:standDownState(),
    unknownScores:Object.freeze([...unknowns].map(([submissionId,u])=>Object.freeze({submissionId,...u}))),
    offlineResults:Object.freeze([...offline].map(([id,o])=>Object.freeze({id,...o}))),
    log:Object.freeze(entries.map(e=>e)),logHead:head,
   });
  },
 });
}
