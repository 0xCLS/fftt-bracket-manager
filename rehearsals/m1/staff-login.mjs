/** Staff email/password sign-in and read-only Match Desk follower. SYNTHETIC CANDIDATE.
 * Opening this page sends nothing. Hosted password sign-in is NOT enabled in this build: the network
 * stays closed unless the automated test harness installs its synthetic flag AND the address passes the
 * origin policy. No sign-up, no scores, no publication, no token or password is ever written to the page,
 * the address bar or storage (only the opt-in tab vault holds a rotating refresh token).
 */
import {assessMilestone1DeviceReadiness} from '../../contracts/milestone1_device_origin_policy.mjs';
import {createMilestone1PasswordSupabaseTransport,StaffSignInError} from '../../contracts/milestone1_password_transport.mjs';
import {createMilestone1StaffSessionVault} from '../../contracts/milestone1_staff_session_vault.mjs';
import {createMilestone1PasswordStaffSession} from '../../contracts/milestone1_password_session.mjs';
import {createMilestone1EmailCodeRecovery} from '../../contracts/milestone1_email_code_recovery.mjs';
import {createMilestone1ReadSupervisor} from '../../contracts/milestone1_read_supervisor.mjs';
const $=id=>document.getElementById(id);
const PAGE='/rehearsals/m1/staff-login.html';
// Flipped only by a separately approved change that also enables password sign-in on the project.
const HOSTED_PASSWORD_AUTH_ENABLED=false;
const ALLOW_TAB_PERSISTENCE=true; // build-level permission; each person still has to opt in
const synthetic=window.__FFTT_SYNTHETIC_PASSWORD_MOCK__===true;
const say=(id,text,cls='')=>{const el=$(id);el.textContent=text;el.className='status'+(cls?' '+cls:'');};
async function loadProfile(){
 try{
  const r=await fetch('./origin-profile.json',{cache:'no-store',credentials:'omit'});
  if(!r.ok)return {};
  const j=await r.json();
  return j!==null&&typeof j==='object'?j:{};
 }catch{return {};}
}
const profile=await loadProfile();
let readiness;
try{
 readiness=assessMilestone1DeviceReadiness({
  href:window.location.origin+window.location.pathname,pagePath:PAGE,
  approvedHttpsOrigins:Array.isArray(profile.approvedHttpsOrigins)?profile.approvedHttpsOrigins:[],
  approvedPublicStaticOrigins:Array.isArray(profile.approvedPublicStaticOrigins)?profile.approvedPublicStaticOrigins:[],
  expectedEnvironment:typeof profile.environment==='string'?profile.environment:null,
  isSecureContext:window.isSecureContext,isTopLevel:window.top===window,cryptoImpl:window.crypto,
  tabStorage:window.sessionStorage,isOnline:()=>navigator.onLine,
 });
}catch{readiness={ready:false,checks:[],blockers:['origin-profile-invalid']};}
const networkAllowed=readiness.ready===true&&(HOSTED_PASSWORD_AUTH_ENABLED||synthetic);
$('envBanner').textContent=(readiness.environment?readiness.environment.toUpperCase()+' · ':'')+
 'SYNTHETIC CANDIDATE · READ ONLY · NO SCORES';
for(const c of readiness.checks){const li=document.createElement('li');li.textContent=(c.pass?'✔ ':'✘ ')+c.id.replaceAll('-',' ');$('readiness').append(li);}
for(const b of readiness.blockers.filter(x=>!readiness.checks.some(c=>c.id===x))){
 const li=document.createElement('li');li.textContent='✘ '+b.replaceAll('-',' ');$('readiness').append(li);
}
$('originStatus').textContent=!readiness.ready?'BLOCKED · this address is not approved for staff sign-in.':
 networkAllowed?'This address is approved.':'Hosted password sign-in is not enabled in this build.';
let session=null,recovery=null,supervisor=null,vault=null;
if(networkAllowed){
 const transport=createMilestone1PasswordSupabaseTransport({
  publishableKey:'sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0',
  allowSyntheticAuthNetwork:true,fetchImpl:(url,init)=>fetch(url,init)});
 vault=createMilestone1StaffSessionVault({tabStorage:window.sessionStorage});
 session=createMilestone1PasswordStaffSession({transport,isOnline:()=>navigator.onLine,vault,
  allowTabPersistence:ALLOW_TAB_PERSISTENCE});
 recovery=createMilestone1EmailCodeRecovery({transport,adopt:session.adoptVerifiedSession});
 supervisor=createMilestone1ReadSupervisor({
  read:()=>session.readDesk(),
  accept:v=>v?.status==='ready'&&v.authoritativeForScoring===false,
  present:v=>{
   say('deskStatus','Verified '+v.role+' · revision '+v.revision+' · generation '+v.generation+
    ' · pending '+v.matches.length+' · READ ONLY','good');
   const list=$('matches');list.replaceChildren();
   for(const m of v.matches){const p=document.createElement('p');p.textContent=m.code+' · '+m.players+' · version '+m.version;list.append(p);}
  },
  clear:reason=>{
   $('matches').replaceChildren();
   if(reason!=='refreshing')say('deskStatus','Following stopped ('+reason+'). No cached private rows.');
  },
  isAvailable:()=>navigator.onLine&&!document.hidden,intervalMs:6000,
 });
}
$('signIn').disabled=!networkAllowed;$('requestCode').disabled=!networkAllowed;$('verifyCode').disabled=!networkAllowed;
const wait=ms=>{
 const s=Math.max(1,Math.ceil(ms/1000));
 return s<90?s+' seconds':Math.ceil(s/60)+' minutes';
};
function message(e){
 const kind=e instanceof StaffSignInError?e.kind:'unavailable';
 const text={
  'invalid-input':'Check the email, password and event ID, then try again.',
  'invalid-credentials':'Email or password not recognised.',
  'invalid-code':'That code was not accepted.',
  'rate-limited':'Too many attempts. Please wait '+wait(e.retryAfterMs??60000)+'.',
  'cooldown':'Please wait '+wait(e.retryAfterMs??60000)+' before trying again.',
  'network':'You appear to be offline. Nothing was sent.',
  'unavailable':'Sign-in is temporarily unavailable. Try again shortly.',
  'not-authorized':'This account is not authorised for this event.',
  'expired':'Your session ended. Please sign in again.',
  'revoked':'Your access ended. Sign in again if you should still have access.',
  'busy':'One moment…','locked':'One moment…',
 }[kind];
 return text??'Sign-in is temporarily unavailable. Try again shortly.';
}
let following=false,wasFollowing=false;
function showSignedIn(r){
 $('signInPanel').hidden=true;$('sessionPanel').hidden=false;$('retry').hidden=true;
 $('roleOut').textContent=r.role;$('persistOut').textContent=r.persisted?'Yes (refresh key only; erased on sign-out)':'No';
 tick();
}
function showSignedOut(text,cls=''){
 supervisor?.pause('signed out');following=false;wasFollowing=false;
 $('sessionPanel').hidden=true;$('signInPanel').hidden=false;$('matches').replaceChildren();
 $('password').value='';$('code').value='';
 if(text)say('signInStatus',text,cls);
}
function startFollow(){if(session?.status.canRead){following=true;supervisor.start();}}
const fmt=ms=>{const m=Math.floor(ms/60000);return m>=60?Math.floor(m/60)+' h '+(m%60)+' min':m+' min';};
function tick(){
 if(session===null||$('sessionPanel').hidden)return;
 const s=session.status;
 if(!s.authenticated&&!s.suspended){showSignedOut('Your session ended. Please sign in again.','bad');return;}
 $('endsOut').textContent=fmt(s.sessionRemainingMs);$('idleOut').textContent=fmt(s.idleRemainingMs)+' without activity';
}
setInterval(tick,5000);
for(const ev of ['pointerdown','keydown','touchstart'])document.addEventListener(ev,()=>session?.touch(),{passive:true});
$('togglePassword').addEventListener('click',()=>{
 const shown=$('password').type==='text';
 $('password').type=shown?'password':'text';
 $('togglePassword').textContent=shown?'Show':'Hide';
 $('togglePassword').setAttribute('aria-pressed',String(!shown));
});
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();
 if(session===null)return;
 const email=$('email').value,password=$('password').value,eventId=$('eventId').value.trim();
 $('password').value='';           // the password leaves the page the moment it is submitted
 $('signIn').disabled=true;say('signInStatus','Signing in…');
 try{
  const r=await session.signIn({email,password,eventId,keepSignedIn:$('keepSignedIn').checked});
  say('signInStatus','');showSignedIn(r);startFollow();
 }catch(err){say('signInStatus',message(err),'bad');}
 finally{$('signIn').disabled=!networkAllowed;}
});
$('requestCode').addEventListener('click',async()=>{
 const email=$('recoveryEmail').value;
 try{
  await recovery.request(email);
  say('recoveryStatus','If this address belongs to an authorised account, a code was sent. It expires soon.','good');
 }catch(err){say('recoveryStatus',message(err),'bad');}
});
$('verifyCode').addEventListener('click',async()=>{
 const code=$('code').value.trim();$('code').value='';
 try{
  const r=await recovery.verify({email:$('recoveryEmail').value,code,eventId:$('eventId').value.trim(),
   keepSignedIn:$('keepSignedIn').checked});
  say('recoveryStatus','');showSignedIn(r);startFollow();
 }catch(err){say('recoveryStatus',message(err),'bad');}
});
$('follow').addEventListener('click',startFollow);
$('stopFollow').addEventListener('click',()=>{supervisor?.pause('stopped by you');following=false;wasFollowing=false;});
async function leave(global){
 supervisor?.pause('signed out');
 const r=await session.signOut({global});
 showSignedOut(r.serverRevoked?'Signed out.':'Signed out on this device. The server could not be reached; ask the organizer to end any other session.');
}
$('signOut').addEventListener('click',()=>leave(false));
$('signOutAll').addEventListener('click',()=>leave(true));
async function resumeSession(){
 try{
  await session.resume();
  $('retry').hidden=true;say('deskStatus','Resumed. Re-checking the Match Desk…');
  if(wasFollowing)startFollow();
 }catch(err){
  if(err instanceof StaffSignInError&&['network','unavailable','rate-limited','busy','locked'].includes(err.kind)){
   if(!document.hidden){$('retry').hidden=false;say('deskStatus',message(err),'bad');}
  }else showSignedOut(message(err),'bad');
 }
}
$('retry').addEventListener('click',resumeSession);
function background(){
 if(session===null)return;
 wasFollowing=wasFollowing||following;
 supervisor.pause('backgrounded');following=false;
 session.suspend(); // drops every view now; tokens stay in memory only
}
document.addEventListener('visibilitychange',()=>{
 if(session===null||$('sessionPanel').hidden)return;
 if(document.hidden)background();else resumeSession();
});
window.addEventListener('offline',()=>{if(session!==null&&!$('sessionPanel').hidden){background();say('deskStatus','Offline. Private view cleared.','bad');}});
window.addEventListener('online',()=>{if(session!==null&&!$('sessionPanel').hidden&&!document.hidden)resumeSession();});
// A reload or a discarded mobile tab: renew from the opt-in tab vault, otherwise show the sign-in form.
if(session!==null&&vault.read()!==null){
 say('signInStatus','Restoring your session…');
 try{
  const r=await session.restore();
  say('signInStatus','');showSignedIn({role:r.role,persisted:true});wasFollowing=true;startFollow();
 }catch(err){
  if(err instanceof StaffSignInError&&['network','unavailable','rate-limited'].includes(err.kind)){
   say('signInStatus',message(err)+' Your saved session is kept; press Sign in to try a fresh one or reload to retry.','bad');
  }else say('signInStatus',message(err),'bad');
 }
}
