import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createSimCloud,EVENT,OTHER_EVENT} from './milestone1_sim_cloud.mjs';
import {makePasswordClient} from './milestone1_sim_password_clients.mjs';
import {StaffSignInError} from '../contracts/milestone1_password_transport.mjs';
const MAIL={org:'organizer@example.invalid',a:'scorekeeper-a@example.invalid',
 b:'scorekeeper-b@example.invalid',out:'outsider@example.invalid'};
// Fixture passwords are random per run: no password-like literal is ever committed.
const pw=()=>'pw-'+randomUUID();
function world(){
 const cloud=createSimCloud();
 const pass={org:pw(),a:pw(),b:pw(),out:pw()};
 const ids=Object.fromEntries(Object.entries(MAIL).map(([k,e])=>[k,cloud.addUser(e,pass[k])]));
 cloud.grant(ids.org,EVENT,'organizer');cloud.grant(ids.a,EVENT,'scorekeeper');cloud.grant(ids.b,EVENT,'scorekeeper');
 return {cloud,ids,pass,client:(n,o)=>makePasswordClient(cloud,n,o)};
}
const kindOf=async p=>{try{await p;return 'ok';}catch(e){return e instanceof StaffSignInError?e.kind:'other:'+e?.message;}};
const errOf=async p=>{try{await p;return null;}catch(e){return e;}};
test('correct credentials sign in, prove the event role independently and read the private desk',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');
 const r=await a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 assert.deepEqual([r.role,r.persisted,r.scoreWritesEnabled],['scorekeeper',false,false]);
 const v=await a.session.readDesk();
 assert.deepEqual([v.status,v.revision,v.matches.length],['ready',1,2]);
 const paths=cloud.log.filter(l=>l.client==='a').map(l=>l.path);
 assert.equal(paths[0],'/auth/v1/token');
 assert.ok(paths.includes('/auth/v1/user')&&paths.includes('/rest/v1/rpc/fftt_staff_role_v1'));
 assert.equal(paths.some(p=>/signup|admin|recover|submit|publish|grant/.test(p)),false);
 assert.equal(a.storage.size,0,'nothing is stored unless the person opts in');
});
test('wrong password and unknown account are indistinguishable and create nothing',async()=>{
 const {cloud,pass,client}=world();
 const wrong=await errOf(client('x1').session.signIn({email:MAIL.a,password:pass.a+'x',eventId:EVENT}));
 const unknown=await errOf(client('x2').session.signIn({email:'nobody@example.invalid',password:pw(),eventId:EVENT}));
 assert.equal(wrong.kind,'invalid-credentials');
 assert.equal(unknown.kind,'invalid-credentials');
 assert.equal(wrong.message,unknown.message);
 assert.equal(wrong.retryAfterMs,unknown.retryAfterMs);
 assert.equal(cloud.userId('nobody@example.invalid'),undefined,'no implicit registration');
 assert.equal(cloud.log.some(l=>l.path==='/auth/v1/signup'),false);
 assert.equal(JSON.stringify(wrong).includes(pass.a),false);
});
test('input is validated locally before any request is sent',async()=>{
 const {client}=world();
 const a=client('a');
 for(const bad of [{email:'nope',password:'x'},{email:MAIL.a,password:''},{email:MAIL.a,password:'p'.repeat(129)},
  {email:MAIL.a,password:123},{email:'a@b.c\nbcc:x@y.z',password:'x'},{email:MAIL.a,password:'x',eventId:'not-a-uuid'}]){
  assert.equal(await kindOf(a.session.signIn({eventId:EVENT,...bad})),'invalid-input',JSON.stringify(Object.keys(bad)));
 }
 assert.equal(a.requests(),0);
});
test('after repeated failures the client stops sending requests and backs off, then recovers',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a',{maxFailures:3,cooldownBaseMs:30_000});
 for(let i=0;i<3;i++)assert.equal(await kindOf(a.session.signIn({email:MAIL.a,password:'bad'+i,eventId:EVENT})),'invalid-credentials');
 const sent=a.requests();
 const blocked=await errOf(a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT}));
 assert.equal(blocked.kind,'cooldown');assert.ok(blocked.retryAfterMs>0&&blocked.retryAfterMs<=30_000);
 assert.equal(a.requests(),sent,'even the CORRECT password sends nothing during the cooldown');
 assert.ok(a.session.status.cooldownRemainingMs>0);
 cloud.clock.t+=61_000; // also clears the provider's 60 s window
 assert.equal(await kindOf(a.session.signIn({email:MAIL.a,password:'bad',eventId:EVENT})),'invalid-credentials');
 const second=await errOf(a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT}));
 assert.equal(second.kind,'cooldown');assert.ok(second.retryAfterMs>30_000,'the ladder grows');
 cloud.clock.t+=121_000;
 assert.equal(await kindOf(a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT})),'ok');
 assert.equal(a.session.status.cooldownRemainingMs,0);
});
test('a provider rate limit is honored: Retry-After becomes the cooldown and nothing is retried',async()=>{
 const {cloud,pass,client}=world();
 const flood=client('flood');
 const kinds=[];
 for(let i=0;i<7;i++){ // a second device hammering the same account from another address
  const d=client('d'+i);
  kinds.push(await kindOf(d.session.signIn({email:MAIL.a,password:'bad'+i,eventId:EVENT})));
 }
 assert.deepEqual(kinds.slice(0,5),new Array(5).fill('invalid-credentials'));
 assert.deepEqual(kinds.slice(5),['rate-limited','rate-limited']);
 // the genuine owner on a fresh device is ALSO limited for that account until the window passes
 const owner=client('owner');
 const e=await errOf(owner.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT}));
 assert.equal(e.kind,'rate-limited');assert.ok(e.retryAfterMs>=1000&&e.retryAfterMs<=60_000);
 const sent=owner.requests();
 assert.equal(await kindOf(owner.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT})),'cooldown');
 assert.equal(owner.requests(),sent,'no automatic or repeated attempt while limited');
 cloud.clock.t+=61_000;
 owner.session.forget();
 const retry=client('owner2');
 assert.equal(await kindOf(retry.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT})),'ok');
 assert.equal(flood.requests(),0);
});
test('authenticated account without an event role is refused and its server session is closed',async()=>{
 const {cloud,pass,client}=world();
 const out=client('out');
 assert.equal(await kindOf(out.session.signIn({email:MAIL.out,password:pass.out,eventId:EVENT})),'not-authorized');
 assert.equal(out.session.status.authenticated,false);
 assert.equal(cloud.log.filter(l=>l.client==='out'&&l.path.endsWith('/fftt_matchdesk_v1')).length,0);
 assert.equal(cloud.log.filter(l=>l.client==='out'&&l.path==='/auth/v1/logout').length,1,'the unauthorized session is revoked');
 assert.equal(cloud.familyCount(),0);
 assert.equal(out.storage.size,0);
 // a grant for one event does not authorize another
 const a=client('a');
 assert.equal(await kindOf(a.session.signIn({email:MAIL.a,password:pass.a,eventId:OTHER_EVENT})),'not-authorized');
});
test('role revoked mid-session ends the session on the very next read and erases storage',async()=>{
 const {cloud,ids,pass,client}=world();
 const a=client('a',{allowTabPersistence:true});
 await a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT,keepSignedIn:true});
 assert.equal(a.storage.size,1);
 assert.equal((await a.session.readDesk()).status,'ready');
 cloud.revokeGrant(ids.a,EVENT);
 assert.equal(await kindOf(a.session.readDesk()),'revoked');
 assert.equal(a.session.status.canRead,false);assert.equal(a.storage.size,0);
 assert.equal(await kindOf(a.session.readDesk()),'expired','nothing is left to read with');
});
test('role change in either direction needs a brand-new sign-in',async()=>{
 const {cloud,ids,pass,client}=world();
 const a=client('a');
 await a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 cloud.grant(ids.a,EVENT,'organizer');
 assert.equal(await kindOf(a.session.readDesk()),'revoked');
});
test('account swap under a still-valid token is rejected',async()=>{
 const {cloud,ids,pass,client}=world();
 const a=client('a');
 await a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 cloud.swapIdentity(cloud.latestToken(ids.a),ids.b); // the same token now reports another person
 assert.equal(await kindOf(a.session.readDesk()),'revoked');
 assert.equal(a.session.status.canRead,false);
});
test('sessions revoked server-side resolve to revoked immediately, not after a confusing second failure',async()=>{
 const {cloud,ids,pass,client}=world();
 const a=client('a');
 await a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 cloud.revokeSessions(ids.a);
 const before=a.requests('/auth/v1/token');
 assert.equal(await kindOf(a.session.readDesk()),'revoked');
 assert.equal(a.requests('/auth/v1/token')-before,1,'exactly one renew attempt, no loop');
});
test('concurrent users keep fully independent identities, sessions and revocation',async()=>{
 const {cloud,ids,pass,client}=world();
 const org=client('org'),a=client('a'),b=client('b');
 const roles=await Promise.all([
  org.session.signIn({email:MAIL.org,password:pass.org,eventId:EVENT}),
  a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT}),
  b.session.signIn({email:MAIL.b,password:pass.b,eventId:EVENT}),
 ]);
 assert.deepEqual(roles.map(r=>r.role),['organizer','scorekeeper','scorekeeper']);
 assert.equal(cloud.familyCount(),3);
 const views=await Promise.all([org,a,b].map(c=>c.session.readDesk()));
 assert.ok(views.every(v=>v.revision===1&&v.matches.length===2));
 cloud.revokeGrant(ids.a,EVENT);
 const results=await Promise.all([org,a,b].map(c=>kindOf(c.session.readDesk())));
 assert.deepEqual(results,['ok','revoked','ok']);
 assert.equal(org.session.status.canRead&&b.session.status.canRead,true);
});
test('one account on two devices has two independent sessions; local sign-out ends only its own',async()=>{
 const {cloud,pass,client}=world();
 const d1=client('d1'),d2=client('d2');
 await d1.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 await d2.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 assert.equal(cloud.familyCount(),2);
 const r=await d1.session.signOut();
 assert.equal(r.serverRevoked,true);assert.equal(cloud.familyCount(),1);
 assert.equal(await kindOf(d1.session.readDesk()),'expired');
 assert.equal(await kindOf(d2.session.readDesk()),'ok');
});
test('global sign-out ends every device of that account but nobody else',async()=>{
 const {cloud,pass,client}=world();
 const d1=client('d1'),d2=client('d2'),b=client('b');
 await d1.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 await d2.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 await b.session.signIn({email:MAIL.b,password:pass.b,eventId:EVENT});
 await d1.session.signOut({global:true});
 assert.equal(cloud.familyCount(),1,'only B remains');
 // d2's access token is still unexpired, but /user no longer recognizes its session
 assert.equal(await kindOf(d2.session.readDesk()),'revoked');
 assert.equal(await kindOf(b.session.readDesk()),'ok');
});
test('signing in again replaces and revokes the previous session instead of orphaning it',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');
 await a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 cloud.clock.t+=61_000;
 await a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 assert.equal(cloud.familyCount(),1);
});
test('overlapping sign-in attempts on one device are refused',async()=>{
 const {pass,client}=world();
 const a=client('a');
 const first=a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 assert.equal(await kindOf(a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT})),'busy');
 assert.equal(await kindOf(first),'ok');
});
test('offline sign-in is refused locally and no password ever appears in the request log',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');a.setOnline(false);
 assert.equal(await kindOf(a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT})),'network');
 assert.equal(a.requests(),0);
 a.setOnline(true);
 await a.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT});
 assert.equal(JSON.stringify(cloud.log).includes(pass.a),false);
});
test('transport refuses unknown paths, missing network permission and malformed sessions',async()=>{
 const {client}=world();
 const a=client('a');
 const {createMilestone1PasswordSupabaseTransport}=await import('../contracts/milestone1_password_transport.mjs');
 const closed=createMilestone1PasswordSupabaseTransport({publishableKey:'sb_publishable_synthetic_test_key_1234',
  fetchImpl:async()=>{throw new Error('must not be called');}});
 assert.equal(await kindOf(closed.signInWithPassword({email:MAIL.a,password:'x'})),'unavailable');
 const odd=(body)=>createMilestone1PasswordSupabaseTransport({publishableKey:'sb_publishable_synthetic_test_key_1234',
  allowSyntheticAuthNetwork:true,fetchImpl:async()=>({status:200,json:async()=>body,headers:{get:()=>null}})});
 for(const body of [{},{access_token:'aa.bb.cc'},{access_token:'bad',token_type:'bearer',expires_in:3600,refresh_token:'abcdefghij',user:{id:'x'}},
  {access_token:'aa.bb.cc',token_type:'bearer',expires_in:99999,refresh_token:'abcdefghij',user:{id:'11111111-1111-4111-8111-111111111111'}}])
  assert.equal(await kindOf(odd(body).signInWithPassword({email:MAIL.a,password:'x'})),'unavailable');
 const ok=await odd({access_token:'aa.bb.cc',token_type:'Bearer',expires_in:3600,refresh_token:'abcdefghij',
  user:{id:'11111111-1111-4111-8111-111111111111',email:'leak@example.invalid',app_metadata:{x:1}}}).signInWithPassword({email:MAIL.a,password:'x'});
 assert.deepEqual(Object.keys(ok).sort(),['accessToken','expiresInMs','refreshToken','userId'],'server extras are dropped');
 assert.ok(a);
});
test('the transport enforces its own input and token rules before any request is made',async()=>{
 const {createMilestone1PasswordSupabaseTransport:make}=await import('../contracts/milestone1_password_transport.mjs');
 let calls=0;
 const t=make({publishableKey:'sb_publishable_synthetic_test_key_1234',allowSyntheticAuthNetwork:true,
  fetchImpl:async()=>{calls++;return {status:200,json:async()=>({}),headers:{get:()=>null}};}});
 const tok='aa.bb.cc';
 for(const bad of [{email:MAIL.a,password:''},{email:MAIL.a,password:'p'.repeat(129)},{email:MAIL.a,password:7},
  {email:'nope',password:'x'},{email:MAIL.a},{}])
  assert.equal(await kindOf(t.signInWithPassword(bad)),'invalid-input',JSON.stringify(Object.keys(bad)));
 // private endpoints refuse to run without a token, and public ones refuse to carry one
 assert.equal(await kindOf(t.readRole({eventId:EVENT})),'unavailable');
 assert.equal(await kindOf(t.readIdentity({})),'unavailable');
 assert.equal(await kindOf(t.signOut({scope:'local'})),'unavailable');
 assert.equal(await kindOf(t.readMatchdesk({eventId:EVENT,token:'not-a-jwt'})),'unavailable');
 assert.equal(await kindOf(t.readRole({eventId:'nope',token:tok})),'invalid-input');
 assert.equal(await kindOf(t.signOut({token:tok,scope:'everyone'})),'invalid-input');
 assert.equal(await kindOf(t.refresh({refreshToken:'x'})),'invalid-refresh');
 assert.equal(await kindOf(t.verifyEmailCode({email:MAIL.a,code:'12345'})),'invalid-input');
 assert.equal(calls,0,'none of those reached the network');
});
test('source hygiene: no storage of secrets, timers, retries, sign-up, admin keys or score paths',()=>{
 for(const f of ['milestone1_password_transport','milestone1_password_session','milestone1_email_code_recovery']){
  const text=readFileSync(new URL('../contracts/'+f+'.mjs',import.meta.url),'utf8');
  for(const banned of ['localStorage','sessionStorage','indexedDB','document.cookie','setTimeout','setInterval',
   'service_role','sb_secret','/signup','/admin','submitScore','publish(','console.','XMLHttpRequest','innerHTML'])
   assert.equal(text.includes(banned),false,f+' contains '+banned);
  assert.equal(/fetch\(/.test(text),false,f+' must only use the injected fetch');
 }
 const vault=readFileSync(new URL('../contracts/milestone1_staff_session_vault.mjs',import.meta.url),'utf8');
 assert.equal(/accessToken|access_token|password/i.test(vault.replace(/\/\*[\s\S]*?\*\//,'')),false,'the vault never handles access tokens or passwords');
});
