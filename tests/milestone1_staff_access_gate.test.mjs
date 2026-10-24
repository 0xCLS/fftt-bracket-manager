import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1StaffAccessGate} from '../contracts/milestone1_staff_access_gate.mjs';
const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN='header.payload.signature';
function kit(){
 let online=true,now=10000,role='scorekeeper',id=ID;
 let requests=[];
 const gate=createMilestone1StaffAccessGate({
  getAccessToken:async()=>TOKEN,
  readIdentity:async({token})=>{requests.push('identity');return {id,is_anonymous:false}},
  readRole:async({eventId,token})=>{requests.push('role');return role},
  isOnline:()=>online,now:()=>now,
 });
 return {gate,requests,setRole:v=>role=v,setId:v=>id=v,
  advance:v=>now+=v,setOnline:v=>online=v,exp:()=>now+60000};
}
test('signed event-scoped role and independent identity are checked on every read',async()=>{
 const t=kit();const r=await t.gate.verify({eventId:EVENT,expiresAt:t.exp()});
 assert.equal(r.authorized,true);assert.equal(r.scoreWritesEnabled,false);
 const x=await t.gate.withFreshRole(EVENT,async args=>{
  assert.equal(args.token,TOKEN);return {allowed:true};
 });
 assert.deepEqual(x,{allowed:true});
 assert.deepEqual(t.requests,['identity','role','identity','role']);
 assert.equal('submitScore' in t.gate,false);assert.equal('enableFallback' in t.gate,false);
});
test('different event, revoked role, and changed account all deny',async()=>{
 const t=kit();await t.gate.verify({eventId:EVENT,expiresAt:t.exp()});
 await assert.rejects(()=>t.gate.withFreshRole(ID,async()=>true));
 assert.equal(t.gate.status.authorized,false);
 await t.gate.verify({eventId:EVENT,expiresAt:t.exp()});
 t.setRole('outsider');
 await assert.rejects(()=>t.gate.withFreshRole(EVENT,async()=>true));
 assert.equal(t.gate.status.authorized,false);
 t.setRole('scorekeeper');await t.gate.verify({eventId:EVENT,expiresAt:t.exp()});
 t.setId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 await assert.rejects(()=>t.gate.withFreshRole(EVENT,async()=>true));
 assert.equal(t.gate.status.authorized,false);
});
test('expiry, offline, no-session and explicit signout cannot read',async()=>{
 const t=kit();await assert.rejects(()=>t.gate.withFreshRole(EVENT,async()=>true));
 await t.gate.verify({eventId:EVENT,expiresAt:t.exp()});
 t.advance(61000);
 assert.equal(t.gate.status.authorized,false);
 await assert.rejects(()=>t.gate.withFreshRole(EVENT,async()=>true));
 await t.gate.verify({eventId:EVENT,expiresAt:t.exp()});
 t.setOnline(false);await assert.rejects(()=>t.gate.withFreshRole(EVENT,async()=>true));
 t.setOnline(true);await t.gate.verify({eventId:EVENT,expiresAt:t.exp()});
 t.gate.signOut();assert.equal(t.gate.status.authorized,false);
});
test('signout mid signed role check makes late response unusable',async()=>{
 let resolveRole;const g=createMilestone1StaffAccessGate({
  getAccessToken:async()=>TOKEN,readIdentity:async()=>({id:ID}),
  readRole:()=>new Promise(resolve=>{resolveRole=resolve}),
  isOnline:()=>true,now:()=>10000,
 });
 const pending=g.verify({eventId:EVENT,expiresAt:70000});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 g.signOut();resolveRole('organizer');
 await assert.rejects(()=>pending);assert.equal(g.status.authorized,false);
});
test('failure and bad identity or unexpected token never expose session',async()=>{
 for(const who of [null,{id:'bad'},{id:ID,is_anonymous:true}]){
  const g=createMilestone1StaffAccessGate({
   getAccessToken:async()=>TOKEN,readIdentity:async()=>who,
   readRole:async()=> 'organizer',isOnline:()=>true,now:()=>10000,
  });
  await assert.rejects(()=>g.verify({eventId:EVENT,expiresAt:70000}));
 }
});
