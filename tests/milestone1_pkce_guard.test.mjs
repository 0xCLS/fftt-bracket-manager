import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1PkceGuard,createMilestone1MemoryPkceVault}
 from '../contracts/milestone1_pkce_guard.mjs';
const V='v'.repeat(64),S='s'.repeat(48),CODE='c'.repeat(48);
const REDIRECT='http://localhost:3002/rehearsals/m1/auth-callback';
const SESSION={access_token:'header.payload.signature',token_type:'bearer',expires_in:3600};
const build=(args={})=>{
 let now=100000;
 const vault=createMilestone1MemoryPkceVault();
 const guard=createMilestone1PkceGuard({
  redirectUri:REDIRECT,createVerifier:()=>V,createState:()=>S,
  challengeFor:async()=> 'z'.repeat(43),vault,now:()=>now,...args
 });
 return {guard,vault,advance:x=>{now+=x}};
};
const url=(state=S,code=CODE)=>REDIRECT+'?code='+code+'&state='+state;
const safe={exchange:async()=>SESSION,verifyIdentity:async()=>({
 verified:true,userId:'11111111-1111-4111-8111-111111111111'})};
test('PKCE challenge and state generated; verifier never exposed in public return',async()=>{
 const h=build();const out=await h.guard.begin();
 assert.deepEqual(out,{state:S,codeChallenge:'z'.repeat(43),codeChallengeMethod:'s256'});
 assert.equal(JSON.stringify(out).includes(V),false);assert.equal(h.vault.hasPending,true);
 let captured;
 const result=await h.guard.complete(url(),{...safe,exchange:async(v)=>{
  captured=v;return SESSION;
 }});
 assert.equal(captured.codeVerifier,V);
 assert.equal(captured.authCode,CODE);assert.equal(captured.redirectUri,REDIRECT);
 assert.equal(result.identityVerified,true);assert.equal(result.needsEventRoleCheck,true);
 assert.equal(result.accessTokenForMemoryOnly,SESSION.access_token);
 assert.equal(h.vault.hasPending,false);
});
test('callback is burned after first exchange and never reusable',async()=>{
 const h=build();await h.guard.begin();await h.guard.complete(url(),safe);
 await assert.rejects(()=>h.guard.complete(url(),safe));
});
test('wrong state, token fragment, extra query or origin rejected before exchange',async()=>{
 const bad=[
  url('w'.repeat(48)),url()+'#access_token=secret',
  url()+'&debug=1',url().replace('localhost','evil.example'),
  REDIRECT+'?code='+CODE+'&code='+CODE+'&state='+S,
  REDIRECT+'?code='+CODE+'&state='+S+'&state='+S,
 ];
 for(const cb of bad){
  const h=build();await h.guard.begin();
  let exchanged=0;
  await assert.rejects(()=>h.guard.complete(cb,{...safe,exchange:async()=>{
   exchanged++;return SESSION;
  }}));
  assert.equal(exchanged,0);assert.equal(h.vault.hasPending,false);
 }
});
test('PKCE verifier timeout or invalid exchange/identity cannot authorize',async()=>{
 const h=build();await h.guard.begin();h.advance(650000);
 await assert.rejects(()=>h.guard.complete(url(),safe));
 assert.equal(h.vault.hasPending,false);
 for(const values of [{exchange:async()=>({...SESSION,token_type:'not-bearer'})},
  {verifyIdentity:async()=>({verified:false,userId:'11111111-1111-4111-8111-111111111111'})}]){
  const x=build();await x.guard.begin();
  await assert.rejects(()=>x.guard.complete(url(),{...safe,...values}));
  assert.equal(x.vault.hasPending,false);
 }
});
test('wrong redirect, invalid random and weak challenge are refused',async()=>{
 for(const bad of ['http://evil.example/callback','https://example.com/callback#secret']){
  assert.throws(()=>build({redirectUri:bad}));
 }
 for(const args of [{createVerifier:()=>V.slice(0,20)},
  {createState:()=>'short'},{challengeFor:async()=>V}]){
  const h=build(args);await assert.rejects(()=>h.guard.begin());
  assert.equal(h.vault.hasPending,false);
 }
});
test('manual cancel clears pending transaction without any Auth session',async()=>{
 const h=build();await h.guard.begin();h.guard.cancel();
 assert.equal(h.vault.hasPending,false);
 await assert.rejects(()=>h.guard.complete(url(),safe));
});

test('loopback 127.0.0.1 on arbitrary temporary port is permitted for isolated browser mock',async()=>{
 const h=build({redirectUri:'http://127.0.0.1:38217/rehearsals/m1/staff-pkce.html'});
 const p=await h.guard.begin();
 assert.equal(p.codeChallengeMethod,'s256');
 assert.equal(h.vault.hasPending,true);
});
