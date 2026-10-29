import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {createMilestone1BrowserPkcePrimitives as browser}
 from '../contracts/milestone1_pkce_browser_adapter.mjs';
import {createMilestone1PkceGuard as guard}
 from '../contracts/milestone1_pkce_guard.mjs';
import {createMilestone1PkceSupabaseTransport as transportFor}
 from '../contracts/milestone1_pkce_supabase_transport.mjs';
/* Offline model of the supabase/auth (GoTrue) behaviour the hosted trial depends on.
 * Derived from internal/api/{verify,pkce,mail}.go and utilities/request.go; zero network.
 * A pkce_-prefixed email token (chosen per /otp request by code_challenge, NOT by the
 * email template) makes GET /verify 303 to redirect_to with `code` set via url.Values,
 * preserving the existing `state` query. Implicit tokens go in a fragment; PKCE
 * errors go in both query and fragment.
 */
const REDIRECT='http://localhost:3000/rehearsals/m1/hosted-pkce.html';
const C8='http://localhost:3000/rehearsals/c8/index.html';
const ALLOW_M1=REDIRECT+'?state=*';
const AUTH_CODE='5c1e9f2a-3b7d-4e6a-9c1f-2d8b7a6e5f40'; // GoTrue issues UUID auth codes
const TOKEN='header.payload.signature';
const HOST='https://copmkalfkkrkzheohwuc.supabase.co';
const IDENTITY='11111111-1111-4111-8111-111111111111';
const gotruePkceRedirect=(redirectTo,code)=>{
 const u=new URL(redirectTo);u.searchParams.set('code',code);
 u.searchParams.sort(); // Go url.Values.Encode() sorts keys
 return u.toString();
};
const gotruePkceErrorRedirect=redirectTo=>{
 const u=new URL(redirectTo);
 u.searchParams.set('error','access_denied');
 u.searchParams.set('error_code','otp_expired');
 u.searchParams.set('error_description','Email link is invalid or has expired');
 u.hash='error=access_denied&error_code=otp_expired&sb=';
 return u.toString();
};
const gotrueImplicitRedirect=redirectTo=>redirectTo+
 '#access_token='+TOKEN+'&expires_in=3600&refresh_token=r&token_type=bearer&type=magiclink';
// Supabase redirect-URL glob: * = non-separator run, ? = one non-separator, separators are . and /
const globMatches=(pattern,value)=>new RegExp('^'+[...pattern].map(c=>
 c==='*'?'[^./]*':c==='?'?'[^./]':c.replace(/[.+^${}()|[\]\\]/g,'\\$&')).join('')+'$').test(value);
function harness(){
 const values=new Map();
 const tabStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),
  removeItem:k=>values.delete(k)};
 const prims=browser({cryptoImpl:webcrypto,tabStorage});
 const pkce=guard({redirectUri:REDIRECT,...prims});
 const calls=[];
 const transport=transportFor({
  publishableKey:'sb_publishable_mock_test_only',allowSyntheticAuthNetwork:true,
  fetchImpl:async(url,init)=>{calls.push({url,init});
   return {status:200,json:async()=>({})};},
 });
 return {pkce,prims,values,transport,calls};
}
const verifyIdentity=async()=>({verified:true,userId:IDENTITY});
const session={access_token:TOKEN,token_type:'bearer',expires_in:3600};

test('S256 challenge matches the RFC 7636 vector GoTrue verifies against',async()=>{
 const {prims}=harness();
 assert.equal(await prims.challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('request -> GoTrue-shaped callback -> exchange agrees end to end',async()=>{
 const h=harness();
 const params=await h.pkce.begin();
 await h.transport.requestExistingUserLink({email:'fictional@example.test',
  redirectUri:REDIRECT,state:params.state,codeChallenge:params.codeChallenge});
 const otp=h.calls[0];
 const redirectTo=new URL(otp.url).searchParams.get('redirect_to');
 // Flow type is chosen per request by a non-empty code_challenge (+ method), never by template.
 const body=JSON.parse(otp.init.body);
 assert.equal(body.code_challenge,params.codeChallenge);
 assert.equal(body.code_challenge_method,'s256');
 assert.match(body.code_challenge,/^[a-zA-Z._~0-9-]{43,128}$/); // GoTrue codeChallengePattern
 assert.equal(body.create_user,false);
 const callback=gotruePkceRedirect(redirectTo,AUTH_CODE);
 assert.equal(callback,REDIRECT+'?code='+AUTH_CODE+'&state='+params.state);
 let exchanged;
 const result=await h.pkce.complete(callback,{
  exchange:async x=>{exchanged=x;return session},verifyIdentity});
 assert.equal(result.identityVerified,true);
 assert.equal(exchanged.authCode,AUTH_CODE);
 // GoTrue VerifyPKCEChallenge: base64url(sha256(verifier)) === stored challenge
 assert.equal(createHash('sha256').update(exchanged.codeVerifier).digest('base64url'),
  params.codeChallenge);
 assert.equal(h.values.size,0);
 // The exchange itself is the supabase-js / GoTrue pkce grant shape.
 await h.transport.exchangeCode({authCode:exchanged.authCode,codeVerifier:exchanged.codeVerifier});
 const token=h.calls[1];
 assert.equal(token.url,HOST+'/auth/v1/token?grant_type=pkce');
 assert.deepEqual(JSON.parse(token.init.body),
  {auth_code:AUTH_CODE,code_verifier:exchanged.codeVerifier});
});

test('provider error and implicit-flow callbacks fail closed and burn the verifier',async()=>{
 for(const shape of [gotruePkceErrorRedirect,gotrueImplicitRedirect]){
  const h=harness();
  const params=await h.pkce.begin();
  const redirectTo=REDIRECT+'?state='+params.state;
  let exchanges=0;
  await assert.rejects(()=>h.pkce.complete(shape(redirectTo),{
   exchange:async()=>{exchanges++;return session},verifyIdentity}));
  assert.equal(exchanges,0);
  assert.equal(h.values.size,0);
  // A later valid-looking callback cannot reuse the consumed verifier.
  await assert.rejects(()=>h.pkce.complete(gotruePkceRedirect(redirectTo,AUTH_CODE),{
   exchange:async()=>{exchanges++;return session},verifyIdentity}));
  assert.equal(exchanges,0);
 }
});

test('M1 redirect allowlist entry matches only real state-bearing requests, not C8',async()=>{
 for(let i=0;i<20;i++){
  const {prims}=harness();
  const state=prims.createState();
  assert.equal(globMatches(ALLOW_M1,REDIRECT+'?state='+state),true,state);
 }
 assert.equal(globMatches(ALLOW_M1,C8),false);
 assert.equal(globMatches(ALLOW_M1,REDIRECT),false);
 assert.equal(globMatches(ALLOW_M1,REDIRECT+'?state=a/b'),false);
 assert.equal(globMatches(ALLOW_M1,'http://localhost:3000/rehearsals/m1/other.html?state=abc'),false);
});
