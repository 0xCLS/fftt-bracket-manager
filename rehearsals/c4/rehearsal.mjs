/**
 * C4 isolated browser demonstration. MOCK NETWORK ONLY.
 * No real Supabase connection, client keys, persisted state or score requests.
 */
import {MockableSharedMatchClient} from "../../contracts/phase1c_mock_shared_client.mjs";
import {createC3ReadOnlySupabaseTransport} from "../../contracts/phase1c_c3_readonly_supabase_transport.mjs";

const EVENT = "12345678-1234-4234-9234-123456789abc"; // wholly fictitious
const PUBLIC_EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE = document.querySelector("#role");
const el = id=>document.getElementById(id);
const ALLOWED = new Set([
  "/rest/v1/rpc/fftt_staff_role_v1",
  "/rest/v1/rpc/fftt_matchdesk_v1",
  "/rest/v1/fftt_public_results_v1",
]);
let online=true;
let readCount=0;
let currentRole=ROLE.value;
let client;

function matchdeskFixture(){
  return [{
    event_id:EVENT,bracket_generation:1,match_id:MATCH,match_code:"C-0-0",
    match_version:0,bracket:"championship",round_number:0,slot:0,
    player_1_id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    player_2_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    player_1_name:"Synthetic Red",player_2_name:"Synthetic Blue",
    is_championship_final:false,table_number:1,
  }];
}
function publicFixture(){
  return [{
    event_id:PUBLIC_EVENT,event_name:"C4 Fictional Demo",event_date:"2099-12-31",
    status:"active",updated_at:"2099-12-31T00:00:00Z",
    brackets:[{name:"championship",matches:[{
      event_id:PUBLIC_EVENT,match_id:"C-0-0",bracket:"championship",
      round:0,slot:0,player_1_name:"Synthetic Red",
      player_2_name:"Synthetic Blue",winner_name:null,
      game_scores:"",status:"pending",
    }]}],
  }];
}

async function fakeFetch(url,options){
  // Strictly injected fake fetch, NOT global fetch. CSP also blocks networks.
  if(!online) throw Error("Simulated offline");
  const u=new URL(url);
  if(u.origin!=="https://copmkalfkkrkzheohwuc.supabase.co" ||
     !ALLOWED.has(u.pathname)) throw Error("Unexpected route in mock");
  const privateRead=u.pathname.includes("/rpc/");
  if(privateRead){
    if(options.method!=="POST" ||
      !options.headers.Authorization?.startsWith("Bearer mock.") ||
      JSON.parse(options.body).p_event_id!==EVENT) throw Error("Mock Auth rejected");
  } else if(options.method!=="GET" || options.headers.Authorization) {
    throw Error("Mock public projection restriction");
  }
  readCount++;
  if(privateRead && currentRole==="outsider") return {status:403,json:async()=>({})};
  if(privateRead && currentRole==="spectator") return {status:403,json:async()=>({})};
  const result=u.pathname.endsWith("fftt_staff_role_v1")?currentRole:
    u.pathname.endsWith("fftt_matchdesk_v1")?matchdeskFixture():publicFixture();
  return {status:200,json:async()=>result};
}

function newClient(){
  const transport=createC3ReadOnlySupabaseTransport({
    publishableKey:"sb_publishable_c4_fake_test_only",
    getAccessToken:()=>Promise.resolve("mock.synthetic.signature"),
    fetchImpl:fakeFetch,
  });
  client=new MockableSharedMatchClient({
    eventId:EVENT,revision:4,generation:1,transport,
  });
  return transport;
}
let transport=newClient();

function clean(node){node.replaceChildren();}
function paragraph(parent,value,className){
  const p=document.createElement("p");
  if(className)p.className=className;
  p.textContent=value;
  parent.append(p);
  return p;
}
function card(parent,title,description,meta){
  const block=document.createElement("article");
  block.className="match";
  const strong=document.createElement("strong");
  strong.textContent=title;
  block.append(strong);
  paragraph(block,description);
  const small=document.createElement("small");
  small.textContent=meta;
  block.append(small);
  parent.append(block);
}
function phaseLabel(status){
  switch(status.phase){
    case "cloud-ready":return ["Cloud ready (mock)","Fake read-only responses can be inspected here. No scoring is enabled.","MOCK READY","ready"];
    case "cloud-paused":return ["Cloud paused — offline simulation","Cached views may be stale. No requests or cloud scores may run.","OFFLINE","paused"];
    case "cloud-reloading":return ["Reconnected — verification pending","Network restoration alone does not verify event revision or score receipts.","STALE / BLOCKED","reloading"];
    case "single-device-fallback":return ["Isolated fallback authority","Only manual organizer-controlled records; no automatic cloud uploads.","ISOLATED","paused"];
    case "organizer-reconciliation":return ["Organizer reconciliation required","Manual comparison of paper/private records is required before future cloud use.","RECONCILE","reloading"];
    default:return ["Unknown state — blocked","No further operations authorized.","BLOCKED","denied"];
  }
}
function renderState(){
  const state=client.status;
  const [heading,desc,label,kind]=phaseLabel(state);
  el("phase").textContent=heading;
  el("stateExplanation").textContent=desc;
  el("stateTag").textContent=label;
  el("stateTag").className="state-tag "+kind;
  el("revision").textContent=String(state.revision);
  el("recoveryWarning").hidden=state.phase==="cloud-ready";
  el("recoveryText").textContent=state.phase==="cloud-paused"?
    "Read-only data may be stale. Reconnect triggers verification, never a score replay.":
    "The current C3 backend adapter has no verified revision/receipt snapshot endpoint, so safe cloud write resumption is unavailable.";
  const usable=online && state.phase==="cloud-ready";
  el("refresh").disabled=!usable;
  el("disconnect").disabled=!usable;
  el("reconnect").disabled=online || state.phase!=="cloud-paused";
  ROLE.disabled=!usable;
  el("requestCount").textContent="Mock reads: "+readCount+" · Score writes: 0";
}

async function readPreview(){
  if(!online || client.status.phase!=="cloud-ready") {
    renderState();
    return;
  }
  clean(el("matchdesk"));
  clean(el("publicResults"));
  el("deskMessage").textContent="No private matches displayed to this role.";
  el("publicMessage").textContent="Only synthetic public projection is shown.";
  // The role selector is a TEST FIXTURE switch; it grants no hosted rights.
  if(currentRole==="organizer" || currentRole==="scorekeeper"){
    try{
      const role=await transport.readStaffRole({eventId:EVENT});
      if(role!==currentRole) throw Error("Unexpected role");
      const matches=await client.readMatchdesk();
      el("deskMessage").textContent="Simulated "+role+" may view these match labels:";
      for(const m of matches){
        card(el("matchdesk"),m.match_code,
          m.player_1_name+" vs. "+m.player_2_name,
          "Pending synthetic match · version "+m.match_version);
      }
    } catch {
      el("deskMessage").textContent="Role or matchdesk read denied; no private data exposed.";
    }
  } else if(currentRole==="outsider") {
    try{
      await transport.readStaffRole({eventId:EVENT});
      el("deskMessage").textContent="Unexpected role; blocked.";
    } catch{
      el("deskMessage").textContent="Access denied — unassigned outsider has no staff matchdesk.";
    }
  } else {
    el("deskMessage").textContent="Spectators have no staff-matchdesk authorization.";
  }
  try{
    const results=await transport.readPublicResults();
    if(results.length){
      for(const event of results){
        for(const b of event.brackets){
          for(const m of b.matches){
            card(el("publicResults"),m.match_id,
              m.player_1_name+" vs. "+m.player_2_name,
              "Fictional public preview · "+m.status);
          }
        }
      }
    }
  }catch{
    el("publicMessage").textContent="Public mock read unavailable.";
  }
  renderState();
}

ROLE.addEventListener("change",async()=>{
  if(!online || client.status.phase!=="cloud-ready"){
    ROLE.value=currentRole;
    return;
  }
  currentRole=ROLE.value;
  transport=newClient();
  await readPreview();
});
el("refresh").addEventListener("click",readPreview);
el("disconnect").addEventListener("click",()=>{
  online=false;
  client.loseConnection();
  el("deskMessage").textContent="STALE — no trusted staff reads while offline.";
  el("publicMessage").textContent="STALE — previously loaded mock public result; not authoritative.";
  renderState();
});
el("reconnect").addEventListener("click",()=>{
  online=true;
  client.restoreConnection();
  // The C3 adapter has NO authenticated revision/receipt snapshot endpoint.
  // Do not even request one: keep C2 in cloud-reloading (stale and blocked).
  // A real recovery would require a separately reviewed trusted protocol.
  renderState();
});
renderState();
await readPreview();
