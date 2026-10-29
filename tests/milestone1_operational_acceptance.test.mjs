/** Consolidated Milestone 1 operational acceptance, fictional event, disposable simulated cloud.
 * Six isolated clients (organizer, Scorekeeper A, Scorekeeper B, outsider, spectator,
 * TV/projector) run the REAL PKCE guard, transports, staff gate, desk supervisor,
 * score session, public display follower and fallback ledger. Only the cloud is
 * simulated. This is NOT physical-device, hosted-provider or production acceptance.
 */
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSimCloud,EVENT,PRIVATE_CANARIES} from './milestone1_sim_cloud.mjs';
import {makeStaffClient,fakeTimers,followDesk} from './milestone1_sim_clients.mjs';
import {createC3ReadOnlySupabaseTransport} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';
import {projectPublishedResults} from '../contracts/milestone1_public_results.mjs';
import {createMilestone1PublicDisplay} from '../contracts/milestone1_public_display.mjs';
import {createMilestone1FallbackOps,verifyMilestone1IncidentLog,STANDDOWN_METHOD as M}
 from '../contracts/milestone1_fallback_ops.mjs';
const MAIL={org:'organizer@example.invalid',a:'scorekeeper-a@example.invalid',
 b:'scorekeeper-b@example.invalid',out:'outsider@example.invalid'};
const SCORES='11-7, 11-8, 11-9';
const UUID_ANY=/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const settle=()=>new Promise(r=>setImmediate(r));
const digestHex=async t=>createHash('sha256').update(t).digest('hex');
// Every test runs with the process-wide fetch armed to fail: nothing may leave the process.
let hostedFetchAttempts=0,trapArmed=false;
const realFetch=globalThis.fetch;
before(()=>{globalThis.fetch=async()=>{hostedFetchAttempts++;throw new Error('network is forbidden in acceptance tests');};trapArmed=true;});
after(()=>{globalThis.fetch=realFetch;});
function display(cloud,name){
 const net=cloud.client(name),timers=fakeTimers();let online=true;
 const transport=createC3ReadOnlySupabaseTransport({publishableKey:'sb_publishable_synthetic_test_key_1234',
  getAccessToken:()=>{throw new Error('anonymous screens never hold a session');},fetchImpl:net.fetch});
 const d=createMilestone1PublicDisplay({read:()=>transport.readPublicResults(),
  project:projectPublishedResults,isAvailable:()=>online,now:cloud.now,
  isInvalidData:e=>e?.name==='AuthorityGateError'&&!/^C3 read/.test(e.message),
  setTimer:timers.setTimer,cancelTimer:timers.cancelTimer});
 const seen=[];
 return {d,net,seen,
  setOnline(v){online=v;net.setOnline(v);},
  async start(){d.start();await settle();seen.push(JSON.stringify(d.view));},
  async tick(){await timers.fire();await settle();seen.push(JSON.stringify(d.view));}};
}
function scene(){
 const cloud=createSimCloud();
 const ids=Object.fromEntries(Object.entries(MAIL).map(([k,e])=>[k,cloud.addUser(e)]));
 cloud.grant(ids.org,EVENT,'organizer');cloud.grant(ids.a,EVENT,'scorekeeper');cloud.grant(ids.b,EVENT,'scorekeeper');
 const mk=n=>makeStaffClient(cloud,n);
 return {cloud,ids,org:mk('org'),a:mk('a'),b:mk('b'),out:mk('out'),
  spec:display(cloud,'spectator'),tv:display(cloud,'tv')};
}
const firstTwoMatches=async c=>(await c.session.readDesk()).matches;
test('fictional event day: auth, contested scoring, lost response, outage, fallback, reconciliation, recovery',async()=>{
 const w=scene(),{cloud,ids,org,a,b,out,spec,tv}=w;
 const DEVICES=[{id:'scorekeeper-a',label:'Scorekeeper A'},{id:'scorekeeper-b',label:'Scorekeeper B'},{id:'tv-display',label:'TV display'}];
 // 1. independent authentication
 await org.signIn(MAIL.org,EVENT);await a.signIn(MAIL.a,EVENT);await b.signIn(MAIL.b,EVENT);
 await assert.rejects(out.signIn(MAIL.out,EVENT));
 const ops=createMilestone1FallbackOps({eventId:EVENT,revision:1,generation:1,devices:DEVICES,digestHex,now:cloud.now,
  readOrganizerRole:()=>org.transport.readRole({eventId:EVENT,token:org.state.token}),
  readSignedSnapshot:async()=>{
   const s=await org.transport.readSnapshot({eventId:EVENT,token:org.state.token});
   return {eventId:s.event_id,revision:s.revision,generation:s.generation,lifecycle:s.lifecycle,authenticated:true};
  }});
 await ops.checkOrganizer();
 // 2. three staff views follow the authoritative revision
 const sinks={org:[],a:[],b:[]},timers={org:fakeTimers(),a:fakeTimers(),b:fakeTimers()};
 const sup={org:followDesk(org,EVENT,timers.org,sinks.org),a:followDesk(a,EVENT,timers.a,sinks.a),b:followDesk(b,EVENT,timers.b,sinks.b)};
 for(const s of Object.values(sup))s.start();
 await settle();
 for(const k of ['org','a','b']){
  assert.deepEqual(sinks[k].at(-1),{type:'present',revision:1,matches:2,role:k==='org'?'organizer':'scorekeeper'},k);
 }
 // 3. spectator and TV start with nothing published
 await spec.start();await tv.start();
 for(const x of [spec,tv]){assert.equal(x.d.view.state,'current');assert.equal(x.d.view.events.length,0);}
 // 4. contested score on one match, plus a response lost after commit
 let loseB=false,loseA=false;
 const A=a.scoreSession(EVENT,{loseResponse:()=>loseA}),B=b.scoreSession(EVENT,{loseResponse:()=>loseB});
 assert.equal((await A.rig.load()).status,'ready');assert.equal((await B.rig.load()).status,'ready');
 const [m0,m1]=await firstTwoMatches(org).then(()=>A.rig.view.matches);
 const pa=A.rig.prepareScore({matchId:m0.matchId,winnerId:m0.players[0].id,gameScores:SCORES});
 const pb=B.rig.prepareScore({matchId:m0.matchId,winnerId:m0.players[1].id,gameScores:SCORES});
 assert.notEqual(pa.submissionId,pb.submissionId);
 await A.rig.submitPrepared({submissionId:pa.submissionId,manualIncidentLogConfirmed:true});
 assert.equal((await A.rig.inspectOwnDecision()).status,'confirmed-accepted');
 loseB=true;
 assert.equal((await B.rig.submitPrepared({submissionId:pb.submissionId,manualIncidentLogConfirmed:true})).status,'unknown');
 loseB=false;
 assert.equal((await B.rig.inspectOwnDecision()).status,'confirmed-rejected');
 assert.equal(B.sent(),1,'the lost-response score was never retried');
 await assert.rejects(B.rig.submitPrepared({submissionId:pb.submissionId,manualIncidentLogConfirmed:true}));
 assert.equal(B.sent(),1);
 // 5. every staff view converges on the new authoritative revision
 for(const k of ['org','a','b']){await timers[k].fire();await settle();}
 for(const k of ['org','a','b']){
  assert.deepEqual(sinks[k].at(-1),{type:'present',revision:2,matches:1,role:k==='org'?'organizer':'scorekeeper'},k);
  const revs=sinks[k].filter(s=>s.type==='present').map(s=>s.revision);
  assert.deepEqual(revs,[...revs].sort((x,y)=>x-y),'revisions never go backwards');
 }
 // 6. publication (simulated organizer action) reaches spectator and TV, privacy-projected
 await spec.tick();await tv.tick();
 assert.equal(spec.d.view.events.length,0,'nothing is public before publication');
 cloud.publish(EVENT);
 await spec.tick();await tv.tick();
 for(const x of [spec,tv]){
  assert.equal(x.d.view.state,'current');
  const ms=x.d.view.events[0].brackets[0].matches;
  assert.equal(ms.length,2);assert.equal(ms.filter(m=>m.status==='complete').length,1);
  assert.equal(ms.find(m=>m.status==='complete').winner,'Ada Quill');
 }
 // 7. a second score whose response is lost right before the outage
 A.rig.acknowledgeAndReset();assert.equal((await A.rig.load()).status,'ready');
 const m1row=A.rig.view.matches[0];
 const pa2=A.rig.prepareScore({matchId:m1row.matchId,winnerId:m1row.players[0].id,gameScores:SCORES});
 loseA=true;
 assert.equal((await A.rig.submitPrepared({submissionId:pa2.submissionId,manualIncidentLogConfirmed:true})).status,'unknown');
 loseA=false;
 // 8. cloud outage: private views clear at once; public screens age and are never shown as current
 const desk=JSON.stringify({fictionalBackup:true,matches:[m0.code,m1row.code]});
 for(const c of [org,a,b]){c.setOnline(false);c.session.pause();}
 spec.setOnline(false);tv.setOnline(false);
 for(const k of ['org','a','b']){await timers[k].fire();await settle();assert.equal(sinks[k].at(-1).type,'clear',k);}
 cloud.clock.t+=25_000;await tv.tick();
 assert.equal(tv.d.view.state,'stale');assert.ok(tv.d.view.ageMs>=25_000);assert.equal(tv.d.view.events.length,1);
 // 9. organizer fallback: stand-down, protected backup, isolated single-device authority
 await ops.declareOutage({unknownSubmissions:[{submissionId:pa2.submissionId,matchCode:m1row.code}]});
 await ops.requestStandDown();
 await ops.acknowledgeStandDown({deviceId:'scorekeeper-a',method:M.PHYSICALLY_OBSERVED});
 await ops.acknowledgeStandDown({deviceId:'scorekeeper-b',method:M.PHYSICALLY_OBSERVED});
 await ops.acknowledgeStandDown({deviceId:'tv-display',method:M.SIMULATED});
 await ops.sealBackup(desk,{storedInProtectedLocation:true});
 assert.deepEqual(await ops.verifyBackup(desk),{intact:true});
 await ops.beginFallback({organizerApproved:true,manualLogReady:true});
 assert.equal(ops.view.physicalStandDownConfirmed,false,'one device acknowledged only in simulation');
 const off=await ops.recordOfflineResult({matchCode:m1row.code,winnerSlot:2,gameScores:'11-9, 9-11, 11-7',writtenToPaperLog:true});
 const decisionsDuringFallback=cloud.scoreSubmitCount();
 assert.equal(decisionsDuringFallback,3,'A\'s lost-response score reached the cloud before the outage; nothing else');
 await assert.rejects(A.rig.submitPrepared({submissionId:pa2.submissionId,manualIncidentLogConfirmed:true}),/./,'unknown score cannot be re-sent');
 cloud.clock.t+=100_000;await tv.tick();
 assert.equal(tv.d.view.state,'empty','TV expired its stale data instead of showing it forever');
 // 10. connectivity returns: nothing resumes by itself
 for(const c of [org,a,b])c.setOnline(true);spec.setOnline(true);tv.setOnline(true);
 for(const k of ['org','a','b']){await timers[k].fire();await settle();}
 assert.equal(sup.org.running,false,'private following stays stopped until a person restarts it');
 assert.equal(cloud.scoreSubmitCount(),decisionsDuringFallback);
 await ops.reconnect();
 cloud.clock.t+=61_000;
 await org.signIn(MAIL.org,EVENT);await a.signIn(MAIL.a,EVENT);
 await ops.checkOrganizer();
 await ops.verifyBackup(desk);
 // 11. manual reconciliation: the cloud is authoritative; the paper result is NOT merged
 assert.equal((await A.rig.inspectOwnDecision()).status,'confirmed-accepted');
 await ops.resolveUnknownScore({submissionId:pa2.submissionId,
  serverDecision:{verifiedFromServer:true,submissionId:pa2.submissionId,status:A.rig.view.decision}});
 await ops.dispositionOfflineResult({id:off.id,disposition:'cloud-already-authoritative-discard-offline',
  outcomeNote:'cloud decision differs from paper log'});
 await ops.reconcile({organizerApproved:true,privateBackupReviewed:true,manualLogReviewed:true});
 await ops.verifyCloudReadOnly();
 for(const d of DEVICES)await ops.releaseDevice({deviceId:d.id});
 const ready=ops.cloudReadiness();
 assert.equal(ready.ready,true);assert.equal(ready.scoreWritesEnabled,false);
 assert.equal(cloud.event(EVENT).matches.get(m1row.matchId).winner,'Cy Dunn',
  'authoritative winner is A\'s accepted cloud decision, not the offline result');
 // 12. public screens recover on their own and show only cloud-authoritative results
 await spec.tick();await tv.tick();
 for(const x of [spec,tv]){
  assert.equal(x.d.view.state,'current');
  assert.equal(x.d.view.events[0].brackets[0].matches.every(m=>m.status==='complete'),true);
  assert.equal(x.d.view.events[0].brackets[0].matches.find(m=>m.status==='complete'&&m.players.startsWith('Cy')).winner,'Cy Dunn');
 }
 A.rig.acknowledgeAndReset();assert.equal((await A.rig.load()).matches.length,0);
 // 13. conservation and privacy invariants
 const statuses=[...cloud.event(EVENT).decisions.values()].map(d=>d.status).sort();
 assert.deepEqual(statuses,['accepted','accepted','rejected']);
 assert.equal(cloud.event(EVENT).revision,3);
 assert.equal(out.session.status.canRead,false);
 assert.equal(cloud.log.filter(l=>l.client==='out'&&l.path.includes('matchdesk')).length,0);
 assert.equal(cloud.userId('nobody@example.invalid'),undefined);
 assert.equal(await ops.verifyLog(),true);
 const rec=await ops.exportIncidentRecord();
 assert.equal(await verifyMilestone1IncidentLog(rec.log,digestHex),true);
 const kinds=rec.log.map(e=>e.kind);
 for(const k of ['outage-declared','stand-down-ack','backup-sealed','fallback-begun','offline-result-recorded',
  'offline-result-disposition','unknown-score-resolved','reconciliation-signed-off','cloud-read-verified','device-released'])
  assert.ok(kinds.includes(k),k);
 const publicText=[...spec.seen,...tv.seen].join('\n');
 for(const canary of PRIVATE_CANARIES)assert.equal(publicText.includes(canary),false,canary);
 assert.equal(UUID_ANY.test(publicText),false,'no private identifiers on public screens');
 assert.equal(publicText.includes('@'),false);
 assert.equal(hostedFetchAttempts,0,'no request ever left the simulation');
 for(const c of [org,a,b,out])c.session.signOut();
 for(const c of [org,a,b,out])assert.equal(c.tabs.size,0);
});
test('three scorers race one match: exactly one accepted, others durably rejected, nobody retries',async()=>{
 const {cloud,org,a,b}=scene();
 await org.signIn(MAIL.org,EVENT);await a.signIn(MAIL.a,EVENT);await b.signIn(MAIL.b,EVENT);
 const rigs=[org,a,b].map(c=>c.scoreSession(EVENT));
 for(const r of rigs)assert.equal((await r.rig.load()).status,'ready');
 const row=rigs[0].rig.view.matches[0];
 const prepared=rigs.map((r,i)=>r.rig.prepareScore({matchId:row.matchId,winnerId:row.players[i%2].id,gameScores:SCORES}));
 await Promise.all(rigs.map((r,i)=>r.rig.submitPrepared({submissionId:prepared[i].submissionId,manualIncidentLogConfirmed:true})));
 const results=[];
 for(const r of rigs)results.push((await r.rig.inspectOwnDecision()).status);
 assert.equal(results.filter(s=>s==='confirmed-accepted').length,1);
 assert.equal(results.filter(s=>s==='confirmed-rejected').length,2);
 const m=cloud.event(EVENT).matches.get(row.matchId);
 assert.equal(m.version,1);assert.equal(cloud.event(EVENT).revision,2);
 assert.deepEqual(rigs.map(r=>r.sent()),[1,1,1]);
 for(const r of rigs)assert.equal(r.rig.view.scoreReady,false,'no one may continue without a human reset and fresh signed reload');
});
test('a scorer cannot read another scorer\'s decision or any other event',async()=>{
 const {cloud,a,b}=scene();
 await a.signIn(MAIL.a,EVENT);await b.signIn(MAIL.b,EVENT);
 const A=a.scoreSession(EVENT);await A.rig.load();
 const row=A.rig.view.matches[0];
 const p=A.rig.prepareScore({matchId:row.matchId,winnerId:row.players[0].id,gameScores:SCORES});
 await A.rig.submitPrepared({submissionId:p.submissionId,manualIncidentLogConfirmed:true});
 assert.equal(cloud.ownSnapshot(a.state.token,{eventId:EVENT,submissionId:p.submissionId}).decision.status,'accepted');
 assert.equal(cloud.ownSnapshot(b.state.token,{eventId:EVENT,submissionId:p.submissionId}).decision,null,'B sees no decision of A');
 assert.throws(()=>cloud.ownSnapshot(a.state.token,{eventId:'abababab-abab-4aba-8aba-abababababab',submissionId:null}));
});
test('revoked scorer: an in-flight prepared score is stopped and no decision is created',async()=>{
 const {cloud,ids,a}=scene();
 await a.signIn(MAIL.a,EVENT);
 const A=a.scoreSession(EVENT);await A.rig.load();
 const row=A.rig.view.matches[0];
 const p=A.rig.prepareScore({matchId:row.matchId,winnerId:row.players[0].id,gameScores:SCORES});
 a.session.pause(); // page-level privacy pause / sign-out
 await assert.rejects(A.rig.submitPrepared({submissionId:p.submissionId,manualIncidentLogConfirmed:true}));
 assert.equal(A.sent(),0);assert.equal(cloud.scoreSubmitCount(),0);
 // and a server-side revoked grant also refuses a direct write with a still-valid token
 const token=a.state.token;cloud.revokeGrant(ids.a,EVENT);
 assert.throws(()=>cloud.submitScore(token,{eventId:EVENT,matchId:row.matchId,submissionId:p.submissionId,
  winnerId:row.players[0].id,bracketGeneration:1,expectedMatchVersion:0,tableNumber:1,gameScores:SCORES}));
 assert.equal(cloud.scoreSubmitCount(),0);
});
test('public screens never receive private fields even if the server regresses',async()=>{
 const {cloud,spec}=scene();
 cloud.publish(EVENT);
 await spec.start();assert.equal(spec.d.view.state,'current');
 // simulate a server bug: private fields leak into the public route
 const real=cloud.event(EVENT).matches;
 for(const m of real.values())m.p1.leak=true;
 const leaky=cloud.client('spectator').fetch;
 const wrapped=async(url,init)=>{const r=await leaky(url,init);
  if(!url.includes('fftt_public_results_v1'))return r;
  const rows=await r.json();rows[0].brackets[0].matches[0].player_1_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  return {status:200,json:async()=>rows};};
 const t=createC3ReadOnlySupabaseTransport({publishableKey:'sb_publishable_synthetic_test_key_1234',
  getAccessToken:()=>{throw Error('none');},fetchImpl:wrapped});
 await assert.rejects(t.readPublicResults(),'transport allowlist rejects the leaked field');
 assert.throws(()=>projectPublishedResults([{event_id:EVENT,event_name:'x',event_date:'2099-01-01',status:'active',
  updated_at:'x',brackets:[],contact:PRIVATE_CANARIES[0]}]));
});
test('revocation while a desk is being followed clears the view and stops following',async()=>{
 const {cloud,ids,a}=scene();
 await a.signIn(MAIL.a,EVENT);
 const timers=fakeTimers(),sink=[];
 const sup=followDesk(a,EVENT,timers,sink);
 sup.start();await settle();
 assert.equal(sink.at(-1).type,'present');
 cloud.revokeGrant(ids.a,EVENT);
 await timers.fire();await settle();
 assert.deepEqual(sink.at(-1),{type:'clear',reason:'denied'});
 assert.equal(sup.running,false);
 assert.equal(timers.pending(),0,'no further reads are scheduled');
 assert.equal(a.session.status.canRead,false);
});
test('an event that changes during a desk read is never presented as one consistent revision',async()=>{
 const {cloud,a}=scene();
 await a.signIn(MAIL.a,EVENT);
 cloud.hooks.onMatchdesk=e=>{e.revision++;};
 await assert.rejects(a.session.readDesk(),/./,'first and second revision reads disagree');
 assert.equal(a.session.status.canRead,false);
 cloud.hooks.onMatchdesk=null;
});
test('callback tampering (state, code swap, extra parameters) burns the verifier and signs nobody in',async()=>{
 const tampers={
  state:cb=>cb.replace(/state=[^&]+/,'state='+'Z'.repeat(43)),
  extraParam:cb=>cb+'&access_token=header.payload.signature',
  fragment:cb=>cb+'#access_token=header.payload.signature',
  otherPath:cb=>cb.replace('hosted-pkce.html','staff-pkce.html'),
  otherOrigin:cb=>cb.replace('localhost:3000','evil.example.invalid'),
 };
 for(const [name,mutate] of Object.entries(tampers)){
  const {cloud,a}=scene();
  await a.requestLink(MAIL.a);
  await assert.rejects(a.session.complete(mutate(cloud.openEmailLink(MAIL.a)),{eventId:EVENT}),/./,name);
  assert.equal(a.tabs.size,0,name+': verifier burned');
  assert.equal(a.session.status.canRead,false,name);
  assert.equal(cloud.log.filter(l=>l.client==='a'&&l.path==='/auth/v1/token').length,0,name+': no code exchange attempted');
 }
});
test('acceptance harness reached no hosted service',()=>{
 assert.equal(trapArmed,true,'the process-wide fetch trap was armed for this run');
 assert.equal(globalThis.fetch.toString().includes('network is forbidden'),true);
 assert.equal(hostedFetchAttempts,0);
});
