/**
 * Phase 1C C2: MOCKABLE shared-match-desk controller, NOT a connected app.
 * Provider-neutral transport injection; no implementation of HTTP or storage.
 * In particular, there is no Supabase URL, client key or actual Auth token.
 * The existing single-file browser app and B2i hosted fixture are untouched.
 */
import {
  PHASE, AuthorityGateError, initialCloudState, canSendCloudIntent,
  beginCloudIntent, acknowledgeCloudIntent, connectivityLost,
  connectivityRestored, revisionNotice, verifiedServerSnapshot,
  beginSingleDeviceFallback, logIsolatedFallbackEdit, organizerReconciled,
} from "./phase1c_disconnect_reference.mjs";

const MATCH_FIELDS = new Set([
  "event_id", "bracket_generation", "match_id", "match_code",
  "match_version", "bracket", "round_number", "slot",
  "player_1_id", "player_2_id", "player_1_name", "player_2_name",
  "is_championship_final", "table_number",
]);

function guard(ok, reason) {
  if (!ok) throw new AuthorityGateError(reason);
}

function validateMatchdeskResponse(value, eventId) {
  guard(Array.isArray(value), "Authorized matchdesk must be an array");
  return value.map(item => {
    guard(item && typeof item === "object" && !Array.isArray(item),
      "Matchdesk row is not an object");
    guard(Object.keys(item).every(field => MATCH_FIELDS.has(field)),
      "Unexpected matchdesk field: could reveal private data");
    guard(item.event_id === eventId, "Cross-event matchdesk data denied");
    guard(Number.isSafeInteger(item.bracket_generation)
      && item.bracket_generation >= 0 && Number.isSafeInteger(item.match_version)
      && item.match_version >= 0, "Invalid matchdesk versions");
    return Object.freeze({ ...item });
  });
}

function ensureIntent(intent, state) {
  guard(intent && typeof intent === "object" && !Array.isArray(intent),
    "Score intent must be structured data");
  guard(intent.eventId === state.eventId, "Cross-event intent blocked");
  guard(intent.bracketGeneration === state.generation,
    "Stale bracket generation: never submit");
  guard(Number.isSafeInteger(intent.expectedMatchVersion)
    && intent.expectedMatchVersion >= 0, "Expected match version required");
  for (const key of ["matchId", "submissionId", "winnerId"]) {
    guard(typeof intent[key] === "string" && intent[key].length >= 8,
      "Missing required score identity: " + key);
  }
  guard(typeof intent.gameScores === "string" && intent.gameScores.length <= 128,
    "Score formatting belongs to server validation");
}

/**
 * The transport MUST later be backed by signed Auth and server RLS; this
 * reference uses injected local fakes. A success response is not treated as
 * truth unless it matches the pending ID and contains newer server versions.
 */
export class MockableSharedMatchClient {
  #state;
  #transport;
  constructor({ eventId, revision, generation, transport }) {
    guard(transport && typeof transport.submitScore === "function"
      && typeof transport.fetchAuthoritativeSnapshot === "function"
      && typeof transport.readMatchdesk === "function",
      "Inject a complete transport; reference supplies NO real network");
    this.#state = initialCloudState({ eventId, revision, generation });
    this.#transport = transport;
  }

  get state() { return this.#state; }

  get status() {
    return Object.freeze({
      phase: this.#state.phase,
      stale: this.#state.stale,
      cloudWritesEnabled: canSendCloudIntent(this.#state),
      unresolvedSubmission: Boolean(this.#state.unresolvedCloudRequest),
      hasPendingSubmission: Boolean(this.#state.cloudRequest),
      fallbackEdits: this.#state.fallbackEdits,
      revision: this.#state.revision,
    });
  }

  loseConnection() {
    this.#state = connectivityLost(this.#state);
    return this.status;
  }

  restoreConnection() {
    this.#state = connectivityRestored(this.#state);
    return this.status;
  }

  receiveRevisionNotice(eventId) {
    this.#state = revisionNotice(this.#state, eventId);
    return this.status;
  }

  async readMatchdesk() {
    guard(this.#state.phase === PHASE.READY && !this.#state.stale
      && this.#state.authority === "cloud",
      "Cannot trust a matchdesk read while disconnected/stale/fallback");
    const eventId = this.#state.eventId;
    let result;
    try {
      result = await this.#transport.readMatchdesk({eventId});
    } catch (_) {
      this.loseConnection();
      throw new AuthorityGateError("Matchdesk read uncertain; cloud paused");
    }
    guard(this.#state.phase === PHASE.READY && !this.#state.stale,
      "In-flight read became stale; discard untrusted response");
    return validateMatchdeskResponse(result, eventId);
  }

  async submitScore(intent) {
    guard(canSendCloudIntent(this.#state),
      "Cloud scoring denied while offline, pending, stale or reconciling");
    ensureIntent(intent, this.#state);
    this.#state = beginCloudIntent(this.#state, {
      eventId: intent.eventId, submissionId: intent.submissionId,
    });
    let response;
    try {
      response = await this.#transport.submitScore(Object.freeze({ ...intent }));
    } catch (_) {
      this.loseConnection();
      return Object.freeze({ status: "uncertain", persisted: false, retryAllowed: false });
    }
    // A delayed acknowledgement cannot override a disconnect/fallback.
    if (this.#state.phase !== PHASE.READY || this.#state.stale
      || this.#state.unresolvedCloudRequest) {
      return Object.freeze({ status: "uncertain", persisted: false, retryAllowed: false });
    }
    const code = response?.httpStatus;
    if (code === 200 && response?.body?.status === "accepted"
      && response.body.submission_id === intent.submissionId) {
      try {
        this.#state = acknowledgeCloudIntent(this.#state, {
          eventId: intent.eventId, submissionId: intent.submissionId,
          result: "accepted", revision: response.body.event_revision,
          generation: response.body.bracket_generation,
        });
      } catch (_) {
        // A malformed ack cannot mark a score as saved. The RPC may have
        // committed despite client uncertainty: force server receipt review.
        this.loseConnection();
        return Object.freeze({ status: "uncertain", persisted: false, retryAllowed: false });
      }
      return Object.freeze({ status: "accepted", persisted: true, retryAllowed: false });
    }
    if (Number.isInteger(code) && code >= 400 && code < 500) {
      this.#state = acknowledgeCloudIntent(this.#state, {
        eventId: intent.eventId, submissionId: intent.submissionId,
        result: "rejected",
      });
      return Object.freeze({ status: "rejected", persisted: false, retryAllowed: false });
    }
    this.loseConnection();
    return Object.freeze({ status: "uncertain", persisted: false, retryAllowed: false });
  }

  async reloadAuthoritativeState() {
    guard(this.#state.phase === PHASE.RELOADING
      && this.#state.authority === "cloud" && !this.#state.reconciliationRequired,
      "A real server refetch requires paused/reloading cloud context");
    const eventId = this.#state.eventId;
    let record;
    try {
      record = await this.#transport.fetchAuthoritativeSnapshot({eventId});
    } catch (_) {
      this.loseConnection();
      throw new AuthorityGateError("Server read failed; do not resume writes");
    }
    this.#state = verifiedServerSnapshot(this.#state, {
      eventId: record?.eventId, revision: record?.revision,
      generation: record?.generation,
      resolvedSubmission: record?.resolvedSubmission,
    });
    return this.status;
  }

  startFallback(flags) {
    this.#state = beginSingleDeviceFallback(this.#state, flags);
    return this.status;
  }

  recordManualFallbackEdit(flags) {
    this.#state = logIsolatedFallbackEdit(this.#state, flags);
    return this.status;
  }

  finishOrganizerReconciliation(flags) {
    this.#state = organizerReconciled(this.#state, flags);
    return this.status;
  }
}
