/** Synthetic development projection: convert allowlisted public Supabase rows into display-only data.
 * No network, credentials, browser storage, scoring, mutation or publication.
 * IDs intentionally never appear in returned display objects.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_FIELDS = ['event_id','event_name','event_date','status','brackets','updated_at'];
const BRACKET_FIELDS = ['name','matches'];
// Deployed SQL nested aggregate excludes event_id; C3 validates the containing event.
const MATCH_FIELDS = ['match_id','bracket','round','slot','player_1_name','player_2_name','winner_name','game_scores','status'];
const EVENT_STATES = new Set(['draft','active','complete','archived']);
const MATCH_STATES = new Set(['pending','complete','bye','empty']);
const BRACKET_NAMES = new Set(['championship','consolation']);
const MAX_EVENTS = 20, MAX_BRACKETS = 2, MAX_MATCHES = 128;
export class PublicProjectionError extends Error {
  constructor() { super('Public projection invalid or unavailable'); this.name='PublicProjectionError'; }
}
const requireSafe = ok => { if (!ok) throw new PublicProjectionError(); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const keys = (x, allow) => object(x) && Object.keys(x).length === allow.length &&
  Object.keys(x).every(k => allow.includes(k));
function text(value, limit, nullable=false) {
  requireSafe((nullable && value === null) || (typeof value === 'string' && value.length <= limit));
  return value === null ? '' : value;
}
function number(value) { requireSafe(Number.isSafeInteger(value) && value >= 0); return value; }
function matchView(m, bracket) {
  requireSafe(keys(m, MATCH_FIELDS) &&
    typeof m.match_id === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,99}$/i.test(m.match_id) &&
    m.bracket === bracket && MATCH_STATES.has(m.status));
  const first = text(m.player_1_name, 120, true);
  const second = text(m.player_2_name, 120, true);
  const winner = text(m.winner_name, 120, true);
  const scores = text(m.game_scores, 160);
  requireSafe(!winner || winner === first || winner === second);
  return Object.freeze({
    round: number(m.round) + 1, slot: number(m.slot) + 1,
    players: (first || 'TBD') + ' vs ' + (second || 'TBD'),
    status: m.status, winner, scores,
  });
}
export function projectPublishedResults(rows) {
  requireSafe(Array.isArray(rows) && rows.length <= MAX_EVENTS);
  return Object.freeze(rows.map(e => {
    requireSafe(keys(e, EVENT_FIELDS) && typeof e.event_id === 'string' && UUID.test(e.event_id) &&
      EVENT_STATES.has(e.status) && Array.isArray(e.brackets) && e.brackets.length <= MAX_BRACKETS);
    const name = text(e.event_name, 120);
    requireSafe(name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date));
    text(e.updated_at, 80);
    const brackets = e.brackets.map(b => {
      requireSafe(keys(b, BRACKET_FIELDS) && BRACKET_NAMES.has(b.name) &&
        Array.isArray(b.matches) && b.matches.length <= MAX_MATCHES);
      return Object.freeze({name: b.name,
        matches: Object.freeze(b.matches.map(m => matchView(m,b.name))) });
    });
    requireSafe(new Set(brackets.map(b => b.name)).size === brackets.length);
    return Object.freeze({name, date:e.event_date, status:e.status,
      brackets:Object.freeze(brackets)});
  }));
}
