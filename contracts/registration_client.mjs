/** Browser client for the organizer-only registration adapter (POST /api/registrations on the SAME origin).
 * It sends the signed-in person's own access token and the event id (plus, for the settings screen, a spreadsheet link,
 * a worksheet name and a column mapping), nothing else, and rebuilds every answer through a strict contract: any field
 * outside the allowlist (a contact detail, an unexpected key) makes the whole answer invalid and nothing is shown.
 * It holds no credential of any kind and cannot reach any other host. */
import {REF_PATTERN, looksLikeContact, parseRegistrationPayload} from './registration_model.mjs';
import {FIELD_KEYS} from './registration_source.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
export const REGISTRATION_ERROR_KINDS = Object.freeze(['not-configured', 'not-enabled', 'source-disabled', 'not-allowed-here', 'forbidden', 'access-rejected', 'rate-limited',
  'source-unauthorized', 'source-not-found', 'source-worksheet', 'source-columns', 'source-auth', 'source-busy', 'source-unavailable', 'invalid-spreadsheet', 'network', 'malformed',
  // Bracket Manager desk check-in
  'registration-not-found', 'name-incomplete', 'level-required', 'registration-not-duplicate', 'registration-invalid', 'outcome-unknown', 'conflict']);
/** The only conflict details the desk can be told about (mirrors the Function's allowlist). */
export const CHECKIN_CONFLICT_DETAILS = Object.freeze(['check-in-closed', 'bracket-locked', 'lifecycle', 'duplicate-name', 'roster-full', 'already-linked', 'source-not-enabled', 'source-changed', 'link-name-mismatch']);

export class RegistrationClientError extends Error {
  constructor(kind, {serviceAccountEmail = null, detail = null} = {}) {
    super('Registration request failed');
    this.name = 'RegistrationClientError';
    this.kind = REGISTRATION_ERROR_KINDS.includes(kind) ? kind : 'source-unavailable';
    this.detail = CHECKIN_CONFLICT_DETAILS.includes(detail) ? detail : null;
    // an identifier the organizer needs to share a sheet with; only ever the connection account's e-mail
    this.serviceAccountEmail = typeof serviceAccountEmail === 'string' && /^[a-z0-9-]{6,30}@[a-z0-9-]{6,30}\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail) ? serviceAccountEmail : null;
  }
}
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const sa = x => (x === null || (typeof x === 'string' && /^[a-z0-9-]{6,30}@[a-z0-9-]{6,30}\.iam\.gserviceaccount\.com$/.test(x)) ? x : (() => { throw new TypeError('bad'); })());
const bad = () => { throw new RegistrationClientError('malformed'); };
const noControl = (t, max) => typeof t === 'string' && t.length <= max && !/[\u0000-\u001f\u007f]/.test(t);

export function parseCapabilities(raw) {
  if (!plain(raw) || typeof raw.fixtureAvailable !== 'boolean' || !['off', 'diagnostic', 'enabled'].includes(raw.googleMode) || typeof raw.googleConfigured !== 'boolean'
    || typeof raw.googleLive !== 'boolean' || raw.readOnly !== true) bad();
  let email; try { email = sa(raw.serviceAccountEmail ?? null); } catch { bad(); }
  return Object.freeze({fixtureAvailable: raw.fixtureAvailable, googleMode: raw.googleMode, googleConfigured: raw.googleConfigured, googleLive: raw.googleLive,
    serviceAccountEmail: email, readOnly: true});
}
export function parseInspect(raw) {
  if (!plain(raw) || !/^[A-Za-z0-9_-]{20,100}$/.test(raw.spreadsheetId ?? '') || !noControl(raw.title, 200) || !Array.isArray(raw.worksheets) || raw.worksheets.length > 200) bad();
  let email; try { email = sa(raw.serviceAccountEmail ?? null); } catch { bad(); }
  const worksheets = raw.worksheets.map(w => { if (!plain(w) || !noControl(w.title, 100) || w.title.length < 1 || typeof w.hidden !== 'boolean') bad(); return Object.freeze({title: w.title, hidden: w.hidden}); });
  return Object.freeze({spreadsheetId: raw.spreadsheetId, title: raw.title, worksheets: Object.freeze(worksheets), serviceAccountEmail: email});
}
const CHECK_IDS = ['google', 'spreadsheet', 'worksheet', 'headers', 'model', 'mapping', 'count'];
export function parseDiagnostic(raw) {
  if (!plain(raw) || typeof raw.ok !== 'boolean' || !(raw.stage === null || CHECK_IDS.includes(raw.stage)) || !Array.isArray(raw.checks) || raw.checks.length > 12
    || !Array.isArray(raw.columns) || raw.columns.length > 60 || !Array.isArray(raw.worksheets) || raw.worksheets.length > 200
    || !Array.isArray(raw.missing) || !Array.isArray(raw.unmatched) || !plain(raw.assessment) || !Array.isArray(raw.assessment.found) || !Array.isArray(raw.assessment.absent)
    || !(raw.responseCount === null || (Number.isSafeInteger(raw.responseCount) && raw.responseCount >= 0))
    || !(raw.spreadsheet === null || (plain(raw.spreadsheet) && noControl(raw.spreadsheet.title, 200)))) bad();
  let email; try { email = sa(raw.serviceAccountEmail ?? null); } catch { bad(); }
  const checks = raw.checks.map(c => { if (!plain(c) || !CHECK_IDS.includes(c.id) || !noControl(c.label, 120) || !['pass', 'fail', 'warn', 'skip'].includes(c.status) || !noControl(c.message, 240)) bad();
    return Object.freeze({id: c.id, label: c.label, status: c.status, message: c.message}); });
  const columns = raw.columns.map(c => { if (!plain(c) || !Number.isSafeInteger(c.index) || c.index < 0 || c.index > 80 || !noControl(c.header, 120)
    || !(c.field === null || FIELD_KEYS.includes(c.field)) || !(c.how === null || ['auto', 'manual'].includes(c.how))) bad();
    return Object.freeze({index: c.index, header: c.header, field: c.field, how: c.how}); });
  const fields = a => { if (!a.every(f => FIELD_KEYS.includes(f))) bad(); return Object.freeze([...a]); };
  return Object.freeze({ok: raw.ok, stage: raw.stage, checks: Object.freeze(checks), serviceAccountEmail: email, spreadsheet: raw.spreadsheet ? Object.freeze({title: raw.spreadsheet.title}) : null,
    worksheets: Object.freeze(raw.worksheets.map(w => { if (!plain(w) || !noControl(w.title, 100) || typeof w.hidden !== 'boolean') bad(); return Object.freeze({title: w.title, hidden: w.hidden}); })),
    worksheet: raw.worksheet === null || noControl(raw.worksheet, 100) ? raw.worksheet : bad(), columns: Object.freeze(columns), missing: fields(raw.missing), unmatched: fields(raw.unmatched),
    assessment: Object.freeze({found: fields(raw.assessment.found), absent: fields(raw.assessment.absent)}), responseCount: raw.responseCount});
}

const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = ['same-email', 'same-phone', 'same-name', 'similar-name'];
/** The Bracket Manager desk's view of an event's registrations: an explicit allowlist with NO contact hints at all, and each
 * registration's roster state as decided by the database. Anything outside the contract throws, so nothing is shown. */
export function parseLookupPayload(raw) {
  const keys = (o, list) => plain(o) && Object.keys(o).length === list.length && list.every(k => k in o);
  if (!keys(raw, ['source', 'sourceName', 'fetchedAt', 'checkInOpen', 'rosterSize', 'registrants', 'duplicates', 'summary', 'warnings'])
    || !['google-sheets', 'synthetic-fixture'].includes(raw.source) || typeof raw.fetchedAt !== 'string' || raw.fetchedAt.length > 40 || typeof raw.checkInOpen !== 'boolean'
    || !Number.isSafeInteger(raw.rosterSize) || !(raw.sourceName === null || (typeof raw.sourceName === 'string' && raw.sourceName.length <= 200 && !looksLikeContact(raw.sourceName)))
    || !Array.isArray(raw.registrants) || raw.registrants.length > 200 || !Array.isArray(raw.duplicates) || raw.duplicates.length > 200 || !Array.isArray(raw.warnings) || raw.warnings.length > 50) bad();
  const seen = new Set();
  const registrants = raw.registrants.map(r => {
    if (!keys(r, ['ref', 'name', 'registeredAt', 'suggestedRating', 'ratingConfidence', 'ratingBasis', 'ratingReview', 'nameIssue', 'duplicate', 'roster'])
      || typeof r.ref !== 'string' || !REF_PATTERN.test(r.ref) || seen.has(r.ref) || typeof r.name !== 'string' || r.name.length < 1 || r.name.length > 120 || looksLikeContact(r.name)
      || typeof r.registeredAt !== 'string' || r.registeredAt.length > 40 || !(r.suggestedRating === null || (Number.isInteger(r.suggestedRating) && r.suggestedRating >= 1 && r.suggestedRating <= 5))
      || !['none', 'low', 'medium', 'high'].includes(r.ratingConfidence) || !Array.isArray(r.ratingBasis) || r.ratingBasis.length > 8
      || !r.ratingBasis.every(b => typeof b === 'string' && b.length <= 120 && !looksLikeContact(b)) || typeof r.ratingReview !== 'boolean'
      || !(r.nameIssue === null || (typeof r.nameIssue === 'string' && r.nameIssue.length <= 120))
      || !(r.duplicate === null || (keys(r.duplicate, ['group', 'reasons', 'strength']) && /^g\d{1,4}$/.test(r.duplicate.group) && Array.isArray(r.duplicate.reasons)
        && r.duplicate.reasons.every(x => REASONS.includes(x)) && ['definite', 'probable', 'possible'].includes(r.duplicate.strength)))
      || !(r.roster === null || (keys(r.roster, ['playerId', 'checkedIn']) && typeof r.roster.playerId === 'string' && UUIDRE.test(r.roster.playerId) && typeof r.roster.checkedIn === 'boolean'))) bad();
    seen.add(r.ref);
    return Object.freeze({ref: r.ref, name: r.name, registeredAt: r.registeredAt, suggestedRating: r.suggestedRating, ratingConfidence: r.ratingConfidence,
      ratingBasis: Object.freeze([...r.ratingBasis]), ratingReview: r.ratingReview, nameIssue: r.nameIssue,
      duplicate: r.duplicate && Object.freeze({group: r.duplicate.group, reasons: Object.freeze([...r.duplicate.reasons]), strength: r.duplicate.strength}),
      roster: r.roster && Object.freeze({playerId: r.roster.playerId.toLowerCase(), checkedIn: r.roster.checkedIn})});
  });
  const duplicates = raw.duplicates.map(d => {
    if (!keys(d, ['id', 'reasons', 'strength', 'refs']) || !/^g\d{1,4}$/.test(d.id) || !Array.isArray(d.reasons) || !d.reasons.every(x => REASONS.includes(x))
      || !['definite', 'probable', 'possible'].includes(d.strength) || !Array.isArray(d.refs) || d.refs.length < 2 || !d.refs.every(x => seen.has(x))) bad();
    return Object.freeze({id: d.id, reasons: Object.freeze([...d.reasons]), strength: d.strength, refs: Object.freeze([...d.refs])});
  });
  const counts = ['total', 'duplicateGroups', 'needsNameFix', 'lowConfidence', 'needsRating'];
  if (!plain(raw.summary) || !counts.every(k => Number.isInteger(raw.summary[k]))) bad();
  return Object.freeze({source: raw.source, sourceName: raw.sourceName, fetchedAt: raw.fetchedAt, checkInOpen: raw.checkInOpen, rosterSize: raw.rosterSize,
    registrants: Object.freeze(registrants), duplicates: Object.freeze(duplicates), summary: Object.freeze(Object.fromEntries(counts.map(k => [k, raw.summary[k]]))),
    warnings: Object.freeze(raw.warnings.map(w => String(w).slice(0, 200)))});
}
/** The Function's answer to one desk check-in. */
export function parseCheckinResult(raw) {
  if (!plain(raw) || Object.keys(raw).length !== 4 || !['saved', 'unchanged'].includes(raw.status) || !['created', 'linked', 'existing'].includes(raw.outcome)
    || typeof raw.playerId !== 'string' || !UUIDRE.test(raw.playerId) || !Number.isSafeInteger(raw.eventRevision)) bad();
  return Object.freeze({status: raw.status, outcome: raw.outcome, playerId: raw.playerId.toLowerCase(), eventRevision: raw.eventRevision});
}

export function createRegistrationClient({fetchImpl, endpoint = '/api/registrations'} = {}) {
  if (typeof fetchImpl !== 'function' || !/^\/[a-z0-9/_-]{1,60}$/.test(endpoint)) throw new RegistrationClientError('malformed');
  async function post(token, eventId, action, extra, parse) {
    if (typeof token !== 'string' || !JWT.test(token) || token.length > 10000) throw new RegistrationClientError('access-rejected');
    if (typeof eventId !== 'string' || !UUID.test(eventId)) throw new RegistrationClientError('malformed');
    let res;
    try {
      res = await fetchImpl(endpoint, {method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({action, event_id: eventId, ...extra})});
    } catch { throw new RegistrationClientError('network'); }
    if (res?.status === 200) {
      try { return parse(await res.json()); } catch (e) { throw e instanceof RegistrationClientError ? e : new RegistrationClientError('malformed'); }
    }
    let code = null, email = null, detailText = null;
    try { const j = await res.json(); code = j?.error ?? null; email = j?.serviceAccountEmail ?? null; detailText = typeof j?.detail === 'string' ? j.detail : null; } catch { /* generic */ }
    const err = kind => new RegistrationClientError(kind, {serviceAccountEmail: email, detail: detailText});
    if (['registration-not-found', 'name-incomplete', 'level-required', 'registration-not-duplicate', 'registration-invalid', 'outcome-unknown', 'conflict'].includes(code)) throw err(code);
    switch (res?.status) {
      case 400: throw err(code === 'invalid-spreadsheet' ? 'invalid-spreadsheet' : 'malformed');
      case 401: throw err('access-rejected');
      case 403: throw err(code === 'event-not-enabled' ? 'not-enabled' : code === 'source-disabled' ? 'source-disabled' : code === 'google-not-allowed' ? 'not-allowed-here' : 'forbidden');
      case 404: case 405: throw err('not-configured');
      case 429: throw err('rate-limited');
      case 503: throw err(code === 'registration-not-configured' ? 'not-configured' : code === 'source-busy' ? 'source-busy' : 'source-unavailable');
      case 502: throw err({'source-unauthorized': 'source-unauthorized', 'source-not-found': 'source-not-found', 'source-worksheet': 'source-worksheet',
        'source-columns': 'source-columns', 'source-auth': 'source-auth'}[code] ?? 'source-unavailable');
      default: throw err('source-unavailable');
    }
  }
  return Object.freeze({
    /** Read-only. Resolves with a validated payload or throws RegistrationClientError. */
    load: (token, {eventId} = {}) => post(token, eventId, 'load', {}, parseRegistrationPayload),
    /** What this deployment can do (no data): fixture, Google mode, the e-mail to share a sheet with. */
    capabilities: (token, {eventId} = {}) => post(token, eventId, 'capabilities', {}, parseCapabilities),
    /** Spreadsheet title + worksheet names for a pasted link or id. */
    inspect: (token, {eventId, spreadsheet} = {}) => post(token, eventId, 'inspect', {spreadsheet}, parseInspect),
    /** The read-only connection diagnostic (readiness only, never rows). */
    test: (token, {eventId, spreadsheet, worksheet, mapping = {}} = {}) => post(token, eventId, 'test', {spreadsheet, worksheet, mapping}, parseDiagnostic),
    /** Bracket Manager only: this event's registrations reduced for the desk (no contact hints). */
    lookup: (token, {eventId} = {}) => post(token, eventId, 'lookup', {}, parseLookupPayload),
    /** Bracket Manager only: check one registration in by its opaque reference (names and levels are never sent). `level` is an optional 1-5 override. */
    checkin: async (token, {eventId, ref, mergeRefs = [], level = null, linkPlayerId = null} = {}) => {
      if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) throw new RegistrationClientError('malformed');
      return post(token, eventId, 'checkin', {ref, ...(mergeRefs.length ? {merge_refs: mergeRefs} : {}), ...(level === null ? {} : {level}),
        ...(linkPlayerId ? {link_player_id: linkPlayerId} : {})}, parseCheckinResult);
    },
  });
}
