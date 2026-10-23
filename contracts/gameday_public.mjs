/** Anonymous public read model for the game-day spectator and TV pages.
 * Reads ONE allowlisted view (names, results, tables, phase) with only the public key: no session, no token,
 * no write path. Any field outside the allowlist, or any malformed value, makes the whole answer invalid so a
 * server-side mistake can never be displayed (the display module blanks on invalid data). */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
// The pinned synthetic project. Deliberately NOT imported from the signed-in transports: the public bundle
// must contain no token-handling code at all (a test compares this constant with the staff-side pin).
export const PUBLIC_HOST = 'https://copmkalfkkrkzheohwuc.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;
const EVENT_FIELDS = ['event_id', 'event_name', 'event_date', 'status', 'revision', 'tables', 'updated_at', 'finale', 'brackets'];
const MATCH_FIELDS = ['match_id', 'bracket', 'round', 'slot', 'player_1_name', 'player_2_name', 'winner_name', 'game_scores', 'status', 'table_number', 'phase'];
const FINALE_FIELDS = ['status', 'team_1', 'team_2', 'winner_team', 'game_scores'];
export class PublicProjectionError extends AuthorityGateError {
  constructor() { super('Public projection invalid or unavailable'); this.name = 'PublicProjectionError'; }
}
const bad = () => { throw new PublicProjectionError(); };
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (o, keys) => plain(o) && Object.keys(o).length === keys.length && keys.every(k => k in o);
const int = (x, lo = 0, hi = 1e9) => Number.isSafeInteger(x) && x >= lo && x <= hi;
const name = x => x === null || (typeof x === 'string' && x.length <= 80);
const txt = (x, max) => typeof x === 'string' && x.length <= max;

export function projectPublicTournaments(rows) {
  if (!Array.isArray(rows) || rows.length > 20) bad();
  return Object.freeze(rows.map(e => {
    if (!exact(e, EVENT_FIELDS) || !UUID.test(e.event_id) || !txt(e.event_name, 160) || !e.event_name.trim()
      || !/^\d{4}-\d{2}-\d{2}$/.test(e.event_date) || !['active', 'complete'].includes(e.status)
      || !int(e.revision) || !int(e.tables, 1, 12) || !txt(e.updated_at, 64) || !Array.isArray(e.brackets) || e.brackets.length > 2) bad();
    let finale = null;
    if (e.finale !== null) {
      const f = e.finale;
      if (!exact(f, FINALE_FIELDS) || !['pending', 'complete'].includes(f.status) || !Array.isArray(f.team_1) || !Array.isArray(f.team_2)
        || f.team_1.length !== 2 || f.team_2.length !== 2 || ![...f.team_1, ...f.team_2].every(n => typeof n === 'string' && n.length <= 80)
        || !(f.winner_team === null || f.winner_team === 1 || f.winner_team === 2) || !txt(f.game_scores, 160)) bad();
      finale = Object.freeze({status: f.status, team1: Object.freeze([...f.team_1]), team2: Object.freeze([...f.team_2]), winnerTeam: f.winner_team, scores: f.game_scores});
    }
    const brackets = {championship: [], consolation: []};
    const seen = new Set();
    for (const b of e.brackets) {
      if (!exact(b, ['name', 'matches']) || !(b.name in brackets) || seen.has(b.name) || !Array.isArray(b.matches) || b.matches.length > 140) bad();
      seen.add(b.name);
      brackets[b.name] = b.matches.map(m => {
        if (!exact(m, MATCH_FIELDS) || !/^[a-z0-9][a-z0-9_.:-]{0,99}$/i.test(m.match_id) || m.bracket !== b.name
          || !int(m.round, 0, 7) || !int(m.slot, 0, 63) || !name(m.player_1_name) || !name(m.player_2_name) || !name(m.winner_name)
          || !txt(m.game_scores, 160) || !['pending', 'complete', 'bye', 'empty'].includes(m.status)
          || !(m.table_number === null || int(m.table_number, 1, 12)) || !['waiting', 'up_next', 'playing', 'done'].includes(m.phase)
          || (m.winner_name !== null && m.winner_name !== m.player_1_name && m.winner_name !== m.player_2_name)) bad();
        return Object.freeze({id: m.match_id, round: m.round, slot: m.slot, name1: m.player_1_name, name2: m.player_2_name,
          winnerName: m.winner_name, scores: m.game_scores, status: m.status, table: m.table_number, phase: m.phase});
      });
      Object.freeze(brackets[b.name]);
    }
    return Object.freeze({id: e.event_id, name: e.event_name, date: e.event_date, status: e.status, revision: e.revision,
      tables: e.tables, updatedAt: e.updated_at, finale, championship: brackets.championship, consolation: brackets.consolation});
  }));
}

export function createPublicReader({projectUrl = PUBLIC_HOST, publishableKey, fetchImpl} = {}) {
  if (projectUrl !== PUBLIC_HOST || typeof publishableKey !== 'string' || !KEY.test(publishableKey) || typeof fetchImpl !== 'function') bad();
  return Object.freeze({
    /** One anonymous GET. A failed fetch is an outage (the display ages its last view); a bad body is invalid data. */
    async read() {
      let response;
      try {
        response = await fetchImpl(projectUrl + '/rest/v1/fftt_public_tournament_v1?select=*', {
          method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
          headers: {apikey: publishableKey, Accept: 'application/json'},
        });
      } catch { throw new Error('public read: network'); }
      if (response?.status !== 200) throw new Error('public read: status');
      let body;
      try { body = await response.json(); } catch { throw new PublicProjectionError(); }
      return body;
    },
  });
}

/** Derived views shared by the spectator page and the TV board. */
export function deriveBoard(ev) {
  const all = [...ev.championship.map(m => ({...m, bracket: 'championship'})), ...ev.consolation.map(m => ({...m, bracket: 'consolation'}))];
  const real = all.filter(m => m.status !== 'bye' && m.status !== 'empty');
  const order = (a, b) => (a.bracket === b.bracket ? 0 : a.bracket === 'championship' ? -1 : 1) || a.round - b.round || a.slot - b.slot;
  return {
    playing: real.filter(m => m.phase === 'playing').sort((a, b) => a.table - b.table),
    upNext: real.filter(m => m.phase === 'up_next').sort(order),
    recent: real.filter(m => m.status === 'complete').sort((a, b) => (b.bracket === a.bracket ? 0 : b.bracket === 'championship' ? 1 : -1) || b.round - a.round || b.slot - a.slot),
    waitingCount: real.filter(m => m.phase === 'waiting').length,
  };
}
