/** FFTT Milestone 1 — physical-device origin and readiness policy (pure, zero network).
 * Answers: may THIS page origin run staff PKCE sign-in, and would the hosted
 * Auth redirect rules accept its callback? Never reads or changes hosted
 * settings; the allowlist model is a reviewed offline copy of documented
 * GoTrue behavior. A phone cannot use the localhost profile: its "localhost"
 * is the phone itself. Phones need a trusted HTTPS origin (secure context for
 * Web Crypto) that the operator has approved in BOTH the code call site and
 * the hosted redirect allowlist. HTTPS origins use the default port because the
 * reviewed PKCE guard rejects explicit ports outside http loopback.
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
export const DEVICE_PROFILE=Object.freeze({
 LOOPBACK:'loopback-dev',HTTPS:'https-dev',
 PUBLIC_STAGING:'public-staging',PUBLIC_PRODUCTION:'public-production',
});
const LOOPBACK_ORIGIN='http://localhost:3000';
// Public static hosts must not serve staff sign-in pages (preflight rule).
const PUBLIC_STATIC=/(^|\.)(github\.io|pages\.dev|netlify\.app|vercel\.app|trycloudflare\.com|ngrok(-free)?\.(app|io|dev)|loca\.lt|workers\.dev)$/i;
const HOST=/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;
// Origins that already serve OTHER content (the public tournament app keeps event data in browser
// storage there, and every project page of that account shares the origin). Never allowed for staff
// sign-in, even if someone lists them.
export const KNOWN_SHARED_ORIGINS=Object.freeze(['https://0xcls.github.io']);
// Platforms whose per-site origin can be dedicated to ONE site: exactly one label before the suffix
// (preview deployments like hash.site.pages.dev have two and are therefore refused).
const DEDICATED_PLATFORM_HOST=/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.(github\.io|pages\.dev)$/;
const ENVIRONMENTS=Object.freeze(['staging','production']);
const fail=()=>{throw new AuthorityGateError('Device origin policy configuration invalid');};
function parseOrigin(text){
 let u;try{u=new URL(text)}catch{return null}
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;
 return u;
}
/** Operator-approved HTTPS origins; exact strings only, no wildcards. */
export function normalizeApprovedHttpsOrigins(list=[]){
 if(!Array.isArray(list)||list.length>8)fail();
 return Object.freeze(list.map(text=>{
  if(typeof text!=='string'||/[*?\s]/.test(text))fail();
  const u=parseOrigin(text);
  // Default port only: the PKCE guard refuses explicit ports outside http loopback.
  if(!u||u.protocol!=='https:'||u.port!==''||!HOST.test(u.hostname)||u.origin!==text)fail();
  return u.origin;
 }));
}
/** Narrow, individually attested public static origins for STAGING or PRODUCTION staff sign-in.
 * Each entry must be {origin, environment, dedicatedOrigin:true}: the operator attests the origin serves
 * only this application (so no other site can share its storage or frame its pages). One per environment.
 * The general public-static-host denial is unchanged for everything not listed here. */
export function normalizeApprovedPublicStaticOrigins(list=[]){
 if(!Array.isArray(list)||list.length>2)fail();
 const seen=new Set();
 return Object.freeze(list.map(entry=>{
  if(entry===null||typeof entry!=='object'||Array.isArray(entry)
    ||Object.keys(entry).sort().join()!=='dedicatedOrigin,environment,origin'
    ||entry.dedicatedOrigin!==true||!ENVIRONMENTS.includes(entry.environment)
    ||typeof entry.origin!=='string'||/[*?\s]/.test(entry.origin))fail();
  const u=parseOrigin(entry.origin);
  if(!u||u.protocol!=='https:'||u.port!==''||u.origin!==entry.origin
    ||!DEDICATED_PLATFORM_HOST.test(u.hostname)||KNOWN_SHARED_ORIGINS.includes(u.origin)
    ||seen.has(u.origin)||seen.has('env:'+entry.environment))fail();
  seen.add(u.origin);seen.add('env:'+entry.environment);
  return Object.freeze({origin:u.origin,environment:entry.environment});
 }));
}
/** Classify an origin. Returns reason codes only, never page contents. */
export function evaluateMilestone1DeviceOrigin({href,approvedHttpsOrigins=[],approvedPublicStaticOrigins=[],
 expectedEnvironment=null,pagePath}={}){
 const approved=normalizeApprovedHttpsOrigins(approvedHttpsOrigins);
 const publicApproved=normalizeApprovedPublicStaticOrigins(approvedPublicStaticOrigins);
 let environment=null;
 const reasons=[];
 if(typeof pagePath!=='string'||!/^\/(rehearsals\/m1|app)\/[a-z0-9-]+\.html$/.test(pagePath))fail();
 let u;try{u=new URL(href)}catch{return Object.freeze({allowed:false,profile:null,environment:null,reasons:Object.freeze(['unparseable-url'])})}
 if(u.username||u.password)reasons.push('embedded-credentials');
 // Cloudflare Pages canonicalizes /app/staff.html to /app/staff (HTTP 308).
 // Permit exactly this reviewed alias on a dedicated Pages HTTPS hostname; all
 // other page paths and all origin/environment checks remain fail-closed.
 const canonicalStaffPagesPath=pagePath==='/app/staff.html'&&u.pathname==='/app/staff'
   &&u.protocol==='https:'&&DEDICATED_PLATFORM_HOST.test(u.hostname)
   &&u.hostname.endsWith('.pages.dev');
 if(u.pathname!==pagePath&&!canonicalStaffPagesPath)reasons.push('unexpected-page-path');
 let profile=null;
 if(u.origin===LOOPBACK_ORIGIN)profile=DEVICE_PROFILE.LOOPBACK;
 else if(u.protocol==='http:'&&(u.hostname==='localhost'||u.hostname==='127.0.0.1'))reasons.push('loopback-port-or-alias-not-allowlisted');
 else if(u.protocol==='http:')reasons.push('insecure-non-loopback-origin');
 else if(u.protocol==='https:'){
  if(KNOWN_SHARED_ORIGINS.includes(u.origin))reasons.push('shared-origin-denied');
  else if(PUBLIC_STATIC.test(u.hostname)){
   const entry=u.port===''?publicApproved.find(e=>e.origin===u.origin):undefined;
   if(!entry)reasons.push('public-static-host-denied');
   else if(expectedEnvironment!==entry.environment)reasons.push('wrong-environment');
   else{
    profile=entry.environment==='staging'?DEVICE_PROFILE.PUBLIC_STAGING:DEVICE_PROFILE.PUBLIC_PRODUCTION;
    environment=entry.environment;
   }
  }
  else if(u.port!=='')reasons.push('https-non-default-port-unsupported');
  else if(!approved.includes(u.origin))reasons.push('https-origin-not-approved');
  else profile=DEVICE_PROFILE.HTTPS;
 }else reasons.push('unsupported-scheme');
 const allowed=reasons.length===0&&profile!==null;
 return Object.freeze({allowed,profile:allowed?profile:null,environment:allowed?environment:null,
  reasons:Object.freeze(reasons)});
}
/** The exact allowlist entry an operator would have to approve in hosted Auth. */
export function requiredRedirectAllowlistEntry({origin,pagePath}){
 const u=parseOrigin(origin);
 if(!u||!['http:','https:'].includes(u.protocol)||!/^\/rehearsals\/m1\/[a-z0-9-]+\.html$/.test(pagePath||''))fail();
 return u.origin+pagePath+'?state=*';
}
// Supabase redirect glob: `*` and `?` never cross `.` or `/`; `**` crosses all.
function globToRegExp(glob){
 let out='';
 for(let i=0;i<glob.length;i++){
  const c=glob[i];
  if(c==='*'&&glob[i+1]==='*'){out+='.*';i++;}
  else if(c==='*')out+='[^./]*';
  else if(c==='?')out+='[^./]';
  else out+=c.replace(/[.+^${}()|[\]\\]/g,'\\$&');
 }
 return new RegExp('^'+out+'$');
}
/** Offline model of hosted redirect acceptance. A rejected redirect silently
 * falls back to the Site URL, which the PKCE callback guard treats as failure.
 */
export function redirectWouldBeAccepted({siteUrl,allowlist=[],redirectTo}={}){
 let site,target;
 try{site=new URL(siteUrl);target=new URL(redirectTo)}catch{return false}
 if(!Array.isArray(allowlist)||allowlist.length>32)return false;
 // Documented reviewed behavior: same scheme and host as Site URL (port ignored).
 if(target.protocol===site.protocol&&target.hostname===site.hostname)return true;
 return allowlist.some(pattern=>typeof pattern==='string'&&globToRegExp(pattern).test(target.href));
}
/** Device capability checklist. Probe key never carries a secret. */
export function assessMilestone1DeviceReadiness({
 href,pagePath,approvedHttpsOrigins=[],approvedPublicStaticOrigins=[],expectedEnvironment=null,
 isSecureContext,isTopLevel,cryptoImpl,tabStorage,isOnline,
}={}){
 const origin=evaluateMilestone1DeviceOrigin({href,approvedHttpsOrigins,approvedPublicStaticOrigins,
  expectedEnvironment,pagePath});
 let storageWorks=false;
 try{
  const key='fftt.m1.device-probe';
  tabStorage.setItem(key,'1');
  storageWorks=tabStorage.getItem(key)==='1';
  tabStorage.removeItem(key);
 }catch{storageWorks=false}
 const checks=[
  ['origin-allowed',origin.allowed],
  ['secure-context',isSecureContext===true],
  ['top-level-page',isTopLevel===true],
  ['web-crypto-sha256',typeof cryptoImpl?.subtle?.digest==='function'],
  ['web-crypto-random',typeof cryptoImpl?.getRandomValues==='function'],
  ['tab-storage-usable',storageWorks],
  ['online',typeof isOnline==='function'?isOnline()===true:isOnline===true],
 ].map(([id,pass])=>Object.freeze({id,pass}));
 return Object.freeze({
  ready:checks.every(c=>c.pass),
  profile:origin.profile,environment:origin.environment,
  checks:Object.freeze(checks),
  blockers:Object.freeze([...checks.filter(c=>!c.pass).map(c=>c.id),...origin.reasons]),
  // Not provable by a probe; the operator must observe it on the real phone.
  manualChecksRequired:Object.freeze([
   'email-link-opens-in-the-original-tab-or-in-app-browser-handoff-preserves-session-storage',
   'tab-survives-switching-to-mail-app',
  ]),
 });
}
