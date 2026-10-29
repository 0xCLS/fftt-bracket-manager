import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimCloud,EVENT,OTHER_EVENT} from './milestone1_sim_cloud.mjs';
import {makeStaffClient,fakeTimers,followDesk} from './milestone1_sim_clients.mjs';
const MAIL={org:'organizer@example.invalid',a:'scorekeeper-a@example.invalid',
 b:'scorekeeper-b@example.invalid',out:'outsider@example.invalid'};
function world(opts){
 const cloud=createSimCloud();
 const ids=Object.fromEntries(Object.entries(MAIL).map(([k,e])=>[k,cloud.addUser(e)]));
 cloud.grant(ids.org,EVENT,'organizer');cloud.grant(ids.a,EVENT,'scorekeeper');
 cloud.grant(ids.b,EVENT,'scorekeeper');
 return {cloud,ids,client:(n,o)=>makeStaffClient(cloud,n,o??opts)};
}
const matchdeskCalls=(cloud,name)=>cloud.log.filter(l=>l.client===name&&l.path.endsWith('/fftt_matchdesk_v1')).length;
test('four independent devices authenticate; the outsider never reaches the private Match Desk',async()=>{
 const {cloud,client}=world();
 const org=client('org'),a=client('a'),b=client('b'),out=client('out');
 assert.equal((await org.signIn(MAIL.org,EVENT)).role,'organizer');
 assert.equal((await a.signIn(MAIL.a,EVENT)).role,'scorekeeper');
 assert.equal((await b.signIn(MAIL.b,EVENT)).role,'scorekeeper');
 await assert.rejects(out.signIn(MAIL.out,EVENT));
 assert.equal(matchdeskCalls(cloud,'out'),0);
 assert.equal(out.session.status.canRead,false);
 await assert.rejects(out.session.readDesk());
 for(const c of [org,a,b]){const v=await c.session.readDesk();
  assert.equal(v.status,'ready');assert.equal(v.matches.length,2);assert.equal(v.revision,1);}
 for(const c of [org,a,b,out])assert.equal(c.tabs.size,0,'no PKCE vault entry or token left in tab storage');
});
test('sign-in never creates accounts and rate-limits are not retried',async()=>{
 const {cloud,client}=world();
 const ghost=client('ghost');
 await assert.rejects(ghost.requestLink('nobody@example.invalid'));
 assert.equal(cloud.userId('nobody@example.invalid'),undefined);
 assert.equal(ghost.tabs.size,0);
 const a=client('a');
 await a.requestLink(MAIL.a);
 const before=cloud.log.filter(l=>l.path==='/auth/v1/otp').length;
 await assert.rejects(a.requestLink(MAIL.a)); // inside the 60 s provider window -> 429
 assert.equal(cloud.log.filter(l=>l.path==='/auth/v1/otp').length,before+1,'exactly one further attempt, no retry loop');
 assert.equal(a.tabs.size,0,'failed request leaves no verifier');
});
test('one-time link: replay, scanner pre-fetch and other-device delivery all fail closed',async()=>{
 const {cloud,client}=world();
 const a=client('a'),other=client('other');
 await a.requestLink(MAIL.a);
 const callback=cloud.openEmailLink(MAIL.a);
 await assert.rejects(other.session.complete(callback,{eventId:EVENT})); // wrong tab: no verifier
 // verifier is tab-scoped and was consumed by the failed attempt in A? no: other had none.
 await assert.rejects(a.session.complete(callback.replace(/code=[^&]+/,'code='+'x'.repeat(40)),{eventId:EVENT}));
 assert.equal(a.tabs.size,0,'verifier burned on first completion attempt');
 const b=client('b');
 await b.requestLink(MAIL.b);
 cloud.openEmailLink(MAIL.b); // mail scanner consumes the one-time token
 const second=cloud.openEmailLink(MAIL.b); // human then gets the error redirect
 await assert.rejects(b.session.complete(second,{eventId:EVENT}));
 assert.equal(b.session.status.canRead,false);
});
test('revoked event grant: that device is denied and cleared, others keep working',async()=>{
 const {cloud,ids,client}=world();
 const a=client('a'),b=client('b');
 await a.signIn(MAIL.a,EVENT);await b.signIn(MAIL.b,EVENT);
 assert.equal((await a.session.readDesk()).matches.length,2);
 cloud.revokeGrant(ids.a,EVENT);
 await assert.rejects(a.session.readDesk());
 assert.equal(a.session.status.canRead,false);
 await assert.rejects(a.session.readDesk(),/./,'stays denied after clearing');
 assert.equal((await b.session.readDesk()).status,'ready');
});
test('role change, even an upgrade, requires a brand-new sign-in',async()=>{
 const {cloud,ids,client}=world();
 const a=client('a');await a.signIn(MAIL.a,EVENT);
 cloud.grant(ids.a,EVENT,'organizer');
 await assert.rejects(a.session.readDesk());
 assert.equal(a.session.status.canRead,false);
});
test('expired authentication fails closed without a refresh token',async()=>{
 const {cloud,client}=world();
 const a=client('a');await a.signIn(MAIL.a,EVENT);
 cloud.clock.t+=3599_000;assert.equal((await a.session.readDesk()).status,'ready');
 cloud.clock.t+=2_000;
 await assert.rejects(a.session.readDesk());
 assert.equal(a.session.status.authenticated,false);
 assert.equal(a.tabs.dump().includes('sim-refresh'),false);
});
test('identity change under a still-valid token is denied (account swap)',async()=>{
 const {cloud,ids,client}=world();
 const a=client('a');await a.signIn(MAIL.a,EVENT);
 cloud.swapIdentity(a.state.token,ids.b);
 await assert.rejects(a.session.readDesk());
 assert.equal(a.session.status.canRead,false);
});
test('global sign-out (session revocation) ends access on every device of that account',async()=>{
 const {cloud,ids,client}=world();
 const a1=client('a1'),a2=client('a2');
 cloud.clock.t+=61_000;await a1.signIn(MAIL.a,EVENT);
 cloud.clock.t+=61_000;await a2.signIn(MAIL.a,EVENT);
 cloud.clock.t+=1;cloud.revokeSessions(ids.a);
 await assert.rejects(a1.session.readDesk());await assert.rejects(a2.session.readDesk());
});
test('a grant for one event confers nothing on another event',async()=>{
 const {client}=world();
 const a=client('a');
 await assert.rejects(a.signIn(MAIL.a,OTHER_EVENT));
 assert.equal(a.session.status.canRead,false);
});
test('disconnect clears private state and reconnecting alone does not resume it',async()=>{
 const {client}=world();
 const a=client('a');await a.signIn(MAIL.a,EVENT);
 const timers=fakeTimers(),sink=[];
 const sup=followDesk(a,EVENT,timers,sink);
 sup.start();await timers.fire();
 assert.ok(sink.some(s=>s.type==='present'&&s.revision===1));
 a.setOnline(false);
 a.session.pause(); // the page's `offline` handler (privacyPause)
 await timers.fire();
 assert.equal(sup.running,false);
 assert.equal(sink.at(-1).type,'clear');
 a.setOnline(true);
 await timers.fire();
 assert.equal(timers.pending(),0,'no automatic restart');
 await assert.rejects(a.session.readDesk(),/./,'a paused session cannot read after reconnect');
 assert.equal(a.session.status.canRead,false);
});
test('access revoked while offline is denied on reconnection even if the page never paused',async()=>{
 const {cloud,ids,client}=world();
 const a=client('a');await a.signIn(MAIL.a,EVENT);
 a.setOnline(false);
 await assert.rejects(a.session.readDesk()); // offline read fails closed and clears
 a.setOnline(true);
 const b=client('b');await b.signIn(MAIL.b,EVENT);
 b.setOnline(false);cloud.revokeGrant(ids.b,EVENT);b.setOnline(true);
 await assert.rejects(b.session.readDesk(),/./,'stale in-memory authority is re-proven on every read');
 assert.equal(b.session.status.canRead,false);
});
test('default policy: backgrounding ends the staff session entirely',async()=>{
 const {client}=world();
 const a=client('a');await a.signIn(MAIL.a,EVENT);
 assert.deepEqual({...a.session.suspend()},{suspended:false});
 await assert.rejects(a.session.resume());
 assert.equal(a.session.status.canRead,false);
});
test('opt-in grace: suspend drops authority; resume re-proves identity and role',async()=>{
 const {client,cloud}=world();
 const a=client('a',{backgroundGraceMs:120_000});
 await a.signIn(MAIL.a,EVENT);
 a.setHidden(true);
 assert.equal(a.session.suspend().suspended,true);
 assert.equal(a.session.status.canRead,false);
 assert.equal(a.session.status.suspended,true);
 const callsBefore=cloud.log.length;
 a.setHidden(false);
 assert.equal((await a.session.resume()).role,'scorekeeper');
 assert.ok(cloud.log.length-callsBefore>=2,'fresh /user and role reads were made');
 assert.equal((await a.session.readDesk()).status,'ready');
 assert.equal(a.session.status.suspended,false);
});
test('suspended session cannot read; resume fails after revocation, swap, upgrade, expiry or grace overrun',async()=>{
 const mutations={
  revoked:(w,a)=>w.cloud.revokeGrant(w.ids.a,EVENT),
  swapped:(w,a)=>w.cloud.swapIdentity(a.state.token,w.ids.b),
  upgraded:(w,a)=>w.cloud.grant(w.ids.a,EVENT,'organizer'),
  expired:(w)=>{w.cloud.clock.t+=3_700_000;},
  graceOverrun:(w)=>{w.cloud.clock.t+=121_000;},
  sessionsRevoked:(w)=>w.cloud.revokeSessions(w.ids.a),
 };
 for(const [name,mutate] of Object.entries(mutations)){
  const w=world();
  const a=w.client('a',{backgroundGraceMs:120_000});
  await a.signIn(MAIL.a,EVENT);
  a.session.suspend();
  await assert.rejects(a.session.readDesk(),/./,name+': no reads while suspended');
  const w2=world();const a2=w2.client('a',{backgroundGraceMs:120_000});
  await a2.signIn(MAIL.a,EVENT);a2.session.suspend();
  mutate(w2,a2);
  await assert.rejects(a2.session.resume(),/./,name);
  assert.equal(a2.session.status.canRead,false,name);
  await assert.rejects(a2.session.resume(),/./,name+': a failed resume cannot be retried');
 }
});
test('grace period is bounded and the default keeps suspension disabled',()=>{
 const {client}=world();
 for(const bad of [-1,600_001,1.5,'60'])assert.throws(()=>client('x',{backgroundGraceMs:bad}),undefined,String(bad));
});
test('staff sessions retain no token or email in tab storage across the whole lifecycle',async()=>{
 const {client}=world();
 const a=client('a',{backgroundGraceMs:60_000});
 await a.requestLink(MAIL.a);
 assert.equal(a.tabs.dump().includes('@'),false,'pending vault holds no email');
 await a.completeFromMail(MAIL.a,EVENT);
 a.session.suspend();await a.session.resume();a.session.signOut();
 assert.equal(a.tabs.size,0);
});

function gate(){let open;const wait=new Promise(r=>{open=r;});return {wait,open};}
test('backgrounding during an in-flight poll suspends the session instead of destroying it',async()=>{
 const {cloud,client}=world();
 const a=client('a',{backgroundGraceMs:120_000});await a.signIn(MAIL.a,EVENT);
 const g=gate();
 cloud.hooks.before=async path=>{if(path.endsWith('/fftt_matchdesk_v1'))await g.wait;};
 const inFlight=a.session.readDesk().then(()=>'ok',()=>'denied');
 await new Promise(r=>setImmediate(r));
 assert.equal(a.session.suspend().suspended,true);
 g.open();cloud.hooks.before=null;
 assert.equal(await inFlight,'denied','the interrupted read is discarded');
 assert.equal(a.session.status.suspended,true,'the suspended session survived the interrupted read');
 assert.equal((await a.session.resume()).role,'scorekeeper');
 assert.equal((await a.session.readDesk()).status,'ready');
});
test('backgrounding again during a resume keeps the session suspended, never half-authorized',async()=>{
 const {cloud,client}=world();
 const a=client('a',{backgroundGraceMs:120_000});await a.signIn(MAIL.a,EVENT);
 a.session.suspend();
 const g=gate();
 cloud.hooks.before=async path=>{if(path.endsWith('/fftt_staff_role_v1'))await g.wait;};
 const resuming=a.session.resume().then(()=>'ok',()=>'denied');
 await new Promise(r=>setImmediate(r));
 a.session.suspend(); // user backgrounds the tab again mid-resume
 g.open();cloud.hooks.before=null;
 assert.equal(await resuming,'denied');
 assert.equal(a.session.status.canRead,false,'nothing is readable after the interrupted resume');
 assert.equal(a.session.status.suspended,true);
 assert.equal((await a.session.resume()).role,'scorekeeper');
});
test('pause or sign-out during an in-flight read still ends the session for good',async()=>{
 for(const end of ['pause','signOut']){
  const {cloud,client}=world();
  const a=client('a',{backgroundGraceMs:120_000});await a.signIn(MAIL.a,EVENT);
  const g=gate();
  cloud.hooks.before=async path=>{if(path.endsWith('/fftt_matchdesk_v1'))await g.wait;};
  const inFlight=a.session.readDesk().then(()=>'ok',()=>'denied');
  await new Promise(r=>setImmediate(r));
  a.session[end]();g.open();cloud.hooks.before=null;
  assert.equal(await inFlight,'denied',end);
  assert.equal(a.session.status.canRead,false,end);
  await assert.rejects(a.session.resume(),/./,end+': nothing left to resume');
 }
});
test('repeated suspend calls cannot extend the grace period',async()=>{
 const {cloud,client}=world();
 const a=client('a',{backgroundGraceMs:120_000});await a.signIn(MAIL.a,EVENT);
 a.session.suspend();
 cloud.clock.t+=100_000;
 a.session.suspend(); // another hide event while still away: must not restart the clock
 cloud.clock.t+=30_000; // 130 s since the FIRST suspension
 await assert.rejects(a.session.resume(),/./);
 assert.equal(a.session.status.canRead,false);
});
