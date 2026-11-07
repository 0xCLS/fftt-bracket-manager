import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directoryFromSnapshots,planStaffChange} from '../contracts/staff_people.mjs';
import {createStaffDirectoryClient, StaffDirectoryError} from '../contracts/staff_directory_client.mjs';
import {createStaffDirectoryHandler} from '../server/staff_directory/handler.mjs';
import {onRequest as staffDirectoryEntrypoint} from '../functions/api/staff-directory.js';
import {createStaffCore} from '../app/staff_core.mjs';
import {C3_HOST} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';

const EVENT_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGIN='https://fftt-staff.clslifestyle.com';
const EMAIL='volunteer@example.org';
const TOKEN='aaa.bbb.ccc';
const admin='sb_secret_'+'a'.repeat(44);
const config={STAFF_ORIGIN:ORIGIN,SUPABASE_URL:C3_HOST,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEF1234567',SUPABASE_ADMIN_SECRET:admin,STAFF_INVITE_REDIRECT_ENABLED:'true'};

test('directory merges existing grants with tagged people without inventing access',()=>{
  const events=[{eventId:EVENT_A,role:'organizer'},{eventId:EVENT_B,role:'organizer'}];
  const people=directoryFromSnapshots(events,{
    [EVENT_A]:{staff:[{email:EMAIL,role:'scorekeeper',active:true},{email:'other@example.org',role:'scorekeeper',active:false}]},
    [EVENT_B]:{staff:[{email:EMAIL,role:'scorekeeper',active:true}]}
  },[{email:EMAIL,name:'Volunteer Example',verified:true,provisioned:true}]);
  assert.equal(people.length,1);
  assert.equal(people[0].name,'Volunteer Example');
  assert.deepEqual(people[0].assignments,{[EVENT_A]:'scorekeeper',[EVENT_B]:'scorekeeper'});
});

test('unchecking a single event revokes only that scope; single role applies to checked events',()=>{
  const events=[{eventId:EVENT_A,role:'organizer'},{eventId:EVENT_B,role:'organizer'}];
  const person={assignments:{[EVENT_A]:'scorekeeper',[EVENT_B]:'scorekeeper'}};
  assert.deepEqual(planStaffChange(person,[EVENT_B],'scorekeeper',events).revoke,[EVENT_A]);
  assert.deepEqual(planStaffChange(person,[EVENT_B],'scorekeeper',events).grant,[]);
  assert.deepEqual(planStaffChange(person,[EVENT_B],'bracket_manager',events).grant,[EVENT_B]);
  assert.throws(()=>planStaffChange(person,[EVENT_B,EVENT_B],'scorekeeper',events),/out-of-scope/);
  assert.throws(()=>planStaffChange(person,['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],'organizer',events),/out-of-scope/);
  assert.throws(()=>planStaffChange(person,[],'scorekeeper',[events[0]]),/unknown-existing-scope/);
});

test('archived event history cannot be changed through the active People directory',()=>{
  const archived={eventId:EVENT_B,role:'organizer',lifecycle:'archived'};
  const live={eventId:EVENT_A,role:'organizer',lifecycle:'active'};
  assert.throws(()=>planStaffChange({assignments:{}},[EVENT_B],'scorekeeper',[live,archived]),/out-of-scope/);
  const people=directoryFromSnapshots([live,archived],{[EVENT_B]:{staff:[{email:EMAIL,role:'scorekeeper',active:true}]}},[]);
  assert.equal(people.length,0,'archived-only grants remain historical and do not become removable assignments');
});

test('client never sends privileged credentials, and refuses malformed response',async()=>{
  let observed=null;
  const c=createStaffDirectoryClient({fetchImpl:async (path,opts)=>{
    observed={path,opts};return new Response(JSON.stringify({people:[]}),{status:200});
  }});
  await c.request(TOKEN,'list',{eventId:EVENT_A});
  assert.equal(observed.path,'/api/staff-directory');
  assert.equal(JSON.parse(observed.opts.body).action,'list');
  assert.equal(observed.opts.headers.Authorization,'Bearer '+TOKEN);
  assert.doesNotMatch(JSON.stringify(observed),/sb_secret_/);
  const bad=createStaffDirectoryClient({fetchImpl:async()=>new Response(JSON.stringify({people:[{email:EMAIL}]}),{status:200})});
  await assert.rejects(bad.request(TOKEN,'list',{eventId:EVENT_A}),e=>e instanceof StaffDirectoryError&&e.kind==='malformed');
});

const makeRequest=(action,more={},origin=ORIGIN,token=TOKEN)=>new Request(ORIGIN+'/api/staff-directory',{
  method:'POST',headers:{origin,authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({action,event_id:EVENT_A,...more})
});
function fake({role='organizer',canCreate=true,users=[],inviteStatus=200}={}){
  const hits=[];
  const responder=async (url,opts)=>{
    const path=new URL(url).pathname;hits.push({path,method:opts.method,auth:opts.headers.Authorization,body:opts.body});
    const json=x=>new Response(JSON.stringify(x),{status:200});
    if(path==='/auth/v1/user')return json({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',is_anonymous:false});
    if(path.endsWith('/fftt_staff_role_v1'))return json(role);
    if(path.endsWith('/fftt_my_events_v4'))return json([{event_id:EVENT_A,role:'organizer',can_create:canCreate}]);
    if(path==='/auth/v1/admin/users')return json({users});
    if(path==='/auth/v1/invite')return inviteStatus!==200?new Response('{}',{status:inviteStatus}):json({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',email:EMAIL,app_metadata:{}});
    if(path.includes('/auth/v1/admin/users/'))return json({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});
    throw Error('unexpected fetch '+url);
  };
  return{hits,fetchImpl:responder};
}

test('unconfigured backend fails closed and never sends network requests',async()=>{
  const mock=fake();
  const app=createStaffDirectoryHandler({env:{...config,SUPABASE_ADMIN_SECRET:null},fetchImpl:mock.fetchImpl});
  const response=await app(makeRequest('list'));
  assert.equal(response.status,503);
  assert.deepEqual(mock.hits,[]);
});

test('cross-origin and signed-out request cannot reach administrator endpoints',async()=>{
  const mock=fake();
  const app=createStaffDirectoryHandler({env:config,fetchImpl:mock.fetchImpl});
  assert.equal((await app(makeRequest('list',{},'https://evil.example'))).status,403);
  assert.equal((await app(makeRequest('list',{},ORIGIN,'bad-token'))).status,401);
  assert.deepEqual(mock.hits,[]);
});

test('scorer and non-platform organizer cannot invite or browse directory',async()=>{
  for(const params of [{role:'scorekeeper'},{canCreate:false}]){
    const mock=fake(params),app=createStaffDirectoryHandler({env:config,fetchImpl:mock.fetchImpl});
    const response=await app(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}));
    assert.equal(response.status,403);
    assert.equal(mock.hits.filter(x=>x.path.startsWith('/auth/v1/admin/')).length,0);
    assert.equal(mock.hits.filter(x=>x.path==='/auth/v1/invite').length,0);
  }
});

test('new invitations are disabled until the exact Staff redirect has been verified',async()=>{
  const mock=fake(),app=createStaffDirectoryHandler({env:{...config,STAFF_INVITE_REDIRECT_ENABLED:'false'},fetchImpl:mock.fetchImpl});
  const res=await app(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}));
  assert.equal(res.status,503);
  assert.equal(mock.hits.filter(x=>x.path==='/auth/v1/invite').length,0);
});

test('an arbitrary Pages domain cannot be configured as the privileged Staff directory host',async()=>{
  const mock=fake(),app=createStaffDirectoryHandler({env:{...config,STAFF_ORIGIN:'https://unrelated.pages.dev'},fetchImpl:mock.fetchImpl});
  const res=await app(makeRequest('list'));
  assert.equal(res.status,503);
  assert.deepEqual(mock.hits,[]);
});

test('approved owner can invite, then directory-tag without adding event role',async()=>{
  const mock=fake(),app=createStaffDirectoryHandler({env:config,fetchImpl:mock.fetchImpl});
  const response=await app(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).status,'invited');
  assert.ok(mock.hits.some(x=>x.path==='/auth/v1/invite'));
  assert.ok(mock.hits.some(x=>x.path.includes('/auth/v1/admin/users/')));
  assert.equal(mock.hits.filter(x=>x.path.includes('fftt_set_staff_v3')).length,0);
});

test('directory removal preserves the Auth user; no DELETE operation or event grant change',async()=>{
  const user={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',email:EMAIL,
    app_metadata:{fftt_staff_directory:true,fftt_staff_name:'Volunteer'},email_confirmed_at:'2026-11-03'};
  const mock=fake({users:[user]});
  const app=createStaffDirectoryHandler({env:config,fetchImpl:mock.fetchImpl});
  const r=await app(makeRequest('archive',{email:EMAIL}));
  assert.equal(r.status,200);
  assert.equal((await r.json()).status,'archived');
  assert.ok(mock.hits.some(x=>x.path.includes('/auth/v1/admin/users/')&&x.method==='PUT'
    &&JSON.parse(x.body).app_metadata.fftt_staff_directory===false));
  assert.ok(!mock.hits.some(x=>x.method==='DELETE'||x.path.includes('fftt_set_staff_v3')));
});

test('the approved People interface is integrated without removing event-scoped permission enforcement',()=>{
  const ui=readFileSync(new URL('../app/staff_ui.mjs',import.meta.url),'utf8');
  const people=readFileSync(new URL('../app/view_staff_people.mjs',import.meta.url),'utf8');
  const core=readFileSync(new URL('../app/staff_core.mjs',import.meta.url),'utf8');
  const staff=readFileSync(new URL('../app/staff.mjs',import.meta.url),'utf8');
  assert.match(ui,/createStaffPeopleView/);
  assert.match(people,/type:'checkbox'/);
  assert.match(people,/people-remove/);
  assert.match(people,/Remove staff member\?/);
  assert.match(core,/planStaffChange/);
  assert.match(core,/api\.setStaff\(ctx\.token/);
  assert.match(staff,/createStaffDirectoryClient/);
  assert.doesNotMatch(staff,/SUPABASE_ADMIN_SECRET/);
});

test('stale directory load cannot repopulate private staff data after sign-out',async()=>{
  let completeSnapshot;
  const pendingSnapshot=new Promise(resolve=>{completeSnapshot=resolve;});
  const core=createStaffCore({
    session:{authorized:fn=>fn({token:TOKEN,eventId:EVENT_A,role:'organizer'})},
    api:{myEvents:async()=>[{eventId:EVENT_A,role:'organizer',lifecycle:'active'}],organizerSnapshot:()=>pendingSnapshot},
    peopleClient:{request:async()=>({people:[]})}
  });
  const s=core.state;
  s.signedIn=true;s.role='organizer';s.eventId=EVENT_A;
  s.events=[{eventId:EVENT_A,role:'organizer',lifecycle:'active'}];
  const request=core.actions.loadStaffDirectory();
  assert.equal(s.staffDirectory.status,'loading');
  core.signedOut(); // clears private state and advances the directory generation
  completeSnapshot({staff:[{email:EMAIL,role:'scorekeeper',active:true}]});
  const result=await request;
  assert.equal(result.ok,false,'superseded response is discarded');
  assert.equal(s.staffDirectory.status,'idle');
  assert.deepEqual(s.staffDirectory.people,[]);
});

test('directory suspends safely and recovers after a verified refresh; failed scope stays read-only',async()=>{
  let calls=0,fail=false;
  const events=[{eventId:EVENT_A,role:'organizer',lifecycle:'active'},{eventId:EVENT_B,role:'organizer',lifecycle:'active'}];
  const core=createStaffCore({session:{authorized:fn=>fn({token:TOKEN,eventId:EVENT_A,role:'organizer'})},
    api:{myEvents:async()=>events,organizerSnapshot:async(token,{p_event_id})=>{calls++;if(fail&&p_event_id===EVENT_B)throw Error('snapshot unavailable');return {staff:[{email:EMAIL,active:true,role:'scorekeeper'}]};}},
    peopleClient:{request:async()=>({people:[]})}});
  const s=core.state; s.signedIn=true;s.role='organizer';s.eventId=EVENT_A;s.events=events;
  assert.equal((await core.actions.loadStaffDirectory()).ok,true);
  assert.equal(calls,2);assert.equal(s.staffDirectory.people.length,1);
  fail=true;assert.equal((await core.actions.loadStaffDirectory()).ok,false);
  assert.equal(s.staffDirectory.status,'error');assert.equal(s.staffDirectory.people.length,1);
  assert.equal((await core.actions.saveStaffPerson(s.staffDirectory.people[0],[EVENT_A],'organizer')).ok,false);
  s.paused=true;const before=calls;await core.actions.loadStaffDirectory();assert.equal(calls,before);
  s.paused=false;fail=false;assert.equal((await core.actions.loadStaffDirectory()).ok,true);
  assert.equal(s.staffDirectory.status,'ready');
});

test('a failed protected directory cannot enable account or access changes',async()=>{
  const events=[{eventId:EVENT_A,role:'organizer',lifecycle:'active'}];
  const core=createStaffCore({session:{authorized:fn=>fn({token:TOKEN,eventId:EVENT_A,role:'organizer'})},
    api:{myEvents:async()=>events,organizerSnapshot:async()=>({staff:[]})},peopleClient:{request:async()=>{throw Error('unavailable');}}});
  Object.assign(core.state,{signedIn:true,role:'organizer',eventId:EVENT_A,events});
  await core.actions.loadStaffDirectory();assert.equal(core.state.staffDirectory.status,'error');
  assert.equal((await core.actions.addStaffPerson('Test',EMAIL)).ok,false);
});

// ---- Replacement invitation for an existing, never-confirmed FFTT Staff identity (expired link recovery) ----
// A small stateful stand-in for Supabase Auth: a send records `confirmation_sent_at`, exactly as Auth does.
const T0=Date.parse('2026-11-05T12:00:00Z'),MIN=60*1000;
const iso=t=>new Date(t).toISOString();
const STAFF_PENDING={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',email:EMAIL,email_confirmed_at:null,invited_at:'2026-11-05T07:43:52Z',
  confirmation_sent_at:'2026-11-05T07:43:52Z',app_metadata:{provider:'email',fftt_staff_directory:true,fftt_staff_name:'Volunteer Name'}};
function authFake({users=[STAFF_PENDING],mode='ok',readFails=false,readFailsAfterInvite=false,staleList=false,delay=0,env={}}={}){
  const store=new Map(users.map(u=>[u.id,JSON.parse(JSON.stringify(u))]));
  const snapshot=[...store.values()].map(u=>JSON.parse(JSON.stringify(u)));
  const state={t:T0,mode,readFails,readFailsAfterInvite,hits:[]};
  const sent=u=>{u.confirmation_sent_at=iso(state.t);};
  const fetchImpl=async(url,opts)=>{
    const u=new URL(url),path=u.pathname,method=opts.method;
    state.hits.push({path,method,body:opts.body,search:u.search});
    const json=(x,status=200)=>new Response(JSON.stringify(x),{status});
    if(path==='/auth/v1/user')return json({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',is_anonymous:false});
    if(path.endsWith('/fftt_staff_role_v1'))return json('organizer');
    if(path.endsWith('/fftt_my_events_v4'))return json([{event_id:EVENT_A,role:'organizer',can_create:true}]);
    if(path==='/auth/v1/admin/users'&&method==='GET')return json({users:staleList?snapshot:[...store.values()]});
    const m=/^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(path);
    if(m&&method==='GET')return state.readFails?json({},503):json(store.get(m[1]));
    if(m&&method==='PUT'){const u0=store.get(m[1]);u0.app_metadata={...u0.app_metadata,...JSON.parse(opts.body).app_metadata};return json(u0);}
    if(path==='/auth/v1/invite'){
      if(delay)await new Promise(r=>setTimeout(r,delay));
      const target=[...store.values()].find(x=>x.email===JSON.parse(opts.body).email);
      if(state.readFailsAfterInvite)state.readFails=true;   // Auth is unreachable from the moment the send is attempted
      switch(state.mode){
        case 'ok':sent(target);return json(target);
        case 'http500-sent':sent(target);return json({},500);
        case 'http500-unsent':return json({},500);
        case 'throw-sent':sent(target);throw new TypeError('network');
        case 'throw-unsent':throw new TypeError('network');
        case 'http429':return json({},429);
      }
    }
    throw Error('unexpected fetch '+method+' '+url);
  };
  const app=createStaffDirectoryHandler({env:{...config,...env},fetchImpl,now:()=>state.t});
  const add=async(extra={})=>{const r=await app(makeRequest('add',{email:EMAIL,name:'Volunteer Name',...extra}));return {status:r.status,body:await r.json()};};
  const calls=path=>state.hits.filter(x=>x.path===path);
  return {state,store,app,add,fetchImpl,invites:()=>calls('/auth/v1/invite'),calls};
}
const mutating=f=>f.state.hits.filter(x=>x.method==='DELETE'||x.path.includes('fftt_set_staff_v3')||(x.path==='/auth/v1/admin/users'&&x.method==='POST'));

test('production entrypoint shares resend lock and uncertain cooldown across requests in one isolate',async()=>{
  const originalFetch=globalThis.fetch, originalNow=Date.now;
  let clock=T0;
  const entry=async()=>{
    const response=await staffDirectoryEntrypoint({env:config,request:makeRequest('add',{email:EMAIL,name:'Volunteer Name'})});
    return {status:response.status,body:await response.json()};
  };
  try{
    Date.now=()=>clock;
    const concurrent=authFake({delay:30,staleList:true});
    globalThis.fetch=concurrent.fetchImpl;
    const results=await Promise.all([entry(),entry()]);
    assert.deepEqual(results.map(r=>r.body.status).sort(),['in-progress','reinvited']);
    assert.ok(results.every(r=>r.status===200));
    assert.equal(concurrent.invites().length,1,'two entrypoint calls initiate only one invitation');

    const uncertain=authFake({mode:'throw-unsent',readFailsAfterInvite:true});
    globalThis.fetch=uncertain.fetchImpl;
    assert.equal((await entry()).body.status,'uncertain');
    uncertain.state.readFails=false;
    assert.equal((await entry()).body.status,'uncertain','a later entrypoint request retains the uncertainty');
    assert.equal(uncertain.invites().length,1,'no second invitation during uncertainty');
    clock+=10*MIN; uncertain.state.t=clock; uncertain.state.readFailsAfterInvite=false; uncertain.state.mode='ok';
    assert.equal((await entry()).body.status,'reinvited','an expired uncertainty is cleared');
    assert.equal(uncertain.invites().length,2);
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});

test('an existing pending FFTT Staff identity gets one replacement to the same account and the pinned callback',async()=>{
  const f=authFake();
  const r=await f.add();
  assert.deepEqual([r.status,r.body.status],[200,'reinvited']);
  assert.equal(f.invites().length,1);
  assert.deepEqual(JSON.parse(f.invites()[0].body),{email:EMAIL},'no profile data is rewritten by the invitation');
  assert.equal(new URLSearchParams(f.invites()[0].search).get('redirect_to'),ORIGIN+'/app/staff-invite.html');
  const idx=f.state.hits.findIndex(x=>x.path==='/auth/v1/invite');
  const put=f.state.hits.findIndex(x=>x.method==='PUT'&&x.path.startsWith('/auth/v1/admin/users/'));
  assert.ok(put>=0&&put<idx,'directory metadata is written before the message');
  assert.deepEqual(Object.keys(JSON.parse(f.state.hits[put].body)),['app_metadata'],'no email, no email_confirm, nothing else');
  assert.equal(f.store.size,1,'no account was created');
  assert.deepEqual(mutating(f),[],'no creation, deletion or event grant');
  assert.equal(f.store.get(STAFF_PENDING.id).email_confirmed_at,null,'nothing is confirmed on the person\'s behalf');
});

test('identities that are not pending FFTT Staff are never messaged: unrelated, untagged-then-tagged, confirmed, banned, archived',async()=>{
  const base={id:'ffffffff-ffff-4fff-8fff-ffffffffffff',email:EMAIL,email_confirmed_at:null};
  const cases={
    'unrelated Auth user (never invited, not in the directory)':{...base,invited_at:null,confirmation_sent_at:null,app_metadata:{provider:'email'}},
    'confirmed staff identity':{...STAFF_PENDING,email_confirmed_at:'2026-11-03T00:00:00Z'},
    'banned pending identity':{...STAFF_PENDING,banned_until:'2999-01-01T00:00:00Z'},
    'pending but archived from the directory':{...STAFF_PENDING,app_metadata:{...STAFF_PENDING.app_metadata,fftt_staff_directory:false}},
  };
  for(const [label,user] of Object.entries(cases)){
    const f=authFake({users:[user]});
    const r=await f.add();
    assert.deepEqual([r.status,r.body.status],[200,'existing'],label);
    assert.equal(f.invites().length,0,label+': no message');
    assert.deepEqual(mutating(f),[],label);
  }
  // Tagging an unrelated account in one call must not make it eligible in the next call.
  const f=authFake({users:[{...base,invited_at:null,confirmation_sent_at:null,app_metadata:{provider:'email'}}]});
  await f.add();
  assert.equal(f.store.get(base.id).app_metadata.fftt_staff_directory,true,'it is tagged (existing behaviour)');
  const again=await f.add();
  assert.equal(again.body.status,'existing');
  assert.equal(f.invites().length,0,'still never messaged: it was never invited by this system');
});

test('repeated requests: a resend inside the cooldown is refused and nothing is sent twice',async()=>{
  const f=authFake();
  assert.equal((await f.add()).body.status,'reinvited');
  f.state.t+=30*1000;
  assert.equal((await f.add()).body.status,'recently-sent');
  f.state.t+=5*MIN;
  assert.equal((await f.add()).body.status,'recently-sent');
  assert.equal(f.invites().length,1,'one message across three requests');
  f.state.t+=6*MIN;   // more than ten minutes since the send: a deliberate, bounded second resend is allowed
  assert.equal((await f.add()).body.status,'reinvited');
  assert.equal(f.invites().length,2);
});

test('concurrent requests send one message; a request holding a stale account list cannot duplicate it',async()=>{
  const f=authFake({delay:25});
  const [a,b]=await Promise.all([f.add(),f.add()]);
  assert.deepEqual([a.body.status,b.body.status].sort(),['in-progress','reinvited']);
  assert.equal(f.invites().length,1);
  const g=authFake({staleList:true});     // the account list always shows the OLD send time
  assert.equal((await g.add()).body.status,'reinvited');
  assert.equal((await g.add()).body.status,'recently-sent','the fresh per-account read overrides the stale list');
  assert.equal(g.invites().length,1);
});

test('uncertain results: Auth\'s own send time decides; if that is unknown nothing more is sent from here',async()=>{
  for(const mode of ['http500-sent','throw-sent']){
    const f=authFake({mode});
    const r=await f.add();
    assert.deepEqual([r.status,r.body.status],[200,'reinvited'],mode+': Auth recorded a send');
    assert.equal(f.invites().length,1);
  }
  for(const mode of ['http500-unsent','throw-unsent']){
    const f=authFake({mode});
    const r=await f.add();
    assert.equal(r.status,503);assert.equal(r.body.code,'invite-not-confirmed');
    f.state.mode='ok';                      // Auth shows nothing was sent, so a retry is safe and sends once
    assert.equal((await f.add()).body.status,'reinvited');
    assert.equal(f.invites().length,2,mode+': one failed attempt that sent nothing, one real send');
  }
  const u=authFake({mode:'throw-sent',readFailsAfterInvite:true});
  const first=await u.add();
  assert.deepEqual([first.status,first.body.status],[200,'uncertain'],'cannot tell: reported as uncertain, never as sent');
  u.state.mode='ok';u.state.readFails=false;u.state.readFailsAfterInvite=false;
  assert.equal((await u.add()).body.status,'uncertain','no automatic or immediate second send after an unconfirmed outcome');
  assert.equal(u.invites().length,1);
  u.state.t+=5*MIN;
  assert.equal((await u.add()).body.status,'uncertain','still blocked inside the cooldown');
  assert.equal(u.invites().length,1);
  u.state.t+=6*MIN;   // eleven minutes after the (recorded) send: a deliberate, bounded resend is allowed again
  assert.equal((await u.add()).body.status,'reinvited');
  assert.equal(u.invites().length,2);
  const limited=authFake({mode:'http429'}),lim=await limited.add();
  assert.equal(lim.status,429);assert.equal(lim.body.code,'rate-limited');assert.equal(limited.invites().length,1);
});

test('replacement invitations stay behind the redirect gate and the Organizer check',async()=>{
  const off=authFake({env:{STAFF_INVITE_REDIRECT_ENABLED:'false'}}),closed=await off.add();
  assert.equal(closed.status,503);
  assert.equal(off.invites().length,0);
  assert.equal(off.state.hits.filter(x=>x.method==='PUT').length,0,'nothing is written while the redirect gate is closed');
  const scorer=fake({users:[STAFF_PENDING],role:'scorekeeper'}),denied=createStaffDirectoryHandler({env:config,fetchImpl:scorer.fetchImpl});
  assert.equal((await denied(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}))).status,403);
  assert.equal(scorer.hits.filter(x=>x.path==='/auth/v1/invite').length,0);
  for(const status of ['reinvited','recently-sent','in-progress','uncertain']){
    const client=createStaffDirectoryClient({fetchImpl:async()=>new Response(JSON.stringify({status}),{status:200})});
    assert.equal((await client.request(TOKEN,'add',{eventId:EVENT_A,name:'Volunteer Name',email:EMAIL})).status,status);
  }
});
