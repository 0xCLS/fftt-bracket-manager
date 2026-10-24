import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSimCloud,EVENT} from './milestone1_sim_cloud.mjs';
import {makePasswordClient} from './milestone1_sim_password_clients.mjs';
import {StaffSignInError} from '../contracts/milestone1_password_transport.mjs';
const MAIL={a:'scorekeeper-a@example.invalid',out:'outsider@example.invalid'};
function world(){
 const cloud=createSimCloud();
 const pass={a:'pw-'+randomUUID(),out:'pw-'+randomUUID()};
 const ids={a:cloud.addUser(MAIL.a,pass.a),out:cloud.addUser(MAIL.out,pass.out)};
 cloud.grant(ids.a,EVENT,'scorekeeper');
 return {cloud,ids,pass,client:(n,o)=>makePasswordClient(cloud,n,o)};
}
const kindOf=async p=>{try{await p;return 'ok';}catch(e){return e instanceof StaffSignInError?e.kind:'other:'+e?.message;}};
const errOf=async p=>{try{await p;return null;}catch(e){return e;}};
const verify=(c,code,extra={})=>c.recovery.verify({email:MAIL.a,code,eventId:EVENT,...extra});
test('requesting a code gives the same answer for a known and an unknown address',async()=>{
 const {cloud,client}=world();
 const a=client('a'),b=client('b');
 const known=await a.recovery.request(MAIL.a);
 const unknown=await b.recovery.request('nobody@example.invalid');
 assert.deepEqual(known,unknown);
 assert.equal(cloud.peekCode(MAIL.a)!==null,true);
 assert.equal(cloud.peekCode('nobody@example.invalid'),null);
 assert.equal(cloud.userId('nobody@example.invalid'),undefined,'no account is created');
 assert.equal(await kindOf(verify(b,'123456',{email:'nobody@example.invalid'})),'invalid-code');
});
test('the correct code signs in through the same independent identity and role proof',async()=>{
 const {cloud,client}=world();
 const a=client('a');
 await a.recovery.request(MAIL.a);
 const r=await verify(a,cloud.peekCode(MAIL.a));
 assert.deepEqual([r.role,r.scoreWritesEnabled],['scorekeeper',false]);
 assert.equal((await a.session.readDesk()).status,'ready');
 const paths=cloud.log.filter(l=>l.client==='a').map(l=>l.path);
 assert.ok(paths.includes('/auth/v1/verify')&&paths.includes('/auth/v1/user')&&paths.includes('/rest/v1/rpc/fftt_staff_role_v1'));
 assert.equal(paths.includes('/auth/v1/token'),false,'no password grant is involved');
 assert.equal(a.storage.size,0);
});
test('a code works once; a second use needs a new request',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.recovery.request(MAIL.a);
 const code=cloud.peekCode(MAIL.a);
 await verify(a,code);
 const sent=a.requests();
 assert.equal(await kindOf(verify(a,code)),'expired');
 assert.equal(a.requests(),sent,'no request for a spent code');
 const other=client('b');
 assert.equal(await kindOf(verify(other,code)),'expired','another device never requested it');
});
test('wrong guesses are capped locally; the sixth never leaves the device',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.recovery.request(MAIL.a);
 const real=cloud.peekCode(MAIL.a),wrong=real==='000000'?'111111':'000000';
 for(let i=0;i<5;i++)assert.equal(await kindOf(verify(a,wrong)),'invalid-code');
 const sent=a.requests();
 assert.equal(await kindOf(verify(a,real)),'expired','the code is burned after the fifth miss, even the right one');
 assert.equal(a.requests(),sent);
 assert.equal(a.recovery.status.codeRequested,false);
});
test('failed attempts that are not wrong-code answers still count towards the guess cap',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.recovery.request(MAIL.a);
 for(let i=0;i<5;i++){cloud.client('a').failNext('/auth/v1/verify',500);assert.equal(await kindOf(verify(a,'111111')),'unavailable');}
 const sent=a.requests();
 assert.equal(await kindOf(verify(a,cloud.peekCode(MAIL.a))),'locked');
 assert.equal(a.requests(),sent,'the sixth attempt never leaves the device');
});
test('malformed codes never reach the network and do not consume a guess',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.recovery.request(MAIL.a);
 const sent=a.requests();
 for(const bad of ['12345','1234567','12345a','','      ',' 123456','１２３４５６',null,123456])
  assert.equal(await kindOf(verify(a,bad)),'invalid-input',String(bad));
 assert.equal(a.requests(),sent);
 assert.equal(a.recovery.status.attemptsLeft,5);
 assert.equal(await kindOf(verify(a,cloud.peekCode(MAIL.a))),'ok');
});
test('requests are throttled locally and a provider limit extends the wait',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.recovery.request(MAIL.a);
 const sent=a.requests();
 const e=await errOf(a.recovery.request(MAIL.a));
 assert.equal(e.kind,'cooldown');assert.ok(e.retryAfterMs>0&&e.retryAfterMs<=60_000);
 assert.equal(a.requests(),sent);
 // a second device asking for the same account inside the provider's window is limited by the provider
 const b=client('b');
 const limited=await errOf(b.recovery.request(MAIL.a));
 assert.equal(limited.kind,'rate-limited');
 assert.equal((await errOf(b.recovery.request(MAIL.a))).kind,'cooldown');
 cloud.clock.t+=61_000;
 assert.equal(await kindOf(a.recovery.request(MAIL.a)),'ok');
});
test('a code expires on the client even before the provider would reject it',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.recovery.request(MAIL.a);
 const code=cloud.peekCode(MAIL.a);
 cloud.clock.t+=16*60_000;
 const sent=a.requests();
 assert.equal(await kindOf(verify(a,code)),'expired');
 assert.equal(a.requests(),sent);
});
test('a code is bound to the address it was requested for',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.recovery.request(MAIL.a);
 assert.equal(await kindOf(verify(a,cloud.peekCode(MAIL.a),{email:MAIL.out})),'expired');
});
test('a valid code for an account with no event role is refused and the server session closed',async()=>{
 const {cloud,client}=world();
 const o=client('o');
 await o.recovery.request(MAIL.out);
 assert.equal(await kindOf(o.recovery.verify({email:MAIL.out,code:cloud.peekCode(MAIL.out),eventId:EVENT})),'not-authorized');
 assert.equal(cloud.familyCount(),0);
 assert.equal(o.session.status.authenticated,false);
 assert.equal(cloud.log.filter(l=>l.client==='o'&&l.path.endsWith('/fftt_matchdesk_v1')).length,0);
});
test('overlapping verification attempts are refused so guesses cannot be parallelized',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.recovery.request(MAIL.a);
 const code=cloud.peekCode(MAIL.a);
 const first=kindOf(verify(a,code));
 assert.equal(await kindOf(verify(a,code)),'busy');
 assert.equal(await first,'ok');
});
test('the code path and the password path are independent and never trigger each other',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a',{maxFailures:3});
 for(let i=0;i<3;i++)await kindOf(a.session.signIn({email:MAIL.a,password:'bad'+i,eventId:EVENT}));
 assert.equal(a.requests('/auth/v1/otp'),0,'failed passwords never send a code');
 assert.equal(a.session.status.cooldownRemainingMs>0,true);
 await a.recovery.request(MAIL.a); // recovery is allowed while the password path is cooling down
 assert.equal(await kindOf(verify(a,cloud.peekCode(MAIL.a))),'ok');
 const b=client('b');
 await b.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 assert.equal(b.requests('/auth/v1/otp'),0,'password sign-in never requests a code');
});
test('the code is never stored, logged or kept after sign-in; persistence follows the same opt-in',async()=>{
 const {cloud,client}=world();
 const a=client('a',{allowTabPersistence:true});await a.recovery.request(MAIL.a);
 const code=cloud.peekCode(MAIL.a);
 const r=await verify(a,code,{keepSignedIn:true});
 assert.equal(r.persisted,true);
 assert.equal(a.storage.dump().includes(code),false);
 assert.equal(JSON.stringify(cloud.log).includes(code),false);
 assert.equal(JSON.stringify(a.recovery.status).includes(code),false);
});
test('configuration is bounded',()=>{
 const {client}=world();
 const a=client('a');
 // the controller is built by the harness; verify the limits by constructing directly
 return import('../contracts/milestone1_email_code_recovery.mjs').then(({createMilestone1EmailCodeRecovery:make})=>{
  const base={transport:a.transport,adopt:a.session.adoptVerifiedSession};
  for(const bad of [{requestCooldownMs:1},{maxVerifyAttempts:6},{maxVerifyAttempts:0},{codeLifetimeMs:1},{adopt:null}])
   assert.throws(()=>make({...base,...bad}),undefined,JSON.stringify(bad));
 });
});
