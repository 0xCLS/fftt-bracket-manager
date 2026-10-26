/** FFTT game-day staff API client (synthetic staging). Every call carries the signed-in person's own
 * access token; there is no privileged key, no sign-up, no admin endpoint and no automatic retry.
 *
 * Only the audited organizer/read RPCs below are reachable (exact path allowlist). Responses are
 * validated and rebuilt into frozen models, so a malformed or unexpected answer is refused, never rendered.
 * Failures are classified: for a WRITE, anything that leaves the outcome unknown (network loss, timeout,
 * 5xx, unreadable body) is reported as `outcomeUnknown` so the UI makes the person refresh and look
 * rather than silently resend. Scoring is NOT here: it uses the single-use, receipt-recovering score session.
 */
import {C3_HOST} from './phase1c_c3_readonly_supabase_transport.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const KEY = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;

export const API_ERROR_KINDS = Object.freeze([
  'validation', 'conflict', 'stale', 'not-found', 'forbidden', 'ineligible', 'access-rejected',
  'rate-limited', 'network', 'unavailable', 'malformed',
]);
export class GamedayApiError extends Error {
  constructor(kind, {detail = null, outcomeUnknown = false, retryAfterMs = null} = {}) {
    super('Game-day request failed');
    this.name = 'GamedayApiError';
    this.kind = API_ERROR_KINDS.includes(kind) ? kind : 'unavailable';
    this.detail = typeof detail === 'string' && /^[a-z0-9-]{1,48}$/.test(detail) ? detail : null;
    this.outcomeUnknown = outcomeUnknown === true;
    this.retryAfterMs = Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : null;
  }
}
const bad = () => { throw new GamedayApiError('malformed'); };
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const int = (x, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= lo && x <= hi;
const text = (x, max) => typeof x === 'string' && x.length <= max;
const uuid = x => typeof x === 'string' && UUID.test(x);
const uuidOrNull = x => x === null || uuid(x);
const only = (o, keys) => plain(o) && Object.keys(o).every(k => keys.includes(k));

const MESSAGE_KIND = Object.freeze({
  fftt_validation_error: 'validation', fftt_conflict: 'conflict', fftt_stale_generation: 'stale',
  fftt_not_found: 'not-found', forbidden: 'forbidden', fftt_ineligible_staff_target: 'ineligible',
  fftt_forbidden_self_change: 'forbidden', fftt_submission_id_reused: 'conflict',
});

const WRITE_ROUTES = Object.freeze([
  'fftt_create_event_v3', 'fftt_update_event_v3', 'fftt_set_lifecycle_v3', 'fftt_set_visibility_v3',
  'fftt_upsert_players_v3', 'fftt_remove_player_v3', 'fftt_set_checkin_v3', 'fftt_set_checkin_bulk_v3', 'fftt_build_championship_v3',
  'fftt_build_consolation_v3', 'fftt_assign_table_v3', 'fftt_forfeit_match_v3', 'fftt_correct_result_v3',
  'fftt_set_doubles_teams_v3', 'fftt_record_doubles_result_v3', 'fftt_set_staff_v3',
  'fftt_set_formats_v4', 'fftt_set_match_format_v4', 'fftt_checkin_registrants_v4', 'fftt_confirm_ratings_v4',
  'fftt_restore_event_v4', 'fftt_delete_event_v4',
]);
const READ_ROUTES = Object.freeze([
  'fftt_my_events_v3', 'fftt_my_events_v4', 'fftt_event_brief_v3', 'fftt_organizer_snapshot_v3', 'fftt_audit_log_v3',
  'fftt_export_event_v3', 'fftt_matchdesk_v1', 'fftt_matchdesk_v2',
]);

// ---------------------------------------------------------------- response models
export function parseMyEvents(raw) {
  if (!Array.isArray(raw) || raw.length > 50) bad();
  return Object.freeze(raw.map(e => {
    if (!only(e, ['event_id', 'name', 'date', 'lifecycle', 'role', 'revision', 'can_create', 'tables', 'players', 'deletable'])
      || !uuid(e.event_id) || !text(e.name, 160) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)
      || !['draft', 'active', 'complete', 'archived'].includes(e.lifecycle)
      || !['organizer', 'scorekeeper'].includes(e.role) || !int(e.revision)
      || typeof e.can_create !== 'boolean' || !int(e.tables, 1, 12)
      || !(e.players === null || int(e.players, 0, 64)) || typeof e.deletable !== 'boolean'
      || (e.role !== 'organizer' && (e.players !== null || e.deletable))) bad();
    return Object.freeze({eventId: e.event_id, name: e.name, date: e.date, lifecycle: e.lifecycle,
      role: e.role, revision: e.revision, canCreate: e.can_create, tables: e.tables,
      players: e.players, deletable: e.deletable});
  }));
}

export function parseEventBrief(raw) {
  if (!only(raw, ['event_id', 'name', 'date', 'tables', 'lifecycle', 'generation', 'revision']) || !uuid(raw.event_id)
    || !text(raw.name, 160) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || !int(raw.tables, 1, 12)
    || !['draft', 'active', 'complete', 'archived'].includes(raw.lifecycle) || !int(raw.generation) || !int(raw.revision)) bad();
  return Object.freeze({eventId: raw.event_id, name: raw.name, date: raw.date, tables: raw.tables,
    lifecycle: raw.lifecycle, generation: raw.generation, revision: raw.revision});
}

const FORMAT_CATEGORIES = ['champ', 'champ_final', 'cons', 'cons_final', 'doubles'];
const REF = /^[A-Za-z0-9_-]{16,64}$/;
function parseFormats(f) {
  if (!only(f, FORMAT_CATEGORIES) || Object.keys(f).length !== FORMAT_CATEGORIES.length) bad();
  const out = {};
  for (const k of FORMAT_CATEGORIES) {
    const v = f[k];
    if (!only(v, ['best_of', 'points']) || ![1, 3].includes(v.best_of) || ![11, 21].includes(v.points)) bad();
    out[k] = Object.freeze({bestOf: v.best_of, points: v.points});
  }
  return Object.freeze(out);
}

export function parseOrganizerSnapshot(raw) {
  if (!only(raw, ['event', 'players', 'brackets', 'matches', 'consolation_candidates', 'doubles', 'staff'])) bad();
  const e = raw.event;
  if (!only(e, ['event_id', 'name', 'date', 'lifecycle', 'tables', 'generation', 'revision', 'public_visible',
    'formats']) || !uuid(e.event_id) || !text(e.name, 160)
    || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !['draft', 'active', 'complete', 'archived'].includes(e.lifecycle)
    || !int(e.tables, 1, 12) || !int(e.generation) || !int(e.revision) || typeof e.public_visible !== 'boolean') bad();
  const formats = parseFormats(e.formats);
  if (!Array.isArray(raw.players) || raw.players.length > 64 || !Array.isArray(raw.matches) || raw.matches.length > 140
    || !Array.isArray(raw.brackets) || raw.brackets.length > 2 || !Array.isArray(raw.consolation_candidates)
    || raw.consolation_candidates.length > 64 || !Array.isArray(raw.staff) || raw.staff.length > 60) bad();
  const players = raw.players.map(p => {
    if (!only(p, ['id', 'name', 'rating', 'rating_status', 'checked_in', 'first_champ_loss', 'registration_refs', 'source', 'rating_confirmed'])
      || !uuid(p.id) || !text(p.name, 80) || p.name.length < 1 || !int(p.rating, 1, 5)
      || !['provisional', 'established'].includes(p.rating_status)
      || typeof p.checked_in !== 'boolean' || typeof p.first_champ_loss !== 'boolean'
      || !Array.isArray(p.registration_refs) || p.registration_refs.length > 16
      || !p.registration_refs.every(r => typeof r === 'string' && REF.test(r))
      || !['manual', 'registration', 'walk_in'].includes(p.source) || typeof p.rating_confirmed !== 'boolean') bad();
    return Object.freeze({id: p.id, name: p.name, rating: p.rating, ratingStatus: p.rating_status,
      checkedIn: p.checked_in, firstChampLoss: p.first_champ_loss, registrationRefs: Object.freeze([...p.registration_refs]),
      source: p.source, ratingConfirmed: p.rating_confirmed});
  });
  const ids = new Set(players.map(p => p.id));
  const matches = raw.matches.map(m => {
    if (!only(m, ['id', 'bracket', 'code', 'round', 'slot', 'player_1_id', 'player_2_id', 'winner_id', 'status',
      'game_scores', 'table', 'version', 'is_final', 'next_match_id', 'best_of', 'points', 'format_legacy'])
      || !uuid(m.id) || !['championship', 'consolation'].includes(m.bracket) || !/^[Cc]-\d{1,2}-\d{1,3}$/.test(m.code)
      || !int(m.round, 0, 7) || !int(m.slot, 0, 63) || !uuidOrNull(m.player_1_id) || !uuidOrNull(m.player_2_id)
      || !uuidOrNull(m.winner_id) || !['pending', 'complete', 'bye', 'empty'].includes(m.status)
      || !text(m.game_scores, 160) || !(m.table === null || int(m.table, 1, 12)) || !int(m.version)
      || typeof m.is_final !== 'boolean' || !uuidOrNull(m.next_match_id)
      || ![1, 3, 5].includes(m.best_of) || ![11, 21].includes(m.points) || typeof m.format_legacy !== 'boolean'
      || (!m.format_legacy && m.best_of === 5)) bad();
    for (const k of [m.player_1_id, m.player_2_id, m.winner_id]) if (k !== null && !ids.has(k)) bad();
    return Object.freeze({id: m.id, bracket: m.bracket, code: m.code, round: m.round, slot: m.slot,
      p1: m.player_1_id, p2: m.player_2_id, winner: m.winner_id, status: m.status, scores: m.game_scores,
      table: m.table, version: m.version, isFinal: m.is_final, nextId: m.next_match_id,
      bestOf: m.best_of, points: m.points, formatLegacy: m.format_legacy});
  });
  const candidates = raw.consolation_candidates.map(c => {
    if (!only(c, ['player_id', 'state', 'first_loss_match_id']) || !uuid(c.player_id)
      || !['eligible', 'reviewed', 'placed'].includes(c.state) || !uuid(c.first_loss_match_id)) bad();
    return Object.freeze({playerId: c.player_id, state: c.state, firstLossMatchId: c.first_loss_match_id});
  });
  let doubles = null;
  if (raw.doubles !== null) {
    const d = raw.doubles;
    if (!only(d, ['finalist_1', 'finalist_2', 'partner_1', 'partner_2', 'winner_team', 'game_scores'])
      || !uuid(d.finalist_1) || !uuid(d.finalist_2) || !uuidOrNull(d.partner_1) || !uuidOrNull(d.partner_2)
      || !(d.winner_team === null || d.winner_team === 1 || d.winner_team === 2) || !text(d.game_scores, 160)) bad();
    doubles = Object.freeze({finalist1: d.finalist_1, finalist2: d.finalist_2, partner1: d.partner_1,
      partner2: d.partner_2, winnerTeam: d.winner_team, scores: d.game_scores});
  }
  const staff = raw.staff.map(s => {
    if (!only(s, ['user_id', 'email', 'role', 'active']) || !uuid(s.user_id) || !text(s.email ?? '', 254)
      || !['organizer', 'scorekeeper'].includes(s.role) || typeof s.active !== 'boolean') bad();
    return Object.freeze({userId: s.user_id, email: s.email ?? '', role: s.role, active: s.active});
  });
  const brackets = raw.brackets.map(b => {
    if (!only(b, ['kind', 'status']) || !['championship', 'consolation'].includes(b.kind)
      || !['active', 'complete'].includes(b.status)) bad();
    return Object.freeze({kind: b.kind, status: b.status});
  });
  return Object.freeze({
    event: Object.freeze({eventId: e.event_id, name: e.name, date: e.date, lifecycle: e.lifecycle, tables: e.tables,
      generation: e.generation, revision: e.revision, publicVisible: e.public_visible, formats}),
    players: Object.freeze(players), brackets: Object.freeze(brackets), matches: Object.freeze(matches),
    candidates: Object.freeze(candidates), doubles, staff: Object.freeze(staff),
  });
}

export function parseMutation(raw) {
  if (!plain(raw) || !text(raw.status, 40)) bad();
  const out = {status: raw.status};
  for (const k of ['event_revision', 'generation', 'match_version', 'added', 'changed', 'created', 'linked', 'existing']) {
    if (k in raw) { if (!int(raw[k])) bad(); out[k] = raw[k]; }
  }
  for (const k of ['lifecycle']) if (k in raw) { if (!text(raw[k], 20)) bad(); out[k] = raw[k]; }
  if ('public_visible' in raw) { if (typeof raw.public_visible !== 'boolean') bad(); out.public_visible = raw.public_visible; }
  if ('event_id' in raw) { if (!uuid(raw.event_id)) bad(); out.event_id = raw.event_id; }
  return Object.freeze(out);
}

export function parseAuditLog(raw) {
  if (!Array.isArray(raw) || raw.length > 200) bad();
  return Object.freeze(raw.map(a => {
    if (!only(a, ['operation', 'match_id', 'actor_id', 'reason', 'before', 'after', 'revision', 'at'])
      || !text(a.operation, 40) || !uuidOrNull(a.match_id) || !uuidOrNull(a.actor_id)
      || !(a.reason === null || text(a.reason, 300)) || !int(a.revision) || !text(a.at, 64)) bad();
    return Object.freeze({operation: a.operation, matchId: a.match_id, actorId: a.actor_id, reason: a.reason,
      revision: a.revision, at: a.at, before: a.before, after: a.after});
  }));
}

// ---------------------------------------------------------------- transport
export function createGamedayApi({projectUrl = C3_HOST, publishableKey, fetchImpl} = {}) {
  if (projectUrl !== C3_HOST || typeof publishableKey !== 'string' || !KEY.test(publishableKey)
    || publishableKey.length > 512 || typeof fetchImpl !== 'function') throw new GamedayApiError('unavailable');
  let requests = 0;

  async function call(name, token, body, {write}) {
    const allowed = write ? WRITE_ROUTES : READ_ROUTES;
    if (!allowed.includes(name)) throw new GamedayApiError('unavailable');
    if (typeof token !== 'string' || !JWT.test(token) || token.length > 10000) throw new GamedayApiError('access-rejected');
    requests++;
    let response;
    try {
      response = await fetchImpl(projectUrl + '/rest/v1/rpc/' + name, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: {apikey: publishableKey, Authorization: 'Bearer ' + token, Accept: 'application/json',
          'Content-Type': 'application/json'},
        body: JSON.stringify(body ?? {}),
      });
    } catch {
      throw new GamedayApiError('network', {outcomeUnknown: write});
    }
    const status = response?.status;
    if (status === 200) {
      try { return await response.json(); } catch { throw new GamedayApiError('malformed', {outcomeUnknown: write}); }
    }
    if (status === 401) throw new GamedayApiError('access-rejected');
    if (status === 429) {
      const s = Number.parseInt(response.headers?.get?.('retry-after') ?? '', 10);
      throw new GamedayApiError('rate-limited', {retryAfterMs: Number.isSafeInteger(s) && s > 0 && s <= 900 ? s * 1000 : 60000});
    }
    if (status === 403) throw new GamedayApiError('forbidden');
    if (status >= 400 && status < 500) {
      let msg = null, detail = null;
      try { const j = await response.json(); msg = j?.message; detail = j?.details ?? null; } catch { /* generic */ }
      const kind = MESSAGE_KIND[msg];
      if (kind) throw new GamedayApiError(kind, {detail});
      throw new GamedayApiError('unavailable');
    }
    throw new GamedayApiError('unavailable', {outcomeUnknown: write});
  }

  const w = (name, parse = parseMutation) => async (token, body) => parse(await call(name, token, body, {write: true}));
  const r = (name, parse) => async (token, body) => parse(await call(name, token, body, {write: false}));
  return Object.freeze({
    myEvents: r('fftt_my_events_v4', parseMyEvents),
    eventBrief: r('fftt_event_brief_v3', parseEventBrief),
    organizerSnapshot: r('fftt_organizer_snapshot_v3', parseOrganizerSnapshot),
    auditLog: r('fftt_audit_log_v3', parseAuditLog),
    exportEvent: r('fftt_export_event_v3', x => { if (!plain(x) || x.format !== 'fftt-event-export-v3') bad(); return x; }),
    createEvent: w('fftt_create_event_v3'),
    updateEvent: w('fftt_update_event_v3'),
    setLifecycle: w('fftt_set_lifecycle_v3'),
    setVisibility: w('fftt_set_visibility_v3'),
    upsertPlayers: w('fftt_upsert_players_v3'),
    removePlayer: w('fftt_remove_player_v3'),
    setCheckin: w('fftt_set_checkin_v3'),
    setCheckinBulk: w('fftt_set_checkin_bulk_v3'),
    buildChampionship: w('fftt_build_championship_v3'),
    buildConsolation: w('fftt_build_consolation_v3'),
    assignTable: w('fftt_assign_table_v3'),
    forfeitMatch: w('fftt_forfeit_match_v3'),
    correctResult: w('fftt_correct_result_v3'),
    setDoublesTeams: w('fftt_set_doubles_teams_v3'),
    recordDoublesResult: w('fftt_record_doubles_result_v3'),
    setStaff: w('fftt_set_staff_v3'),
    setFormats: w('fftt_set_formats_v4'),
    setMatchFormat: w('fftt_set_match_format_v4'),
    checkinRegistrants: w('fftt_checkin_registrants_v4'),
    confirmRatings: w('fftt_confirm_ratings_v4'),
    restoreEvent: w('fftt_restore_event_v4'),
    deleteEvent: w('fftt_delete_event_v4'),
    getRequestCount: () => requests,
  });
}
