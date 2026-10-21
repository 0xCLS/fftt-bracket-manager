/** FFTT hosted provider PKCE trial: explicitly clicked, exactly localhost:3000.
 * NEVER imported by production index.html or mock-only staff-pkce.html.
 * No auto sign-in or email on navigation; no scores, writes, retries or accounts.
 */
import {createMilestone1PkceGuard} from '../../contracts/milestone1_pkce_guard.mjs';
import {createMilestone1BrowserPkcePrimitives} from '../../contracts/milestone1_pkce_browser_adapter.mjs';
import {createMilestone1PkceSupabaseTransport} from '../../contracts/milestone1_pkce_supabase_transport.mjs';
import {createMilestone1PkceStaffSession} from '../../contracts/milestone1_pkce_staff_session.mjs';
const $=id=>document.getElementById(id);
const show=(id,value)=>{$(id).textContent=value;};
const local=window.location.origin==='http://localhost:3000' &&
 window.location.pathname==='/rehearsals/m1/hosted-pkce.html';
const callbackURL=window.location.search||window.location.hash?window.location.href:null;
// Always remove auth codes, state and tokens from the address synchronously.
if(callbackURL)window.history.replaceState(null,'',window.location.pathname);
const redirectUri='http://localhost:3000/rehearsals/m1/hosted-pkce.html';
const pkce=createMilestone1PkceGuard({
 redirectUri,
 ...createMilestone1BrowserPkcePrimitives({
  cryptoImpl:window.crypto,tabStorage:window.sessionStorage,
 }),
});
const transport=createMilestone1PkceSupabaseTransport({
 publishableKey:'sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0',
 allowSyntheticAuthNetwork:local,
 fetchImpl:(url,init)=>{
  if(!local)throw Error('Not the authorized localhost dev trial');
  return fetch(url,init);
 },
});
const session=createMilestone1PkceStaffSession({
 pkce,transport,redirectUri,
 isOnline:()=>local&&navigator.onLine&&!document.hidden,
});
let requested=false;
// Operator enters the pre-existing synthetic address locally; do not put it in this public repository.
$('requestLink').disabled=!local;
$('complete').disabled=!local||!callbackURL;
show('requestStatus',local?
 'Ready. No network request until you click the button once.':
 'Denied: use exactly http://localhost:3000/rehearsals/m1/hosted-pkce.html');
show('authStatus',callbackURL?
 'Return received and URL scrubbed. If the callback is code+state, enter the private event UUID and validate once.':
 'No callback. No hosted access or token exchange.');
$('requestLink').addEventListener('click',async()=>{
 const address=$('email').value.trim().toLowerCase();
 if(requested||!local||!$('consent').checked||
    !/^[^\\s@<>]{1,64}@[^\\s@<>]{1,190}$/.test(address)){
  show('requestStatus','Not authorized: an existing fictional account address and operator confirmation are required.');
  return;
 }
 requested=true;$('requestLink').disabled=true;
 try{
  await session.begin(address);
  show('requestStatus','One dev Magic Link requested. Check synthetic Yahoo inbox/spam and open in this SAME browser profile. No repeats.');
 }catch{
  show('requestStatus','Request refused, unavailable or rate-limited. Do NOT retry. Check safe provider logs.');
 }
});
$('complete').addEventListener('click',async()=>{
 if(!local||!callbackURL)return;
 $('complete').disabled=true;
 try{
  const r=await session.complete(callbackURL,{eventId:$('eventId').value.trim()});
  show('authStatus','SIGNED IN · verified '+r.role+' · synthetic only · read-only');
  $('readDesk').disabled=false;
 }catch{
  show('authStatus','PKCE code/state, account or event authorization failed. No tokens retained. Do not retry automatically.');
  $('readDesk').disabled=true;$('matches').replaceChildren();
 }
});
$('readDesk').addEventListener('click',async()=>{
 $('readDesk').disabled=true;$('matches').replaceChildren();
 try{
  const view=await session.readDesk();
  show('deskStatus','Verified '+view.role+' · revision '+view.revision+
   ' · generation '+view.generation+' · pending '+view.matches.length+' · READ ONLY');
  for(const match of view.matches){
   const p=document.createElement('p');
   p.textContent=match.code+' · '+match.players+' · version '+match.version;
   $('matches').append(p);
  }
  $('readDesk').disabled=false;
 }catch{show('deskStatus','Denied or stale. Read-only view cleared.');}
});
const clear=()=>{
 session.signOut();$('matches').replaceChildren();$('readDesk').disabled=true;
 show('deskStatus','Session cleared. No retained private rows.');
};
$('signOut').addEventListener('click',()=>{clear();show('authStatus','SIGNED OUT · synthetic only');});
// Navigating to Yahoo hides the tab: pause any authenticated session WITHOUT
// cancelling the pending verifier. Only the explicit sign-out cancels PKCE.
const privacyPause=()=>{
 session.pause();$('matches').replaceChildren();$('readDesk').disabled=true;
 show('deskStatus','Private session paused. No cached rows.');
};
window.addEventListener('offline',privacyPause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)privacyPause();});
