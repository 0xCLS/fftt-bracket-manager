import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1ConnectedDesk} from '../contracts/milestone1_connected_desk.mjs';

const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MATCH='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const row=()=>({event_id:EVENT,bracket_generation:1,match_id:MATCH,
 match_code:'C-0-0',match_version:0,bracket:'championship',round_number:0,
 slot:0,player_1_id:P1,player_2_id:P2,player_1_name:'Fictional Alpha',
 player_2_name:'Fictional Beta',is_championship_final:true,table_number:null});
const snapshot=(revision=1)=>({eventId:EVENT,revision,generation:1,
 status:'unknown',cloudWritesEnabled:false});
function harness({role='scorekeeper',rows=[row()],snapshots=[snapshot(),snapshot()],
 authed=true}={}){
 let reads=0,scoreWrites=0,authenticated=authed;
 const controller=createMilestone1ConnectedDesk({
   isAuthenticated:()=>authenticated,
   readRole:async()=>{reads++;if(role==='throw')throw Error('private token');return role;},
   readMatchdesk:async()=>{reads++;return rows;},
   readSnapshot:async()=>{reads++;return snapshots.shift()??snapshot();},
 });
 return {controller,reads:()=>reads,writes:()=>scoreWrites,logout:()=>{authenticated=false;controller.signOut();}};
}
test('fresh signed double-read presents an immutable display-only Match Desk',async()=>{
 const h=harness(),v=await h.controller.refresh(EVENT);
 assert.equal(v.status,'ready');assert.equal(v.role,'scorekeeper');
 assert.equal(v.revision,1);assert.equal(v.generation,1);
 assert.equal(v.matches.length,1);
 assert.deepEqual(v.matches[0],{code:'C-0-0',bracket:'championship',round:1,
  players:'Fictional Alpha vs Fictional Beta',version:0,table:null});
 assert.equal(v.authoritativeForScoring,false);
 assert.equal(Object.isFrozen(v.matches),true);
 assert.equal(Object.hasOwn(v.matches[0],'match_id'),false);
 assert.equal(h.reads(),4);
 await assert.rejects(h.controller.submitScore(),/disabled/);
 await assert.rejects(h.controller.enableFallback(),/separate/);
 assert.equal(h.writes(),0);
});
test('empty hosted consumed fixture is a valid read-only result at revision 1',async()=>{
 const h=harness({rows:[],role:'organizer'});
 const v=await h.controller.refresh(EVENT);
 assert.equal(v.status,'ready');assert.equal(v.matches.length,0);
 assert.equal(v.revision,1);assert.equal(v.role,'organizer');
});
test('out-of-role, expired and failed snapshots discard all cached private rows',async()=>{
 const role=harness({role:'outsider'});
 assert.equal((await role.controller.refresh(EVENT)).status,'denied');
 assert.equal(role.reads(),1);
 const bad=harness({snapshots:[snapshot(1),snapshot(2)]});
 assert.equal((await bad.controller.refresh(EVENT)).status,'denied');
 assert.deepEqual(bad.controller.view.matches,[]);
 const fail=harness({role:'throw'});
 assert.equal((await fail.controller.refresh(EVENT)).status,'denied');
 assert.equal(JSON.stringify(fail.controller.view).includes('private token'),false);
});
test('inconsistent double-read revisions and generations never render stale desk',async()=>{
 for(const snapshots of [
  [snapshot(1),snapshot(2)],
  [snapshot(2),{...snapshot(2),generation:2}],
  [snapshot(1),{...snapshot(1),cloudWritesEnabled:true}],
  [{...snapshot(1),eventId:P1},snapshot(1)],
 ]){
  const h=harness({snapshots});assert.equal((await h.controller.refresh(EVENT)).status,'denied');
  assert.equal(h.controller.view.matches.length,0);
 }
});
test('private fields, cross-event rows, or invalid player names are rejected',async()=>{
 for(const m of [
  {...row(),email:'private@example.org'},
  {...row(),event_id:P1},
  {...row(),player_1_name:'x'.repeat(161)},
  {...row(),player_2_id:P1},
  {...row(),bracket_generation:2},
  {...row(),round_number:-1}
 ]){
  const h=harness({rows:[m]});assert.equal((await h.controller.refresh(EVENT)).status,'denied');
  assert.equal(h.controller.view.matches.length,0);
 }
});
test('disconnect clears private view and does not silently resume',async()=>{
 const h=harness();await h.controller.refresh(EVENT);
 assert.equal(h.controller.pause().status,'paused');
 assert.equal(h.controller.view.matches.length,0);
 assert.equal(h.controller.view.authoritativeForScoring,false);
 const fresh=await h.controller.refresh(EVENT);
 assert.equal(fresh.status,'ready');
 h.logout();assert.equal(h.controller.view.status,'signed-out');
 await assert.rejects(h.controller.refresh(EVENT));
 assert.equal(h.controller.view.matches.length,0);
});
test('sign-out during pending network read suppresses late private responses',async()=>{
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 let isAuth=true;
 const c=createMilestone1ConnectedDesk({
  isAuthenticated:()=>isAuth,
  readRole:async()=>gate,
  readMatchdesk:async()=>[row()],
  readSnapshot:async()=>snapshot(),
 });
 const task=c.refresh(EVENT);
 isAuth=false;c.signOut();
 release('organizer');await task;
 assert.equal(c.view.status,'signed-out');
 assert.equal(c.view.matches.length,0);
});
test('rapid overlapping reads do not interleave authoritative versions',async()=>{
 let done;const gate=new Promise(resolve=>{done=resolve;});
 const c=createMilestone1ConnectedDesk({
  isAuthenticated:()=>true,readRole:async()=>gate,
  readMatchdesk:async()=>[],readSnapshot:async()=>snapshot(),
 });
 const first=c.refresh(EVENT);
 await assert.rejects(c.refresh(EVENT),/Read in progress/);
 done('organizer');
 assert.equal((await first).status,'ready');
 c.dispose();await assert.rejects(c.refresh(EVENT));
});
test('invalid configuration, event ID and session never dispatch requests',async()=>{
 assert.throws(()=>createMilestone1ConnectedDesk({}),/Explicit/);
 const h=harness();
 await assert.rejects(h.controller.refresh('not UUID'));
 assert.equal(h.reads(),0);
 assert.equal(h.controller.view.status,'denied');
});
