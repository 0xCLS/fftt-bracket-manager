import test from "node:test";
import assert from "node:assert/strict";
import {C8MagicLinkAuth} from "../contracts/phase1c_c8_magic_link.mjs";
import {createC3ReadOnlySupabaseTransport} from "../contracts/phase1c_c3_readonly_supabase_transport.mjs";

const KEY="sb_publishable_synthetic_mock_key_123456";
const EVENT="12345678-1234-4234-8234-123456789012";
const PERSON="87654321-4321-4321-8321-210987654321";
const callbackToken="header.payload.signature";
function fakeCallback(){return {pathname:"/rehearsals/c8/index.html",search:"",hash:"#access_token="+callbackToken+"&token_type=bearer&expires_in=3600&type=magiclink"};}
function harness({email,role,desk=[],rejectIdentity=false}){
 const calls=[];
 const fetchImpl=async(url,init)=>{
  calls.push({path:new URL(url).pathname,method:init.method,body:init.body||null});
  const path=new URL(url).pathname;
  if(path==="/auth/v1/user")return {status:rejectIdentity?403:200,json:async()=>({id:PERSON,email})};
  if(path.endsWith("/fftt_staff_role_v1"))return {status:role?200:403,json:async()=>role};
  if(path.endsWith("/fftt_matchdesk_v1"))return {status:role?200:403,json:async()=>desk};
  if(path.endsWith("/fftt_public_results_v1"))return {status:200,json:async()=>[]};
  throw Error("Unapproved endpoint in mock");
 };
 const auth=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl});
 const transport=createC3ReadOnlySupabaseTransport({publishableKey:KEY,fetchImpl,getAccessToken:()=>auth.accessToken()});
 return {auth,transport,calls};
}
async function signIn(h,email){
 const loc=fakeCallback(),history={replaceState(_a,_b,path){assert.equal(path,loc.pathname);}};
 assert.equal(h.auth.consumeLocation(loc,history),true);
 assert.equal(h.auth.status.authenticated,false);
 await h.auth.verifyReturningEmail(email);
 assert.equal(h.auth.status.authenticated,true);
}
test("scorekeeper has independently verified identity and only allowed empty desk",async()=>{
 const email="synthetic-scorekeeper@example.invalid";
 const h=harness({email,role:"scorekeeper"});
 await signIn(h,email);
 assert.equal(await h.transport.readStaffRole({eventId:EVENT}),"scorekeeper");
 assert.deepEqual(await h.transport.readMatchdesk({eventId:EVENT}),[]);
 assert.deepEqual(await h.transport.readPublicResults(),[]);
 assert.equal(h.calls.filter(c=>c.path==="/auth/v1/otp").length,0);
 assert.equal(h.calls.filter(c=>c.path.endsWith("/fftt_matchdesk_v1")).length,1);
 h.auth.end();
 await assert.rejects(h.transport.readStaffRole({eventId:EVENT}));
});
test("outsider can be authenticated yet cannot access staff role or matchdesk",async()=>{
 const email="synthetic-outsider@example.invalid";
 const h=harness({email,role:null});
 await signIn(h,email);
 await assert.rejects(h.transport.readStaffRole({eventId:EVENT}));
 await assert.rejects(h.transport.readMatchdesk({eventId:EVENT}));
 assert.deepEqual(await h.transport.readPublicResults(),[]);
 assert.equal(h.calls.some(c=>c.path.includes("submit")||c.path.includes("grant")),false);
});
test("wrong signed-in identity never reaches private role endpoint",async()=>{
 const h=harness({email:"other@example.invalid",role:"scorekeeper"});
 const loc=fakeCallback();h.auth.consumeLocation(loc,{replaceState(){}});
 await assert.rejects(h.auth.verifyReturningEmail("synthetic-scorekeeper@example.invalid"));
 await assert.rejects(h.transport.readStaffRole({eventId:EVENT}));
 assert.equal(h.calls.some(c=>c.path.endsWith("/fftt_staff_role_v1")),false);
});
test("rejected Auth identity never grants a role",async()=>{
 const h=harness({email:"synthetic-scorekeeper@example.invalid",role:"scorekeeper",rejectIdentity:true});
 const loc=fakeCallback();h.auth.consumeLocation(loc,{replaceState(){}});
 await assert.rejects(h.auth.verifyReturningEmail("synthetic-scorekeeper@example.invalid"));
 await assert.rejects(h.transport.readMatchdesk({eventId:EVENT}));
});
test("C9 exercises no hosted requests, scoring, staff changes or account creation",async()=>{
 for(const role of ["scorekeeper",null]){
  const email=role?"synthetic-scorekeeper@example.invalid":"synthetic-outsider@example.invalid";
  const h=harness({email,role});
  await signIn(h,email);
  try{await h.transport.readStaffRole({eventId:EVENT});}catch{}
  try{await h.transport.readMatchdesk({eventId:EVENT});}catch{}
  assert.equal(h.calls.every(c=>["/auth/v1/user","/rest/v1/rpc/fftt_staff_role_v1","/rest/v1/rpc/fftt_matchdesk_v1"].includes(c.path)),true);
  assert.equal(h.calls.every(c=>c.method==="GET"||c.method==="POST"),true);
 }
});
