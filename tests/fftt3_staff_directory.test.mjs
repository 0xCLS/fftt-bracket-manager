import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directoryFromSnapshots,planStaffChange} from '../contracts/staff_people.mjs';
import {createStaffDirectoryClient, StaffDirectoryError} from '../contracts/staff_directory_client.mjs';
import {createStaffDirectoryHandler} from '../server/staff_directory/handler.mjs';
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

// ---- Replacement invitation for an existing, never-confirmed identity (expired link recovery) ----
const PENDING_USER={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',email:EMAIL,email_confirmed_at:null,
  app_metadata:{provider:'email',fftt_staff_directory:true,fftt_staff_name:'Volunteer Name'}};
const invites=mock=>mock.hits.filter(x=>x.path==='/auth/v1/invite');

test('Add Staff on an existing never-confirmed identity sends exactly one replacement invitation to the same account',async()=>{
  const mock=fake({users:[PENDING_USER]}),app=createStaffDirectoryHandler({env:config,fetchImpl:mock.fetchImpl});
  const res=await app(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}));
  assert.equal(res.status,200);
  assert.equal((await res.json()).status,'reinvited');
  assert.equal(invites(mock).length,1,'one message, no automatic retry');
  assert.deepEqual(JSON.parse(invites(mock)[0].body),{email:EMAIL},'no profile data is rewritten by the invitation');
  const idx=mock.hits.findIndex(x=>x.path==='/auth/v1/invite');
  const patchIdx=mock.hits.findIndex(x=>x.path.startsWith('/auth/v1/admin/users/')&&x.method==='PUT');
  assert.ok(patchIdx>=0&&patchIdx<idx,'directory metadata is written before the message so a retry cannot double-send');
  // Never creates, confirms, deletes, re-addresses or grants.
  assert.ok(!mock.hits.some(x=>x.method==='DELETE'||x.path.includes('fftt_set_staff_v3')));
  const patchBody=JSON.parse(mock.hits[patchIdx].body);
  assert.deepEqual(Object.keys(patchBody),['app_metadata'],'only app_metadata is written (no email, no email_confirm)');
  assert.ok(!('email' in patchBody)&&!('email_confirm' in patchBody));
});

test('the replacement invitation redirects only to the pinned Staff callback',async()=>{
  const urls=[];
  const mock=fake({users:[PENDING_USER]});
  const spy=async(url,opts)=>{if(new URL(url).pathname==='/auth/v1/invite')urls.push(new URL(url));return mock.fetchImpl(url,opts);};
  const app=createStaffDirectoryHandler({env:config,fetchImpl:spy});
  await app(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}));
  assert.equal(urls.length,1);
  assert.equal(urls[0].searchParams.get('redirect_to'),ORIGIN+'/app/staff-invite.html');
});

test('a confirmed account is never re-invited, and a banned pending account is not messaged',async()=>{
  for(const user of [{...PENDING_USER,email_confirmed_at:'2026-11-03T00:00:00Z'},{...PENDING_USER,banned_until:'2999-01-01T00:00:00Z'}]){
    const mock=fake({users:[user]}),app=createStaffDirectoryHandler({env:config,fetchImpl:mock.fetchImpl});
    const res=await app(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}));
    assert.equal(res.status,200);
    assert.equal((await res.json()).status,'existing');
    assert.equal(invites(mock).length,0);
  }
});

test('replacement invitations stay disabled until the Staff redirect gate is on, and fail without silent retry',async()=>{
  const off=fake({users:[PENDING_USER]});
  assert.equal((await createStaffDirectoryHandler({env:{...config,STAFF_INVITE_REDIRECT_ENABLED:'false'},fetchImpl:off.fetchImpl})(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}))).status,503);
  assert.equal(invites(off).length,0);
  assert.equal(off.hits.filter(x=>x.path.startsWith('/auth/v1/admin/users/')&&x.method==='PUT').length,0,'nothing is written while the gate is closed');
  const limited=fake({users:[PENDING_USER],inviteStatus:429}),r429=await createStaffDirectoryHandler({env:config,fetchImpl:limited.fetchImpl})(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}));
  assert.equal(r429.status,429);assert.equal((await r429.json()).code,'rate-limited');assert.equal(invites(limited).length,1);
  const down=fake({users:[PENDING_USER],inviteStatus:500}),r503=await createStaffDirectoryHandler({env:config,fetchImpl:down.fetchImpl})(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}));
  assert.equal(r503.status,503);assert.equal((await r503.json()).code,'invite-not-confirmed');assert.equal(invites(down).length,1);
});

test('only an Organizer can trigger a replacement invitation, and the client accepts the new status',async()=>{
  const mock=fake({users:[PENDING_USER],role:'scorekeeper'}),app=createStaffDirectoryHandler({env:config,fetchImpl:mock.fetchImpl});
  assert.equal((await app(makeRequest('add',{email:EMAIL,name:'Volunteer Name'}))).status,403);
  assert.equal(invites(mock).length,0);
  const c=createStaffDirectoryClient({fetchImpl:async()=>new Response(JSON.stringify({status:'reinvited'}),{status:200})});
  assert.equal((await c.request(TOKEN,'add',{eventId:EVENT_A,name:'Volunteer Name',email:EMAIL})).status,'reinvited');
});
