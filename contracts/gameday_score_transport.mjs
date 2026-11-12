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
  'slot', 'player_1_id', 'player_2_id', 'player_1_name', 'player_2_name', 'is_championship_final', 'table_number',
  'best_of', 'points_to_win'];
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
    if (response?.status === 400 && what === 'game') {
      // Only this exact PostgREST error is known to be raised by the withdrawal guard inside the
      // game-save transaction. The exception rolls that transaction back. Other errors remain unknown.
      let body = null; try { body = await response.json(); } catch { /* unknown */ }
      if (sameKeys(body, ['code', 'message', 'details', 'hint']) && body.code === 'P0001'
        && body.message === 'fftt_conflict' && body.details === 'player-withdrawn' && body.hint === null) {
        throw Object.assign(new AuthorityGateError('game: player withdrawn'), {definiteRefusal: true, detail: 'player-withdrawn'});
      }
      fail(what + ': denied, expired or uncertain');
    }
    if (response?.status === 400 && what === 'score') {
      // The database RAISED a validation error: the whole transaction rolled back, so nothing was recorded. That is the
      // one failure that is definite (every other non-200 stays "unknown" and is settled from the server's own receipt).
      let body = null; try { body = await response.json(); } catch { /* generic */ }
      if (body?.message === 'fftt_validation_error') {
        throw Object.assign(new AuthorityGateError('score: refused by validation'), {definiteRefusal: true, detail: typeof body.details === 'string' ? body.details.slice(0, 48) : null});
      }
      fail(what + ': denied, expired or uncertain');
    }
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
      const rows = await post('/rest/v1/rpc/fftt_matchdesk_v2', token, {p_event_id: eventId}, 'desk');
      if (!Array.isArray(rows) || rows.length > 140) fail('Unexpected Match Desk');
      return rows.map(r => {
        if (!sameKeys(r, DESK) || r.event_id !== eventId) fail('Unexpected Match Desk row');
        // a historical Best of 5 may still be waiting to be played; nothing else outside 1/3 and 11/21 is valid
        if (![1, 3, 5].includes(r.best_of) || ![11, 21].includes(r.points_to_win)) fail('Unexpected match format');
        return r;
      });
    },
    /** Event-scoped, signed, read-only snapshot of server-confirmed completed games. */
    async readGameProgress(token, {eventId, matchId} = {}) {
      if (!UUID.test(eventId || '') || !UUID.test(matchId || '')) fail('Invalid game progress request');
      reads++;
      const r = await post('/rest/v1/rpc/fftt_game_progress_v1', token,
        {p_event_id: eventId, p_match_id: matchId}, 'game progress');
      const keys = ['event_id','match_id','generation','match_version','epoch','best_of',
        'points_to_win','match_status','revision','games','updated_at','event_revision'];
      if (!sameKeys(r, keys) || r.event_id !== eventId || r.match_id !== matchId
        || !natural(r.generation) || !natural(r.match_version) || !natural(r.epoch)
        || !natural(r.revision) || !natural(r.event_revision) || ![1,3,5].includes(r.best_of)
        || ![11,21].includes(r.points_to_win) || !['pending','complete','bye','empty'].includes(r.match_status)
        || !Array.isArray(r.games) || r.games.length > r.best_of
        || !r.games.every(g => Array.isArray(g) && g.length === 2 && g.every(x => Number.isSafeInteger(x) && x >= 0 && x <= 99))
        || !(r.updated_at === null || (typeof r.updated_at === 'string' && r.updated_at.length < 65))) {
        fail('Invalid game progress snapshot');
      }
      return Object.freeze({...r, games: Object.freeze(r.games.map(g => Object.freeze([...g])))});
    },
    /** One-shot write. Unknown outcomes MUST be settled with readGameDecision, never resent. */
    async submitCompletedGame(token, x) {
      if (!x || !UUID.test(x.eventId || '') || !UUID.test(x.matchId || '') || !UUID.test(x.submissionId || '')
        || !natural(x.generation) || !natural(x.matchVersion) || !natural(x.epoch)
        || !natural(x.revision) || ![1,3,5].includes(x.bestOf) || ![11,21].includes(x.points)
        || !Number.isSafeInteger(x.gameIndex) || x.gameIndex < 1 || x.gameIndex > x.bestOf
        || ![x.player1Score,x.player2Score].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 99)
        || !(x.reason === null || (typeof x.reason === 'string' && x.reason.length <= 500))) {
        fail('Invalid completed game request');
      }
      if (attempted.has(x.submissionId)) fail('Duplicate submission is forbidden, even after a timeout');
      attempted.add(x.submissionId);
      scoreRequests++;
      const r = await post('/rest/v1/rpc/fftt_save_completed_game_v1', token, {
        p_event_id: x.eventId, p_match_id: x.matchId, p_generation: x.generation,
        p_expected_match_version: x.matchVersion, p_expected_epoch: x.epoch,
        p_expected_progress_version: x.revision, p_expected_best_of: x.bestOf,
        p_expected_points_to_win: x.points, p_submission_id: x.submissionId,
        p_game_index: x.gameIndex, p_player_1_score: x.player1Score,
        p_player_2_score: x.player2Score, p_reason: x.reason,
      }, 'game');
      if (!sameKeys(r, ['submission_id','status','reason','match_id','revision','event_revision'])
        || r.submission_id !== x.submissionId || r.match_id !== x.matchId
        || !['accepted','rejected'].includes(r.status)
        || !natural(r.revision) || !natural(r.event_revision)
        || (r.status === 'accepted' ? (r.reason !== null || r.revision <= x.revision)
          : r.reason !== 'stale-progress')) {
        fail('Invalid game-save response; outcome unknown');
      }
      return Object.freeze(r);
    },
    /** Mixed-Skill Doubles: event-scoped staff read of the two teams (names only), format and server-confirmed games. */
    async readDoublesDesk(token, {eventId} = {}) {
      if (!UUID.test(eventId || '')) fail('Invalid doubles request');
      reads++;
      const r = await post('/rest/v1/rpc/fftt_doubles_desk_v1', token, {p_event_id: eventId}, 'doubles desk');
      if (sameKeys(r, ['event_id','status','event_revision']) && r.event_id === eventId && r.status === 'no-teams' && natural(r.event_revision)) {
        return Object.freeze(r);
      }
      const keys = ['event_id','status','lifecycle','team_key','best_of','points_to_win','teams','revision','games',
        'winner_team','game_scores','event_revision'];
      if (!sameKeys(r, keys) || r.event_id !== eventId || !['ready','complete'].includes(r.status)
        || typeof r.lifecycle !== 'string' || r.lifecycle.length > 20 || typeof r.team_key !== 'string' || !/^[0-9a-f]{32}$/.test(r.team_key)
        || ![1,3,5].includes(r.best_of) || ![11,21].includes(r.points_to_win)
        || !Array.isArray(r.teams) || r.teams.length !== 2
        || !r.teams.every(t => Array.isArray(t) && t.length === 2 && t.every(n => typeof n === 'string' && n.length > 0 && n.length <= 120))
        || !natural(r.revision) || !natural(r.event_revision) || !Array.isArray(r.games) || r.games.length > r.best_of
        || !r.games.every(g => Array.isArray(g) && g.length === 2 && g.every(x => Number.isSafeInteger(x) && x >= 0 && x <= 99))
        || !(r.winner_team === null || r.winner_team === 1 || r.winner_team === 2)
        || typeof r.game_scores !== 'string' || r.game_scores.length > 120) {
        fail('Invalid doubles desk');
      }
      return Object.freeze({...r, teams: Object.freeze(r.teams.map(t => Object.freeze([...t]))), games: Object.freeze(r.games.map(g => Object.freeze([...g])))});
    },
    /** One-shot, like submitCompletedGame: an unknown outcome is settled with readGameDecision, never resent. */
    async submitDoublesGame(token, x) {
      if (!x || !UUID.test(x.eventId || '') || !UUID.test(x.submissionId || '') || typeof x.teamKey !== 'string' || !/^[0-9a-f]{32}$/.test(x.teamKey)
        || !natural(x.revision) || ![1,3,5].includes(x.bestOf) || ![11,21].includes(x.points)
        || !Number.isSafeInteger(x.gameIndex) || x.gameIndex < 1 || x.gameIndex > x.bestOf
        || ![x.team1Score,x.team2Score].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 99)
        || !(x.reason === null || (typeof x.reason === 'string' && x.reason.length <= 500))) {
        fail('Invalid doubles game request');
      }
      if (attempted.has(x.submissionId)) fail('Duplicate submission is forbidden, even after a timeout');
      attempted.add(x.submissionId);
      scoreRequests++;
      const r = await post('/rest/v1/rpc/fftt_save_doubles_game_v1', token, {
        p_event_id: x.eventId, p_expected_team_key: x.teamKey, p_expected_progress_version: x.revision,
        p_expected_best_of: x.bestOf, p_expected_points_to_win: x.points, p_submission_id: x.submissionId,
        p_game_index: x.gameIndex, p_team_1_score: x.team1Score, p_team_2_score: x.team2Score, p_reason: x.reason,
      }, 'game');
      if (!sameKeys(r, ['submission_id','status','reason','match_id','revision','event_revision'])
        || r.submission_id !== x.submissionId || r.match_id !== x.eventId
        || !['accepted','rejected'].includes(r.status)
        || !natural(r.revision) || !natural(r.event_revision)
        || (r.status === 'accepted' ? (r.reason !== null || r.revision <= x.revision) : r.reason !== 'stale-progress')) {
        fail('Invalid doubles game-save response; outcome unknown');
      }
      return Object.freeze(r);
    },
    /** Caller-owned, event-scoped receipt only; absence never proves the write failed. */
    async readGameDecision(token, {eventId, submissionId} = {}) {
      if (!UUID.test(eventId || '') || !UUID.test(submissionId || '')) fail('Invalid game receipt request');
      reads++;
      const r = await post('/rest/v1/rpc/fftt_game_progress_decision_v1', token,
        {p_event_id: eventId, p_submission_id: submissionId}, 'game receipt');
      if (sameKeys(r, ['submission_id','status']) && r.submission_id === submissionId && r.status === 'unconfirmed')
        return Object.freeze(r);
      if (!sameKeys(r, ['submission_id','status','reason','match_id','revision','event_revision'])
        || r.submission_id !== submissionId || !UUID.test(r.match_id || '')
        || !['accepted','rejected'].includes(r.status) || !natural(r.revision)
        || !natural(r.event_revision)
        || (r.status === 'accepted' ? r.reason !== null : r.reason !== 'stale-progress')) {
        fail('Invalid game receipt');
      }
      return Object.freeze(r);
    },
    get stats() { return Object.freeze({scoreRequests, reads, automaticRetries: 0, queuedScores: 0}); },
  });
}
