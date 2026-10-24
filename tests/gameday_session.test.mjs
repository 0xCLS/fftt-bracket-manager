/** Game-day extensions of the staff password session: authorized reads/writes and event switching.
 * Real transport, vault, gate and session over the disposable SimCloud. Zero network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSimCloud,EVENT,OTHER_EVENT} from './milestone1_sim_cloud.mjs';
import {makePasswordClient} from './milestone1_sim_password_clients.mjs';
import {StaffSignInError} from '../contracts/milestone1_password_transport.mjs';
const MAIL={org:'organizer@example.invalid',a:'scorekeeper-a@example.invalid'};
const pw=()=>'pw-'+randomUUID();
const MIN=60_000;
function world(){
 const cloud=createSimCloud();cloud.jwtTtlMs=10*MIN;
 const pass={org:pw(),a:pw()};
 const ids=Object.fromEntries(Object.entries(MAIL).map(([k,e])=>[k,cloud.addUser(e,pass[k])]));
 cloud.grant(ids.org,EVENT,'organizer');cloud.grant(ids.a,EVENT,'scorekeeper');
 return {cloud,ids,pass,client:(n,o)=>makePasswordClient(cloud,n,o)};
}
const kindOf=async p=>{try{await p;return 'ok';}catch(e){return e instanceof StaffSignInError?e.kind:'other:'+e?.message;}};
const signIn=(c,w,who='a')=>c.session.signIn({email:MAIL[who],password:w.pass[who],eventId:EVENT});

test('authorized() gives a fresh token and role proof, and returns what the callback returns',async()=>{
 const w=world();const c=w.client('a');await signIn(c,w);
 const before=c.requests('/rest/v1/rpc/fftt_staff_role_v1');
 const out=await c.session.authorized(async ctx=>({role:ctx.role,event:ctx.eventId,token:typeof ctx.token}));
 assert.deepEqual(out,{role:'scorekeeper',event:EVENT,token:'string'});
 assert.ok(c.requests('/rest/v1/rpc/fftt_staff_role_v1')>before,'the role was proven again for this operation');
});
test('an application error from the callback is NOT a lost session',async()=>{
 const w=world();const c=w.client('a');await signIn(c,w);
 const boom=new Error('fftt_validation_error');
 await assert.rejects(c.session.authorized(async()=>{throw boom;}),e=>e===boom);
 assert.equal(c.session.status.authenticated,true);
 assert.equal(await kindOf(c.session.authorized(async()=>1)),'ok');
});
test('a revoked grant stops the very next authorized call, before the callback runs',async()=>{
 const w=world();const c=w.client('a');await signIn(c,w);
 w.cloud.revokeGrant(w.ids.a,EVENT);
 let ran=false;
 const k=await kindOf(c.session.authorized(async()=>{ran=true;}));
 assert.equal(ran,false);assert.equal(k,'revoked');
 assert.equal(c.session.status.authenticated,false);
});
test('offline, suspended and signed-out sessions refuse without running the callback',async()=>{
 const w=world();const c=w.client('a');await signIn(c,w);
 let ran=0;const fn=async()=>{ran++;};
 c.setOnline(false);assert.equal(await kindOf(c.session.authorized(fn)),'network');c.setOnline(true);
 c.session.suspend();assert.equal(await kindOf(c.session.authorized(fn)),'locked');
 await c.session.resume();assert.equal(await kindOf(c.session.authorized(fn)),'ok');
 await c.session.signOut();assert.equal(await kindOf(c.session.authorized(fn)),'expired');
 assert.equal(ran,1);
});
test('authorized calls run one at a time, in order; wait:false is skipped while one is in flight',async()=>{
 const w=world();const c=w.client('a');await signIn(c,w);
 const order=[];let release;const gate=new Promise(r=>{release=r;});
 const first=c.session.authorized(async()=>{order.push('1-start');await gate;order.push('1-end');});
 const second=c.session.authorized(async()=>{order.push('2');});
 await new Promise(r=>setTimeout(r,20));
 assert.equal(await kindOf(c.session.authorized(async()=>{order.push('poll');},{wait:false})),'busy');
 release();await Promise.all([first,second]);
 assert.deepEqual(order,['1-start','1-end','2']);
});
test('the access token is renewed inside authorized() when due',async()=>{
 const w=world();const c=w.client('a');await signIn(c,w);
 const t0=c.requests('/auth/v1/token');
 w.cloud.clock.t+=9*MIN;
 assert.equal(await kindOf(c.session.authorized(async()=>1)),'ok');
 assert.equal(c.requests('/auth/v1/token')-t0,1);
});
test('selectEvent switches to another event the account is authorized for',async()=>{
 const w=world();w.cloud.grant(w.ids.org,OTHER_EVENT,'scorekeeper');
 const c=w.client('org');await signIn(c,w,'org');
 assert.equal(c.session.currentEventId,EVENT);
 const r=await c.session.selectEvent(OTHER_EVENT);
 assert.deepEqual({...r},{role:'scorekeeper',eventId:OTHER_EVENT});
 assert.equal(c.session.currentEventId,OTHER_EVENT);
 assert.equal(await c.session.authorized(async x=>x.role),'scorekeeper');
 assert.equal((await c.session.readDesk()).role,'scorekeeper');
 await c.session.selectEvent(EVENT);
 assert.equal(await c.session.authorized(async x=>x.role),'organizer');
});
test('a denied switch leaves the previous event working and the session alive',async()=>{
 const w=world();const c=w.client('a');await signIn(c,w);
 assert.equal(await kindOf(c.session.selectEvent(OTHER_EVENT)),'not-authorized');
 assert.equal(c.session.currentEventId,EVENT);
 assert.equal(c.session.status.authenticated,true);
 assert.equal(await c.session.authorized(async x=>x.role),'scorekeeper');
 assert.equal(await kindOf(c.session.selectEvent('not-a-uuid')),'invalid-input');
});
test('an event switch is remembered by the opt-in tab vault so a reload resumes on that event',async()=>{
 const w=world();w.cloud.grant(w.ids.a,OTHER_EVENT,'organizer');
 const c=w.client('a',{allowTabPersistence:true});
 await c.session.signIn({email:MAIL.a,password:w.pass.a,eventId:EVENT,keepSignedIn:true});
 await c.session.selectEvent(OTHER_EVENT);
 c.reload();
 const r=await c.session.restore();
 assert.equal(r.role,'organizer');
 assert.equal(c.session.currentEventId,OTHER_EVENT);
});
