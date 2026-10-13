import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1ScoreSession} from '../contracts/milestone1_score_session.mjs';

const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const A='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const B='ffffffff-ffff-4fff-8fff-ffffffffffff';
const row=()=>({event_id:E,bracket_generation:1,match_id:M,
 match_code:'C-0-0',match_version:0,player_1_id:P1,player_2_id:P2,
 player_1_name:'Synthetic Alpha',player_2_name:'Synthetic Beta'});
const snapshot=(submissionId=null,decision=null,revision=0)=>({
 eventId:E,revision,generation:1,lifecycle:'active',decision,
 source:'synthetic-local-wire',scoreWritesEnabled:false,
});
const receipt=(id,status='accepted')=>({
 id,matchId:M,status,reason:status==='accepted'?null:'stale-match-version',
 matchVersion:1,eventRevision:1,generation:1,
});
function rig({role='scorekeeper',rows=[row()],response='accepted',
  missing=false,signature=true}={}){
 let signed=signature,revision=0,sent=0,submitted=null,release=null;
 const pendingReads=[];
 const runtime=createMilestone1ScoreSession({
   eventId:E,readRole:async()=>role,
   readMatchdesk:async()=>rows,
   readOwnSnapshot:async({submissionId})=>{
     if(missing&&submissionId)return snapshot(submissionId,null,revision);
     return snapshot(submissionId,
       submissionId&&submitted?receipt(submissionId,response==='rejected'?'rejected':'accepted'):null,revision);
   },
   sendScore:async intent=>{
     sent++;submitted=intent;
     if(response==='timeout'){revision=1;throw Error('response lost after commit');}
     if(response==='held'){return await new Promise(resolve=>{release=resolve;});}
     if(response==='accepted'){revision=1;return {status:'accepted',revision:1,generation:1};}
     if(response==='rejected'){revision=1;return {status:'rejected',revision:1,generation:1};}
     throw Error('not found');
   },
   getSubmissionId:()=>A,isAuthenticated:()=>signed,
   allowDisposableLocalSimulation:true,
 });
 return {runtime,sent:()=>sent,release:()=>release,logout:()=>{signed=false;runtime.pause();}};
}
const score={matchId:M,winnerId:P1,gameScores:'11-7, 11-8, 11-9',tableNumber:1};
test('preflight enforces signed role + two consistent V2 snapshot reads',async()=>{
 const r=rig(),v=await r.runtime.load();
 assert.equal(v.status,'ready');assert.equal(v.role,'scorekeeper');
 assert.equal(v.revision,0);assert.equal(v.matches.length,1);
 assert.equal(v.matches[0].players[0].name,'Synthetic Alpha');
 assert.equal(r.sent(),0);
});
test('first prepare generates incident id; manual record REQUIRED before one score POST',async()=>{
 const r=rig();await r.runtime.load();
 const prepared=r.runtime.prepareScore(score);
 assert.equal(prepared.submissionId,A);
 assert.equal(prepared.mayTransmit,false);
 assert.equal(r.runtime.view.status,'prepared');
 await assert.rejects(r.runtime.submitPrepared({submissionId:A}),/Record the exact private ID/);
 assert.equal(r.sent(),0);
 const v=await r.runtime.submitPrepared({submissionId:A,manualIncidentLogConfirmed:true});
 assert.equal(v.status,'needs-own-receipt');
 assert.equal(r.sent(),1);
 await assert.rejects(r.runtime.submitPrepared({submissionId:A,manualIncidentLogConfirmed:true}));
 const result=await r.runtime.inspectOwnDecision();
 assert.equal(result.status,'confirmed-accepted');
 assert.equal(result.decision,'accepted');
 assert.equal(result.scoreReady,false);
 assert.equal(r.sent(),1);
 r.runtime.acknowledgeAndReset();
 assert.equal(r.runtime.view.status,'needs-refresh');
});
test('durable stale rejection demands own receipt and blocks next score',async()=>{
 const r=rig({response:'rejected'});await r.runtime.load();
 const p=r.runtime.prepareScore(score);
 await r.runtime.submitPrepared({submissionId:p.submissionId,manualIncidentLogConfirmed:true});
 assert.equal((await r.runtime.inspectOwnDecision()).status,'confirmed-rejected');
 assert.equal(r.runtime.view.scoreReady,false);
 assert.equal(r.sent(),1);
});
test('lost acknowledgement after a committed match: UNKNOWN until own signed receipt',async()=>{
 const r=rig({response:'timeout'});await r.runtime.load();
 const p=r.runtime.prepareScore(score);
 assert.equal((await r.runtime.submitPrepared({
   submissionId:p.submissionId,manualIncidentLogConfirmed:true})).status,'unknown');
 assert.equal(r.sent(),1);
 await assert.rejects(r.runtime.submitPrepared({submissionId:p.submissionId,manualIncidentLogConfirmed:true}));
 assert.equal((await r.runtime.inspectOwnDecision()).status,'confirmed-accepted');
 assert.equal(r.runtime.view.scoreReady,false);
 assert.equal(r.sent(),1);
});
test('empty own receipt is UNKNOWN and never automatically labeled rejected',async()=>{
 const r=rig({response:'timeout',missing:true});await r.runtime.load();
 const p=r.runtime.prepareScore(score);
 await r.runtime.submitPrepared({submissionId:p.submissionId,manualIncidentLogConfirmed:true});
 assert.equal((await r.runtime.inspectOwnDecision()).status,'unknown');
 assert.equal(r.runtime.view.noAutomaticRetry,true);
});
test('outsider role, invalid winner and wrong session prevent even preparation',async()=>{
 const denied=rig({role:null});
 assert.equal((await denied.runtime.load()).status,'denied');
 assert.throws(()=>denied.runtime.prepareScore(score));
 assert.equal(denied.sent(),0);
 const good=rig();await good.runtime.load();
 assert.throws(()=>good.runtime.prepareScore({...score,winnerId:E}));
 assert.equal(good.sent(),0);
});
test('disconnection during irreversible in-flight request keeps UNKNOWN',async()=>{
 const r=rig({response:'held'});await r.runtime.load();
 const p=r.runtime.prepareScore(score);
 const task=r.runtime.submitPrepared({submissionId:p.submissionId,
   manualIncidentLogConfirmed:true});
 for(let i=0;i<10&&!r.release();i++)await Promise.resolve();
 assert.equal(typeof r.release(),'function');
 r.runtime.pause();r.release()({status:'accepted',revision:1,generation:1});
 await task;
 assert.equal(r.runtime.view.status,'unknown');
 assert.equal(r.sent(),1);
 await assert.rejects(r.runtime.submitPrepared({submissionId:p.submissionId,
   manualIncidentLogConfirmed:true}));
});
test('manual fallback checklist requires protected backup, stopped devices and organizer',async()=>{
 const r=rig();await r.runtime.load();
 r.runtime.pause();
 const flags={backupRevision:0,backupGeneration:1,organizerApproved:true,
  otherDevicesStopped:true,backupProtected:true,manualLogReady:true};
 assert.equal(r.runtime.fallbackChecklist({...flags,otherDevicesStopped:false})
  .procedureChecklistSatisfied,false);
 const result=r.runtime.fallbackChecklist(flags);
 assert.equal(result.procedureChecklistSatisfied,true);
 assert.equal(result.physicalIsolationVerified,false);
 assert.equal(result.cloudWritesEnabled,false);
 assert.equal(result.manualReconciliationRequired,true);
});
test('outcome pending requires explicit incident documentation for fallback',async()=>{
 const r=rig({response:'timeout'});await r.runtime.load();
 const p=r.runtime.prepareScore(score);
 await r.runtime.submitPrepared({submissionId:p.submissionId,manualIncidentLogConfirmed:true});
 const flags={backupRevision:0,backupGeneration:1,organizerApproved:true,
  otherDevicesStopped:true,backupProtected:true,manualLogReady:true};
 assert.equal(r.runtime.fallbackChecklist(flags).procedureChecklistSatisfied,false);
 assert.equal(r.runtime.fallbackChecklist({...flags,unresolvedOutcomeDocumented:true})
  .procedureChecklistSatisfied,true);
});
test('read-only mode never transmits even with a valid fictional role',async()=>{
 let sends=0;
 const c=createMilestone1ScoreSession({
  eventId:E,readRole:async()=> 'organizer',
  readMatchdesk:async()=>[row()],
  readOwnSnapshot:async()=>snapshot(),
  sendScore:async()=>{sends++;},
  getSubmissionId:()=>B,isAuthenticated:()=>true,
 });
 assert.equal((await c.load()).status,'read-only');
 assert.throws(()=>c.prepareScore(score));
 assert.equal(sends,0);
});
test('signed user revocation during own receipt read never confirms server result',async()=>{
 const r=rig();await r.runtime.load();
 const p=r.runtime.prepareScore(score);
 await r.runtime.submitPrepared({submissionId:p.submissionId,manualIncidentLogConfirmed:true});
 r.logout();
 assert.equal((await r.runtime.inspectOwnDecision()).status,'unknown');
 assert.equal(r.sent(),1);
});
test('can discard a never-transmitted prepared intent safely; cannot discard sent result',async()=>{
 const r=rig();await r.runtime.load();
 r.runtime.prepareScore(score);
 assert.equal(r.runtime.discardPrepared().status,'needs-refresh');
 assert.equal(r.sent(),0);
 await r.runtime.load();
 const p=r.runtime.prepareScore(score);
 await r.runtime.submitPrepared({submissionId:p.submissionId,manualIncidentLogConfirmed:true});
 assert.throws(()=>r.runtime.discardPrepared());
});
