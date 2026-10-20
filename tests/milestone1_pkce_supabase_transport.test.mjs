import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1PkceSupabaseTransport}
 from '../contracts/milestone1_pkce_supabase_transport.mjs';
const HOST='https://copmkalfkkrkzheohwuc.supabase.co';
const PUB='sb_publishable_mock_test_only';
const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL='fictional-user@example.test',S='s'.repeat(48),CODE='c'.repeat(48);
const CHALLENGE='z'.repeat(43),VERIFIER='v'.repeat(64),TOKEN='header.payload.signature';
const REDIRECT='http://127.0.0.1:3030/rehearsals/m1/staff-pkce.html';
function fixture({enabled=true}={}){
 const calls=[];
 const fetchImpl=async(url,init)=>{
   calls.push({url,init});
   const path=new URL(url).pathname;
   const body=path==='/auth/v1/otp'?{}:
     path==='/auth/v1/token'?{access_token:TOKEN,expires_in:3600,token_type:'bearer'}:
     path==='/auth/v1/user'?{id:EVENT}:
     path.endsWith('staff_role_v1')?'scorekeeper':
     path.endsWith('matchdesk_v1')?[]:
     {event_id:EVENT,revision:1,generation:1,lifecycle:'active',
       submission_id:null,decision:null};
   return {status:200,json:async()=>body};
 };
 const client=createMilestone1PkceSupabaseTransport({
   publishableKey:PUB,fetchImpl,allowSyntheticAuthNetwork:enabled});
 return {client,calls};
}
test('default host mode is network-disabled even when user asks for email',async()=>{
 const f=fixture({enabled:false});
 await assert.rejects(()=>f.client.requestExistingUserLink({
    email:EMAIL,state:S,codeChallenge:CHALLENGE,redirectUri:REDIRECT}));
 assert.equal(f.calls.length,0);
});
test('explicit test-only transport emits exact existing-user PKCE OTP shape',async()=>{
 const {client,calls}=fixture();
 await client.requestExistingUserLink({email:EMAIL.toUpperCase(),state:S,
  codeChallenge:CHALLENGE,redirectUri:REDIRECT});
 assert.equal(calls.length,1);
 const request=calls[0],url=new URL(request.url);
 assert.equal(url.origin,HOST);
 assert.equal(url.pathname,'/auth/v1/otp');
 assert.equal(url.searchParams.get('redirect_to'),REDIRECT+'?state='+S);
 assert.deepEqual(JSON.parse(request.init.body),{
  email:EMAIL,create_user:false,code_challenge:CHALLENGE,
  code_challenge_method:'s256'});
 assert.equal(request.init.credentials,'omit');
 assert.equal(request.init.redirect,'error');
 assert.equal(request.init.headers.Authorization,undefined);
});
test('single PKCE exchange and scoped authenticated reads have no write endpoints',async()=>{
 const {client,calls}=fixture();
 const session=await client.exchangeCode({authCode:CODE,codeVerifier:VERIFIER});
 assert.equal(session.access_token,TOKEN);
 const user=await client.readIdentity({token:TOKEN});
 assert.equal(user.id,EVENT);
 assert.equal(await client.readRole({eventId:EVENT,token:TOKEN}),'scorekeeper');
 assert.deepEqual(await client.readMatchdesk({eventId:EVENT,token:TOKEN}),[]);
 const snap=await client.readSnapshot({eventId:EVENT,token:TOKEN});
 assert.equal(snap.revision,1);
 assert.equal(calls.length,5);
 assert.equal(calls.filter(c=>c.url.includes('submit_match_result')).length,0);
 assert.equal(calls.filter(c=>c.url.includes('publish')).length,0);
 assert.equal(calls.filter(c=>c.url.includes('signup')).length,0);
 for(const call of calls){
  assert.equal(call.init.credentials,'omit');
  assert.equal(call.init.redirect,'error');
 }
});
test('invalid OTP redirect, token, event or secret key are refused before network',async()=>{
 const {client,calls}=fixture();
 const invalid=[
  {email:EMAIL,state:S,codeChallenge:CHALLENGE,redirectUri:'http://evil.example/'},
  {email:EMAIL,state:S,codeChallenge:CHALLENGE,redirectUri:REDIRECT+'?access_token=x'},
  {email:EMAIL,state:'short',codeChallenge:CHALLENGE,redirectUri:REDIRECT},
 ];
 for(const args of invalid)
  await assert.rejects(()=>client.requestExistingUserLink(args));
 for(const bad of [null,'abc','sb_secret_forbidden'])
  await assert.rejects(()=>client.readRole({eventId:EVENT,token:bad}));
 await assert.rejects(()=>client.exchangeCode({authCode:'short',codeVerifier:VERIFIER}));
 assert.equal(calls.length,0);
 assert.throws(()=>createMilestone1PkceSupabaseTransport({
   publishableKey:'sb_secret_forbidden',fetchImpl:async()=>({status:200})}));
});
