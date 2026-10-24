import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1ContinuityDrill} from '../contracts/milestone1_continuity_drill.mjs';
const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function kit({role='organizer'}={}){
 let r=role,now=100000,serverRevision=8;
 const x=createMilestone1ContinuityDrill({
  eventId:EVENT,revision:7,generation:1,
  readOrganizerRole:async()=>r,
  readSignedSnapshot:async()=>({
   eventId:EVENT,revision:serverRevision,generation:1,
   lifecycle:'active',authenticated:true,
  }),now:()=>now,
 });
 return {x,setRole:v=>r=v,setRevision:v=>serverRevision=v,advance:v=>now+=v};
}
const flags={backupRevision:7,backupGeneration:1,organizerApproved:true,
 otherDevicesStopped:true,backupProtected:true,manualLogReady:true,
 unresolvedOutcomeDocumented:true};
const reconcile={organizerApproved:true,privateBackupReviewed:true,
 manualLogReviewed:true,allFallbackEditsReconciled:true,
 unresolvedCloudRequestChecked:true};
test('healthy cloud cannot enter fallback even with organizer checklists',async()=>{
 const {x}=kit();await x.checkOrganizer();
 assert.throws(()=>x.fallback(flags));
 assert.equal(x.view.cloudWritesEnabled,false);
 assert.equal('submitScore' in x,false);
});
test('non-organizer cannot initiate fallback training',async()=>{
 const {x}=kit({role:'scorekeeper'});
 await x.checkOrganizer().then(()=>assert.fail('expected denial'),()=>{});
 x.outage();assert.throws(()=>x.fallback(flags));
});
test('unknown in-flight score must be documented before organizer drill fallback',async()=>{
 const {x}=kit();await x.checkOrganizer();x.outage({outstandingSubmissionId:SUB});
 assert.equal(x.view.unresolvedDecision,true);
 assert.throws(()=>x.fallback({...flags,unresolvedOutcomeDocumented:false}));
 assert.equal(x.view.phase,'cloud-paused');
 x.fallback(flags);assert.equal(x.view.phase,'single-device-fallback');
 assert.equal(x.view.physicalIsolationVerified,false);
 assert.equal(x.view.scoreSubmissionAvailable,false);
 x.localEdit({writtenToPrivateLog:true});assert.equal(x.view.fallbackEdits,1);
 x.reconnect();assert.equal(x.view.phase,'organizer-reconciliation');
 await assert.rejects(()=>x.reconcile(reconcile)); // Explicit fresh signed organizer role
 await x.checkOrganizer();
 await assert.rejects(()=>x.reconcile({...reconcile,unresolvedCloudRequestChecked:false}));
 await x.reconcile(reconcile);assert.equal(x.view.phase,'cloud-reloading');
 await x.verifyCloudReadOnly();assert.equal(x.view.phase,'cloud-ready');
 assert.equal(x.view.cloudWritesEnabled,false);
});
test('backup protection and staff standdown cannot be skipped',async()=>{
 for(const bad of [{otherDevicesStopped:false},{backupProtected:false},
  {manualLogReady:false},{backupRevision:6},{backupGeneration:0},
  {organizerApproved:false}]){
  const {x}=kit();await x.checkOrganizer();x.outage();
  assert.throws(()=>x.fallback({...flags,...bad}));
  assert.equal(x.view.phase,'cloud-paused');
 }
});
test('all local edits require private log; reconnect cannot silently upload',async()=>{
 const {x}=kit();await x.checkOrganizer();x.outage();x.fallback(flags);
 assert.throws(()=>x.localEdit({writtenToPrivateLog:false}));
 x.localEdit({writtenToPrivateLog:true});
 x.reconnect();assert.equal(x.view.reconciliationRequired,true);
 assert.equal(x.view.cloudWritesEnabled,false);
 await x.checkOrganizer();
 for(const bad of [{manualLogReviewed:false},{allFallbackEditsReconciled:false},
  {privateBackupReviewed:false},{organizerApproved:false}]){
  await assert.rejects(()=>x.reconcile({...reconcile,...bad}));
 }
});
test('reconciliation rejects regressed or unauthenticated cloud snapshot',async()=>{
 const {x,setRevision}=kit();await x.checkOrganizer();x.outage();x.fallback(flags);
 x.reconnect();await x.checkOrganizer();setRevision(6);
 await assert.rejects(()=>x.reconcile(reconcile));
 assert.equal(x.view.phase,'organizer-reconciliation');
});
test('organizer authority expires, preserving safe paused state',async()=>{
 const {x,advance}=kit();await x.checkOrganizer();x.outage();
 advance(20*60000);
 assert.throws(()=>x.fallback(flags));
 assert.equal(x.view.cloudWritesEnabled,false);
});
test('drill cannot mutate local storage, network, roles, or send cloud writes',async()=>{
 const fs=await import('node:fs');
 const text=fs.readFileSync(new URL('../contracts/milestone1_continuity_drill.mjs',import.meta.url),'utf8');
 for(const banned of ['fetch(', 'localStorage','sessionStorage','indexedDB','navigator.',
  'window.', 'submitScore(', 'createUser(', 'publishResults(', 'setTimeout(']){
  assert.equal(text.includes(banned),false,banned);
 }
});
