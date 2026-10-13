import test from "node:test";
import assert from "node:assert/strict";
import {C8MagicLinkAuth,C8_REDIRECT,safeRequestCategory} from "../contracts/phase1c_c8_magic_link.mjs";
const KEY="sb_publishable_testclientpublic1234";
const TOKEN=["abc","def","ghi"].join(".");
function response(status,payload){return {status,json:async()=>payload};}
function history(){return {path:null,replaceState(_a,_b,path){this.path=path;}};}
function callback(opts={}){
 const p=new URLSearchParams({access_token:TOKEN,token_type:"bearer",expires_in:"3600",type:"magiclink",refresh_token:"discarded"});
 for(const [k,v] of Object.entries(opts))p.set(k,v);
 return {hash:"#"+p,search:"",pathname:"/rehearsals/c8/index.html"};
}
test("fixed exact local callback and no unrequested remote requests",async()=>{
 let calls=0;const a=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl:async()=>{calls++;return response(200,{})}});
 assert.equal(C8_REDIRECT,"http://localhost:3000/rehearsals/c8/index.html");
 assert.equal(a.status.authenticated,false);assert.equal(calls,0);
 await a.requestLink("test@example.org");
 assert.equal(calls,1);
});
test("existing-only request and exact redirect",async()=>{
 let req;const a=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl:async(u,i)=>{req={u,i};return response(200,{})}});
 await a.requestLink("Tester@Example.org");
 const url=new URL(req.u);
 assert.equal(url.pathname,"/auth/v1/otp");
 assert.equal(url.searchParams.get("redirect_to"),C8_REDIRECT);
 assert.deepEqual(JSON.parse(req.i.body),{email:"tester@example.org",create_user:false});
 assert.equal(req.i.credentials,"omit");
});
test("callback is immediately scrubbed, validated with /user, token is memory only",async()=>{
 let requests=[];
 const a=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl:async(u,i)=>{requests.push({u,i});return response(200,{id:"12345678-1234-4234-8234-123456789012",email:"tester@example.org"});}});
 const h=history();assert.equal(a.consumeLocation(callback(),h),true);assert.equal(h.path,"/rehearsals/c8/index.html");
 assert.equal(a.status.authenticated,false);
 await a.verifyReturningEmail("Tester@Example.org");
 assert.equal(a.status.authenticated,true);assert.equal(a.accessToken(),TOKEN);
 assert.equal(requests.length,1);assert.equal(requests[0].u.endsWith("/auth/v1/user"),true);
 a.end();assert.equal(a.status.authenticated,false);
});
test("wrong account, unknown URL parameter, query, and invalid key fail closed",async()=>{
 assert.throws(()=>new C8MagicLinkAuth({publishableKey:"sb_secret_dont",fetchImpl:async()=>{}}));
 const a=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl:async()=>response(200,{id:"12345678-1234-4234-8234-123456789012",email:"other@example.org"})});
 const h=history();assert.equal(a.consumeLocation(callback(),h),true);
 await assert.rejects(()=>a.verifyReturningEmail("tester@example.org"));assert.equal(a.status.authenticated,false);
 const q=callback();q.search="?unexpected=1";assert.equal(a.consumeLocation(q,history()),false);
 assert.equal(a.consumeLocation(callback({not_allowed:"oops"}),history()),false);
});
test("expiration blocks use and avoids session renewal",async()=>{
 let current=1000000;
 const a=new C8MagicLinkAuth({publishableKey:KEY,now:()=>current,fetchImpl:async()=>response(200,{id:"12345678-1234-4234-8234-123456789012",email:"tester@example.org"})});
 a.consumeLocation(callback({expires_in:"60"}),history());
 current+=61000;await assert.rejects(()=>a.verifyReturningEmail("tester@example.org"));
 assert.equal(a.status.authenticated,false);
});

test("failed requests disclose only predefined HTTP category; no response contents",async()=>{
 for(const [status,expected] of [[429,"rate-limited (HTTP 429)"],[400,"invalid request (HTTP 400)"],[401,"authentication denied (HTTP 401)"],[500,"service unavailable (HTTP 5xx)"]]){
  const a=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl:async()=>({status,json:async()=>({secret:"DO-NOT-RENDER"})})});
  await assert.rejects(a.requestLink("test@example.org"),e=>e.name==="C8RequestFailure"&&e.category===expected&&!String(e).includes("DO-NOT-RENDER"));
  assert.equal(a.status.authenticated,false);
 }
 assert.equal(safeRequestCategory(undefined),"request failed (HTTP unknown)");
});
test("network failures produce a safe category, no auto retries",async()=>{
 let count=0;
 const a=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl:async()=>{count++;throw Error("private service response");}});
 await assert.rejects(a.requestLink("test@example.org"),e=>e.category==="network or browser request failure"&&!String(e).includes("private"));
 assert.equal(count,1);
});
