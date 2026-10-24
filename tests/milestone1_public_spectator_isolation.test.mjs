import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createSimCloud,EVENT,PRIVATE_CANARIES} from './milestone1_sim_cloud.mjs';
import {makePasswordClient} from './milestone1_sim_password_clients.mjs';
import {fakeTimers} from './milestone1_sim_clients.mjs';
import {createC3ReadOnlySupabaseTransport} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';
import {projectPublishedResults} from '../contracts/milestone1_public_results.mjs';
import {createMilestone1PublicDisplay} from '../contracts/milestone1_public_display.mjs';
const MAIL='scorekeeper-a@example.invalid';
const settle=()=>new Promise(r=>setImmediate(r));
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
/** Transitive module graph of a page, from real import/script statements. */
function graph(entry){
 const seen=new Set(),queue=[entry];
 while(queue.length){
  const f=queue.pop();if(seen.has(f))continue;seen.add(f);
  const text=read(f);
  const refs=[...text.matchAll(/(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]/g)].map(m=>m[1])
   .concat([...text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]));
  for(const r of refs){
   const base=f.split('/').slice(0,-1);
   for(const part of r.split('/')){if(part==='..')base.pop();else if(part!=='.')base.push(part);}
   queue.push(base.join('/'));
  }
 }
 return [...seen];
}
function world(){
 const cloud=createSimCloud();
 const pass='pw-'+randomUUID();
 const id=cloud.addUser(MAIL,pass);cloud.grant(id,EVENT,'scorekeeper');
 cloud.publish(EVENT);
 return {cloud,pass,id};
}
function display(cloud,name,project=projectPublishedResults){
 const net=cloud.client(name),timers=fakeTimers();
 const transport=createC3ReadOnlySupabaseTransport({publishableKey:'sb_publishable_synthetic_test_key_1234',
  getAccessToken:()=>{throw new Error('anonymous screens never hold a session');},fetchImpl:net.fetch});
 const d=createMilestone1PublicDisplay({read:()=>transport.readPublicResults(),project,isAvailable:()=>true,now:cloud.now,
  isInvalidData:e=>e?.name==='AuthorityGateError'&&!/^C3 read/.test(e.message),
  setTimer:timers.setTimer,cancelTimer:timers.cancelTimer});
 return {d,net,timers,seen:[]};
}
test('spectator and TV need no login: zero Auth requests and no credentials on any request',async()=>{
 const {cloud}=world();
 const spec=display(cloud,'spec'),tv=display(cloud,'tv');
 spec.d.start();tv.d.start();await settle();
 for(let i=0;i<3;i++){cloud.clock.t+=6000;await spec.timers.fire();await tv.timers.fire();await settle();}
 assert.equal(spec.d.view.state,'current');assert.equal(tv.d.view.events.length,1);
 const theirs=cloud.log.filter(l=>l.client==='spec'||l.client==='tv');
 assert.ok(theirs.length>=6);
 assert.equal(theirs.some(l=>l.path.startsWith('/auth/')),false,'no Auth endpoint, so no email can ever be requested');
 assert.equal(theirs.some(l=>l.authz),false,'no Authorization header on any public request');
 assert.deepEqual([...new Set(theirs.map(l=>l.method+' '+l.path))],['GET /rest/v1/fftt_public_results_v1']);
});
test('the public pages cannot reach any staff authentication code or the staff storage key',()=>{
 const forbidden=/pkce|password|staff_session|staff-session|email_code|staff_access|connected_desk|score_session|fallback_ops|device_origin/i;
 for(const page of ['rehearsals/m1/live-spectator.html','rehearsals/m1/tv-display.html']){
  const files=graph(page);
  assert.ok(files.length>=4,page);
  for(const f of files){
   assert.equal(forbidden.test(f),false,page+' imports '+f);
   const text=read(f);
   assert.equal(/fftt\.m1\.staff-session|fftt\.m1\.pkce|sessionStorage|localStorage|\/auth\/v1\//.test(text),false,f);
  }
 }
});
test('the public display module cannot hold or send credentials',()=>{
 const text=read('contracts/milestone1_public_display.mjs');
 for(const banned of ['Authorization','Bearer','access_token','refresh_token','password','apikey'])
  assert.equal(text.includes(banned),false,banned);
});
test('staff credentials and identifiers never appear in what the public sees',async()=>{
 const {cloud,pass,id}=world();
 const staff=makePasswordClient(cloud,'staff');
 await staff.session.signIn({email:MAIL,password:pass,eventId:EVENT});
 await staff.session.readDesk();
 const spec=display(cloud,'spec');spec.d.start();await settle();
 const shown=JSON.stringify(spec.d.view);
 for(const secret of [MAIL,pass,id,EVENT.slice(0,8)+'x',...PRIVATE_CANARIES])assert.equal(shown.includes(secret),false,secret);
 assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(
  JSON.stringify(spec.d.view.events.map(e=>e.brackets))),false,'no UUID inside the public brackets');
 // the public response itself, as the server sent it
 const raw=await (await cloud.client('raw').fetch('https://copmkalfkkrkzheohwuc.supabase.co/rest/v1/fftt_public_results_v1',
  {method:'GET',headers:{apikey:'sb_publishable_synthetic_test_key_1234'}})).json();
 const wire=JSON.stringify(raw);
 for(const secret of [MAIL,pass,id,...PRIVATE_CANARIES])assert.equal(wire.includes(secret),false,'wire: '+secret);
});
test('a public response carrying staff or private fields is rejected and blanks the display',async()=>{
 const leaks={
  'staff email':m=>{m.staff_email=MAIL;},'staff id':m=>{m.user_id='11111111-1111-4111-8111-111111111111';},
  'role':m=>{m.role='organizer';},'rating':m=>{m.rating=PRIVATE_CANARIES[2];},'phone':m=>{m.phone=PRIVATE_CANARIES[1];},
  'contact':m=>{m.contact=PRIVATE_CANARIES[0];},'token':m=>{m.access_token='aa.bb.cc';},
  'player id':m=>{m.player_1_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';},
 };
 for(const [label,mutate] of Object.entries(leaks)){
  const {cloud}=world();
  const spec=display(cloud,'spec');spec.d.start();await settle();
  assert.equal(spec.d.view.state,'current');
  const real=spec.net.fetch;
  const net={fetch:async(url,init)=>{const r=await real(url,init);const rows=await r.json();mutate(rows[0].brackets[0].matches[0]);
   return {status:200,json:async()=>rows,headers:{get:()=>null}};}};
  const transport=createC3ReadOnlySupabaseTransport({publishableKey:'sb_publishable_synthetic_test_key_1234',
   getAccessToken:()=>{throw new Error('none');},fetchImpl:net.fetch});
  const timers=fakeTimers();
  const d=createMilestone1PublicDisplay({read:()=>transport.readPublicResults(),project:projectPublishedResults,
   isAvailable:()=>true,now:cloud.now,isInvalidData:e=>e?.name==='AuthorityGateError'&&!/^C3 read/.test(e.message),
   setTimer:timers.setTimer,cancelTimer:timers.cancelTimer});
  d.start();await settle();
  assert.equal(d.view.state,'empty',label);assert.equal(d.view.blankedByInvalidData,true,label);
  assert.equal(JSON.stringify(d.view).includes('example.invalid')||JSON.stringify(d.view).includes('CANARY'),false,label);
 }
});
test('public views stay readable while staff sign in, are revoked and sign out, and never the other way round',async()=>{
 const {cloud,pass,id}=world();
 const spec=display(cloud,'spec');spec.d.start();await settle();
 const staff=makePasswordClient(cloud,'staff');
 await staff.session.signIn({email:MAIL,password:pass,eventId:EVENT});
 cloud.revokeGrant(id,EVENT);
 await assert.rejects(staff.session.readDesk());
 await staff.session.signOut({global:true});
 cloud.clock.t+=6000;await spec.timers.fire();await settle();
 assert.equal(spec.d.view.state,'current');
 assert.equal(spec.d.view.events.length,1);
 // public traffic never reflects staff state: the spectator made no request to any /auth path
 assert.equal(cloud.log.filter(l=>l.client==='spec'&&l.path.startsWith('/auth/')).length,0);
});
test('a stale public view is labelled stale and expires; staff outages do not change that',async()=>{
 const {cloud}=world();
 const spec=display(cloud,'spec');spec.d.start();await settle();
 spec.net.setOnline(false);
 cloud.clock.t+=25_000;await spec.timers.fire();await settle();
 assert.equal(spec.d.view.state,'stale');
 cloud.clock.t+=110_000;
 assert.equal(spec.d.view.state,'empty');
});
test('a dedicated staff origin and a separate public origin keep storage apart (documented design check)',()=>{
 // The staff page keeps its opt-in vault in sessionStorage of ITS origin. The public pages must never
 // read it; recommended deployment also serves them from a different origin than staff sign-in.
 const doc=read('docs/MILESTONE1_STAGING_HOSTING_2026-10-23.md');
 assert.match(doc,/separate origins?/i);
 assert.match(doc,/public (spectator )?(view|origin)/i);
});
