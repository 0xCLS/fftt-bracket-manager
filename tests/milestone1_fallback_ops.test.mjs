import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createMilestone1FallbackOps,verifyMilestone1IncidentLog,STANDDOWN_METHOD as M}
 from '../contracts/milestone1_fallback_ops.mjs';
const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S1='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S2='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEVICES=[{id:'scorekeeper-a',label:'Scorekeeper A'},{id:'scorekeeper-b',label:'Scorekeeper B'},
 {id:'tv-display',label:'TV display'}];
const digestHex=async t=>createHash('sha256').update(t).digest('hex');
const BACKUP='{"fictional":"event backup","players":[{"name":"Synthetic Alpha"}]}';
function kit({mode='training',role='organizer'}={}){
 const s={role,now:1_000_000,rev:8,gen:1};
 const ops=createMilestone1FallbackOps({eventId:E,revision:7,generation:1,
  readOrganizerRole:async()=>s.role,
  readSignedSnapshot:async()=>({eventId:E,revision:s.rev,generation:s.gen,lifecycle:'active',authenticated:true}),
  digestHex,devices:DEVICES,evidenceMode:mode,now:()=>s.now});
 return {ops,s};
}
const approve={organizerApproved:true,manualLogReady:true};
const sign={organizerApproved:true,privateBackupReviewed:true,manualLogReviewed:true};
async function toPaused(k,unknown=[{submissionId:S1,matchCode:'C-0-0'},{submissionId:S2,matchCode:'C-0-1'}]){
 await k.ops.checkOrganizer();await k.ops.declareOutage({unknownSubmissions:unknown});
}
async function standDownAll(ops,method=M.PHYSICALLY_OBSERVED){
 await ops.requestStandDown();
 for(const d of DEVICES)await ops.acknowledgeStandDown({deviceId:d.id,method});
}
async function toFallback(k,method=M.SIMULATED){
 await toPaused(k);await standDownAll(k.ops,method);
 await k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true});
 await k.ops.verifyBackup(BACKUP);
 await k.ops.beginFallback(approve);
}
test('complete simulated drill: outage to verified cloud return, with no automatic merge or writes',async()=>{
 const k=kit();await toPaused(k);
 assert.equal(k.ops.view.unknownScores.unresolved,2);
 await standDownAll(k.ops,M.SIMULATED);
 assert.equal(k.ops.view.standDown.complete,true);
 assert.equal(k.ops.view.standDown.physicallyConfirmed,false);
 const manifest=await k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true});
 assert.match(manifest.sha256,/^[0-9a-f]{64}$/);assert.equal(JSON.stringify(manifest).includes('Synthetic Alpha'),false);
 assert.deepEqual(await k.ops.verifyBackup(BACKUP),{intact:true});
 await k.ops.beginFallback(approve);
 assert.equal(k.ops.view.phase,'single-device-fallback');
 assert.equal(k.ops.view.physicalIsolationVerified,false);
 assert.equal(k.ops.view.physicalStandDownConfirmed,false);
 const r1=await k.ops.recordOfflineResult({matchCode:'C-0-0',winnerSlot:1,gameScores:'11-7, 11-9, 11-5',writtenToPaperLog:true});
 const r2=await k.ops.recordOfflineResult({matchCode:'C-0-1',winnerSlot:2,gameScores:'9-11, 11-8, 9-11, 7-11',writtenToPaperLog:true});
 assert.deepEqual([r1.id,r2.id],['O-1','O-2']);
 await k.ops.reconnect();assert.equal(k.ops.view.phase,'organizer-reconciliation');
 await k.ops.checkOrganizer();
 await assert.rejects(k.ops.reconcile(sign),/./,'nothing reviewed yet');
 await k.ops.verifyBackup(BACKUP);
 await k.ops.dispositionOfflineResult({id:'O-1',disposition:'entered-in-cloud-by-organizer'});
 await assert.rejects(k.ops.reconcile(sign),/./,'one offline result and both unknown scores remain open');
 await k.ops.dispositionOfflineResult({id:'O-2',disposition:'cloud-already-authoritative-discard-offline',outcomeNote:'cloud shows a different winner'});
 await assert.rejects(k.ops.reconcile(sign),/./,'unknown scores still unresolved');
 await k.ops.resolveUnknownScore({submissionId:S1,serverDecision:{verifiedFromServer:true,submissionId:S1,status:'accepted'}});
 await k.ops.markUnknownCheckedByOrganizer({submissionId:S2,outcomeNote:'receipt seen in read-only audit'});
 await k.ops.reconcile(sign);
 assert.equal(k.ops.view.phase,'cloud-reloading');
 assert.equal(k.ops.cloudReadiness().ready,false);
 await k.ops.verifyCloudReadOnly();
 assert.equal(k.ops.view.phase,'cloud-ready');
 assert.equal(k.ops.cloudReadiness().ready,false,'devices not yet released by organizer');
 for(const d of DEVICES)await k.ops.releaseDevice({deviceId:d.id});
 const ready=k.ops.cloudReadiness();
 assert.equal(ready.ready,true);assert.equal(ready.scoreWritesEnabled,false);
 assert.equal(ready.requiresSeparateScoringGate,true);
 assert.equal(k.ops.view.scoreWritesEnabled,false);assert.equal(k.ops.view.automaticMergeAllowed,false);
 assert.equal(await k.ops.verifyLog(),true);
});
test('live mode accepts only organizer-observed stand-down; simulation and self-report are refused',async()=>{
 const k=kit({mode:'live'});await toPaused(k);await k.ops.requestStandDown();
 for(const method of [M.SIMULATED,M.DEVICE_SELF_REPORT,'telepathy'])
  await assert.rejects(k.ops.acknowledgeStandDown({deviceId:'scorekeeper-a',method}),/./,method);
 await k.ops.acknowledgeStandDown({deviceId:'scorekeeper-a',method:M.PHYSICALLY_OBSERVED});
 await assert.rejects(k.ops.acknowledgeStandDown({deviceId:'scorekeeper-a',method:M.PHYSICALLY_OBSERVED}),/./,'no double acknowledgement');
 await assert.rejects(k.ops.acknowledgeStandDown({deviceId:'unknown-device',method:M.PHYSICALLY_OBSERVED}));
 await k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true});
 await assert.rejects(k.ops.beginFallback(approve),/./,'two devices still not confirmed');
 for(const id of ['scorekeeper-b','tv-display'])await k.ops.acknowledgeStandDown({deviceId:id,method:M.PHYSICALLY_OBSERVED});
 await k.ops.beginFallback(approve);
 assert.equal(k.ops.view.physicalStandDownConfirmed,true);
 assert.equal(k.ops.view.physicalIsolationVerified,false,'underlying drill still cannot inspect devices');
});
test('self-reported or simulated acknowledgements complete training but never count as physical',async()=>{
 const k=kit();await toPaused(k);await k.ops.requestStandDown();
 await k.ops.acknowledgeStandDown({deviceId:'scorekeeper-a',method:M.DEVICE_SELF_REPORT});
 await k.ops.acknowledgeStandDown({deviceId:'scorekeeper-b',method:M.SIMULATED});
 await k.ops.acknowledgeStandDown({deviceId:'tv-display',method:M.PHYSICALLY_OBSERVED});
 const sd=k.ops.view.standDown;
 assert.deepEqual([sd.complete,sd.physicallyConfirmed,sd.simulatedOrSelfReported],[true,false,2]);
});
test('fallback cannot begin without stand-down, a sealed intact backup, or while cloud is healthy',async()=>{
 let k=kit();await k.ops.checkOrganizer();
 await assert.rejects(k.ops.requestStandDown(),/./,'healthy cloud');
 await assert.rejects(k.ops.beginFallback(approve));
 k=kit();await toPaused(k);
 await assert.rejects(k.ops.beginFallback(approve),/./,'nothing done');
 await standDownAll(k.ops);
 await assert.rejects(k.ops.beginFallback(approve),/./,'no backup');
 await assert.rejects(k.ops.sealBackup(BACKUP,{storedInProtectedLocation:false}),/./,'unprotected backup');
 await assert.rejects(k.ops.sealBackup('',{storedInProtectedLocation:true}));
 await k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true});
 await assert.rejects(k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true}),/./,'one seal per incident');
 await assert.rejects(k.ops.beginFallback({organizerApproved:false,manualLogReady:true}));
 await assert.rejects(k.ops.beginFallback({organizerApproved:true,manualLogReady:false}));
 await k.ops.beginFallback(approve);
});
test('a tampered or substituted backup withdraws trust and blocks the transfer of authority',async()=>{
 const k=kit();await toPaused(k);await standDownAll(k.ops);
 await k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true});
 assert.deepEqual(await k.ops.verifyBackup(BACKUP.replace('Alpha','Alpha2')),{intact:false});
 assert.equal(k.ops.view.backup.intact,false);
 await assert.rejects(k.ops.beginFallback(approve));
 assert.deepEqual(await k.ops.verifyBackup(BACKUP),{intact:true});
 await k.ops.beginFallback(approve);
 const kinds=(await k.ops.exportIncidentRecord()).log.map(e=>e.kind);
 assert.ok(kinds.includes('backup-MISMATCH'),'the mismatch stays in the permanent log');
});
test('the organizer window gates the authority transfer, not local paper-backed steps',async()=>{
 const k=kit();await toPaused(k);
 k.s.now+=16*60_000; // organizer role cannot be re-verified while paused
 await standDownAll(k.ops);
 await k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true});
 await k.ops.verifyBackup(BACKUP);
 await assert.rejects(k.ops.beginFallback(approve),/./,'authority transfer needs a fresh organizer proof');
 assert.equal(k.ops.view.phase,'cloud-paused');
 // within the window it works, and local edits then have no clock limit
 const k2=kit();await toFallback(k2,M.SIMULATED);
 k2.s.now+=6*3600_000;
 await k2.ops.recordOfflineResult({matchCode:'C-0-0',winnerSlot:1,gameScores:'11-0',writtenToPaperLog:true});
 assert.equal(k2.ops.view.fallbackEdits,1);
});
test('offline results need a paper-log attestation, valid scores, and cannot be dispositioned early or twice',async()=>{
 const k=kit();
 await assert.rejects(k.ops.recordOfflineResult({matchCode:'C-0-0',winnerSlot:1,gameScores:'11-5',writtenToPaperLog:true}),/./,'before verified organizer session');
 await toFallback(k);
 for(const bad of [{winnerSlot:3},{gameScores:'eleven-five'},{gameScores:''},{matchCode:'../x'},{writtenToPaperLog:false}])
  await assert.rejects(k.ops.recordOfflineResult({matchCode:'C-0-0',winnerSlot:1,gameScores:'11-5',writtenToPaperLog:true,...bad}),/./,JSON.stringify(bad));
 await k.ops.recordOfflineResult({matchCode:'C-0-0',winnerSlot:1,gameScores:'11-5, 11-6',writtenToPaperLog:true});
 await assert.rejects(k.ops.dispositionOfflineResult({id:'O-1',disposition:'entered-in-cloud-by-organizer'}),/./,'still isolated');
 await k.ops.reconnect();
 await assert.rejects(k.ops.dispositionOfflineResult({id:'O-1',disposition:'auto-merged'}));
 await assert.rejects(k.ops.dispositionOfflineResult({id:'O-9',disposition:'discarded-invalid'}));
 await k.ops.dispositionOfflineResult({id:'O-1',disposition:'discarded-invalid'});
 await assert.rejects(k.ops.dispositionOfflineResult({id:'O-1',disposition:'entered-in-cloud-by-organizer'}),/./,'append-only decision');
});
test('an unknown score is resolved only by a signed server decision or an explicit organizer check',async()=>{
 const k=kit();await toFallback(k);await k.ops.reconnect();await k.ops.checkOrganizer();
 const good={verifiedFromServer:true,submissionId:S1,status:'rejected'};
 for(const bad of [{...good,verifiedFromServer:false},{...good,submissionId:S2},{...good,status:'absent'},
  {...good,status:'unknown'},undefined])
  await assert.rejects(k.ops.resolveUnknownScore({submissionId:S1,serverDecision:bad}),/./,JSON.stringify(bad));
 assert.equal(k.ops.view.unknownScores.unresolved,2);
 await assert.rejects(k.ops.markUnknownCheckedByOrganizer({submissionId:S1}),/./,'a note is required');
 await assert.rejects(k.ops.markUnknownCheckedByOrganizer({submissionId:S1,outcomeNote:'call 734-555-0100 to confirm'}),/./,'no phone numbers');
 await assert.rejects(k.ops.markUnknownCheckedByOrganizer({submissionId:S1,outcomeNote:'ask ada@example.invalid'}),/./,'no email addresses');
 await k.ops.resolveUnknownScore({submissionId:S1,serverDecision:good});
 await assert.rejects(k.ops.resolveUnknownScore({submissionId:S1,serverDecision:good}),/./,'already resolved');
 assert.equal(k.ops.view.unknownScores.unresolved,1);
});
test('late unknown scores can be added during the incident but each id only once',async()=>{
 const k=kit();await toPaused(k,[]);
 await k.ops.recordUnknownScore({submissionId:S1,matchCode:'C-0-0'});
 await assert.rejects(k.ops.recordUnknownScore({submissionId:S1,matchCode:'C-0-0'}));
 await assert.rejects(k.ops.recordUnknownScore({submissionId:'not-a-uuid',matchCode:'C-0-0'}));
 assert.equal(k.ops.view.unknownScores.total,1);
 const healthy=kit();await healthy.ops.checkOrganizer();
 await assert.rejects(healthy.ops.recordUnknownScore({submissionId:S2,matchCode:'C-0-0'}),/./,'only during an incident');
});
test('reconciliation is blocked by a regressed server snapshot and by an unverified backup',async()=>{
 const k=kit();await toFallback(k);await k.ops.reconnect();await k.ops.checkOrganizer();
 for(const id of [S1,S2])await k.ops.markUnknownCheckedByOrganizer({submissionId:id,outcomeNote:'checked'});
 await assert.rejects(k.ops.reconcile(sign),/./,'backup not re-verified after reconnection');
 await k.ops.verifyBackup(BACKUP);
 k.s.rev=6;
 await assert.rejects(k.ops.reconcile(sign),/./,'server revision regressed below the backup');
 assert.equal(k.ops.view.phase,'organizer-reconciliation');
 k.s.rev=9;await k.ops.reconcile(sign);
 assert.equal(k.ops.view.phase,'cloud-reloading');
});
test('a non-organizer can neither start nor sign off a fallback',async()=>{
 const k=kit({role:'scorekeeper'});
 await assert.rejects(k.ops.checkOrganizer());
 await assert.rejects(k.ops.declareOutage({}),/./,'no verified organizer session');
 await assert.rejects(k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true}));
});
test('incident log is a verifiable hash chain; edits, deletions and reordering are detected',async()=>{
 const k=kit();await toFallback(k);
 await Promise.all([k.ops.recordOfflineResult({matchCode:'C-0-0',winnerSlot:1,gameScores:'11-5',writtenToPaperLog:true}),
  k.ops.recordUnknownScore({submissionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',matchCode:'C-0-2'})]);
 const rec=await k.ops.exportIncidentRecord();
 assert.equal(await verifyMilestone1IncidentLog(rec.log,digestHex),true);
 assert.equal(rec.log.at(-1).hash,rec.logHead);
 const edited=rec.log.map((e,i)=>i===3?{...e,detail:'altered'}:e);
 const dropped=rec.log.filter((_,i)=>i!==2);
 const swapped=[rec.log[1],rec.log[0],...rec.log.slice(2)];
 for(const bad of [edited,dropped,swapped,[],null])
  if(bad&&bad.length)assert.equal(await verifyMilestone1IncidentLog(bad,digestHex),false);
 assert.equal(await verifyMilestone1IncidentLog(null,digestHex),false);
});
test('exported incident record carries no event UUID, contact data or backup text',async()=>{
 const k=kit();await toFallback(k);
 const text=JSON.stringify(await k.ops.exportIncidentRecord());
 assert.equal(text.includes(E),false);assert.equal(text.includes('Synthetic Alpha'),false);
 assert.equal(/@|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.test(text),false);
 assert.match(JSON.parse(text).eventRef,/^[0-9a-f]{8}$/);
});
test('device roster must be a small set of safe unique identifiers',()=>{
 const base={eventId:E,revision:1,generation:1,readOrganizerRole:async()=>'organizer',
  readSignedSnapshot:async()=>({}),digestHex};
 for(const bad of [[],null,[{id:'a',label:'x'}],[{id:'ok-1',label:'x'},{id:'ok-1',label:'y'}],
  [{id:'ok-1',label:'bad <script>'}],new Array(13).fill(0).map((_,i)=>({id:'dev-'+i,label:'d'}))])
  assert.throws(()=>createMilestone1FallbackOps({...base,devices:bad}),undefined,JSON.stringify(bad));
 assert.throws(()=>createMilestone1FallbackOps({...base,devices:DEVICES,evidenceMode:'production'}));
 assert.throws(()=>createMilestone1FallbackOps({...base,devices:DEVICES,digestHex:null}));
});
test('an over-long note is rejected before any state changes (no half-recorded decisions)',async()=>{
 const k=kit();await toFallback(k);
 await k.ops.recordOfflineResult({matchCode:'C-0-0',winnerSlot:1,gameScores:'11-5',writtenToPaperLog:true});
 await k.ops.reconnect();await k.ops.checkOrganizer();
 const long='x'.repeat(158); // valid alone, but the combined log line exceeds 160
 await assert.rejects(k.ops.dispositionOfflineResult({id:'O-1',disposition:'cloud-already-authoritative-discard-offline',outcomeNote:long}));
 assert.equal(k.ops.view.offlineResults.undispositioned,1,'disposition NOT recorded');
 await assert.rejects(k.ops.markUnknownCheckedByOrganizer({submissionId:S1,outcomeNote:long}));
 assert.equal(k.ops.view.unknownScores.unresolved,2,'unknown score still unresolved');
 const before=(await k.ops.exportIncidentRecord()).log.length;
 await k.ops.dispositionOfflineResult({id:'O-1',disposition:'discarded-invalid',outcomeNote:'short note'});
 assert.equal((await k.ops.exportIncidentRecord()).log.length,before+1);
 assert.equal(await k.ops.verifyLog(),true);
});
test('stand-down evidence cannot be added or changed once authority has transferred',async()=>{
 const k=kit();await toPaused(k);await k.ops.requestStandDown();
 await k.ops.acknowledgeStandDown({deviceId:'scorekeeper-a',method:M.PHYSICALLY_OBSERVED});
 await k.ops.acknowledgeStandDown({deviceId:'scorekeeper-b',method:M.PHYSICALLY_OBSERVED});
 await k.ops.sealBackup(BACKUP,{storedInProtectedLocation:true});
 await k.ops.acknowledgeStandDown({deviceId:'tv-display',method:M.SIMULATED});
 await k.ops.beginFallback(approve);
 const l=(await k.ops.exportIncidentRecord()).log.length;
 await assert.rejects(k.ops.requestStandDown());
 assert.equal((await k.ops.exportIncidentRecord()).log.length,l);
 const k2=kit();await toPaused(k2);await k2.ops.requestStandDown();
 await k2.ops.sealBackup(BACKUP,{storedInProtectedLocation:true});
 await k2.ops.acknowledgeStandDown({deviceId:'scorekeeper-a',method:M.PHYSICALLY_OBSERVED});
 await k2.ops.reconnect(); // outage over before stand-down finished
 await assert.rejects(k2.ops.acknowledgeStandDown({deviceId:'scorekeeper-b',method:M.PHYSICALLY_OBSERVED}),/./,'late acknowledgement after reconnect');
});
test('the ledger exposes no way to submit, upload, merge, retry or enable scoring',async()=>{
 const k=kit();
 for(const name of Object.keys(k.ops))
  assert.equal(/submit|upload|sync|merge|retry|publish|enableScor/i.test(name),false,name);
 const text=readFileSync(new URL('../contracts/milestone1_fallback_ops.mjs',import.meta.url),'utf8');
 for(const banned of ['fetch(','localStorage','sessionStorage','indexedDB','navigator.','window.',
  'document.','XMLHttpRequest','submitScore(','createUser(','publishResults(','setTimeout(','crypto.subtle'])
  assert.equal(text.includes(banned),false,banned);
 // not even a fully reconciled, released ledger can turn writes on
 await toFallback(k);
 assert.equal(k.ops.view.scoreWritesEnabled,false);
});
