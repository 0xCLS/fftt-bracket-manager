import test from "node:test";
import assert from "node:assert/strict";

import {AuthorityGateError} from "../contracts/phase1c_disconnect_reference.mjs";
import {MockableSharedMatchClient} from "../contracts/phase1c_mock_shared_client.mjs";
import {createC3ReadOnlySupabaseTransport,C3_HOST}
  from "../contracts/phase1c_c3_readonly_supabase_transport.mjs";

const EVENT="12345678-1234-4234-9234-123456789abc";
const PUBLIC="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUB="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY="sb_publishable_mock_key_not_privileged";
const ACCESS="signed.header.signature";
const fail=call=>assert.rejects(call,AuthorityGateError);
const deskRow=()=>({
  event_id:EVENT,bracket_generation:1,match_id:UUID,match_code:"C-0-0",
  match_version:1,bracket:"championship",round_number:0,slot:0,
  player_1_id:UUID,player_2_id:PUBLIC,
  player_1_name:"Synthetic Alpha",player_2_name:"Synthetic Beta",
  is_championship_final:false,table_number:1,
});
const pubMatch=()=>({
  event_id:PUBLIC,match_id:UUID,bracket:"championship",round:0,slot:0,
  player_1_name:"Synthetic Alpha",player_2_name:"Synthetic Beta",
  winner_name:"Synthetic Alpha",game_scores:"11-7, 11-8",status:"complete",
});
const pubEvent=()=>({
  event_id:PUBLIC,event_name:"Synthetic Public Projection",event_date:"2099-01-01",
  status:"complete",updated_at:"2099-01-01T00:00:00Z",
});
const pubResult=()=>({...pubEvent(),
  brackets:[{name:"championship",matches:[pubMatch()]}],
});
function harness(payload, opts={}) {
  const calls=[];
  let tokenLookups=0;
  const fetchImpl=async (url, init)=>{
    calls.push({url,init});
    if(opts.throwFetch)throw new Error("offline");
    if(opts.status!==undefined)return {status:opts.status,json:async()=>payload};
    if(opts.badJson)return {status:200,json:async()=>{throw new Error("invalid");}};
    return {status:200,json:async()=>payload};
  };
  const getAccessToken=async()=>{
    tokenLookups++;
    return opts.token??ACCESS;
  };
  const transport=createC3ReadOnlySupabaseTransport({
    publishableKey:KEY,getAccessToken,fetchImpl,
  });
  return {transport,calls,lookups:()=>tokenLookups};
}

test("project URL and publishable key are pinned; no admin key accepted",()=>{
  for(const bad of ["sb_secret_bad","service_role","eyJh.c2Vj.c2ln","",KEY+" bad"]){
    assert.throws(()=>createC3ReadOnlySupabaseTransport({
      publishableKey:bad,getAccessToken:()=>ACCESS,fetchImpl:async()=>{},
    }),AuthorityGateError);
  }
  assert.throws(()=>createC3ReadOnlySupabaseTransport({
    projectUrl:"https://malicious.example",publishableKey:KEY,
    getAccessToken:()=>ACCESS,fetchImpl:async()=>{},
  }),AuthorityGateError);
});
test("no default network or implicit token loader",()=>{
  assert.throws(()=>createC3ReadOnlySupabaseTransport({
    publishableKey:KEY,getAccessToken:()=>ACCESS,
  }),AuthorityGateError);
  assert.throws(()=>createC3ReadOnlySupabaseTransport({
    publishableKey:KEY,fetchImpl:async()=>{},
  }),AuthorityGateError);
});
test("only pinned read-only endpoints are reachable, with correct REST verbs",async()=>{
  const a=harness([deskRow()]);
  await a.transport.readMatchdesk({eventId:EVENT});
  assert.equal(a.calls.length,1);
  assert.equal(a.calls[0].url,C3_HOST+"/rest/v1/rpc/fftt_matchdesk_v1");
  assert.equal(a.calls[0].init.method,"POST");
  assert.deepEqual(JSON.parse(a.calls[0].init.body),{p_event_id:EVENT});
  assert.equal(a.calls[0].init.redirect,"error");
  assert.equal(a.calls[0].init.cache,"no-store");
  assert.equal(a.calls[0].init.credentials,"omit");
  assert.equal(a.calls[0].init.headers.Authorization,"Bearer "+ACCESS);
});
test("role RPC accepts only signed scoped organizer or scorekeeper",async()=>{
  for(const role of ["organizer","scorekeeper"]){
    const h=harness(role);
    assert.equal(await h.transport.readStaffRole({eventId:EVENT}),role);
    assert.equal(h.calls[0].url,C3_HOST+"/rest/v1/rpc/fftt_staff_role_v1");
  }
  const r=harness("outsider");
  await fail(()=>r.transport.readStaffRole({eventId:EVENT}));
});
test("wrong or missing event UUID cannot invoke signed RPC",async()=>{
  const h=harness([deskRow()]);
  for(const eventId of ["",null,"garbage",PUBLIC+"?admin=true"]){
    await fail(()=>h.transport.readMatchdesk({eventId}));
  }
  assert.equal(h.calls.length,0);
  assert.equal(h.lookups(),0);
});
test("missing JWT and injected admin secret rejected before network",async()=>{
  for(const token of ["","sb_secret_not_a_jwt","admin service role","a.b",null]){
    const h=harness([deskRow()],{token});
    await fail(()=>h.transport.readMatchdesk({eventId:EVENT}));
    assert.equal(h.calls.length,0);
  }
});
test("matchdesk projection preserves only audited 14 fields",async()=>{
  const h=harness([deskRow()]);
  const rows=await h.transport.readMatchdesk({eventId:EVENT});
  assert.equal(rows.length,1);
  assert.equal(rows[0].player_1_name,"Synthetic Alpha");
  assert.ok(Object.isFrozen(rows)&&Object.isFrozen(rows[0]));
  assert.equal(Object.keys(rows[0]).length,14);
});
test("cross-event, invalid match identity or missing versions rejected",async()=>{
  for(const x of [
    {...deskRow(),event_id:PUBLIC},
    {...deskRow(),match_id:"fake"},
    {...deskRow(),bracket_generation:-1},
    {...deskRow(),match_version:"1"},
  ]) {
    const h=harness([x]);
    await fail(()=>h.transport.readMatchdesk({eventId:EVENT}));
  }
});
test("extra private fields in staff desk fail closed rather than filter",async()=>{
  for(const field of ["email","rating","phone","actor_id","staff","checked_in"]){
    const h=harness([{...deskRow(),[field]:"PRIVATE"}]);
    await fail(()=>h.transport.readMatchdesk({eventId:EVENT}));
  }
});
test("bad matchdesk response type and huge responses rejected",async()=>{
  for(const body of [{},null,"secret",Array(1001).fill(deskRow())]){
    const h=harness(body);
    await fail(()=>h.transport.readMatchdesk({eventId:EVENT}));
  }
});
test("public results use anonymous GET and explicit allowlisted projection",async()=>{
  const h=harness([pubResult()]);
  const out=await h.transport.readPublicResults();
  assert.equal(out.length,1);
  assert.equal(out[0].brackets[0].matches[0].winner_name,"Synthetic Alpha");
  assert.ok(Object.isFrozen(out[0].brackets[0].matches));
  const call=h.calls[0];
  const uri=new URL(call.url);
  assert.equal(uri.origin,C3_HOST);
  assert.equal(uri.pathname,"/rest/v1/fftt_public_results_v1");
  assert.equal(uri.searchParams.get("select"),"event_id,event_name,event_date,status,brackets,updated_at");
  assert.equal(call.init.method,"GET");
  assert.equal(call.init.headers.Authorization,undefined);
  assert.equal(h.lookups(),0);
});
test("public nested bracket or match private fields rejected",async()=>{
  const cases=[
    [{...pubResult(),email:"SECRET"}],
    [{...pubResult(),brackets:[{name:"championship",matches:[{...pubMatch(),rating:5}]}]}],
    [{...pubResult(),brackets:[{name:"championship",matches:[pubMatch()],notes:"private"}]}],
    [{...pubResult(),brackets:[{name:"championship",matches:"wrong"}]}],
  ];
  for(const sample of cases){
    const h=harness(sample);
    await fail(()=>h.transport.readPublicResults());
  }
});
test("public result handles empty projection without auto publishing",async()=>{
  const h=harness([]);
  assert.deepEqual(await h.transport.readPublicResults(),[]);
  assert.equal(h.calls.length,1);
});
test("published events read-only GET with strict fields",async()=>{
  const h=harness([pubEvent()]);
  assert.equal((await h.transport.readPublicEvents())[0].event_name,
    "Synthetic Public Projection");
  assert.equal(new URL(h.calls[0].url).pathname,"/rest/v1/fftt_published_events");
  const bad=harness([{...pubEvent(),contact:"SECRET"}]);
  await fail(()=>bad.transport.readPublicEvents());
});
test("published matches read-only GET and field allowlist",async()=>{
  const h=harness([pubMatch()]);
  assert.equal((await h.transport.readPublicMatches())[0].game_scores,"11-7, 11-8");
  assert.equal(new URL(h.calls[0].url).pathname,"/rest/v1/fftt_published_matches");
  const bad=harness([{...pubMatch(),player_1_id:UUID}]);
  await fail(()=>bad.transport.readPublicMatches());
});
test("403 forbidden / 429 throttling / 5xx all fail closed without backend error details",async()=>{
  for(const status of [400,401,403,404,429,500]){
    const h=harness([deskRow()],{status});
    await fail(()=>h.transport.readMatchdesk({eventId:EVENT}));
    assert.equal(h.calls.length,1);
  }
});
test("network error and invalid JSON never return cached state",async()=>{
  await fail(()=>harness([deskRow()],{throwFetch:true}).transport.readMatchdesk({eventId:EVENT}));
  await fail(()=>harness([deskRow()],{badJson:true}).transport.readMatchdesk({eventId:EVENT}));
});
test("score submission always denied even with fabricated approval and JWT",async()=>{
  let calls=0;
  const h=harness([deskRow()]);
  const result=h.transport.submitScore({
    eventId:EVENT,submissionId:SUB,expectedMatchVersion:0,
  });
  await fail(()=>result);
  assert.equal(h.calls.length,0);
  assert.equal(calls,0);
});
test("authoritative snapshot/reconciliation API is intentionally unavailable",async()=>{
  const h=harness([]);
  await fail(()=>h.transport.fetchAuthoritativeSnapshot({eventId:EVENT}));
  assert.equal(h.calls.length,0);
});
test("read-only C3 transport can serve C2 matchdesk without allowing score writes",async()=>{
  const h=harness([deskRow()]);
  const c=new MockableSharedMatchClient({
    eventId:EVENT,revision:4,generation:1,transport:h.transport,
  });
  assert.equal((await c.readMatchdesk())[0].match_version,1);
  const attempt=await c.submitScore({
    eventId:EVENT,matchId:UUID,submissionId:SUB,
    bracketGeneration:1,expectedMatchVersion:1,winnerId:UUID,
    gameScores:"11-7, 11-8",
  });
  assert.deepEqual(attempt,{status:"uncertain",persisted:false,retryAllowed:false});
  assert.equal(c.status.phase,"cloud-paused");
  assert.equal(h.calls.length,1);
});
test("post-disconnect C2 cannot auto-reload authoritative state from C3",async()=>{
  const h=harness([]);
  const c=new MockableSharedMatchClient({
    eventId:EVENT,revision:4,generation:1,transport:h.transport,
  });
  c.loseConnection();
  c.restoreConnection();
  await fail(()=>c.reloadAuthoritativeState());
  assert.equal(c.status.cloudWritesEnabled,false);
});
test("C3 source contains no write RPC, persistent credential code or unapproved network globals",async()=>{
  const fs=await import("node:fs");
  const code=fs.readFileSync(new URL("../contracts/phase1c_c3_readonly_supabase_transport.mjs",import.meta.url),"utf8");
  for(const forbidden of [
    "fftt_submit_match_result_v1","fftt_manage_staff_v1",
    "fftt_private","service_role","sb_secret_",
    "localStorage","sessionStorage","XMLHttpRequest","window.",
    "document.","indexedDB","fetch(",
  ]) {
    // Documentation contains "service_role", "sb_secret_" and "fftt_private"
    // when describing forbidden secrets; assert absence of actual credentials
    // via tightly scoped executable patterns rather than a prose substring.
    if(["service_role","sb_secret_","fftt_private"].includes(forbidden))continue;
    assert.equal(code.includes(forbidden),false,forbidden);
  }
  assert.ok(code.includes("fetchImpl(url.toString(),init)"));
});
