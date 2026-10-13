/**
 * Phase 1C C5 — PURE draft wire-contract decoder for a NOT-DEPLOYED RPC.
 * No HTTP, Supabase Auth, JWTs, score writes, browser storage or persistent state.
 *
 * IMPORTANT: This decoder cannot authenticate server data. It NEVER marks a
 * receipt verifiedFromServer. That signal may only come from an independently
 * reviewed genuine signed Auth + TLS transport after an RPC is actually deployed.
 */
import {AuthorityGateError} from "./phase1c_disconnect_reference.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_FIELDS=Object.freeze([
  "event_id","revision","generation","lifecycle","resolved_submission",
]);
const RECEIPT_FIELDS=Object.freeze([
  "id","status","match_id","match_version","event_revision","generation",
]);

function expect(test,why) {
  if(!test) throw new AuthorityGateError("Untrusted C5 snapshot: "+why);
}
function uuid(value) {return typeof value==="string"&&UUID.test(value);}
function safeNumber(value) {return Number.isSafeInteger(value)&&value>=0;}
function sameKeys(object, fields) {
  return Object.keys(object).length===fields.length
    && Object.keys(object).every(name=>fields.includes(name));
}
function plain(x) {
  return x!==null&&typeof x==="object"&&!Array.isArray(x)
    && (Object.getPrototypeOf(x)===Object.prototype
        || Object.getPrototypeOf(x)===null);
}

/**
 * p_submission_id=null is allowed for normal reconnect without in-flight
 * write. A requested submission ID can only be checked against a receipt
 * belonging to that user by the future server, NOT by client JSON alone.
 *
 * Unknown/missing receipt blocks pending write resolution. The durable
 * result_submissions table stores ACCEPTED receipts, not denied conflicts.
 * Therefore absence is NEVER mapped to "rejected".
 */
export function decodeC5SnapshotWire(raw,{
  eventId,requestedSubmissionId=null,
}={}){
  expect(uuid(eventId),"expected one event UUID");
  expect(requestedSubmissionId===null||uuid(requestedSubmissionId),
    "request ID must be UUID or null");
  expect(plain(raw)&&sameKeys(raw,EVENT_FIELDS),
    "missing, unexpected or private event fields");
  expect(raw.event_id===eventId,"cross-event response denied");
  expect(safeNumber(raw.revision)&&safeNumber(raw.generation),
    "revision/generation must be nonnegative safe integers");
  expect(["draft","active","complete","archived"].includes(raw.lifecycle),
    "event lifecycle value is invalid");
  // No cloud-score readiness for completed/draft/archived events. Staff may
  // still have legitimate read access, but a C1 scoring resume is forbidden.
  expect(raw.lifecycle==="active",
    "event not active; never resume cloud score writes");

  let receipt=null;
  if(raw.resolved_submission!==null) {
    expect(requestedSubmissionId!==null,
      "unexpected receipt when no submission ID requested");
    const r=raw.resolved_submission;
    expect(plain(r)&&sameKeys(r,RECEIPT_FIELDS),
      "receipt fields invalid or private");
    expect(r.id===requestedSubmissionId&&uuid(r.id)&&uuid(r.match_id),
      "receipt must match exact submitted request and valid match ID");
    expect(r.status==="accepted",
      "only durable accepted receipts may resolve uncertainty");
    expect(safeNumber(r.match_version)&&safeNumber(r.event_revision)
      &&safeNumber(r.generation),"receipt versions must be safe integers");
    expect(r.event_revision<=raw.revision&&r.generation<=raw.generation,
      "accepted receipt cannot be ahead of server event");
    receipt=Object.freeze({
      id:r.id,
      status:"accepted",
      matchId:r.match_id,
      matchVersion:r.match_version,
      eventRevision:r.event_revision,
      generation:r.generation,
      // This pure client JSON decoder never claims authentic server proof.
      verifiedFromServer:false,
    });
  }

  return Object.freeze({
    eventId:raw.event_id,
    revision:raw.revision,
    generation:raw.generation,
    lifecycle:raw.lifecycle,
    resolvedSubmission:receipt,
    pendingUnresolved:requestedSubmissionId!==null && receipt===null,
  });
}

/** Returns a frozen minimal envelope suitable for read-only UI inspection.
 * It CANNOT unlock C1 cloud scoring because verifiedFromServer is false.
 */
export function c1ReadOnlyEnvelope(decoded){
  expect(plain(decoded),"expected decoded snapshot");
  return Object.freeze({
    eventId:decoded.eventId,
    revision:decoded.revision,
    generation:decoded.generation,
    resolvedSubmission:decoded.resolvedSubmission,
  });
}
