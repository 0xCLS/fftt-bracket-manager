import test from "node:test";
import assert from "node:assert/strict";
import {C6ExistingUserOtp} from "../contracts/phase1c_c6_existing_user_otp.mjs";
import {AuthorityGateError} from "../contracts/phase1c_disconnect_reference.mjs";

const KEY="sb_publishable_test_only";
const USER_ID="11111111-1111-4111-8111-111111111111";
const EMAIL="synthetic-organizer@example.test";
const JWT="header.payload.signature";
const okUser={id:USER_ID,email:EMAIL};
const validVerify={access_token:JWT,expires_in:3600,token_type:"bearer",user:okUser};
let now=100000;
function mock({verify=validVerify,user=okUser,otpStatus=200,verifyStatus=200,userStatus=200,throwOn=null}={}){
  const requests=[];
  const fetchImpl=async(url,init)=>{
    const path=new URL(url).pathname;
    requests.push({path,init});
    if(path===throwOn)throw Error("offline");
    if(path==="/auth/v1/otp")return{status:otpStatus,json:async()=>({})};
    if(path==="/auth/v1/verify")return{status:verifyStatus,json:async()=>verify};
    if(path==="/auth/v1/user")return{status:userStatus,json:async()=>user};
    throw Error("Unexpected Auth path");
  };
  return {client:new C6ExistingUserOtp({
    publishableKey:KEY,fetchImpl,now:()=>now
  }),requests};
}
async function signed(h){
  await h.client.requestCode(EMAIL);
  return h.client.verifyCode("123456");
}
async function denied(fn){await assert.rejects(fn,AuthorityGateError);}

test("Auth boundary requires public key, pinned project and explicitly injected network",()=>{
  assert.throws(()=>new C6ExistingUserOtp({publishableKey:"sb_secret_forbidden",fetchImpl:async()=>{}}),AuthorityGateError);
  assert.throws(()=>new C6ExistingUserOtp({publishableKey:KEY,projectUrl:"https://fake.example",fetchImpl:async()=>{}}),AuthorityGateError);
  assert.throws(()=>new C6ExistingUserOtp({publishableKey:KEY}),AuthorityGateError);
});
test("creating Auth session instance never initiates any login requests",()=>{
  const h=mock();assert.equal(h.requests.length,0);
  assert.deepEqual(h.client.status,{state:"signed-out",authenticated:false,busy:false});
});
test("OTP only after explicit request, with create_user false and zero client signup paths",async()=>{
  const h=mock();
  await h.client.requestCode(EMAIL.toUpperCase());
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].path,"/auth/v1/otp");
  const body=JSON.parse(h.requests[0].init.body);
  assert.deepEqual(body,{email:EMAIL,create_user:false});
  assert.equal(h.requests[0].init.method,"POST");
  assert.equal(h.requests[0].init.credentials,"omit");
  assert.equal(h.requests[0].init.redirect,"error");
  assert.equal(h.client.status.state,"awaiting-code");
});
test("OTP refuses invalid input without network",async()=>{
  const h=mock();
  for(const email of ["","somewhere","a@b c","x".repeat(300),null]){
    await denied(()=>h.client.requestCode(email));
  }
  assert.equal(h.requests.length,0);
});
test("no verification before OTP request, or when token is not exactly six digits",async()=>{
  const h=mock();
  await denied(()=>h.client.verifyCode("123456"));
  await h.client.requestCode(EMAIL);
  for(const token of ["12345","1234567","123 456","abcdef",null]){
    await denied(()=>h.client.verifyCode(token));
  }
  assert.equal(h.requests.filter(r=>r.path==="/auth/v1/verify").length,0);
});
test("valid OTP verifies session identity through independent hosted Auth /user request",async()=>{
  const h=mock();
  const r=await signed(h);
  assert.deepEqual(r,{authenticated:true});
  assert.equal(h.client.accessToken(),JWT);
  assert.equal(h.client.status.authenticated,true);
  assert.deepEqual(h.requests.map(r=>r.path),
    ["/auth/v1/otp","/auth/v1/verify","/auth/v1/user"]);
  const verify=JSON.parse(h.requests[1].init.body);
  assert.deepEqual(verify,{type:"email",email:EMAIL,token:"123456"});
  assert.equal(h.requests[2].init.headers.Authorization,"Bearer "+JWT);
  assert.equal(h.requests[2].init.method,"GET");
});
test("identity mismatch between user and verified OTP invalidates entire session",async()=>{
  const h=mock({user:{...okUser,id:"22222222-2222-4222-8222-222222222222"}});
  await h.client.requestCode(EMAIL);
  await denied(()=>h.client.verifyCode("123456"));
  assert.equal(h.client.status.authenticated,false);
  assert.throws(()=>h.client.accessToken(),AuthorityGateError);
});
test("GoTrue session email mismatch is denied even if /user endpoint returns success",async()=>{
  for(const changed of [
    {verify:{...validVerify,user:{...okUser,email:"someone@example.test"}}},
    {user:{...okUser,email:"someone@example.test"}},
  ]){
    const h=mock(changed);await h.client.requestCode(EMAIL);
    await denied(()=>h.client.verifyCode("123456"));
    assert.equal(h.client.status.authenticated,false);
  }
});
test("missing or malformed JWT is rejected, including secret key masquerading as token",async()=>{
  for(const access_token of [null,"","sb_secret_no","a.b","something with spaces"]){
    const h=mock({verify:{...validVerify,access_token}});
    await h.client.requestCode(EMAIL);await denied(()=>h.client.verifyCode("123456"));
    assert.equal(h.requests.some(r=>r.path==="/auth/v1/user"),false);
  }
});
test("unreasonable lifetimes and non-bearer types cannot establish a session",async()=>{
  for(const extras of [{expires_in:-1},{expires_in:0},{expires_in:999999},
    {expires_in:"3600"},{token_type:"unknown"}]){
    const h=mock({verify:{...validVerify,...extras}});
    await h.client.requestCode(EMAIL);await denied(()=>h.client.verifyCode("123456"));
    assert.equal(h.client.status.authenticated,false);
  }
});
test("expired in-memory JWT cannot be used and never refreshes itself",async()=>{
  now=100000;
  const h=mock();await signed(h);
  now+=3600*1000;
  assert.throws(()=>h.client.accessToken(),AuthorityGateError);
  assert.equal(h.client.status.authenticated,false);
  assert.equal(h.requests.length,3);
  now=100000;
});
test("end clears local token and challenge; does not call server logout/reset",async()=>{
  const h=mock();await signed(h);
  assert.deepEqual(h.client.end(),{signedOutLocally:true});
  assert.equal(h.client.status.state,"signed-out");
  assert.throws(()=>h.client.accessToken(),AuthorityGateError);
  assert.deepEqual(h.requests.map(r=>r.path),
    ["/auth/v1/otp","/auth/v1/verify","/auth/v1/user"]);
});
test("HTTP failures or offline timeouts never leave a cached session",async()=>{
  for(const bad of [
    {otpStatus:429},{verifyStatus:400},{userStatus:401},
    {throwOn:"/auth/v1/user"},
  ]){
    const h=mock(bad);
    if(bad.otpStatus)await denied(()=>h.client.requestCode(EMAIL));
    else{await h.client.requestCode(EMAIL);await denied(()=>h.client.verifyCode("123456"));}
    assert.equal(h.client.status.authenticated,false);
  }
});
test("repeated OTP request cannot create another session when signed in",async()=>{
  const h=mock();await signed(h);await denied(()=>h.client.requestCode(EMAIL));
  assert.equal(h.requests.length,3);
});
test("local sign-out during pending verification cannot resurrect old session",async()=>{
  let resolveUser;
  const requests=[];
  const h=new C6ExistingUserOtp({
    publishableKey:KEY,now:()=>100000,
    fetchImpl:async(url,init)=>{
      const path=new URL(url).pathname;
      requests.push(path);
      if(path==="/auth/v1/otp")return{status:200,json:async()=>({})};
      if(path==="/auth/v1/verify")return{status:200,json:async()=>validVerify};
      if(path==="/auth/v1/user")return new Promise(ok=>{resolveUser=ok});
      throw Error("Unlisted auth route");
    },
  });
  await h.requestCode(EMAIL);
  const inFlight=h.verifyCode("123456");
  // Promise advances after auth verify before /user response.
  for(let i=0;i<10&&!resolveUser;i++)await Promise.resolve();
  assert.equal(typeof resolveUser,"function");
  h.end();
  resolveUser({status:200,json:async()=>okUser});
  await denied(()=>inFlight);
  assert.equal(h.status.authenticated,false);
  assert.throws(()=>h.accessToken(),AuthorityGateError);
  assert.deepEqual(requests,["/auth/v1/otp","/auth/v1/verify","/auth/v1/user"]);
});
test("source cannot contain account creation, password reset, Auth admin, persistence or logging",async()=>{
  const fs=await import("node:fs");
  const src=fs.readFileSync(new URL("../contracts/phase1c_c6_existing_user_otp.mjs",import.meta.url),"utf8");
  for(const forbidden of ["/auth/v1/signup","/auth/v1/recover","/auth/v1/admin",
    "fftt_manage_staff","fftt_submit_match_result_v1","localStorage.",
    "sessionStorage.","document.cookie","console.log(", "console.error(",
    "refresh_token:", "window.location.hash", "getSessionFromUrl"]){
    assert.ok(!src.includes(forbidden),"Forbidden executable pattern: "+forbidden);
  }
  assert.ok(src.includes("create_user:false"));
});
