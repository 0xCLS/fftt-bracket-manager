/**
 * FFTT C6 isolated read-only existing-user OTP browser rehearsal.
 * Only developer-initiated email OTP and real signed-in READ RPCs are allowed.
 * No imported score RPC or hosted C5 snapshot endpoint; no auto-login.
 */
import {C6ExistingUserOtp} from "../../contracts/phase1c_c6_existing_user_otp.mjs";
import {createC3ReadOnlySupabaseTransport} from "../../contracts/phase1c_c3_readonly_supabase_transport.mjs";

const DEV_PUBLIC_PUBLISHABLE_KEY="sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0"; // publicly intended, NOT an admin secret
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const get=id=>document.getElementById(id);
const auth=new C6ExistingUserOtp({
  publishableKey:DEV_PUBLIC_PUBLISHABLE_KEY,
  fetchImpl:(url,options)=>fetch(url,options),
});
const read=createC3ReadOnlySupabaseTransport({
  publishableKey:DEV_PUBLIC_PUBLISHABLE_KEY,
  getAccessToken:()=>auth.accessToken(),
  fetchImpl:(url,options)=>fetch(url,options),
});
let activeEpoch=0;
function say(target,msg){get(target).textContent=msg;}
function empty(id){get(id).replaceChildren();}
function card(id,title,description,caption){
  const node=document.createElement("article");
  node.className="match";
  const strong=document.createElement("strong");
  strong.textContent=title;
  const p=document.createElement("p");
  p.textContent=description;
  const small=document.createElement("small");
  small.textContent=caption;
  node.append(strong,p,small);
  get(id).append(node);
}
function renderAuth(){
  const signed=auth.status.authenticated;
  get("authBadge").textContent=signed?"SIGNED IN · READ ONLY":"SIGNED OUT";
  get("authBadge").className="state-tag "+(signed?"ready":"paused");
  get("requestForm").hidden=signed||auth.status.state==="awaiting-code";
  get("verifyForm").hidden=signed||auth.status.state!=="awaiting-code";
  get("staffControls").hidden=!signed;
  get("end").hidden=!signed;
}
function clearPrivate(){
  empty("staffMatches");
  get("eventId").value="";
  get("email").value="";
  get("code").value="";
  say("staffStatus","No staff data. Authenticate again to read authorized test-event matches.");
}
function signedOutUi(message){
  activeEpoch++;
  auth.end();
  clearPrivate();
  renderAuth();
  say("authStatus",message);
}
function protectExpiredSession(){
  if(!get("end").hidden&&!auth.status.authenticated){
    signedOutUi("Local session expired. Request a fresh code when needed.");
  }
}
function setBusy(busy){
  for(const id of ["email","requestCode","code","verifyCode","eventId",
    "readStaff","publicRefresh","end"])get(id).disabled=busy;
}
async function publicRead(){
  const epoch=activeEpoch;
  empty("published");
  say("publicStatus","Reading published-only projection…");
  try{
    const results=await read.readPublicResults();
    if(epoch!==activeEpoch)return;
    if(results.length===0){say("publicStatus","No public event results have been published.");return;}
    let count=0;
    for(const event of results){
      for(const bracket of event.brackets){
        for(const match of bracket.matches){
          card("published",match.match_id,
            [match.player_1_name,match.player_2_name].filter(Boolean).join(" vs. "),
            "Public "+match.status+" · "+bracket.name);
          count++;
        }
      }
    }
    say("publicStatus",count+" public published match record(s). No private data shown.");
  }catch{
    if(epoch===activeEpoch)say("publicStatus",
      "Public results unavailable. Nothing private is shown.");
  }
}
get("requestForm").addEventListener("submit",async event=>{
  event.preventDefault();
  setBusy(true);
  say("authStatus","Requesting code for an existing test account…");
  try{
    await auth.requestCode(get("email").value);
    say("authStatus","Request recorded. Enter the six-digit code if the development email template provides one. Never paste magic-link URLs or JWTs.");
  }catch{
    say("authStatus","No code session established. Check the email and request limits; do not create or reset an account.");
  }finally{setBusy(false);renderAuth();}
});
get("verifyForm").addEventListener("submit",async event=>{
  event.preventDefault();
  setBusy(true);
  const epoch=++activeEpoch;
  say("authStatus","Verifying individual identity…");
  try{
    await auth.verifyCode(get("code").value);
    if(epoch!==activeEpoch)return;
    get("code").value="";
    get("email").value="";
    say("authStatus","Signed-in test session validated with Supabase Auth. Enter the private synthetic event UUID to view your authorized matchdesk.");
    renderAuth();
  }catch{
    if(epoch===activeEpoch){
      say("authStatus","Code or account verification denied. Start with a new code; no private data displayed.");
      clearPrivate();
    }
  }finally{setBusy(false);renderAuth();}
});
get("readStaff").addEventListener("click",async()=>{
  protectExpiredSession();
  if(!auth.status.authenticated)return;
  const eventId=get("eventId").value.trim();
  empty("staffMatches");
  if(!UUID.test(eventId)){
    say("staffStatus","Enter an exact private synthetic event UUID; no request sent.");
    return;
  }
  const epoch=activeEpoch;
  setBusy(true);
  say("staffStatus","Checking live signed-in staff role and private matchdesk access…");
  try{
    const role=await read.readStaffRole({eventId});
    if(epoch!==activeEpoch||!auth.status.authenticated)return;
    const matches=await read.readMatchdesk({eventId});
    if(epoch!==activeEpoch||!auth.status.authenticated)return;
    say("staffStatus",matches.length?
      "Authorized "+role+" · "+matches.length+" matchdesk row(s). READ ONLY.":
      "Authorized "+role+" · no eligible pending matchdesk rows. READ ONLY.");
    for(const match of matches){
      card("staffMatches",match.match_code,
        [match.player_1_name,match.player_2_name].filter(Boolean).join(" vs. "),
        "Generation "+match.bracket_generation+" · version "+match.match_version);
    }
  }catch{
    empty("staffMatches");
    if(epoch===activeEpoch)say("staffStatus",
      "Staff access denied, expired, or unavailable. No private result shown.");
  }finally{setBusy(false);protectExpiredSession();}
});
get("end").addEventListener("click",()=>{
  signedOutUi("Local session cleared. The server-issued token expires independently; do not use shared devices.");
});
get("publicRefresh").addEventListener("click",publicRead);
// No auto-refresh, background session recovery, cloud scoring or local storage.
document.addEventListener("visibilitychange",()=>{if(!document.hidden)protectExpiredSession();});
window.addEventListener("focus",protectExpiredSession);
setInterval(protectExpiredSession,15000);
// Never consume, propagate or log a link-provided session in fragment/query.
if(location.search||location.hash)history.replaceState(null,"",location.pathname);
renderAuth();
await publicRead();
