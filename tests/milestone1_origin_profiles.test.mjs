import test from 'node:test';
import assert from 'node:assert/strict';
import {DEVICE_PROFILE,KNOWN_SHARED_ORIGINS,normalizeApprovedPublicStaticOrigins,
 evaluateMilestone1DeviceOrigin,assessMilestone1DeviceReadiness} from '../contracts/milestone1_device_origin_policy.mjs';
const PAGE='/rehearsals/m1/staff-login.html';
const STAGING='https://fftt-staging-example.pages.dev';
const PROD='https://fftt-staff-example.github.io';
const LIST=[{origin:STAGING,environment:'staging',dedicatedOrigin:true},
 {origin:PROD,environment:'production',dedicatedOrigin:true}];
const ev=(href,env,list=LIST)=>evaluateMilestone1DeviceOrigin({href,pagePath:PAGE,
 approvedPublicStaticOrigins:list,expectedEnvironment:env});
test('an exactly listed, attested origin is accepted only in its own environment',()=>{
 const s=ev(STAGING+PAGE,'staging');
 assert.deepEqual([s.allowed,s.profile,s.environment],[true,DEVICE_PROFILE.PUBLIC_STAGING,'staging']);
 const p=ev(PROD+PAGE,'production');
 assert.deepEqual([p.allowed,p.profile,p.environment],[true,DEVICE_PROFILE.PUBLIC_PRODUCTION,'production']);
});
test('Cloudflare Pages staff canonical URL is accepted without widening other paths or origins',()=>{
 const pagePath='/app/staff.html';
 const check=(href,environment='staging',approvedPublicStaticOrigins=LIST)=>
  evaluateMilestone1DeviceOrigin({href,pagePath,approvedPublicStaticOrigins,expectedEnvironment:environment});
 for(const path of ['/app/staff.html','/app/staff']){
  const r=check(STAGING+path);
  assert.deepEqual([r.allowed,r.profile,r.environment],[true,DEVICE_PROFILE.PUBLIC_STAGING,'staging'],path);
 }
 for(const path of ['/app/staff/','/app/staff/extra','/app/staff.htm','/app/other','/app/staff-login']){
  const r=check(STAGING+path);
  assert.equal(r.allowed,false,path);
  assert.ok(r.reasons.includes('unexpected-page-path'),path+' '+r.reasons);
 }
 assert.equal(check(STAGING+'/app/staff','production').allowed,false,'staging build on wrong environment');
 assert.equal(check('https://unlisted.pages.dev/app/staff').allowed,false,'unlisted dedicated host');
 assert.equal(check('https://preview.fftt-staging-example.pages.dev/app/staff').allowed,false,'preview subdomain');
 assert.equal(check('https://0xcls.github.io/app/staff').allowed,false,'shared GitHub Pages host');
 assert.equal(check('http://localhost:3000/app/staff').allowed,false,'no loopback alias');
 assert.equal(check('https://fftt-staff-example.github.io/app/staff','production').allowed,false,'no new alias on github.io');
 assert.equal(check(STAGING+'/app/staff','staging',[]).allowed,false,'requires explicit approved origin');
});

test('a staging build cannot run on the production origin and vice versa',()=>{
 for(const [href,env] of [[PROD+PAGE,'staging'],[STAGING+PAGE,'production'],[STAGING+PAGE,null],[PROD+PAGE,undefined],[STAGING+PAGE,'preview']]){
  const r=ev(href,env);
  assert.equal(r.allowed,false,href+' '+env);assert.deepEqual(r.reasons,['wrong-environment']);
 }
});
test('the origin that hosts the public tournament app is refused for staff sign-in even if someone lists it',()=>{
 assert.deepEqual([...KNOWN_SHARED_ORIGINS],['https://0xcls.github.io']);
 for(const href of ['https://0xcls.github.io'+PAGE,'https://0xcls.github.io/fftt-bracket-manager/rehearsals/m1/staff-login.html']){
  const r=ev(href,'production');
  assert.equal(r.allowed,false,href);assert.ok(r.reasons.includes('shared-origin-denied'),href);
 }
 assert.throws(()=>normalizeApprovedPublicStaticOrigins([{origin:'https://0xcls.github.io',environment:'production',dedicatedOrigin:true}]));
});
test('look-alike, unlisted and mis-shaped origins are all rejected',()=>{
 const bad=[
  'https://fftt-staff-example.github.io.evil.example'+PAGE,
  'https://evil-fftt-staff-example.github.io'+PAGE,
  'https://fftt-staff-example.github.io@evil.example'+PAGE,
  'https://user:pw@fftt-staff-example.github.io'+PAGE,
  'https://fftt-staff-example.github.io:8443'+PAGE,
  'http://fftt-staff-example.github.io'+PAGE,
  'https://preview.fftt-staging-example.pages.dev'+PAGE,
  'https://other-site.github.io'+PAGE,
  'https://other-site.pages.dev'+PAGE,
  'https://fftt-staff-example.netlify.app'+PAGE,
  'https://fftt-staff-example.vercel.app'+PAGE,
  'https://abc.trycloudflare.com'+PAGE,
  'https://fftt-staff-example.github.io/other/path.html',
  'https://fftt-staff-example.github.io/rehearsals/m1/staff-login.html/extra',
  'https://xn--ftt-staff-example-9ob.github.io'+PAGE,
 ];
 for(const href of bad){
  const r=evaluateMilestone1DeviceOrigin({href,pagePath:PAGE,approvedPublicStaticOrigins:LIST,expectedEnvironment:'production'});
  assert.equal(r.allowed,false,href);
 }
});
test('host letter-case does not matter, because DNS does not distinguish it',()=>{
 assert.equal(ev('https://FFTT-Staff-Example.GitHub.io'+PAGE,'production').allowed,true);
});
test('without a list, every public static host stays denied exactly as before',()=>{
 for(const host of ['fftt-staff-example.github.io','fftt-staging-example.pages.dev','x.netlify.app','x.vercel.app','x.workers.dev']){
  const r=evaluateMilestone1DeviceOrigin({href:'https://'+host+PAGE,pagePath:PAGE});
  assert.equal(r.allowed,false,host);assert.deepEqual(r.reasons,['public-static-host-denied'],host);
 }
});
test('listing an origin does not widen anything else (no wildcard, other platform, preview, port or http)',()=>{
 const entry=o=>[{origin:o,environment:'staging',dedicatedOrigin:true}];
 for(const origin of ['https://*.github.io','https://fftt.netlify.app','https://fftt.vercel.app','https://a.b.pages.dev',
  'https://a.b.github.io','https://fftt.pages.dev:8443','http://fftt.pages.dev','https://fftt.pages.dev/path',
  'https://fftt.pages.dev/','https://github.io','https://pages.dev','https://fftt.example.com','https://192.168.1.2',
  'https://FFTT.pages.dev ',7,null])
  assert.throws(()=>normalizeApprovedPublicStaticOrigins(entry(origin)),undefined,String(origin));
});
test('every entry must carry the dedicated-origin attestation and a known environment',()=>{
 const ok={origin:STAGING,environment:'staging',dedicatedOrigin:true};
 for(const bad of [{...ok,dedicatedOrigin:false},{...ok,dedicatedOrigin:'yes'},{...ok,environment:'preview'},
  {...ok,environment:undefined},{origin:STAGING,environment:'staging'},{...ok,extra:1},'https://x.pages.dev',null,[]])
  assert.throws(()=>normalizeApprovedPublicStaticOrigins([bad]),undefined,JSON.stringify(bad));
});
test('at most one origin per environment and no duplicates',()=>{
 assert.throws(()=>normalizeApprovedPublicStaticOrigins([LIST[0],{...LIST[0]}]));
 assert.throws(()=>normalizeApprovedPublicStaticOrigins([LIST[0],{origin:'https://second-staging.pages.dev',environment:'staging',dedicatedOrigin:true}]));
 assert.throws(()=>normalizeApprovedPublicStaticOrigins([LIST[0],LIST[1],LIST[0]]));
 assert.equal(normalizeApprovedPublicStaticOrigins(LIST).length,2);
});
test('the loopback profile and the private HTTPS profile are unaffected by the new lists',()=>{
 const l=evaluateMilestone1DeviceOrigin({href:'http://localhost:3000'+PAGE,pagePath:PAGE,approvedPublicStaticOrigins:LIST});
 assert.deepEqual([l.allowed,l.profile,l.environment],[true,DEVICE_PROFILE.LOOPBACK,null]);
 const h=evaluateMilestone1DeviceOrigin({href:'https://private-host.example.invalid'+PAGE,pagePath:PAGE,
  approvedHttpsOrigins:['https://private-host.example.invalid'],approvedPublicStaticOrigins:LIST});
 assert.deepEqual([h.allowed,h.profile],[true,DEVICE_PROFILE.HTTPS]);
});
test('readiness carries the environment and blocks a mismatched build',()=>{
 const store=new Map();
 const env={href:STAGING+PAGE,pagePath:PAGE,approvedPublicStaticOrigins:LIST,expectedEnvironment:'staging',
  isSecureContext:true,isTopLevel:true,cryptoImpl:globalThis.crypto,isOnline:()=>true,
  tabStorage:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)??null,removeItem:k=>store.delete(k)}};
 const ok=assessMilestone1DeviceReadiness(env);
 assert.deepEqual([ok.ready,ok.profile,ok.environment],[true,DEVICE_PROFILE.PUBLIC_STAGING,'staging']);
 const wrong=assessMilestone1DeviceReadiness({...env,expectedEnvironment:'production'});
 assert.equal(wrong.ready,false);assert.ok(wrong.blockers.includes('wrong-environment'));
 assert.equal(assessMilestone1DeviceReadiness({...env,isTopLevel:false}).ready,false,'a framed page never signs anyone in');
});
