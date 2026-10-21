/** Physical-device staff sign-in, read-only Match Desk follower. Synthetic development only.
 * Runs only on an origin approved by the reviewed device policy (exact localhost:3000, or an
 * operator-approved HTTPS origin from the git-ignored device-origins.local.json). No network request
 * to the Auth provider happens until one explicit consented click. No scores, writes or retries.
 */
import {assessMilestone1DeviceReadiness} from '../../contracts/milestone1_device_origin_policy.mjs';
import {createMilestone1PkceGuard} from '../../contracts/milestone1_pkce_guard.mjs';
import {createMilestone1BrowserPkcePrimitives} from '../../contracts/milestone1_pkce_browser_adapter.mjs';
import {createMilestone1PkceSupabaseTransport} from '../../contracts/milestone1_pkce_supabase_transport.mjs';
import {createMilestone1PkceStaffSession} from '../../contracts/milestone1_pkce_staff_session.mjs';
import {createMilestone1ReadSupervisor} from '../../contracts/milestone1_read_supervisor.mjs';
const $=id=>document.getElementById(id);
const show=(id,text)=>{$(id).textContent=text;};
const PAGE='/rehearsals/m1/device-staff.html';
// Proposed default pending organizer decision: up to 2 minutes of memory-only suspension while the
// tab is in the background (e.g. while reading the mail app). Set to 0 to sign out on every background.
const BACKGROUND_GRACE_MS=120000;
// Remove one-time callback material from the address bar before ANY asynchronous work.
const callbackURL=window.location.search||window.location.hash?window.location.href:null;
if(callbackURL)window.history.replaceState(null,'',window.location.pathname);
async function loadApprovedOrigins(){
 try{
  const r=await fetch('./device-origins.local.json',{cache:'no-store',credentials:'omit'});
  if(!r.ok)return [];
  const j=await r.json();
  return Array.isArray(j?.approvedHttpsOrigins)?j.approvedHttpsOrigins:[];
 }catch{return [];}
}
const approvedOrigins=await loadApprovedOrigins();
let readiness;
try{
 readiness=assessMilestone1DeviceReadiness({
  href:window.location.origin+window.location.pathname,pagePath:PAGE,
  approvedHttpsOrigins:approvedOrigins,isSecureContext:window.isSecureContext,
  isTopLevel:window.top===window,cryptoImpl:window.crypto,tabStorage:window.sessionStorage,
  isOnline:()=>navigator.onLine,
 });
}catch{readiness={ready:false,checks:[],blockers:['approved-origin-config-invalid'],manualChecksRequired:[]};}
let ready=readiness.ready===true;
const blockedBy=[...readiness.blockers];
let pkce=null,session=null,supervisor=null;
let signedIn=false,wasFollowing=false,requested=false;
const redirectUri=window.location.origin+PAGE;
if(ready){
 try{
  pkce=createMilestone1PkceGuard({redirectUri,...createMilestone1BrowserPkcePrimitives({
   cryptoImpl:window.crypto,tabStorage:window.sessionStorage})});
  const transport=createMilestone1PkceSupabaseTransport({
   publishableKey:'sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0',
   allowSyntheticAuthNetwork:true,fetchImpl:(url,init)=>fetch(url,init)});
  session=createMilestone1PkceStaffSession({pkce,transport,redirectUri,
   isOnline:()=>navigator.onLine&&!document.hidden,backgroundGraceMs:BACKGROUND_GRACE_MS});
  supervisor=createMilestone1ReadSupervisor({
   read:()=>session.readDesk(),
   accept:view=>view?.status==='ready'&&view.authoritativeForScoring===false,
   present:view=>{
    show('deskStatus','Verified '+view.role+' · revision '+view.revision+' · generation '+view.generation+
     ' · pending '+view.matches.length+' · READ ONLY');
    const list=$('matches');list.replaceChildren();
    for(const m of view.matches){const p=document.createElement('p');p.textContent=m.code+' · '+m.players+' · version '+m.version;list.append(p);}
   },
   clear:reason=>{
    $('matches').replaceChildren();
    if(reason!=='refreshing')show('deskStatus','Following stopped ('+reason+'). No cached private rows.');
   },
   isAvailable:()=>navigator.onLine&&!document.hidden,intervalMs:6000,
  });
 }catch{ready=false;blockedBy.push('initialization-failed');}
}
show('originStatus',ready?'READY · this origin and browser are approved for staff sign-in.':
 'BLOCKED · this device or address is not approved. Sign-in is disabled.');
for(const c of readiness.checks){const li=document.createElement('li');li.textContent=(c.pass?'✔ ':'✘ ')+c.id.replaceAll('-',' ');$('readiness').append(li);}
for(const b of blockedBy.filter(x=>!readiness.checks.some(c=>c.id===x))){
 const li=document.createElement('li');li.textContent='✘ '+b.replaceAll('-',' ');$('readiness').append(li);
}
$('requestLink').disabled=!ready;
$('complete').disabled=!ready||!callbackURL;
$('follow').disabled=true;
show('requestStatus',ready?'Ready. No request is sent until you tick the box and press the button once.':
 'Disabled: this origin is not approved for staff sign-in.');
show('authStatus',callbackURL?'Return received and address cleared. Enter the event UUID and finish sign-in.':'Awaiting callback.');
$('requestLink').addEventListener('click',async()=>{
 const address=$('email').value.trim().toLowerCase();
 if(requested||!ready||!$('consent').checked||!/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(address)){
  show('requestStatus','Not authorized: an existing fictional account address and operator confirmation are required.');return;
 }
 requested=true;$('requestLink').disabled=true;
 try{
  await session.begin(address);
  show('requestStatus','One link requested. Open it in THIS tab (paste the copied link into the address bar). No repeats.');
 }catch{show('requestStatus','Request refused, unavailable or rate-limited. Do NOT retry; reload this page after a minute.');}
});
$('complete').addEventListener('click',async()=>{
 if(!ready||!callbackURL)return;
 $('complete').disabled=true;
 try{
  const r=await session.complete(callbackURL,{eventId:$('eventId').value.trim()});
  signedIn=true;
  show('authStatus','SIGNED IN · verified '+r.role+' · synthetic only · READ ONLY');
  $('follow').disabled=false;
 }catch{
  signedIn=false;
  show('authStatus','Sign-in failed: code, state, account or event authorization not accepted. Nothing retained. Reload to start over.');
  $('follow').disabled=true;
 }
});
$('follow').addEventListener('click',()=>{if(signedIn)supervisor.start();});
$('stopFollow').addEventListener('click',()=>supervisor?.pause('stopped by you'));
function signedOut(message){
 // Keep the UI and the session in agreement: nothing may linger in memory after "signed out".
 supervisor?.pause('signed out');session?.pause();
 signedIn=false;wasFollowing=false;$('follow').disabled=true;
 $('matches').replaceChildren();show('authStatus',message);
}
$('signOut').addEventListener('click',()=>{
 supervisor?.pause('signed out');session?.signOut();signedOut('SIGNED OUT · tokens and private rows cleared.');
});
window.addEventListener('offline',()=>{
 if(!ready)return;
 supervisor.pause('offline');session.pause();
 if(signedIn)signedOut('SIGNED OUT · connection lost. Reload and request a new link.');
});
document.addEventListener('visibilitychange',async()=>{
 if(!ready)return;
 if(document.hidden){
  wasFollowing=supervisor.running;
  supervisor.pause('backgrounded');
  // Hiding never cancels the pending email verifier; it only drops private authority.
  const result=session.suspend();
  if(signedIn){
   if(result.suspended)show('authStatus','SUSPENDED · private view cleared; identity and role are re-checked when you return.');
   else signedOut('SIGNED OUT · this device does not keep a session while backgrounded.');
  }
  return;
 }
 if(signedIn&&session.status.suspended){
  try{
   const r=await session.resume();
   show('authStatus','SIGNED IN · re-verified '+r.role+' · READ ONLY');
   if(wasFollowing)supervisor.start();
  }catch{
   // Backgrounded again mid-resume: the session stays suspended and the next return retries once.
   if(document.hidden)return;
   signedOut('SIGNED OUT · identity and role could not be re-verified. Reload and request a new link.');
  }
 }
});
