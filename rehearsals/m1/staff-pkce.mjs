import {createMilestone1PkceGuard}
 from '../../contracts/milestone1_pkce_guard.mjs';
import {createMilestone1BrowserPkcePrimitives}
 from '../../contracts/milestone1_pkce_browser_adapter.mjs';
import {createMilestone1PkceSupabaseTransport}
 from '../../contracts/milestone1_pkce_supabase_transport.mjs';
import {createMilestone1PkceStaffSession}
 from '../../contracts/milestone1_pkce_staff_session.mjs';
const $=id=>document.getElementById(id);
const callbackURL=window.location.search||window.location.hash?window.location.href:null;
// Scrub raw callback code, state, fragments *synchronously before first async operation*.
if(callbackURL)window.history.replaceState(null,'',window.location.pathname);
const redirectUri=window.location.origin+window.location.pathname;
const mock=window.__FFTT_SYNTHETIC_PKCE_MOCK__===true
 &&['127.0.0.1','localhost'].includes(window.location.hostname);
const PK='sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0';
const cryptoParts=createMilestone1BrowserPkcePrimitives({
 cryptoImpl:window.crypto,tabStorage:window.sessionStorage,
});
const pkce=createMilestone1PkceGuard({redirectUri,...cryptoParts});
const transport=createMilestone1PkceSupabaseTransport({
 publishableKey:PK,allowSyntheticAuthNetwork:mock,
 fetchImpl:(url,init)=>{
  if(!mock)throw Error('Hosted Auth not approved for this demo');
  return fetch(url,init);
 },
});
const session=createMilestone1PkceStaffSession({
 pkce,transport,redirectUri,
 isOnline:()=>navigator.onLine&&!document.hidden,
});
const show=(id,message)=>{$(id).textContent=message;};
$('requestLink').disabled=!mock;
show('requestStatus',mock?
 'Mock GoTrue endpoints are connected. Only fictional existing users may request a link.':
 'Mock harness not installed. Hosted sign-in is deliberately disabled.');
show('authStatus',callbackURL?
 'One-time return received; enter the exact fictional event UUID to finish.':
 'No callback received. Same-browser login required.');
$('requestLink').addEventListener('click',async()=>{
 $('requestLink').disabled=true;
 try{
  await session.begin($('email').value);
  show('requestStatus','Existing-account mock link requested. Check the synthetic harness for the callback.');
 }catch{show('requestStatus','Request refused or unavailable. No session. Do not retry automatically.');}
 finally{$('requestLink').disabled=!mock;}
});
$('complete').addEventListener('click',async()=>{
 if(!callbackURL){show('authStatus','No one-time callback to complete.');return;}
 $('complete').disabled=true;
 try{
  const r=await session.complete(callbackURL,{eventId:$('eventId').value.trim()});
  show('authStatus','SIGNED IN · verified '+r.role+' · authorized fictional staff only · READ ONLY');
  $('readDesk').disabled=false;
 }catch{
  show('authStatus','Callback expired, mismatched, unauthorized or unavailable. All private session data cleared.');
  $('readDesk').disabled=true;$('matches').replaceChildren();
 }
});
$('readDesk').addEventListener('click',async()=>{
 $('readDesk').disabled=true;$('matches').replaceChildren();
 try{
  const view=await session.readDesk();
  show('deskStatus','Authorized '+view.role+' · event revision '+view.revision+
    ' · generation '+view.generation+' · '+view.matches.length+' pending matches. READ ONLY.');
  for(const m of view.matches){
   const e=document.createElement('p');
   e.textContent=m.code+' · '+m.players+' · match version '+m.version;
   $('matches').append(e);
  }
  $('readDesk').disabled=false;
 }catch{show('deskStatus','Denied, changed or expired. Private view cleared.');}
});
function pause(){
 session.pause();$('matches').replaceChildren();$('readDesk').disabled=true;
 show('deskStatus','Session stopped; no cached private data.');
}
$('signOut').addEventListener('click',()=>{
 session.signOut();pause();
 show('authStatus','SIGNED OUT · all bearer tokens and private rows cleared.');
});
window.addEventListener('offline',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
