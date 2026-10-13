/**
 * Phase 1C C10: pure, non-authoritative recovery decision preview.
 * No Supabase, HTTP, credentials, local storage, score replay or event mutation.
 * Even a valid C5 wire response is NOT verified server provenance.
 */
import {
  PHASE, AuthorityGateError, beginSingleDeviceFallback,
} from "./phase1c_disconnect_reference.mjs";
import {decodeC5SnapshotWire} from "./phase1c_c5_snapshot_wire.mjs";

export const C10_DECISION = Object.freeze({
  NOT_RECOVERING: "not-recovering",
  OFFLINE: "offline-wait-for-reconnect",
  WAIT_FOR_SNAPSHOT: "awaiting-authenticated-snapshot",
  INVALID_SNAPSHOT: "invalid-or-regressed-snapshot",
  UNKNOWN_SUBMISSION: "submission-outcome-unknown",
  UNVERIFIED_ACCEPTANCE: "accepted-receipt-unverified",
  UNVERIFIED_REVISION: "event-revision-unverified",
  MANUAL_RECONCILIATION: "organizer-reconciliation-required",
});

function safeDecision(code, {manualReviewRequired=false}={}) {
  return Object.freeze({
    code, cloudWritesEnabled:false, retryAllowed:false,
    automaticReplayAllowed:false, snapshotVerified:false,
    manualReviewRequired,
  });
}
function validState(state) {
  return state && typeof state==="object" && !Array.isArray(state)
    && typeof state.eventId==="string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.eventId)
    && Number.isSafeInteger(state.revision)&&state.revision>=0
    && Number.isSafeInteger(state.generation)&&state.generation>=0;
}

/**
 * Never calls C1 verifiedServerSnapshot, because C5 is an UNAPPLIED proposal
 * whose pure decoder always sets verifiedFromServer:false.
 * The response contains only fixed, privacy-safe status codes, no IDs or scores.
 */
export function assessC10Recovery(state, rawSnapshot=null) {
  if(!validState(state)) throw new AuthorityGateError("Invalid synthetic recovery state");
  if(state.phase===PHASE.FALLBACK || state.phase===PHASE.RECONCILING) {
    return safeDecision(C10_DECISION.MANUAL_RECONCILIATION,{manualReviewRequired:true});
  }
  if(state.authority!=="cloud") {
    throw new AuthorityGateError("Unexpected authority: never infer cloud readiness");
  }
  if(state.phase===PHASE.READY) return safeDecision(C10_DECISION.NOT_RECOVERING);
  if(state.phase===PHASE.PAUSED) return safeDecision(C10_DECISION.OFFLINE);
  if(state.phase!==PHASE.RELOADING)
    throw new AuthorityGateError("Unrecognized recovery phase");
  if(rawSnapshot===null || rawSnapshot===undefined)
    return safeDecision(C10_DECISION.WAIT_FOR_SNAPSHOT,{
      manualReviewRequired:Boolean(state.unresolvedCloudRequest),
    });
  let decoded;
  try {
    decoded=decodeC5SnapshotWire(rawSnapshot,{
      eventId:state.eventId,
      requestedSubmissionId:state.unresolvedCloudRequest??null,
    });
  } catch {
    return safeDecision(C10_DECISION.INVALID_SNAPSHOT,{manualReviewRequired:true});
  }
  if(decoded.revision<state.revision || decoded.generation<state.generation) {
    return safeDecision(C10_DECISION.INVALID_SNAPSHOT,{manualReviewRequired:true});
  }
  if(state.unresolvedCloudRequest) {
    if(decoded.pendingUnresolved) {
      return safeDecision(C10_DECISION.UNKNOWN_SUBMISSION,{manualReviewRequired:true});
    }
    // An 'accepted' wire receipt is NOT proof that the calling user owns it.
    // A genuine signed-Auth + TLS endpoint is required before resolution.
    return safeDecision(C10_DECISION.UNVERIFIED_ACCEPTANCE,{manualReviewRequired:true});
  }
  return safeDecision(C10_DECISION.UNVERIFIED_REVISION);
}

/**
 * Preview C1's organizer-only safeguards without transitioning live state.
 * Returned readiness is a checklist preview, not approval, a data write,
 * a cloud recovery, or verification that other devices are physically stopped.
 */
export function previewC10SingleDeviceFallback(state, confirmations={}) {
  if(!validState(state))throw new AuthorityGateError("Invalid fallback state");
  try{
    beginSingleDeviceFallback(state,confirmations);
    return Object.freeze({
      procedureChecklistSatisfied:true,
      physicalIsolationVerified:false,
      cloudWritesEnabled:false,
      automaticReplayAllowed:false,
      manualReconciliationRequired:true,
    });
  }catch{
    return Object.freeze({
      procedureChecklistSatisfied:false,
      physicalIsolationVerified:false,
      cloudWritesEnabled:false,
      automaticReplayAllowed:false,
      manualReconciliationRequired:true,
    });
  }
}
