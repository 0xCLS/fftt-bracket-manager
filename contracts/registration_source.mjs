/** Event-specific registration source: the pure rules shared by the browser, the server adapter and the tests.
 * No network, storage, DOM or secrets. A "source" says WHICH sheet an event reads and HOW its columns map; it never
 * contains credentials or registration data.
 *
 * Mapping: {field: header text}. Header TEXT (not a column number) is stored, so re-ordering the form's columns keeps
 * working; renaming a mapped question is detected and reported instead of silently reading the wrong column. */
export const MAPPING_FIELDS = Object.freeze([
  // [field, label, group, required]
  ['name', 'Full name', 'identity', false], ['firstName', 'First name', 'identity', false], ['lastName', 'Last name', 'identity', false],
  ['timestamp', 'Registration time', 'identity', false],
  ['email', 'E-mail (matching only)', 'contact', false], ['phone', 'Phone (matching only)', 'contact', false],
  ['frequency', 'How often they play', 'assessment', false], ['experience', 'League / club / school-team experience', 'assessment', false],
  ['rallies', 'Rally consistency', 'assessment', false], ['spin', 'Uses spin', 'assessment', false],
  ['attack', 'Attacks easy balls', 'assessment', false], ['description', 'Playing profile / description', 'assessment', false],
  ['selfLevel', 'Self-described level', 'assessment', false],
]);
export const FIELD_KEYS = Object.freeze(MAPPING_FIELDS.map(f => f[0]));
export const ASSESSMENT_FIELDS = Object.freeze(MAPPING_FIELDS.filter(f => f[2] === 'assessment').map(f => f[0]));
export const CONTACT_FIELDS = Object.freeze(['email', 'phone']);
/** The mapping value meaning "this field has no column in my form" (it also skips auto-detection). */
export const NO_COLUMN = '(none)';
export const NO_COLUMN_LABEL = 'Not in my form';
export const SOURCE_KINDS = Object.freeze(['fixture', 'google-sheets']);

export const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,100}$/;
export const validWorksheetTitle = t => typeof t === 'string' && t.length >= 1 && t.length <= 100 && !/[\u0000-\u001f\u007f]/.test(t);
export const validHeaderText = t => typeof t === 'string' && t.length >= 1 && t.length <= 120 && !/[\u0000-\u001f\u007f]/.test(t);

/** Accepts a bare spreadsheet id, or a https://docs.google.com/spreadsheets/d/<id>/... link, and NOTHING else.
 * Any other host, scheme, credentials-in-URL, port or shape is refused, so this can never be used to point the server
 * at an arbitrary address. Returns the id or null. */
export function parseSpreadsheetRef(input) {
  const t = String(input ?? '').trim();
  if (t.length === 0 || t.length > 400) return null;
  if (SPREADSHEET_ID.test(t)) return t;
  let u;
  try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.username || u.password || u.port) return null;
  const m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/.exec(u.pathname);
  return m ? m[1] : null;
}

/** Validates an organizer-supplied mapping; returns a clean {field: header} object or null when anything is off. */
export function cleanMapping(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  const entries = Object.entries(raw);
  if (entries.length > FIELD_KEYS.length) return null;
  for (const [k, v] of entries) {
    if (!FIELD_KEYS.includes(k) || !validHeaderText(v)) return null;
    out[k] = v;
  }
  return out;
}

/** Stable text for a mapping (sorted), used to key caches so a changed mapping never reuses another result. */
export const mappingKey = m => JSON.stringify(Object.entries(m ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));

/** The organizer-facing states of a registration source. One vocabulary for the whole UI. */
export const SOURCE_STATES = Object.freeze({
  fictional: {label: 'Fictional demo data', tone: 'warn', detail: 'Made-up registrations for rehearsal. No real people.'},
  connected: {label: 'Connected Google Sheet', tone: 'good', detail: 'Read-only. Rows are read on demand and never saved.'},
  'not-configured': {label: 'Not configured', tone: '', detail: 'No registration source is set for this event.'},
  unauthorized: {label: 'Unauthorized', tone: 'bad', detail: 'The sheet is not shared with the connection account, or access was removed.'},
  unavailable: {label: 'Temporarily unavailable', tone: 'warn', detail: 'The source could not be read right now. Nothing was changed.'},
  disabled: {label: 'Connection off', tone: '', detail: 'A sheet is saved for this event but reading it is turned off.'},
  'not-allowed-here': {label: 'Not available on this site', tone: 'warn', detail: 'Reading a live Google Sheet is not allowed on this synthetic staging site.'},
});

// ---------------------------------------------------------------- the saved source record (database -> server and browser)
export const SOURCE_STATUSES = Object.freeze(['untested', 'ready', 'needs-attention', 'failed']);
export const SOURCE_ERRORS = Object.freeze(['not-configured', 'unauthorized', 'not-found', 'worksheet-not-found', 'busy', 'unavailable', 'malformed', 'invalid-source', 'columns', 'google-auth']);
const plainObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isoOrNull = x => x === null || x === undefined || (typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x)));
/** Rebuilds the record the database returns for fftt_registration_source_v5, or throws TypeError. Nothing outside the allowlist survives. */
export function parseSourceRecord(raw) {
  const fail = () => { throw new TypeError('invalid registration source record'); };
  if (!plainObj(raw) || typeof raw.configured !== 'boolean' || typeof raw.event_synthetic !== 'boolean') fail();
  if (!raw.configured) return Object.freeze({configured: false, eventSynthetic: raw.event_synthetic, kind: null, spreadsheetId: null, spreadsheetTitle: null,
    worksheet: null, columnMap: Object.freeze({}), enabled: false, status: 'untested', lastError: null, lastCheckedAt: null, lastOkAt: null, lastResponseCount: null});
  const allowed = ['configured', 'event_synthetic', 'kind', 'spreadsheet_id', 'spreadsheet_title', 'worksheet', 'column_map', 'enabled', 'status', 'last_error',
    'last_checked_at', 'last_ok_at', 'last_response_count', 'updated_at'];
  if (Object.keys(raw).some(k => !allowed.includes(k)) || !SOURCE_KINDS.includes(raw.kind) || typeof raw.enabled !== 'boolean'
    || !SOURCE_STATUSES.includes(raw.status) || !(raw.last_error === null || SOURCE_ERRORS.includes(raw.last_error))
    || !isoOrNull(raw.last_checked_at) || !isoOrNull(raw.last_ok_at) || !isoOrNull(raw.updated_at)
    || !(raw.last_response_count === null || (Number.isSafeInteger(raw.last_response_count) && raw.last_response_count >= 0))) fail();
  const map = cleanMapping(raw.column_map);
  if (map === null) fail();
  if (raw.kind === 'google-sheets') {
    if (!SPREADSHEET_ID.test(raw.spreadsheet_id ?? '') || !validWorksheetTitle(raw.worksheet)
      || !(raw.spreadsheet_title === null || (typeof raw.spreadsheet_title === 'string' && raw.spreadsheet_title.length <= 200))) fail();
  } else if (raw.spreadsheet_id !== null || raw.worksheet !== null) fail();
  return Object.freeze({configured: true, eventSynthetic: raw.event_synthetic, kind: raw.kind, spreadsheetId: raw.spreadsheet_id ?? null,
    spreadsheetTitle: raw.spreadsheet_title ?? null, worksheet: raw.worksheet ?? null, columnMap: Object.freeze(map), enabled: raw.enabled, status: raw.status,
    lastError: raw.last_error, lastCheckedAt: raw.last_checked_at ?? null, lastOkAt: raw.last_ok_at ?? null, lastResponseCount: raw.last_response_count ?? null});
}
