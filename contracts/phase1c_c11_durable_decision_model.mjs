/**
 * C11 DISPOSABLE SYNTHETIC MODEL ONLY.
 * Models what a future single atomic database transaction MUST guarantee.
 * No database, Auth, storage, remote request, or production score entry.
 * trustedActorId is injected FAKE context, not a verified browser identity.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST=/^[0-9a-f]{64}$/i;
const deliveryModes=new Set(["received","lost-after-commit","dropped-before-commit"]);
export class C11ModelError extends Error {
  constructor(message) {super(message);this.name="C11ModelError";}
}
const requireCondition=(valid,reason)=>{if(!valid)throw new C11ModelError(reason);};
const validVersion=n=>Number.isSafeInteger(n)&&n>=0;
const isUuid=x=>typeof x==="string"&&UUID.test(x);
const unknown=()=>Object.freeze({outcome:"unknown",retryAllowed:false,autoReplayAllowed:false});
const returned=decision=>Object.freeze({outcome:decision.status,decision,retryAllowed:false,autoReplayAllowed:false});

export class SyntheticC11DecisionLedger {
  #eventId; #matchId; #revision; #generation; #matchVersion; #receipts=new Map();
  constructor({eventId,matchId,revision,generation,matchVersion}) {
    requireCondition(isUuid(eventId)&&isUuid(matchId),"Valid fictional event/match IDs required");
    requireCondition([revision,generation,matchVersion].every(validVersion),"Nonnegative safe integer versions required");
    this.#eventId=eventId;this.#matchId=matchId;this.#revision=revision;
    this.#generation=generation;this.#matchVersion=matchVersion;
  }
  get view() {return Object.freeze({revision:this.#revision,generation:this.#generation,matchVersion:this.#matchVersion,receiptCount:this.#receipts.size});}
  #key(actor,submissionId) {return actor+":"+submissionId;}
  /**
   * Synchronous execution stands in for a SERIALIZED single-match SQL transaction.
   * A real service MUST derive actor from auth.uid(), verify fresh staff grant,
   * lock the match, decide, and commit event+decision together.
   * This model deliberately cannot prove any hosted durability/authorization.
   */
  submit({trustedActorId,eventId,matchId,submissionId,payloadFingerprint,expectedMatchVersion,delivery="received"}) {
    requireCondition(isUuid(trustedActorId)&&isUuid(eventId)&&isUuid(matchId)&&isUuid(submissionId),"Opaque synthetic identifiers required");
    requireCondition(eventId===this.#eventId&&matchId===this.#matchId,"Cross-event/match submission forbidden");
    requireCondition(typeof payloadFingerprint==="string"&&DIGEST.test(payloadFingerprint),"Fixed SHA-256 fingerprint required");
    requireCondition(validVersion(expectedMatchVersion),"Expected match version required");
    requireCondition(deliveryModes.has(delivery),"Unknown delivery simulation");
    const key=this.#key(trustedActorId,submissionId);
    const existing=this.#receipts.get(key);
    if(existing) {
      requireCondition(existing.payloadFingerprint===payloadFingerprint,"Submission reused with changed payload");
      return delivery==="lost-after-commit"?unknown():returned(existing.receipt);
    }
    if(delivery==="dropped-before-commit")return unknown();
    const accepted=expectedMatchVersion===this.#matchVersion;
    if(accepted){this.#matchVersion++;this.#revision++;}
    const receipt=Object.freeze({
      id:submissionId,status:accepted?"accepted":"rejected",match_id:matchId,
      match_version:this.#matchVersion,event_revision:this.#revision,
      generation:this.#generation,reason:accepted?null:"stale-match-version",
    });
    this.#receipts.set(key,Object.freeze({payloadFingerprint,receipt}));
    return delivery==="lost-after-commit"?unknown():returned(receipt);
  }
  /** Simulated owner-scoped query. Actual ownership MUST be enforced by Auth/RLS. */
  readOwnDecision({trustedActorId,eventId,submissionId}) {
    requireCondition(isUuid(trustedActorId)&&isUuid(eventId)&&isUuid(submissionId),"Valid private lookup scope required");
    requireCondition(eventId===this.#eventId,"Cross-event read denied");
    return this.#receipts.get(this.#key(trustedActorId,submissionId))?.receipt??null;
  }
}
