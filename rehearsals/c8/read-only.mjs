import {projectPublishedResults} from "../../contracts/milestone1_public_results.mjs";
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
function render(){const signed=auth.status.authenticated;
 $("authBadge").textContent=signed?"SIGNED IN · READ ONLY":"SIGNED OUT";
 $("authBadge").className="state-tag "+(signed?"ready":"paused");
 $("confirmForm").hidden=!auth.status.hasCallback;$("requestForm").hidden=signed||auth.status.hasCallback;
 $("staffControls").hidden=!signed;$("end").hidden=!signed;
}
function clear(){epoch++;auth.end();$("eventId").value="";$("email").value="";$("confirmEmail").value="";$("staffMatches").replaceChildren();say("staffStatus","No staff data. Sign in first.");render();}
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
