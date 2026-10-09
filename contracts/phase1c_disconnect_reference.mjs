/**
 * FFTT Phase 1C C1 — provider-neutral, pure cloud/fallback authority reference.
 *
 * NO networking, storage, UI changes, SQL, credentials, timers or real data.
 * This is an executable specification for a FUTURE shared adapter, not one.
 * The server alone decides whether a submitted score was persisted.
 */

export const PHASE = Object.freeze({
  READY: "cloud-ready",
  PAUSED: "cloud-paused",
  RELOADING: "cloud-reloading",
  FALLBACK: "single-device-fallback",
  RECONCILING: "organizer-reconciliation",
});

export class AuthorityGateError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "AuthorityGateError";
  }
}

function requireGate(ok, reason) {
  if (!ok) throw new AuthorityGateError(reason);
}

function nonNegativeInt(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validEventId(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function identity(state, eventId) {
  requireGate(eventId === state.eventId, "Wrong event: never cross event authority boundaries");
}

function evolve(state, changes) {
  return Object.freeze({ ...state, ...changes });
}

export function initialCloudState({ eventId, revision, generation }) {
  requireGate(validEventId(eventId), "Expected one opaque event UUID");
  requireGate(nonNegativeInt(revision) && nonNegativeInt(generation),
    "Authoritative event revision and bracket generation required");
  return Object.freeze({
    eventId, revision, generation,
    phase: PHASE.READY,
    authority: "cloud",
    stale: false,
    cloudRequest: null,
    unresolvedCloudRequest: null,
    lastAcknowledgedRequest: null,
    fallbackEdits: 0,
    reconciliationRequired: false,
  });
}

/** An RPC intent may be SENT only by the single authoritative cloud path. */
export function canSendCloudIntent(state) {
  return state.phase === PHASE.READY && state.authority === "cloud"
    && !state.stale && !state.cloudRequest && !state.unresolvedCloudRequest
    && !state.reconciliationRequired;
}

export function beginCloudIntent(state, { eventId, submissionId }) {
  identity(state, eventId);
  requireGate(canSendCloudIntent(state), "Cloud write paused/stale/unresolved; do not queue");
  requireGate(typeof submissionId === "string" && /^[0-9a-f-]{36}$/i.test(submissionId),
    "A stable opaque submission identifier is required");
  requireGate(submissionId !== state.lastAcknowledgedRequest,
    "Repeated score requires explicit server-side idempotency workflow");
  return evolve(state, { cloudRequest: submissionId });
}

export function acknowledgeCloudIntent(state, {
  eventId, submissionId, result, revision, generation,
}) {
  identity(state, eventId);
  requireGate(state.phase === PHASE.READY && state.authority === "cloud" && !state.stale,
    "Stale or disconnected clients cannot claim saved score");
  requireGate(submissionId === state.cloudRequest && !state.unresolvedCloudRequest,
    "Acknowledgement must match the outstanding request exactly");
  requireGate(result === "accepted" || result === "rejected",
    "Only an actual server accepted/rejected response resolves an intent");
  if (result === "accepted") {
    requireGate(nonNegativeInt(revision) && revision > state.revision
      && nonNegativeInt(generation) && generation >= state.generation,
      "Accepted write requires newer authoritative server revision");
    return evolve(state, {
      cloudRequest: null, lastAcknowledgedRequest: submissionId,
      revision, generation,
    });
  }
  // Even a rejected score needs a new authoritative snapshot to clear staleness.
  return evolve(state, {
    cloudRequest: null, phase: PHASE.RELOADING, stale: true,
  });
}

export function connectivityLost(state) {
  if (state.phase === PHASE.FALLBACK || state.phase === PHASE.RECONCILING)
    return state;
  if (state.phase === PHASE.PAUSED) return state;
  return evolve(state, {
    phase: PHASE.PAUSED, stale: true,
    unresolvedCloudRequest: state.cloudRequest ?? state.unresolvedCloudRequest,
    cloudRequest: null,
  });
}

export function connectivityRestored(state) {
  if (state.phase === PHASE.FALLBACK)
    return evolve(state, { phase: PHASE.RECONCILING, reconciliationRequired: true, stale: true });
  if (state.phase === PHASE.RECONCILING) return state;
  if (state.phase === PHASE.PAUSED)
    return evolve(state, { phase: PHASE.RELOADING, stale: true });
  return state;
}

/**
 * A Realtime ping only marks cached views stale; it does not contain trusted
 * state or authorize a write. An authenticated authoritative refetch is needed.
 */
export function revisionNotice(state, eventId) {
  identity(state, eventId);
  if (state.authority !== "cloud" || state.phase !== PHASE.READY) return state;
  return evolve(state, { stale: true, phase: PHASE.RELOADING });
}

export function verifiedServerSnapshot(state, {
  eventId, revision, generation, resolvedSubmission,
}) {
  identity(state, eventId);
  requireGate(state.phase === PHASE.RELOADING && state.authority === "cloud"
    && !state.reconciliationRequired,
    "Only a fresh verified read can resume paused cloud mode");
  requireGate(nonNegativeInt(revision) && revision >= state.revision,
    "Server revision regressed: incident investigation required");
  requireGate(nonNegativeInt(generation) && generation >= state.generation,
    "Bracket generation regressed: do not resume");
  if (state.unresolvedCloudRequest) {
    requireGate(resolvedSubmission?.id === state.unresolvedCloudRequest
      && ["accepted", "rejected"].includes(resolvedSubmission?.status)
      && resolvedSubmission?.verifiedFromServer === true,
      "Ambiguous in-flight score must be reconciled with server receipt FIRST");
  }
  return evolve(state, {
    phase: PHASE.READY, authority: "cloud",
    revision, generation, stale: false, cloudRequest: null,
    unresolvedCloudRequest: null,
  });
}

/**
 * Serious outage fallback is an organizer-directed change of authority.
 * The code can verify acknowledgements, not physically stop other devices.
 */
export function beginSingleDeviceFallback(state, {
  eventId, backupRevision, backupGeneration,
  organizerApproved, otherDevicesStopped, backupProtected,
  manualLogReady, unresolvedOutcomeDocumented,
}) {
  identity(state, eventId);
  requireGate(state.phase === PHASE.PAUSED && state.authority === "cloud",
    "Fallback requires verified outage/pause, not a healthy cloud");
  requireGate(organizerApproved === true && otherDevicesStopped === true,
    "Only organizer-selected single-device authority allowed");
  requireGate(backupProtected === true && manualLogReady === true,
    "Controlled private backup and dated paper/manual log required");
  requireGate(backupRevision === state.revision && backupGeneration === state.generation,
    "Fallback backup metadata must match last verified server snapshot");
  requireGate(!state.unresolvedCloudRequest || unresolvedOutcomeDocumented === true,
    "Unknown prior write must be explicitly recorded, never silently retried");
  return evolve(state, {
    phase: PHASE.FALLBACK, authority: "isolated-single-device", stale: true,
    reconciliationRequired: true,
  });
}

/** Records only the fact of a manually logged fallback edit. No cloud queue. */
export function logIsolatedFallbackEdit(state, { eventId, writtenToPrivateLog }) {
  identity(state, eventId);
  requireGate(state.phase === PHASE.FALLBACK && writtenToPrivateLog === true,
    "Fallback changes require isolated organizer log");
  return evolve(state, { fallbackEdits: state.fallbackEdits + 1 });
}

export function organizerReconciled(state, {
  eventId, organizerApproved, privateBackupReviewed,
  manualLogReviewed, allFallbackEditsReconciled,
  unresolvedCloudRequestChecked, serverRevision, serverGeneration,
}) {
  identity(state, eventId);
  requireGate(state.phase === PHASE.RECONCILING
    && state.authority === "isolated-single-device",
    "Manual reconciliation only after isolated fallback and reconnection");
  requireGate(organizerApproved === true && privateBackupReviewed === true
    && manualLogReviewed === true && allFallbackEditsReconciled === true,
    "No automatic import: organizer must review every local result");
  requireGate(!state.unresolvedCloudRequest || unresolvedCloudRequestChecked === true,
    "Unknown previously submitted cloud result must be independently checked");
  requireGate(nonNegativeInt(serverRevision) && serverRevision >= state.revision
    && nonNegativeInt(serverGeneration) && serverGeneration >= state.generation,
    "A verified authoritative server snapshot must exist");
  // Not READY: a separate verified reload of authoritative server state is
  // required before the cloud command gate can reopen.
  return evolve(state, {
    authority: "cloud", phase: PHASE.RELOADING,
    revision: serverRevision, generation: serverGeneration,
    unresolvedCloudRequest: null,
    reconciliationRequired: false, stale: true,
  });
}
