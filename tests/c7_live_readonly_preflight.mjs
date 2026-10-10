/**
 * C7 external-host preflight — explicitly READ-ONLY anonymous operations.
 * 
 * Runs in GitHub Actions with a PUBLIC development publishable key only.
 * Allowed: GET three public results projections; GET /auth/v1/settings;
 * OPTIONS Auth email/read-RPC endpoints (never invokes OTP POST).
 * Forbidden: Auth enrollment/verification, scoring, staff writes, result
 * publication, data migration, sign-in email, all private schema reads.
 *
 * Output is safe status/count/boolean only; never outputs response bodies.
 */
import assert from "node:assert/strict";
import {C3_HOST,createC3ReadOnlySupabaseTransport}
  from "../contracts/phase1c_c3_readonly_supabase_transport.mjs";

const KEY="sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0";
const ORIGIN="http://127.0.0.1:8765";
const PATHS=Object.freeze([
  "/auth/v1/otp",
  "/auth/v1/verify",
  "/auth/v1/user",
  "/rest/v1/rpc/fftt_staff_role_v1",
  "/rest/v1/rpc/fftt_matchdesk_v1",
]);
const corsMethods=Object.freeze({
  "/auth/v1/otp":"POST",
  "/auth/v1/verify":"POST",
  "/auth/v1/user":"GET",
  "/rest/v1/rpc/fftt_staff_role_v1":"POST",
  "/rest/v1/rpc/fftt_matchdesk_v1":"POST",
});
function withTimeout(){
  return AbortSignal.timeout(15000);
}
const transport=createC3ReadOnlySupabaseTransport({
  publishableKey:KEY,
  getAccessToken:()=>{
    throw Error("C7 must NEVER request a signed user session");
  },
  fetchImpl:async(url,init)=>{
    assert.ok(url.startsWith(C3_HOST+"/rest/v1/"));
    assert.equal(init.method,"GET","C7 only makes anonymous public GETs");
    assert.ok(!init.headers.Authorization,"Never attach a signed JWT");
    return fetch(url,{...init,signal:withTimeout()});
  },
});

async function publicProjections(){
  const [results,events,matches]=await Promise.all([
    transport.readPublicResults(),
    transport.readPublicEvents(),
    transport.readPublicMatches(),
  ]);
  assert.ok(Array.isArray(results)&&Array.isArray(events)&&Array.isArray(matches));
  // The isolated dev test event has never been approved for publication.
  assert.equal(results.length,0,"Unexpected development public results — review privacy");
  assert.equal(events.length,0,"Unexpected dev published events — review privacy");
  assert.equal(matches.length,0,"Unexpected dev published matches — review privacy");
  console.log("PASS C7: all three actual dev public projections are empty and correctly allowlisted.");
}

async function getAuthSettings(){
  const response=await fetch(C3_HOST+"/auth/v1/settings",{
    method:"GET",redirect:"error",cache:"no-store",credentials:"omit",
    headers:{apikey:KEY,Accept:"application/json"},
    signal:withTimeout(),
  });
  assert.equal(response.status,200,"Public Auth settings GET unavailable");
  const metadata=await response.json();
  assert.equal(typeof metadata,"object");
  assert.ok(metadata!==null&&!Array.isArray(metadata));
  // This endpoint does not expose the hosted email template markup. Do not
  // infer Token or ConfirmationURL delivery from enabled email provider.
  console.log("PASS C7: Auth public settings readable; OTP email template still UNKNOWN.");
}

async function optionsOnly(){
  for(const path of PATHS){
    const intended=corsMethods[path];
    const response=await fetch(C3_HOST+path,{
      method:"OPTIONS",redirect:"error",cache:"no-store",credentials:"omit",
      headers:{
        Origin:ORIGIN,
        "Access-Control-Request-Method":intended,
        "Access-Control-Request-Headers":path==="/auth/v1/user"
          ?"apikey,authorization,accept":"apikey,authorization,content-type",
      },
      signal:withTimeout(),
    });
    assert.ok(response.status>=200&&response.status<300,
      "Development CORS preflight rejected for "+path);
    const allow=response.headers.get("access-control-allow-origin");
    assert.ok(allow==="*"||allow===ORIGIN,
      "Development CORS origin blocked for "+path);
    const allowed=(response.headers.get("access-control-allow-methods")||"")
      .split(",").map(x=>x.trim().toUpperCase());
    assert.ok(allowed.includes(intended),"Missing CORS method for "+path);
    console.log("PASS C7: safe CORS OPTIONS for audited Auth/read endpoint.");
  }
}

await publicProjections();
await getAuthSettings();
await optionsOnly();
console.log("C7 READ-ONLY HOSTED PREFLIGHT PASSED. NO OTP SENT, NO ACCOUNT SIGNED IN, NO WRITES.");
