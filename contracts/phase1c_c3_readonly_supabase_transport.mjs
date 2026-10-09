/**
 * FFTT Phase 1C C3: allowlisted READ-ONLY hosted Supabase transport.
 *
 * Draft synthetic prototype ONLY; deliberately absent from live index.html.
 * No privileged credential, stored JWT, write endpoint, automatic retry,
 * authoritative event-revision read, Realtime or offline queue exists here.
 * Explicit signed, user-held access token injection; no service_role keys.
 */
import {AuthorityGateError} from "./phase1c_disconnect_reference.mjs";

export const C3_HOST = "https://copmkalfkkrkzheohwuc.supabase.co";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESK_FIELDS = Object.freeze([
  "event_id", "bracket_generation", "match_id", "match_code", "match_version",
  "bracket", "round_number", "slot", "player_1_id", "player_2_id",
  "player_1_name", "player_2_name", "is_championship_final", "table_number",
]);
const PUBLIC_RESULTS_FIELDS = Object.freeze([
  "event_id", "event_name", "event_date", "status", "brackets", "updated_at",
]);
const PUBLIC_EVENT_FIELDS = Object.freeze([
  "event_id", "event_name", "event_date", "status", "updated_at",
]);
const PUBLIC_MATCH_FIELDS = Object.freeze([
  "event_id", "match_id", "bracket", "round", "slot", "player_1_name",
  "player_2_name", "winner_name", "game_scores", "status",
]);

const ROUTES = Object.freeze({
  role: "/rest/v1/rpc/fftt_staff_role_v1",
  desk: "/rest/v1/rpc/fftt_matchdesk_v1",
  results: "/rest/v1/fftt_public_results_v1",
  events: "/rest/v1/fftt_published_events",
  matches: "/rest/v1/fftt_published_matches",
});

function guard(value, reason) {
  if (!value) throw new AuthorityGateError(reason);
}
function nonNegativeInt(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function checkEventId(value) {
  guard(typeof value === "string" && UUID.test(value), "Expected exact event UUID");
  return value;
}
function checkPublicId(value) {
  guard(value === null || (typeof value === "string" && UUID.test(value)),
    "Expected opaque public UUID or null");
}
function freezeRow(raw, fields, name) {
  guard(raw && typeof raw === "object" && !Array.isArray(raw),
    name + " is not an object");
  const keys=Object.keys(raw);
  guard(keys.every(k=>fields.includes(k)), name + " contains a forbidden field");
  return Object.freeze(Object.fromEntries(keys.map(key=>[key, raw[key]])));
}
function parseRows(json, fields, name) {
  guard(Array.isArray(json) && json.length <= 1000, name + " rows are invalid");
  return Object.freeze(json.map(raw=>freezeRow(raw, fields, name)));
}
function validateDesk(rows, eventId) {
  const list=parseRows(rows, DESK_FIELDS, "Matchdesk");
  for (const row of list) {
    guard(row.event_id===eventId && UUID.test(row.match_id),
      "Cross-event or invalid private match identity");
    guard(nonNegativeInt(row.bracket_generation)
      && nonNegativeInt(row.match_version), "Invalid server match versions");
  }
  return list;
}
function validatePublicMatch(raw) {
  const row=freezeRow(raw, PUBLIC_MATCH_FIELDS, "Published match");
  checkPublicId(row.event_id);
  checkPublicId(row.match_id);
  guard(nonNegativeInt(row.round) && nonNegativeInt(row.slot),
    "Invalid public match round/slot");
  return row;
}
function validatePublicResults(json) {
  const events=parseRows(json, PUBLIC_RESULTS_FIELDS, "Public results");
  return Object.freeze(events.map(entry=>{
    checkPublicId(entry.event_id);
    guard(Array.isArray(entry.brackets) && entry.brackets.length<=64,
      "Invalid public brackets container");
    const brackets=entry.brackets.map(bracket=>{
      const b=freezeRow(bracket, ["name", "matches"], "Public bracket");
      guard(typeof b.name==="string" && Array.isArray(b.matches) &&
        b.matches.length<=1000, "Invalid public bracket shape");
      return Object.freeze({name:b.name,
        matches:Object.freeze(b.matches.map(validatePublicMatch))});
    });
    return Object.freeze({...entry,brackets:Object.freeze(brackets)});
  }));
}
function validatePublicEvents(json) {
  const rows=parseRows(json, PUBLIC_EVENT_FIELDS, "Public events");
  for(const row of rows) checkPublicId(row.event_id);
  return rows;
}
function validatePublicMatches(json) {
  return Object.freeze(parseRows(json,PUBLIC_MATCH_FIELDS,
    "Public matches").map(validatePublicMatch));
}
function assertJwt(token) {
  guard(typeof token==="string" && token.split(".").length===3
    && !/\s/.test(token) && token.length<10000,
    "Signed session access token required (no shared credentials)");
  return token;
}

export function createC3ReadOnlySupabaseTransport({
  projectUrl=C3_HOST, publishableKey, getAccessToken, fetchImpl,
}={}) {
  guard(projectUrl===C3_HOST, "C3 is pinned to exactly one development project");
  guard(typeof publishableKey==="string" &&
    publishableKey.startsWith("sb_publishable_") &&
    !/\s/.test(publishableKey) && publishableKey.length<512,
    "Use only a public sb_publishable_ key; never a service/admin key");
  guard(typeof getAccessToken==="function", "Inject a user-session token provider");
  guard(typeof fetchImpl==="function", "Inject fetch; no implicit network");
  let requestCount=0;

  async function request(kind, {eventId}={}) {
    guard(Object.hasOwn(ROUTES,kind), "Only audited read routes permitted");
    const signed=kind==="desk" || kind==="role";
    let token;
    if (signed) {
      checkEventId(eventId);
      token=assertJwt(await getAccessToken());
    }
    const path=ROUTES[kind];
    const url=new URL(C3_HOST+path);
    if (!signed) {
      const columns=kind==="results"?PUBLIC_RESULTS_FIELDS:
        kind==="events"?PUBLIC_EVENT_FIELDS:PUBLIC_MATCH_FIELDS;
      url.searchParams.set("select", columns.join(","));
      url.searchParams.set("limit", "1000");
    }
    const init={
      method:signed?"POST":"GET",
      redirect:"error",
      credentials:"omit",
      cache:"no-store",
      headers:{
        "apikey":publishableKey,
        "Accept":"application/json",
        ...(signed?{
          "Authorization":"Bearer "+token,
          "Content-Type":"application/json",
        }:{}),
      },
      ...(signed?{body:JSON.stringify({p_event_id:eventId})}:{}),
    };
    requestCount++;
    let response;
    try {
      response=await fetchImpl(url.toString(),init);
    } catch {
      throw new AuthorityGateError("C3 read failed; no cached result is authoritative");
    }
    guard(response && typeof response.status==="number" && response.status===200,
      "C3 read denied or failed; never expose raw backend error");
    let value;
    try { value=await response.json(); }
    catch { throw new AuthorityGateError("C3 read returned invalid JSON"); }
    return value;
  }

  return Object.freeze({
    async readMatchdesk({eventId}) {
      return validateDesk(await request("desk",{eventId}),eventId);
    },
    async readStaffRole({eventId}) {
      const role=await request("role",{eventId});
      guard(role==="organizer" || role==="scorekeeper",
        "Current user has no authorized staff role");
      return role;
    },
    async readPublicResults() {
      return validatePublicResults(await request("results"));
    },
    async readPublicEvents() {
      return validatePublicEvents(await request("events"));
    },
    async readPublicMatches() {
      return validatePublicMatches(await request("matches"));
    },
    async submitScore() {
      throw new AuthorityGateError("C3 strictly READ-ONLY: no score endpoint");
    },
    async fetchAuthoritativeSnapshot() {
      throw new AuthorityGateError(
        "C3 cannot restore cloud writes: no secure authoritative snapshot/receipt RPC");
    },
    getReadCount() { return requestCount; },
  });
}
