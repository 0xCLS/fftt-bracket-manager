import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSimCloud,EVENT} from './milestone1_sim_cloud.mjs';
import {makePasswordClient} from './milestone1_sim_password_clients.mjs';
import {tabStorage} from './milestone1_sim_clients.mjs';
import {StaffSignInError} from '../contracts/milestone1_password_transport.mjs';
const MAIL={org:'organizer@example.invalid',a:'scorekeeper-a@example.invalid',b:'scorekeeper-b@example.invalid'};
const pw=()=>'pw-'+randomUUID();
const MIN=60_000,HOUR=3600_000;
function world({ttl=10*MIN}={}){
 const cloud=createSimCloud();cloud.jwtTtlMs=ttl;
 const pass={org:pw(),a:pw(),b:pw()};
 const ids=Object.fromEntries(Object.entries(MAIL).map(([k,e])=>[k,cloud.addUser(e,pass[k])]));
 cloud.grant(ids.org,EVENT,'organizer');cloud.grant(ids.a,EVENT,'scorekeeper');cloud.grant(ids.b,EVENT,'scorekeeper');
 return {cloud,ids,pass,client:(n,o)=>makePasswordClient(cloud,n,o)};
}
const kindOf=async p=>{try{await p;return 'ok';}catch(e){return e instanceof StaffSignInError?e.kind:'other:'+e?.message;}};
const signIn=(c,pass,extra={})=>c.session.signIn({email:MAIL.a,password:pass.a,eventId:EVENT,...extra});
const tokenCalls=c=>c.requests('/auth/v1/token');
test('the access token is renewed shortly before it expires, exactly once, and rotated',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);
 assert.equal(tokenCalls(a),1);
 cloud.clock.t+=7*MIN; // 3 min left: not yet
 await a.session.readDesk();assert.equal(tokenCalls(a),1);
 cloud.clock.t+=90_000; // 90 s left < 2 min window
 assert.equal((await a.session.readDesk()).status,'ready');
 assert.equal(tokenCalls(a),2);
 await a.session.readDesk();assert.equal(tokenCalls(a),2,'a fresh token is not renewed again');
 assert.equal(cloud.familyCount(),1);
});
test('a tournament-length session survives many renewals with only real activity extending the idle clock',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);
 for(let i=0;i<120;i++){ // 10 hours, a poll every 5 minutes
  cloud.clock.t+=5*MIN;
  if(i%6===5)a.session.touch(); // a person taps every 30 minutes
  assert.equal((await a.session.readDesk()).status,'ready',String(i));
 }
 assert.ok(tokenCalls(a)>=60,'many renewals happened: '+tokenCalls(a));
 assert.equal(cloud.familyCount(),1);
 assert.equal(a.session.status.canRead,true);
});
test('idle expiry: automatic reads are NOT activity; a touch resets the clock',async()=>{
 const {cloud,pass,client}=world({ttl:HOUR});
 const a=client('a',{idleTimeoutMs:30*MIN});await signIn(a,pass);
 cloud.clock.t+=20*MIN;await a.session.readDesk();
 a.session.touch();
 cloud.clock.t+=25*MIN;await a.session.readDesk(); // 25 min since the touch
 cloud.clock.t+=10*MIN; // 35 min with no touch, although reads kept happening
 assert.equal(await kindOf(a.session.readDesk()),'expired');
 assert.equal(a.session.status.authenticated,false);
});
test('absolute expiry ends even an active session',async()=>{
 const {cloud,pass,client}=world({ttl:HOUR});
 const a=client('a',{idleTimeoutMs:HOUR,maxSessionMs:3*HOUR,allowTabPersistence:true});
 await signIn(a,pass,{keepSignedIn:true});
 for(let i=0;i<5;i++){cloud.clock.t+=30*MIN;a.session.touch();await a.session.readDesk();}
 cloud.clock.t+=31*MIN;a.session.touch();
 assert.equal(await kindOf(a.session.readDesk()),'expired');
 assert.equal(a.storage.size,0,'the stored copy is erased too');
});
test('a clock that moves backwards fails closed',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);
 cloud.clock.t-=5*MIN;
 assert.equal(await kindOf(a.session.readDesk()),'expired');
});
test('renewal failures are classified: transient ones keep the session, a dead refresh token ends it',async()=>{
 const {cloud,ids,pass,client}=world();
 for(const [label,force] of [['server error',()=>cloud.client('a').failNext('/auth/v1/token',500)],
  ['rate limited',()=>cloud.client('a').failNext('/auth/v1/token',429,{'retry-after':'30'})]]){
  const a=client('a');await signIn(a,pass);cloud.clock.t+=9*MIN;force();
  const before=tokenCalls(a);
  const k=await kindOf(a.session.readDesk());
  assert.ok(['unavailable','rate-limited'].includes(k),label+': '+k);
  assert.equal(tokenCalls(a)-before,1,label+': one attempt, no retry');
  assert.equal(a.session.status.authenticated,true,label+': still signed in');
  assert.equal(await kindOf(a.session.readDesk()),'ok',label+': recovers on the next explicit read');
  await a.session.signOut();cloud.clock.t+=61*1000;
 }
 const a=client('a');await signIn(a,pass);cloud.clock.t+=9*MIN;
 cloud.revokeSessions(ids.a);
 assert.equal(await kindOf(a.session.readDesk()),'revoked');
 assert.equal(a.session.status.authenticated,false);
});
test('renewal that returns a different identity ends the session',async()=>{
 const {cloud,ids,pass,client}=world();
 const a=client('a');await signIn(a,pass);cloud.clock.t+=9*MIN;
 cloud.forceRefreshUser=ids.b;
 assert.equal(await kindOf(a.session.readDesk()),'revoked');
 assert.equal(a.session.status.authenticated,false);
});
test('a renewal response that names another person is refused even though the token still works',async()=>{
 const {cloud,ids,pass,client}=world();
 const a=client('a');await signIn(a,pass);cloud.clock.t+=9*MIN;
 cloud.lieRefreshUserId=ids.b;
 assert.equal(await kindOf(a.session.readDesk()),'revoked');
 assert.equal(a.session.status.authenticated,false);
});
test('offline reads fail locally with no request and keep the session for later',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);
 a.setOnline(false);const sent=a.requests();
 assert.equal(await kindOf(a.session.readDesk()),'network');
 assert.equal(a.requests(),sent);
 cloud.clock.t+=2*MIN;a.setOnline(true);
 assert.equal(await kindOf(a.session.readDesk()),'ok');
});
test('overlapping reads are serialized: one renews and reads, the others are refused as busy',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);cloud.clock.t+=9*MIN;
 const before=tokenCalls(a);
 const results=await Promise.allSettled([a.session.readDesk(),a.session.readDesk(),a.session.readDesk()]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.kind),['busy','busy']);
 assert.equal(tokenCalls(a)-before,1,'a single renewal');
 assert.equal(a.session.status.authenticated,true,'an overlapping call never ends the session');
 assert.equal(await kindOf(a.session.readDesk()),'ok');
});
test('suspend drops all views at once; a long background with an expired token resumes silently',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);
 assert.equal(a.session.suspend().suspended,true);
 assert.equal(a.session.status.canRead,false);assert.equal(a.session.status.authenticated,false);
 const sent=a.requests();
 assert.equal(await kindOf(a.session.readDesk()),'locked');
 assert.equal(a.requests(),sent,'nothing is read while suspended');
 cloud.clock.t+=90*MIN; // access token long expired, still inside the idle limit
 const r=await a.session.resume();
 assert.equal(r.role,'scorekeeper');
 assert.equal(await kindOf(a.session.readDesk()),'ok');
});
test('resume fails closed after idle overrun, revocation, role change or identity switch',async()=>{
 const cases={
  idle:(w)=>{w.cloud.clock.t+=3*HOUR;},
  grantRevoked:(w)=>w.cloud.revokeGrant(w.ids.a,EVENT),
  roleChanged:(w)=>w.cloud.grant(w.ids.a,EVENT,'organizer'),
  sessionsRevoked:(w)=>w.cloud.revokeSessions(w.ids.a),
  identitySwitch:(w)=>{w.cloud.forceRefreshUser=w.ids.b;w.cloud.clock.t+=30*MIN;},
 };
 for(const [name,mutate] of Object.entries(cases)){
  const w=world();const a=w.client('a',{allowTabPersistence:true});
  await signIn(a,w.pass,{keepSignedIn:true});
  a.session.suspend();mutate(w);
  const k=await kindOf(a.session.resume());
  assert.ok(['revoked','expired'].includes(k),name+': '+k);
  assert.equal(a.session.status.authenticated,false,name);assert.equal(a.storage.size,0,name);
 }
});
test('resume while offline stays suspended and can be retried by a person later',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);a.session.suspend();
 a.setOnline(false);cloud.clock.t+=15*MIN;
 const sent=a.requests();
 assert.equal(await kindOf(a.session.resume()),'network');
 assert.equal(a.requests(),sent);
 assert.equal(a.session.status.suspended,true);assert.equal(a.session.status.canRead,false);
 a.setOnline(true);
 assert.equal((await a.session.resume()).role,'scorekeeper');
 assert.equal(a.session.status.suspended,false);
});
test('backgrounding in the middle of a read or a resume never destroys the suspended session',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);
 let open;const wait=new Promise(r=>{open=r;});
 cloud.hooks.before=async p=>{if(p.endsWith('/fftt_matchdesk_v1'))await wait;};
 const inFlight=kindOf(a.session.readDesk());
 await new Promise(r=>setImmediate(r));
 a.session.suspend();open();cloud.hooks.before=null;
 assert.equal(await inFlight,'locked');
 assert.equal(a.session.status.suspended,true);
 assert.equal((await a.session.resume()).role,'scorekeeper');
});
test('opt-in tab persistence stores only the refresh token and its pins, and restores after a reload',async()=>{
 const {cloud,ids,pass,client}=world();
 const a=client('a',{allowTabPersistence:true});
 const r=await signIn(a,pass,{keepSignedIn:true});
 assert.equal(r.persisted,true);
 const stored=JSON.parse(a.storage.dump());
 assert.deepEqual(Object.keys(stored).sort(),['eventId','lastActiveAt','refreshToken','role','startedAt','userId','v']);
 assert.equal(stored.userId,ids.a);
 const raw=a.storage.dump();
 assert.equal(raw.includes(pass.a),false);assert.equal(raw.includes(MAIL.a),false);
 assert.equal(/eyJ|\.[A-Za-z0-9_-]{10,}\./.test(raw),false,'no JWT in storage');
 const firstRefresh=stored.refreshToken;
 // reload: a new session object, same tab storage
 cloud.clock.t+=40*MIN;
 const b=a.reload();
 assert.equal((await b.session.restore()).role,'scorekeeper');
 assert.equal((await b.session.readDesk()).status,'ready');
 const rotated=JSON.parse(a.storage.dump()).refreshToken;
 assert.notEqual(rotated,firstRefresh,'the rotated token replaced the old one');
});
test('persistence is off unless BOTH the build allows it and the person opts in',async()=>{
 const {pass,client}=world();
 const off=client('off',{allowTabPersistence:false});
 assert.equal((await signIn(off,pass,{keepSignedIn:true})).persisted,false);assert.equal(off.storage.size,0);
 const optOut=client('optout',{allowTabPersistence:true});
 assert.equal((await signIn(optOut,pass,{keepSignedIn:false})).persisted,false);assert.equal(optOut.storage.size,0);
 assert.equal(await kindOf(off.reload().session.restore()),'expired');
});
test('a vault that is corrupt, tampered or from another person is discarded and erased',async()=>{
 const {cloud,ids,pass,client}=world();
 const base=()=>({v:1,refreshToken:'abcdefghijkl',userId:ids.a,eventId:EVENT,role:'scorekeeper',
  startedAt:cloud.now()-1000,lastActiveAt:cloud.now()-500});
 const bad=[ 'not json','{"v":1}',JSON.stringify({...base(),extra:'x'}),JSON.stringify({...base(),v:2}),
  JSON.stringify({...base(),refreshToken:'short'}),JSON.stringify({...base(),userId:'nope'}),
  JSON.stringify({...base(),role:'admin'}),JSON.stringify({...base(),lastActiveAt:1}),'x'.repeat(5000),
  JSON.stringify({...base(),accessToken:'aa.bb.cc'})];
 for(const raw of bad){
  const storage=tabStorage();storage.setItem('fftt.m1.staff-session.tab',raw);
  const a=client('v'+Math.random(),{allowTabPersistence:true,storage});
  assert.equal(await kindOf(a.session.restore()),'expired',raw.slice(0,30));
  assert.equal(storage.size,0,'erased: '+raw.slice(0,30));
 }
});
test('restoring with a swapped user or a raised role is refused and erased',async()=>{
 for(const [label,patch] of [['other user',w=>({userId:w.ids.b})],['raised role',()=>({role:'organizer'})]]){
  const w=world();
  const a=w.client('a',{allowTabPersistence:true});
  await signIn(a,w.pass,{keepSignedIn:true});
  const good=JSON.parse(a.storage.dump());
  // a REAL refresh token for A, but the stored pins claim something else
  const storage=tabStorage();
  storage.setItem('fftt.m1.staff-session.tab',JSON.stringify({...good,...patch(w)}));
  const fresh=w.client('r',{allowTabPersistence:true,storage});
  assert.equal(await kindOf(fresh.session.restore()),'revoked',label);
  assert.equal(fresh.session.status.authenticated,false,label);
  assert.equal(storage.size,0,label+': erased');
 }
});
test('a restore that fails because the network is down keeps the vault for a later attempt',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a',{allowTabPersistence:true});
 await signIn(a,pass,{keepSignedIn:true});
 cloud.clock.t+=20*MIN;
 const b=a.reload();b.setOnline(false);
 assert.equal(await kindOf(b.session.restore()),'network');
 assert.equal(a.storage.size,1);
 b.setOnline(true);
 assert.equal((await b.session.restore()).role,'scorekeeper');
});
test('a duplicated tab shares one refresh token: inside the reuse interval both work',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a',{allowTabPersistence:true});
 await signIn(a,pass,{keepSignedIn:true});
 cloud.clock.t+=20*MIN;
 const copy=tabStorage();copy.setItem('fftt.m1.staff-session.tab',a.storage.dump());
 const dup=client('dup',{allowTabPersistence:true,storage:copy});
 assert.equal(await kindOf(a.reload().session.restore()),'ok');
 cloud.clock.t+=5_000; // inside GoTrue's 10 s reuse interval
 assert.equal(await kindOf(dup.session.restore()),'ok');
});
test('a refresh token presented after it was rotated away is treated as theft: the whole session dies',async()=>{
 const {cloud,pass,client}=world();
 const storage=tabStorage();
 const owner=client('owner',{allowTabPersistence:true,storage});
 await signIn(owner,pass,{keepSignedIn:true});
 const oldToken=storage.dump();              // what a duplicated or leaked tab would hold
 cloud.clock.t+=20*MIN;
 await owner.session.readDesk();             // the rightful tab renews: the old token is now spent
 cloud.clock.t+=60_000;                      // well past the reuse interval
 const copy=tabStorage();copy.setItem('fftt.m1.staff-session.tab',oldToken);
 const stale=client('stale',{allowTabPersistence:true,storage:copy});
 assert.equal(await kindOf(stale.session.restore()),'revoked');
 assert.equal(copy.size,0);
 cloud.clock.t+=20*MIN;
 assert.equal(await kindOf(owner.session.readDesk()),'revoked','fails closed: the rightful tab must sign in again');
 assert.equal(cloud.familyCount(),0);
});
test('sign-out revokes on the server, clears every local copy, and works offline too',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a',{allowTabPersistence:true});
 await signIn(a,pass,{keepSignedIn:true});
 const r=await a.session.signOut();
 assert.equal(r.serverRevoked,true);assert.equal(cloud.familyCount(),0);
 assert.equal(a.storage.size,0);assert.equal(await kindOf(a.session.readDesk()),'expired');
 cloud.clock.t+=61_000;
 const b=client('b',{allowTabPersistence:true});
 await signIn(b,pass,{keepSignedIn:true});
 b.setOnline(false);
 const off=await b.session.signOut();
 assert.equal(off.serverRevoked,false);assert.equal(b.storage.size,0);assert.equal(b.session.status.authenticated,false);
 b.setOnline(true);
 assert.equal(await kindOf(b.session.readDesk()),'expired','even if the server copy lingers, this device cannot use it');
});
test('sign-out with an expired access token renews once so the server session can still be revoked',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);
 cloud.clock.t+=30*MIN;
 const before=tokenCalls(a);
 const r=await a.session.signOut({global:true});
 assert.equal(r.serverRevoked,true);assert.equal(tokenCalls(a)-before,1);assert.equal(cloud.familyCount(),0);
});
test('no automatic retry: every failed call is exactly one request',async()=>{
 const {cloud,pass,client}=world();
 const a=client('a');await signIn(a,pass);
 cloud.clock.t+=9*MIN;
 for(let i=0;i<4;i++){cloud.client('a').failNext('/auth/v1/token',500);}
 const before=a.requests();
 await kindOf(a.session.readDesk());
 assert.equal(a.requests()-before,1);
 assert.equal(a.requests(),before+1);
});
test('the session exposes no score, publish, registration or token accessor',()=>{
 const {client}=world();
 const names=Object.keys(client('a').session);
 for(const n of names)assert.equal(/submit|score|publish|register|signUp|token|password|refresh/i.test(n),false,n);
 assert.equal(client('a').session.status.scoreWritesEnabled,false);
});
test('configuration is bounded',()=>{
 const {client}=world();
 for(const bad of [{refreshBeforeMs:1},{idleTimeoutMs:1},{idleTimeoutMs:13*HOUR},{maxSessionMs:25*HOUR},
  {maxFailures:1},{cooldownBaseMs:1},{allowTabPersistence:'yes'}])
  assert.throws(()=>client('x',bad),undefined,JSON.stringify(bad));
});
