/** FFTT game-day signed score transport (SYNTHETIC STAGING).
 * Same safety model as the audited local transport it builds on — and reuses its intent validator and
 * receipt parser — but pointed at the pinned synthetic project, for ANY fictional event the signed-in
 * person holds a grant on (the server decides; nothing here is a fixture pin).
 *  - A submission id is used at most once per transport instance, whatever the outcome.
 *  - There is NO retry, backoff or queue. A write whose outcome is uncertain throws; the score session
 *    turns that into `unknown` and the person resolves it from the server's own receipt.
 *  - Only the person's own access token is used. No privileged key can be supplied.
 * Reads: the person's own decision receipt, a lightweight event "pulse" (revision/generation/lifecycle,
 * valid before a bracket exists) and the Match Desk rows (strict field allowlist).
 */
import {C3_HOST} from './phase1c_c3_readonly_supabase_transport.mjs';
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
import {validateLocalScoreIntent, parseLocalOwnSnapshot} from './milestone1_signed_local_score_transport.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const KEY = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;
const TERMINAL = ['submission_id', 'status', 'match_id', 'match_version', 'event_revision', 'generation', 'reason'];
const PULSE = ['event_id', 'revision', 'generation', 'lifecycle', 'submission_id', 'decision'];
const DESK = ['event_id', 'bracket_generation', 'match_id', 'match_code', 'match_version', 'bracket', 'round_number',
  'slot', 'player_1_id', 'player_2_id', 'player_1_name', 'player_2_name', 'is_championship_final', 'table_number'];
const fail = reason => { throw new AuthorityGateError(reason); };
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const natural = x => Number.isSafeInteger(x) && x >= 0;
const sameKeys = (x, keys) => plain(x) && Object.keys(x).length === keys.length && keys.every(k => k in x);

export function createGamedayScoreTransport({projectUrl = C3_HOST, publishableKey, fetchImpl} = {}) {
  if (projectUrl !== C3_HOST || typeof publishableKey !== 'string' || !KEY.test(publishableKey)
    || publishableKey.length > 512 || publishableKey.startsWith('sb_secret_') || typeof fetchImpl !== 'function') {
    fail('Pinned synthetic project, a publishable key and fetch are required');
  }
  const attempted = new Set();
  let scoreRequests = 0, reads = 0;

  async function post(path, token, payload, what) {
    if (typeof token !== 'string' || !JWT.test(token) || token.length > 10000) fail('Verified signed-in token required');
    let response;
    try {
      response = await fetchImpl(projectUrl + path, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: {apikey: publishableKey, Authorization: 'Bearer ' + token, Accept: 'application/json',
          'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
    } catch { fail(what + ': network response unknown'); }
    if (response?.status !== 200) fail(what + ': denied, expired or uncertain');
    try { return await response.json(); } catch { fail(what + ': unreadable response'); }
  }

  return Object.freeze({
    /** One shot. Resolves only with a structurally valid terminal decision; anything else throws. */
    async submitScore(token, intent) {
      const x = validateLocalScoreIntent(intent);
      if (attempted.has(x.submissionId)) fail('Duplicate submission is forbidden, even after a timeout');
      attempted.add(x.submissionId);
      scoreRequests++;
      const raw = await post('/rest/v1/rpc/fftt_submit_match_result_v2', token, {
        p_event_id: x.eventId, p_match_id: x.matchId, p_bracket_generation: x.bracketGeneration,
        p_expected_match_version: x.expectedMatchVersion, p_submission_id: x.submissionId,
        p_winner_id: x.winnerId, p_game_scores: x.gameScores, p_table_number: x.tableNumber,
      }, 'score');
      if (!sameKeys(raw, TERMINAL) || raw.submission_id !== x.submissionId || raw.match_id !== x.matchId
        || !natural(raw.match_version) || !natural(raw.event_revision) || raw.generation !== x.bracketGeneration
        || !(raw.status === 'accepted' || raw.status === 'rejected')
        || (raw.status === 'accepted' ? !(raw.reason === null && raw.match_version > x.expectedMatchVersion)
                                      : raw.reason !== 'stale-match-version')) {
        fail('Invalid score response; outcome unknown');
      }
      return Object.freeze({status: raw.status, revision: raw.event_revision, generation: raw.generation,
        matchVersion: raw.match_version, receiptValidated: false});
    },
    /** The person's own decision for one submission, or the event state when submissionId is null. */
    async readOwnSnapshot(token, {eventId, submissionId = null} = {}) {
      if (!UUID.test(eventId || '') || !(submissionId === null || UUID.test(submissionId))) fail('Invalid snapshot request');
      reads++;
      const raw = await post('/rest/v1/rpc/fftt_score_decision_snapshot_v2', token,
        {p_event_id: eventId, p_submission_id: submissionId}, 'receipt');
      return parseLocalOwnSnapshot(raw, {eventId, submissionId});
    },
    /** Cheap change detector; valid in every lifecycle (the strict parser above requires 'active'). */
    async readPulse(token, {eventId} = {}) {
      if (!UUID.test(eventId || '')) fail('Invalid pulse request');
      reads++;
      const raw = await post('/rest/v1/rpc/fftt_score_decision_snapshot_v2', token,
        {p_event_id: eventId, p_submission_id: null}, 'pulse');
      if (!sameKeys(raw, PULSE) || raw.event_id !== eventId || !natural(raw.revision) || !natural(raw.generation)
        || !['draft', 'active', 'complete', 'archived'].includes(raw.lifecycle)
        || raw.submission_id !== null || raw.decision !== null) fail('Invalid pulse');
      return Object.freeze({eventId, revision: raw.revision, generation: raw.generation, lifecycle: raw.lifecycle});
    },
    async readMatchdesk(token, {eventId} = {}) {
      if (!UUID.test(eventId || '')) fail('Invalid desk request');
      reads++;
      const rows = await post('/rest/v1/rpc/fftt_matchdesk_v1', token, {p_event_id: eventId}, 'desk');
      if (!Array.isArray(rows) || rows.length > 140) fail('Unexpected Match Desk');
      return rows.map(r => {
        if (!sameKeys(r, DESK) || r.event_id !== eventId) fail('Unexpected Match Desk row');
        return r;
      });
    },
    get stats() { return Object.freeze({scoreRequests, reads, automaticRetries: 0, queuedScores: 0}); },
  });
}
