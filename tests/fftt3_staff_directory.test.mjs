import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directoryFromSnapshots,planStaffChange} from '../contracts/staff_people.mjs';
import {createStaffDirectoryClient, StaffDirectoryError} from '../contracts/staff_directory_client.mjs';
import {createStaffDirectoryHandler} from '../server/staff_directory/handler.mjs';
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
function fake({role='organizer',canCreate=true,users=[]}={}){
  const hits=[];
  const responder=async (url,opts)=>{
    const path=new URL(url).pathname;hits.push({path,method:opts.method,auth:opts.headers.Authorization,body:opts.body});
    const json=x=>new Response(JSON.stringify(x),{status:200});
    if(path==='/auth/v1/user')return json({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',is_anonymous:false});
    if(path.endsWith('/fftt_staff_role_v1'))return json(role);
    if(path.endsWith('/fftt_my_events_v4'))return json([{event_id:EVENT_A,role:'organizer',can_create:canCreate}]);
    if(path==='/auth/v1/admin/users')return json({users});
    if(path==='/auth/v1/invite')return json({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',email:EMAIL,app_metadata:{}});
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
