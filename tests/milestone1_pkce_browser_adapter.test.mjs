import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createMilestone1BrowserPkcePrimitives as browser}
 from '../contracts/milestone1_pkce_browser_adapter.mjs';
import {createMilestone1PkceGuard as guard}
 from '../contracts/milestone1_pkce_guard.mjs';
const REDIRECT='http://localhost:3002/rehearsals/m1/auth-callback';
function make(){
 const values=new Map();
 const tabStorage={getItem:k=>values.get(k)??null,
  setItem:(k,v)=>values.set(k,v),
  removeItem:k=>values.delete(k)};
 const c=browser({cryptoImpl:webcrypto,tabStorage});
 return {c,values,tabStorage};
}
test('Web Crypto generates different strong PKCE transactions and S256 valid digest',async()=>{
 const {c}=make(),v=c.createVerifier(),v2=c.createVerifier();
 assert.match(v,/^[A-Za-z0-9._~-]{43,128}$/);
 assert.notEqual(v,v2);
 assert.notEqual(c.createState(),c.createState());
 const digest=await c.challengeFor(v);
 assert.match(digest,/^[A-Za-z0-9_-]{43}$/);
 const expected=Buffer.from(await webcrypto.subtle.digest('SHA-256',
  new TextEncoder().encode(v))).toString('base64url');
 assert.equal(digest,expected);
});
test('pending single-tab vault never includes JWT or email and cannot be read twice',async()=>{
 const {c,values}=make();const g=guard({
  redirectUri:REDIRECT,...c,
 });
 const challenge=await g.begin();
 const raw=[...values.values()].join('');
 assert.equal(raw.includes('access_token'),false);
 assert.equal(raw.includes('refresh_token'),false);
 assert.equal(raw.includes('email'),false);
 assert.equal(raw.includes('sb_secret_'),false);
 assert.equal(challenge.codeChallengeMethod,'s256');
 let called=0;
 const result=await g.complete(REDIRECT+'?code='+ 'c'.repeat(48)+'&state='+challenge.state,{
  exchange:async({authCode,codeVerifier})=>{
   called++;assert.equal(await c.challengeFor(codeVerifier),challenge.codeChallenge);
   return {access_token:'header.payload.signature',token_type:'bearer',expires_in:600};
  },
  verifyIdentity:async()=>({verified:true,userId:'11111111-1111-4111-8111-111111111111'}),
 });
 assert.equal(result.identityVerified,true);
 assert.equal(called,1);assert.equal(values.size,0);
 await assert.rejects(()=>g.complete(REDIRECT+'?code='+ 'c'.repeat(48)+'&state='+challenge.state,{
  exchange:async()=>{called++},
  verifyIdentity:async()=>({verified:true})}));
 assert.equal(called,1);
});
test('corrupted tab record is deleted, fail-closed, never parsed into a session',async()=>{
 const {c,tabStorage,values}=make();
 tabStorage.setItem('fftt.m1.pkce.one-pending','{"access_token":"evil"}');
 assert.equal(c.vault.take(),null);assert.equal(values.size,0);
});
test('scoped vault cannot be instantiated with forbidden store or missing Web Crypto',()=>{
 assert.throws(()=>browser({cryptoImpl:webcrypto,tabStorage:{}}));
 assert.throws(()=>browser({cryptoImpl:{},tabStorage:{}}));
});
