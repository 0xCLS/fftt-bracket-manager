import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMilestone1PkceGuard,createMilestone1MemoryPkceVault} from '../contracts/milestone1_pkce_guard.mjs';
import {DEVICE_PROFILE,normalizeApprovedHttpsOrigins,evaluateMilestone1DeviceOrigin,
 requiredRedirectAllowlistEntry,redirectWouldBeAccepted,assessMilestone1DeviceReadiness}
 from '../contracts/milestone1_device_origin_policy.mjs';
const PAGE='/rehearsals/m1/hosted-pkce.html';
const LAN='https://fftt-desk.example.invalid';
const evalOrigin=(href,approved=[])=>evaluateMilestone1DeviceOrigin({href,approvedHttpsOrigins:approved,pagePath:PAGE});
test('only the exact localhost:3000 page is a loopback profile',()=>{
 const ok=evalOrigin('http://localhost:3000'+PAGE);
 assert.deepEqual([ok.allowed,ok.profile],[true,DEVICE_PROFILE.LOOPBACK]);
 for(const [href,code] of [
  ['http://localhost:3001'+PAGE,'loopback-port-or-alias-not-allowlisted'],
  ['http://127.0.0.1:3000'+PAGE,'loopback-port-or-alias-not-allowlisted'],
  ['http://192.168.1.20:3000'+PAGE,'insecure-non-loopback-origin'],
  ['http://fftt-desk.local:3000'+PAGE,'insecure-non-loopback-origin'],
  ['http://localhost:3000/rehearsals/c8/index.html','unexpected-page-path'],
  ['http://user:pw@localhost:3000'+PAGE,'embedded-credentials'],
 ]){
  const r=evalOrigin(href);
  assert.equal(r.allowed,false,href);assert.ok(r.reasons.includes(code),href+' '+r.reasons);
 }
});
test('phones need an operator-approved HTTPS origin; public static hosts are always denied',()=>{
 assert.equal(evalOrigin(LAN+PAGE).allowed,false);
 assert.deepEqual(evalOrigin(LAN+PAGE).reasons,['https-origin-not-approved']);
 const ok=evalOrigin(LAN+PAGE,[LAN]);
 assert.deepEqual([ok.allowed,ok.profile],[true,DEVICE_PROFILE.HTTPS]);
 for(const host of ['0xcls.github.io','x.pages.dev','x.netlify.app','x.vercel.app',
  'abc.trycloudflare.com','abc.ngrok-free.app','x.workers.dev']){
  const r=evalOrigin('https://'+host+PAGE,['https://'+host]);
  assert.equal(r.allowed,false,host);assert.ok(r.reasons.includes('public-static-host-denied'),host);
 }
 assert.equal(evalOrigin('https://other.example.invalid'+PAGE,[LAN]).allowed,false);
});
test('approved-origin configuration rejects wildcards, paths, credentials and http',()=>{
 for(const bad of ['https://*.example.invalid','https://x.example.invalid/path','https://x.example.invalid?a=1',
  'https://u:p@x.example.invalid','http://x.example.invalid','https://x.example.invalid/','x',7,
  'https://x.example.invalid ']){
  assert.throws(()=>normalizeApprovedHttpsOrigins([bad]),undefined,String(bad));
 }
 assert.throws(()=>normalizeApprovedHttpsOrigins(new Array(9).fill(LAN)));
 assert.deepEqual(normalizeApprovedHttpsOrigins([LAN]),[LAN]);
 assert.throws(()=>evaluateMilestone1DeviceOrigin({href:LAN+PAGE,pagePath:'/index.html'}));
});
test('explicit HTTPS ports are refused because the PKCE guard refuses them',()=>{
 assert.throws(()=>normalizeApprovedHttpsOrigins(['https://fftt-desk.example.invalid:8443']));
 const r=evalOrigin('https://fftt-desk.example.invalid:8443'+PAGE,[LAN]);
 assert.equal(r.allowed,false);assert.ok(r.reasons.includes('https-non-default-port-unsupported'));
});
test('policy and PKCE guard agree: every approved origin builds a valid guard, every refused one is irrelevant',()=>{
 const build=redirectUri=>createMilestone1PkceGuard({redirectUri,createVerifier:()=>'a'.repeat(64),
  createState:()=>'b'.repeat(43),challengeFor:async()=>'c'.repeat(43),vault:createMilestone1MemoryPkceVault()});
 for(const href of ['http://localhost:3000'+PAGE,LAN+PAGE,'https://other.example.invalid'+PAGE]){
  const approved=evalOrigin(href,[LAN,'https://other.example.invalid']);
  assert.equal(approved.allowed,true,href);
  assert.doesNotThrow(()=>build(href),href);
 }
 // the guard's refusals the policy must therefore also refuse
 for(const href of ['https://x.example.invalid:8443'+PAGE,'http://192.168.1.20:3000'+PAGE]){
  assert.equal(evalOrigin(href,['https://x.example.invalid']).allowed,false,href);
  assert.throws(()=>build(href),undefined,href);
 }
});
test('hosted redirect model: the Site URL host passes, a new device origin needs an explicit allowlist entry',()=>{
 const site='http://localhost:3000';
 const existing=['http://localhost:3000/rehearsals/c8/index.html',
  'http://localhost:3000/rehearsals/m1/hosted-pkce.html?state=*'];
 const state='A'.repeat(43);
 const local='http://localhost:3000'+PAGE+'?state='+state;
 assert.equal(redirectWouldBeAccepted({siteUrl:site,allowlist:existing,redirectTo:local}),true);
 const device=LAN+PAGE+'?state='+state;
 // Hosted change required: without it GoTrue would silently use the Site URL.
 assert.equal(redirectWouldBeAccepted({siteUrl:site,allowlist:existing,redirectTo:device}),false);
 const entry=requiredRedirectAllowlistEntry({origin:LAN,pagePath:PAGE});
 assert.equal(entry,LAN+PAGE+'?state=*');
 assert.equal(redirectWouldBeAccepted({siteUrl:site,allowlist:[...existing,entry],redirectTo:device}),true);
 // The state glob cannot widen to another path, host or extra segment.
 for(const evil of [LAN+'/rehearsals/m1/staff-pkce.html?state='+state,
  'https://evil.example.invalid'+PAGE+'?state='+state,
  LAN+PAGE+'?state='+state+'&x=1/../',LAN+PAGE+'?state=a.b']){
  assert.equal(redirectWouldBeAccepted({siteUrl:site,allowlist:[entry],redirectTo:evil}),false,evil);
 }
 assert.equal(redirectWouldBeAccepted({siteUrl:'not a url',allowlist:[entry],redirectTo:device}),false);
 assert.throws(()=>requiredRedirectAllowlistEntry({origin:'https://x.example.invalid/p',pagePath:PAGE}));
});
const goodEnv=(over={})=>{
 const store=new Map();
 return {href:LAN+PAGE,pagePath:PAGE,approvedHttpsOrigins:[LAN],isSecureContext:true,
  isTopLevel:true,cryptoImpl:globalThis.crypto,isOnline:()=>true,
  tabStorage:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)??null,removeItem:k=>store.delete(k)},
  store,...over};
};
test('device readiness passes on a secure approved phone-like environment and leaves no probe behind',()=>{
 const env=goodEnv();
 const r=assessMilestone1DeviceReadiness(env);
 assert.equal(r.ready,true);assert.equal(r.profile,DEVICE_PROFILE.HTTPS);
 assert.equal(env.store.size,0);
 assert.ok(r.manualChecksRequired.length>=2);
});
test('device readiness blocks insecure context, framed page, missing crypto, broken storage and offline',()=>{
 const cases={
  'secure-context':{isSecureContext:false},
  'top-level-page':{isTopLevel:false},
  'web-crypto-sha256':{cryptoImpl:{getRandomValues(){}}},
  'web-crypto-random':{cryptoImpl:{subtle:{digest(){}}}},
  'tab-storage-usable':{tabStorage:{setItem(){throw Error('private mode')},getItem(){},removeItem(){}}},
  'online':{isOnline:()=>false},
  'origin-allowed':{href:'http://192.168.1.20:3000'+PAGE},
 };
 for(const [id,over] of Object.entries(cases)){
  const r=assessMilestone1DeviceReadiness(goodEnv(over));
  assert.equal(r.ready,false,id);assert.ok(r.blockers.includes(id),id+' '+r.blockers);
 }
 // storage that accepts writes but forgets them (some embedded browsers)
 const lossy={setItem(){},getItem(){return null},removeItem(){}};
 assert.equal(assessMilestone1DeviceReadiness(goodEnv({tabStorage:lossy})).ready,false);
});
test('readiness output carries no URL, token or identifier text',()=>{
 const r=JSON.stringify(assessMilestone1DeviceReadiness(goodEnv()));
 assert.equal(r.includes('example.invalid'),false);
 assert.equal(/eyJ|code=|state=|@/.test(r),false);
});
test('policy source performs no network, storage or hosted configuration access',()=>{
 const text=readFileSync(new URL('../contracts/milestone1_device_origin_policy.mjs',import.meta.url),'utf8');
 for(const banned of ['fetch(','localStorage','sessionStorage','indexedDB','navigator.','window.','XMLHttpRequest','supabase.co'])
  assert.equal(text.includes(banned),false,banned);
});
