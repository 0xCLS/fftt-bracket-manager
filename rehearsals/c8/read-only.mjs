import {C8MagicLinkAuth} from "../../contracts/phase1c_c8_magic_link.mjs";
import {createC3ReadOnlySupabaseTransport} from "../../contracts/phase1c_c3_readonly_supabase_transport.mjs";
const KEY="sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0";
const $=id=>document.getElementById(id),say=(id,text)=>{$(id).textContent=text;};
const auth=new C8MagicLinkAuth({publishableKey:KEY,fetchImpl:(url,init)=>fetch(url,init)});
const callbackInput={hash:window.location.hash,search:window.location.search,pathname:window.location.pathname};
const callback=auth.consumeLocation(window.location,window.history);
const callbackDiagnostic=callback?"callback-ready":
 callbackInput.search?"query-callback-unsupported":
 callbackInput.hash?"fragment-callback-rejected":"no-authentication-callback";
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
 catch{say("authStatus","Request denied or limited. No session established.");}
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
 }catch{say("staffStatus","Denied, expired or unavailable. No private result shown.");}
 finally{$("readStaff").disabled=false;if(!auth.status.authenticated){clear();say("authStatus","Session expired.");}}});
$("end").addEventListener("click",()=>{clear();say("authStatus","Local memory cleared; server token expires separately.");});
async function publicRead(){try{const rows=await read.readPublicResults();say("publicStatus",rows.length+" published public event(s); no private data exposed.");}catch{say("publicStatus","Public projection unavailable.");}}
$("publicRefresh").addEventListener("click",publicRead);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!auth.status.authenticated&&$("end").hidden===false)clear();});
render();say("authStatus",callback?
 "Magic Link session received; re-enter the existing test account email to validate it.":
 callbackDiagnostic==="query-callback-unsupported"?
 "Sign-in redirect reached C8, but provided a query-style callback instead of the expected session fragment. No credentials were stored; report QUERY CALLBACK to the developer.":
 callbackDiagnostic==="fragment-callback-rejected"?
 "Sign-in redirect reached C8, but its session fragment did not pass strict validation. No credentials were stored; report FRAGMENT REJECTED to the developer.":
 "No authentication callback received. If you just clicked an email link, check whether the link opened in a different browser profile and report NO CALLBACK.");await publicRead();
