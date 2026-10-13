import {projectPublishedResults} from "../../contracts/milestone1_public_results.mjs";
import {createMilestone1ConnectedDesk} from "../../contracts/milestone1_connected_desk.mjs";
import {createMilestone1ReadOnlySnapshotTransport} from "../../contracts/milestone1_signed_snapshot_transport.mjs";
import {C8MagicLinkAuth} from "../../contracts/phase1c_c8_magic_link.mjs";
import {createC3ReadOnlySupabaseTransport} from "../../contracts/phase1c_c3_readonly_supabase_transport.mjs";
const KEY="sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0";
const $=id=>document.getElementById(id),say=(id,text)=>{$(id).textContent=text;};
const auth=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl:(url,init)=>fetch(url,init)});
const callbackInput={hash:window.location.hash,search:window.location.search,pathname:window.location.pathname};
const callback=auth.consumeLocation(window.location,window.history);
const callbackDiagnostic=auth.status.callbackStatus;
const read=createC3ReadOnlySupabaseTransport({publishableKey:KEY,getAccessToken:()=>auth.accessToken(),fetchImpl:(url,init)=>fetch(url,init)});
let epoch=0;
const snapshotTransport=createMilestone1ReadOnlySnapshotTransport({
 publishableKey:KEY,getAccessToken:()=>auth.accessToken(),
 fetchImpl:(url,init)=>fetch(url,init),
});
const connected=createMilestone1ConnectedDesk({
 readRole:args=>read.readStaffRole(args),
 readMatchdesk:args=>read.readMatchdesk(args),
 readSnapshot:args=>snapshotTransport.readSnapshot(args),
 isAuthenticated:()=>auth.status.authenticated,
});
const resetConnected=(message='No connected event loaded.')=>{
 connected.pause();$('connectedMatches').replaceChildren();
 say('connectedStatus',message);
};
function render(){const signed=auth.status.authenticated;
 $("authBadge").textContent=signed?"SIGNED IN · READ ONLY":"SIGNED OUT";
 $("authBadge").className="state-tag "+(signed?"ready":"paused");
 $("confirmForm").hidden=!auth.status.hasCallback;$("requestForm").hidden=signed||auth.status.hasCallback;
 $("staffControls").hidden=!signed;$("connectedControls").hidden=!signed;$("end").hidden=!signed;
}
function clear(){epoch++;connected.signOut();$("connectedMatches").replaceChildren();say("connectedStatus","No connected event loaded.");auth.end();$("eventId").value="";$("email").value="";$("confirmEmail").value="";$("staffMatches").replaceChildren();say("staffStatus","No staff data. Sign in first.");render();}
$("requestForm").addEventListener("submit",async ev=>{ev.preventDefault();$("requestLink").disabled=true;
 try{await auth.requestLink($("email").value);say("authStatus","Magic Link requested. Open the email on this same Mac in this browser. No account was created.");}
 catch(error){
  const category=error?.name==="C8RequestFailure"?error.category:"request could not be completed";
  say("authStatus","Magic Link not requested successfully: "+category+". No session established. Do not retry immediately.");
 }
 finally{$("requestLink").disabled=false;render();}});
$("confirmForm").addEventListener("submit",async ev=>{ev.preventDefault();
 try{await auth.verifyReturningEmail($("confirmEmail").value);$("confirmEmail").value="";say("authStatus","Supabase verified existing individual account. Read-only access available.");}
 catch{clear();say("authStatus","Callback expired, account mismatched or validation denied. Request a fresh link when appropriate.");}render();});
$("readStaff").addEventListener("click",async()=>{
 const id=$("eventId").value.trim();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)){say("staffStatus","Enter an exact private synthetic event UUID.");return;}
 const prior=epoch;$("readStaff").disabled=true;$("staffMatches").replaceChildren();
 try{const role=await read.readStaffRole({eventId:id});const matches=await read.readMatchdesk({eventId:id});
  if(prior!==epoch||!auth.status.authenticated)return;
  say("staffStatus","Authorized "+role+" · "+matches.length+" eligible pending matchdesk rows. READ ONLY.");
  for(const m of matches){const article=document.createElement("article");article.className="match";article.textContent=m.match_code+" · "+[m.player_1_name,m.player_2_name].filter(Boolean).join(" vs. ");$("staffMatches").append(article);}
 }catch{if(prior===epoch)say("staffStatus","Denied, expired or unavailable. No private result shown.");}
 finally{$("readStaff").disabled=false;if(!auth.status.authenticated){clear();say("authStatus","Session expired.");}}});
$("readConnected").addEventListener("click",async()=>{
 const id=$("eventId").value.trim(),at=epoch;
 $("readConnected").disabled=true;$("connectedMatches").replaceChildren();
 say("connectedStatus","Reading signed V2 event revision and Match Desk…");
 try{
   const view=await connected.refresh(id);
   if(at!==epoch||!auth.status.authenticated)return;
   if(view.status!=="ready"){
     say("connectedStatus","Signed event read denied, changed, or unavailable. Private view cleared; retry manually.");
     return;
   }
   say("connectedStatus","Authorized "+view.role+" · event revision "+view.revision+
     " · generation "+view.generation+" · "+view.matches.length+
     " pending matches · READ ONLY · scoring disabled.");
   for(const m of view.matches){
     const card=document.createElement("article");card.className="match";
     const title=document.createElement("strong");title.textContent=m.code+" · "+m.players;
     const meta=document.createElement("small");meta.textContent=
       m.bracket+" · round "+m.round+" · match version "+m.version+
       (m.table?" · table "+m.table:"");
     card.append(title,meta);$("connectedMatches").append(card);
   }
 }catch{
   if(at===epoch){
     resetConnected("Invalid or unavailable signed event read. Private view cleared.");
   }
 }finally{$("readConnected").disabled=false;}
});
$("pauseConnected").addEventListener("click",()=>resetConnected("Paused. Manual refresh required; no offline merge."));
window.addEventListener("offline",()=>resetConnected("Connection lost. Private view cleared; no queued actions."));
window.addEventListener("online",()=>resetConnected("Connection restored. Manually refresh signed V2 state."));
document.addEventListener("visibilitychange",()=>{if(document.hidden)resetConnected("Tab hidden. Private view cleared; manual refresh required.");});
$("end").addEventListener("click",()=>{clear();say("authStatus","Local memory cleared; server token expires separately.");});
let publicRequest = 0;
function renderPublishedEvents(events) {
 const parent=$("publicEvents");parent.replaceChildren();
 for(const event of events){
  const section=document.createElement("section");section.className="public-event";
  const title=document.createElement("h3");title.textContent=event.name;section.append(title);
  const meta=document.createElement("p");meta.className="muted";
  meta.textContent=event.date+" · "+event.status+" · SYNTHETIC READ ONLY";section.append(meta);
  if(!event.brackets.length){
   const empty=document.createElement("p");empty.textContent="No published matches yet.";section.append(empty);
  }
  for(const bracket of event.brackets){
   const heading=document.createElement("h4");heading.textContent=bracket.name;section.append(heading);
   if(!bracket.matches.length){const empty=document.createElement("p");empty.textContent="No published matches.";section.append(empty);}
   for(const match of bracket.matches){
    const line=document.createElement("div");line.className="public-match";
    const pairing=document.createElement("p");pairing.textContent="Round "+match.round+" · "+match.players;line.append(pairing);
    const summary=document.createElement("p");summary.className="muted";
    summary.textContent=match.status+(match.winner?" · Winner: "+match.winner:"")+
      (match.scores?" · Games: "+match.scores:"");line.append(summary);section.append(line);
   }
  }
  parent.append(section);
 }
}
async function publicRead(){
 const request=++publicRequest;const button=$("publicRefresh");button.disabled=true;
 $("publicEvents").replaceChildren();say("publicStatus","Refreshing public synthetic projection…");
 try{
  const events=projectPublishedResults(await read.readPublicResults());
  if(request!==publicRequest)return;
  renderPublishedEvents(events);
  say("publicStatus",events.length+" published synthetic event(s). Manual refresh only; no private staff state.");
 }catch{
  if(request===publicRequest){$("publicEvents").replaceChildren();say("publicStatus","Public projection unavailable or invalid; no results displayed.");}
 }finally{if(request===publicRequest)button.disabled=false;}
}
$("publicRefresh").addEventListener("click",publicRead);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!auth.status.authenticated&&$("end").hidden===false)clear();});
render();
say("authStatus",callback?
 "Magic Link session received; re-enter the existing test account email to validate it.":
 callbackDiagnostic==="no-callback"?
 "No authentication callback received. Do not request a new link until the redirect is checked.":
 "C8 rejected the callback. Safe diagnostic: "+callbackDiagnostic+". No tokens stored. Report this diagnostic only; do not share login links.");
await publicRead();
