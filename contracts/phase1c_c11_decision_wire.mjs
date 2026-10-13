/**
 * C11 PROPOSED future trusted-decision wire parser, NOT a trust provider.
 * A valid JSON shape does NOT establish Auth, transaction provenance,
 * actual database durability or authorization. No cloud resume.
 */
import {AuthorityGateError} from "./phase1c_disconnect_reference.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_FIELDS=["event_id","revision","generation","lifecycle","submission_id","decision"];
const DECISION_FIELDS=["id","status","match_id","match_version","event_revision","generation","reason"];
const req=(condition,reason)=>{if(!condition)throw new AuthorityGateError("C11 untrusted decision: "+reason);};
const uuid=x=>typeof x==="string"&&UUID.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x)
    &&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const keys=(obj,fields)=>Object.keys(obj).length===fields.length&&Object.keys(obj).every(k=>fields.includes(k));
/**
 * A missing decision stays UNKNOWN, not rejected. A syntactically present
 * rejected decision stays UNVERIFIED until a separate signed service confirms
 * that exact terminal outcome was durably committed by the trusted server.
 */
export function decodeC11DecisionWire(raw,{eventId,requestedSubmissionId=null}={}) {
  req(uuid(eventId),"valid event ID required");
  req(requestedSubmissionId===null||uuid(requestedSubmissionId),"valid optional submission ID required");
  req(plain(raw)&&keys(raw,EVENT_FIELDS),"unexpected or missing event field");
  req(raw.event_id===eventId,"cross-event decision");
  req(raw.submission_id===requestedSubmissionId,"submission query mismatch");
  req(integer(raw.revision)&&integer(raw.generation),"invalid event versions");
  req(raw.lifecycle==="active","inactive events cannot authorize scoring");
  let result="unknown";
  if(raw.decision!==null) {
    const d=raw.decision;
    req(requestedSubmissionId!==null,"unrequested decision");
    req(plain(d)&&keys(d,DECISION_FIELDS),"invalid or private decision fields");
    req(d.id===requestedSubmissionId&&uuid(d.id)&&uuid(d.match_id),"decision identifier mismatch");
    req(d.status==="accepted"||d.status==="rejected","terminal outcome required");
    req(integer(d.match_version)&&integer(d.event_revision)&&integer(d.generation),"invalid decision versions");
    req(d.event_revision<=raw.revision&&d.generation<=raw.generation,"future decision revision");
    req(d.status==="accepted"?d.reason===null:d.reason==="stale-match-version",
       "unrecognized or contradictory terminal reason");
    result=d.status;
  }
  return Object.freeze({
    eventId:raw.event_id, revision:raw.revision,generation:raw.generation,
    status:result,unresolved:result==="unknown",
    decisionVerifiedFromServer:false,cloudWritesEnabled:false,
    retryAllowed:false,automaticReplayAllowed:false,
  });
}
