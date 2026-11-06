/** Registration adapter request handler (SERVER-SIDE, runtime-agnostic: Cloudflare Pages Functions, Node, tests).
 *
 *   POST /api/registrations   Authorization: Bearer <the signed-in person's own Supabase access token>
 *     {"action":"load","event_id":uuid}                                      -> the event's registrants (default action)
 *     {"action":"capabilities","event_id":uuid}                              -> what this deployment can do (no data)
 *     {"action":"inspect","event_id":uuid,"spreadsheet":"<url or id>"}       -> spreadsheet title + worksheet names
 *     {"action":"test","event_id":uuid,"spreadsheet","worksheet","mapping"}  -> read-only connection diagnostic (no rows)
 *   Bracket Manager (event-day desk) only:
 *     {"action":"lookup","event_id":uuid}                                    -> the event's registrants, reduced for the desk
 *     {"action":"checkin","event_id":uuid,"ref","merge_refs"?,"level"?,"link_player_id"?} -> check one registration in
 *
 * Contract:
 *  - ORGANIZER ONLY (load, capabilities, inspect, test), EVENT-SCOPED. The caller's own token is checked against the Supabase project on every request: the
 *    session must be valid (/auth/v1/user) AND the database must report the caller's CURRENT role for THAT event as
 *    `organizer` (fftt_staff_role_v1). The event's saved registration source is then read from the database under the
 *    same token (fftt_registration_source_v5, itself organizer-only for that event). The server never takes a spreadsheet
 *    id from the request for `load`: it reads the sheet the event's organizer saved. A signed-in organizer who substitutes
 *    another event's id is refused by the database check, so no other event's sheet or registrations are reachable.
 *  - BRACKET MANAGER (lookup, checkin) is a SEPARATE, narrower grant: the database must report the caller's CURRENT role for THAT
 *    event as `bracket_manager`. The saved source is read through fftt_bm_registration_lookup_v1, which only answers with a
 *    short-lived HMAC proof this Function makes (the browser never holds one), so the source's sheet details never reach the
 *    desk and the source RPC stays Organizer-only. A check-in names a registration by its opaque reference ONLY: the Function
 *    re-reads the event's own enabled sheet, finds that reference, and sends the database the name and level IT read, signed
 *    (fftt_bm_registration_checkin_v1 verifies the signature, the source and the roster). Nothing the browser says about a
 *    name or a rating is ever used. Scorekeepers, unassigned or revoked staff and other events are refused by the same checks.
 *  - READ-ONLY, CONTROLLED EGRESS. Outbound requests go through edge_fetch: https only, fixed hosts (the pinned Supabase
 *    project, Google's token endpoint and the Sheets API). Google access is the single scope spreadsheets.readonly.
 *  - FAIL CLOSED. Not configured, not allowed, disabled or unreadable -> a generic, sanitized answer. A live Google source
 *    is NEVER served for a synthetic (fictional) event, and only when the deployment mode is `enabled`.
 *  - NO CONTACT DATA LEAVES. Rows are reduced by the registration model to an allowlisted, masked shape. Raw rows are
 *    never returned, never logged, and only the reduced result is cached (20 s, per event + sheet + tab + mapping).
 *  - Same-origin only: the single approved staff origin may call it; there is no wildcard CORS.
 *
 * Deployment settings (Cloudflare Pages Function variables/secrets): REGISTRATION_ENABLED, STAFF_ORIGIN, SUPABASE_URL,
 * SUPABASE_PUBLISHABLE_KEY; REGISTRATION_FIXTURE (or the legacy REGISTRATION_SOURCE=synthetic-fixture) allows the fictional
 * demo source; REGISTRATION_GOOGLE_MODE = off | diagnostic | enabled (default off) with the secrets GOOGLE_SA_EMAIL and
 * GOOGLE_SA_PRIVATE_KEY (and, for `enabled`, REGISTRATION_REF_SECRET). Bracket Manager lookup/check-in additionally needs
 * REGISTRATION_GATE_SECRET (32+ characters, the same value the database holds); without it those two actions answer
 * `registration-not-configured`. There is NO per-event deployment setting: an event is eligible through its own saved,
 * enabled source and the caller's current role. */
import {C3_HOST} from '../../contracts/phase1c_c3_readonly_supabase_transport.mjs';
import {REF_PATTERN, buildRegistrants, looksLikeContact, mapHeaders, parseCsv, parseRegistrationPayload} from '../../contracts/registration_model.mjs';
import {cleanMapping, mappingKey, parseSourceRecord, parseSpreadsheetRef, validWorksheetTitle} from '../../contracts/registration_source.mjs';
import {createGoogleSheetsReader, createRefMaker, RegistrationSourceError} from './google_sheets.mjs';
import {createEdgeFetch, EDGE_HOSTS} from './edge_fetch.mjs';
import {SYNTHETIC_FORM_CSV} from './synthetic_fixture.mjs';
import {checkinFields, createGate, sourceFingerprint} from './gate.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const KEY = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;
// A dedicated *.pages.dev project, or the one exact permanent production staff hostname (never a wildcard or sibling subdomain).
const STAFF_ORIGIN = /^https:\/\/(?:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev|fftt-staff\.clslifestyle\.com)$/;
const CACHE_MS = 20_000, CACHE_MAX = 24, RATE_WINDOW_MS = 60_000, RATE_MAX = 30;
const FIXTURE_SECRET = 'synthetic-fixture-reference-secret-0001';   // fictional data only: not a secret
const ACTION_KEYS = Object.freeze({load: ['event_id'], capabilities: ['event_id'], inspect: ['event_id', 'spreadsheet'], test: ['event_id', 'spreadsheet', 'worksheet', 'mapping'],
  lookup: ['event_id'], checkin: ['event_id', 'ref', 'merge_refs', 'level', 'link_player_id']});
// the one role each action needs for the event; nothing is shared between the two grants
const ROLE_FOR = Object.freeze({load: 'organizer', capabilities: 'organizer', inspect: 'organizer', test: 'organizer', lookup: 'bracket_manager', checkin: 'bracket_manager'});
// the only database refusals a check-in may explain to the desk (anything else is a generic failure)
const CHECKIN_CONFLICTS = Object.freeze(['bracket-locked', 'lifecycle', 'duplicate-name', 'roster-full', 'already-linked', 'source-not-enabled', 'source-changed', 'link-name-mismatch']);
const LOOKUP_KEYS = ['configured', 'event_synthetic', 'kind', 'spreadsheet_id', 'spreadsheet_title', 'worksheet', 'column_map', 'enabled', 'source_fp', 'check_in_open', 'roster_size', 'links'];

/** A check-in the Function itself refuses or the database refused (a sanitized status + code, never data). */
class CheckinRefusal extends Error {
  constructor(status, error, detail = null) { super(error); this.status = status; this.error = error; this.detail = detail; }
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', ...headers}});
const refuse = (status, error, headers, extra = {}) => json(status, {error, ...extra}, headers);

/** `state` lets a long-lived isolate share the rate counters, the short cache and the Google token across requests. */
export const createHandlerState = () => ({rate: new Map(), cache: new Map(), reader: null});

const safeHeader = h => { const t = String(h ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); return looksLikeContact(t) ? '(hidden)' : t; };

export function createRegistrationHandler({env = {}, fetchImpl, now = () => Date.now(), state = createHandlerState()} = {}) {
  const cfg = readConfig(env);
  const rate = state.rate;
  const edge = typeof fetchImpl === 'function' ? createEdgeFetch(fetchImpl, {hosts: [new URL(C3_HOST).hostname, ...EDGE_HOSTS.filter(h => !h.endsWith('.supabase.co'))]}) : null;

  function readConfig(e) {
    if (e.REGISTRATION_ENABLED !== 'true' || !STAFF_ORIGIN.test(e.STAFF_ORIGIN ?? '') || e.SUPABASE_URL !== C3_HOST
      || !KEY.test(e.SUPABASE_PUBLISHABLE_KEY ?? '')) return null;
    const mode = ['off', 'diagnostic', 'enabled'].includes(e.REGISTRATION_GOOGLE_MODE) ? e.REGISTRATION_GOOGLE_MODE : 'off';
    const credentials = typeof e.GOOGLE_SA_EMAIL === 'string' && typeof e.GOOGLE_SA_PRIVATE_KEY === 'string' && e.GOOGLE_SA_PRIVATE_KEY.includes('BEGIN PRIVATE KEY');
    const refSecret = typeof e.REGISTRATION_REF_SECRET === 'string' && e.REGISTRATION_REF_SECRET.length >= 32 ? e.REGISTRATION_REF_SECRET : null;
    return {
      staffOrigin: e.STAFF_ORIGIN, publishableKey: e.SUPABASE_PUBLISHABLE_KEY,
      fixture: e.REGISTRATION_FIXTURE === 'true' || e.REGISTRATION_SOURCE === 'synthetic-fixture',
      googleMode: credentials ? mode : 'off', googleRequested: mode, sa: e.GOOGLE_SA_EMAIL, key: e.GOOGLE_SA_PRIVATE_KEY, credentials,
      // Event eligibility comes from the event-scoped saved source and current role, not deployment configuration.
      googleLive: mode === 'enabled' && credentials && refSecret !== null, refSecret,
      gate: createGate(e.REGISTRATION_GATE_SECRET, {now}),
    };
  }

  async function supa(path, token, body) {
    try {
      return await edge(C3_HOST + path, {method: body === undefined ? 'GET' : 'POST',
        headers: {apikey: cfg.publishableKey, Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        body: body === undefined ? undefined : JSON.stringify(body)});
    } catch { return null; }
  }

  async function authorize(token, eventId, wanted) {
    const who = await supa('/auth/v1/user', token);
    if (!who) return {error: refuse(503, 'service-unavailable')};
    if (who.status === 401 || who.status === 403) return {error: refuse(401, 'access-rejected')};
    if (who.status !== 200) return {error: refuse(503, 'service-unavailable')};
    let user; try { user = await who.json(); } catch { return {error: refuse(503, 'service-unavailable')}; }
    if (typeof user?.id !== 'string' || !UUID.test(user.id) || user.is_anonymous === true) return {error: refuse(401, 'access-rejected')};
    const role = await supa('/rest/v1/rpc/fftt_staff_role_v1', token, {p_event_id: eventId});
    if (!role) return {error: refuse(503, 'service-unavailable')};
    if (role.status === 401) return {error: refuse(401, 'access-rejected')};
    if (role.status === 403 || role.status === 400) return {error: refuse(403, 'forbidden')};
    if (role.status !== 200) return {error: refuse(503, 'service-unavailable')};
    let r; try { r = await role.json(); } catch { return {error: refuse(503, 'service-unavailable')}; }
    if (r !== wanted) return {error: refuse(403, 'forbidden')};
    return {userId: user.id.toLowerCase()};
  }

  /** The event's saved source, read from the database under the caller's own token (organizer-only for that event). */
  async function savedSource(token, eventId) {
    const res = await supa('/rest/v1/rpc/fftt_registration_source_v5', token, {p_event_id: eventId});
    if (!res) throw new RegistrationSourceError('unavailable');
    if (res.status === 401 || res.status === 403) throw new RegistrationSourceError('invalid-source');
    if (res.status === 404) throw new RegistrationSourceError('not-configured');     // the V5 database objects are not there
    if (res.status !== 200) throw new RegistrationSourceError('unavailable');
    try { return parseSourceRecord(await res.json()); } catch { throw new RegistrationSourceError('malformed'); }
  }
  /** Best effort and informational only (a counter and an outcome code, never data); a failure here changes nothing. */
  async function recordCheck(token, eventId, status, error, count) {
    try { await supa('/rest/v1/rpc/fftt_record_registration_check_v5', token, {p_event_id: eventId, p_status: status, p_error: error, p_count: count}); } catch { /* informational */ }
  }

  function rateLimited(userId) {
    const t = now();
    const hits = (rate.get(userId) ?? []).filter(x => t - x < RATE_WINDOW_MS);
    if (hits.length >= RATE_MAX) { rate.set(userId, hits); return true; }
    hits.push(t); rate.set(userId, hits);
    if (rate.size > 500) for (const [k, v] of rate) if (v.every(x => t - x >= RATE_WINDOW_MS)) rate.delete(k);
    return false;
  }

  function reader() {
    if (!cfg.credentials) throw new RegistrationSourceError('not-configured');
    const key = cfg.sa + '|' + cfg.key.length;
    // one reader per isolate: it keeps the short-lived OAuth token, so a read does not re-sign and re-authorize every time
    if (state.reader?.key !== key) state.reader = {key, value: createGoogleSheetsReader({serviceAccountEmail: cfg.sa, privateKeyPem: cfg.key, fetchImpl: edge, now})};
    return state.reader.value;
  }

  const cacheGet = key => { const c = state.cache.get(key); return c && now() - c.at < CACHE_MS ? c.payload : null; };
  const cachePut = (key, payload) => {
    state.cache.set(key, {at: now(), payload});
    if (state.cache.size > CACHE_MAX) for (const [k, v] of state.cache) if (now() - v.at >= CACHE_MS || state.cache.size > CACHE_MAX) state.cache.delete(k);
  };

  // ------------------------------------------------------------ actions
  /** Organizer: the saved source is read under the caller's own token (organizer-only RPC) and a live read is noted for the status panel. */
  async function doLoad(eventId, token) {
    return readPayload(eventId, await savedSource(token, eventId), async count => recordCheck(token, eventId, 'ready', null, count));
  }

  /** Reads the registrants of one event's source (shared by both roles). `onLiveRead` runs after a successful live Google read only. */
  async function readPayload(eventId, src, onLiveRead = null) {
    let kind, rows, refScope, cacheKey, name = null, mapping = {};
    if (!src.configured || src.kind === 'fixture') {
      // the fictional demo source: only for synthetic events and only where the deployment allows it
      if (!cfg.fixture || !src.eventSynthetic) throw new RegistrationSourceError('not-configured');
      kind = 'synthetic-fixture'; refScope = `event:${eventId}|fixture`; cacheKey = `${eventId}|fixture`;
      rows = parseCsv(SYNTHETIC_FORM_CSV); name = 'Sample sign-up form (fictional)';
    } else {
      if (!src.enabled) throw new RegistrationSourceError('disabled');
      if (src.eventSynthetic || cfg.googleMode !== 'enabled') throw new RegistrationSourceError('not-allowed');
      if (!cfg.googleLive) throw new RegistrationSourceError('not-configured');
      kind = 'google-sheets'; mapping = src.columnMap; name = src.spreadsheetTitle;
      refScope = `event:${eventId}|sheet:${src.spreadsheetId}`;
      cacheKey = `${eventId}|${src.spreadsheetId}|${src.worksheet}|${mappingKey(mapping)}`;
    }
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
    if (kind === 'google-sheets') rows = await reader().readRows(src.spreadsheetId, src.worksheet);
    if (mapHeaders(rows[0] ?? [], mapping).missing.length) throw new RegistrationSourceError('columns');
    const refFor = createRefMaker(kind === 'google-sheets' ? cfg.refSecret : FIXTURE_SECRET, refScope);
    const built = await buildRegistrants(rows, {refFor, mapping});
    // a sheet TITLE is organizer-chosen text: it is shown only when it cannot be mistaken for a contact detail (a date such as 2026-11-22 looks like a phone number)
    if (name !== null && looksLikeContact(name)) name = null;
    const payload = parseRegistrationPayload({source: kind, sourceName: name, fetchedAt: new Date(now()).toISOString(), ...built});
    cachePut(cacheKey, payload);
    if (kind === 'google-sheets' && onLiveRead) await onLiveRead(payload.registrants.length);
    return payload;
  }

  // ------------------------------------------------------------ Bracket Manager: lookup and check-in
  /** The database's answer to a proof-bearing lookup: the event's saved source, check-in state and opaque ref -> roster links. */
  async function bmContext(token, eventId, userId) {
    if (!cfg.gate) throw new RegistrationSourceError('not-configured');
    const {exp, proof} = await cfg.gate.sign('lookup', eventId, userId);
    const res = await supa('/rest/v1/rpc/fftt_bm_registration_lookup_v1', token, {p_event_id: eventId, p_exp: exp, p_proof: proof});
    if (!res) throw new RegistrationSourceError('unavailable');
    if (res.status === 401) throw new RegistrationSourceError('access-rejected');
    if (res.status === 403) throw new RegistrationSourceError('forbidden');
    if (res.status === 404) throw new RegistrationSourceError('not-configured');      // the database objects are not installed (or were rolled back)
    if (res.status !== 200) throw new RegistrationSourceError('unavailable');
    try {
      const raw = await res.json();
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !LOOKUP_KEYS.includes(k))) throw new TypeError('shape');
      const src = parseSourceRecord(raw.configured
        ? {configured: true, event_synthetic: raw.event_synthetic, kind: raw.kind, spreadsheet_id: raw.spreadsheet_id, spreadsheet_title: raw.spreadsheet_title, worksheet: raw.worksheet,
          column_map: raw.column_map, enabled: raw.enabled, status: 'untested', last_error: null, last_checked_at: null, last_ok_at: null, last_response_count: null, updated_at: null}
        : {configured: false, event_synthetic: raw.event_synthetic});
      if (typeof raw.check_in_open !== 'boolean' || !Number.isSafeInteger(raw.roster_size) || !Array.isArray(raw.links) || raw.links.length > 5000
        || typeof raw.source_fp !== 'string' || raw.source_fp !== await sourceFingerprint(src)) throw new TypeError('shape');
      const links = new Map();
      for (const l of raw.links) {
        if (l === null || typeof l !== 'object' || typeof l.ref !== 'string' || !REF_PATTERN.test(l.ref) || typeof l.player_id !== 'string' || !UUID.test(l.player_id)
          || typeof l.checked_in !== 'boolean') throw new TypeError('shape');
        links.set(l.ref, Object.freeze({playerId: l.player_id.toLowerCase(), checkedIn: l.checked_in}));
      }
      return {src, links, checkInOpen: raw.check_in_open, rosterSize: raw.roster_size, fingerprint: raw.source_fp};
    } catch { throw new RegistrationSourceError('malformed'); }
  }

  /** What the desk may see of a registration: no contact hints, no short name, no raw anything. */
  const deskRegistrant = (r, links) => ({ref: r.ref, name: r.name, registeredAt: r.registeredAt, suggestedRating: r.suggestedRating, ratingConfidence: r.ratingConfidence,
    ratingBasis: [...r.ratingBasis], ratingReview: r.ratingReview, nameIssue: r.nameIssue,
    duplicate: r.duplicate ? {group: r.duplicate.group, reasons: [...r.duplicate.reasons], strength: r.duplicate.strength} : null,
    roster: links.get(r.ref) ?? null});

  async function doLookup(eventId, token, userId) {
    const ctx = await bmContext(token, eventId, userId);
    const p = await readPayload(eventId, ctx.src);
    return {source: p.source, sourceName: p.sourceName, fetchedAt: p.fetchedAt, checkInOpen: ctx.checkInOpen, rosterSize: ctx.rosterSize,
      registrants: p.registrants.map(r => deskRegistrant(r, ctx.links)),
      duplicates: p.duplicates.map(d => ({id: d.id, reasons: [...d.reasons], strength: d.strength, refs: [...d.refs]})),
      summary: {total: p.summary.total, duplicateGroups: p.summary.duplicateGroups, needsNameFix: p.summary.needsNameFix, lowConfidence: p.summary.lowConfidence, needsRating: p.summary.needsRating},
      warnings: [...p.warnings]};
  }

  /** One registration (plus, optionally, its duplicate submissions) checked in. Names, levels and references come from the sheet, never the browser. */
  async function doCheckin(eventId, token, userId, req) {
    const ctx = await bmContext(token, eventId, userId);
    if (!ctx.checkInOpen) throw new CheckinRefusal(409, 'conflict', 'check-in-closed');
    const p = await readPayload(eventId, ctx.src);
    const byRef = new Map(p.registrants.map(r => [r.ref, r]));
    const primary = byRef.get(req.ref);
    if (!primary) throw new CheckinRefusal(404, 'registration-not-found');
    if (primary.nameIssue) throw new CheckinRefusal(422, 'name-incomplete');
    const level = req.level ?? primary.suggestedRating;
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new CheckinRefusal(422, 'level-required');
    const merged = [];
    for (const ref of req.mergeRefs) {
      const other = byRef.get(ref);
      // only a registration the model itself grouped with this one can be merged into it
      if (!other || !primary.duplicate || other.duplicate?.group !== primary.duplicate.group) throw new CheckinRefusal(422, 'registration-not-duplicate');
      merged.push(other);
    }
    const items = [{ref: primary.ref, name: primary.name, rating: level, ...(req.linkPlayerId ? {link_player_id: req.linkPlayerId} : {})},
      ...merged.map(o => ({ref: o.ref, name: o.name, rating: level, same_as_ref: primary.ref}))];
    const {exp, proof} = await cfg.gate.sign('checkin', eventId, userId, checkinFields(ctx.fingerprint, items));
    const res = await supa('/rest/v1/rpc/fftt_bm_registration_checkin_v1', token, {p_event_id: eventId, p_items: items, p_source_fp: ctx.fingerprint, p_exp: exp, p_proof: proof});
    // no answer at all: the request may or may not have been applied, so the desk is told to verify rather than retry blindly
    if (!res) throw new CheckinRefusal(503, 'outcome-unknown');
    if (res.status === 200) {
      let r; try { r = await res.json(); } catch { throw new CheckinRefusal(503, 'outcome-unknown'); }
      if (r === null || typeof r !== 'object' || !['saved', 'unchanged'].includes(r.status) || !['created', 'linked', 'existing'].includes(r.outcome)
        || typeof r.player_id !== 'string' || !UUID.test(r.player_id) || !Number.isSafeInteger(r.event_revision)) throw new CheckinRefusal(503, 'outcome-unknown');
      return {status: r.status, outcome: r.outcome, playerId: r.player_id.toLowerCase(), eventRevision: r.event_revision};
    }
    if (res.status === 401) throw new CheckinRefusal(401, 'access-rejected');
    if (res.status === 404) throw new CheckinRefusal(503, 'registration-not-configured');
    if (res.status >= 500) throw new CheckinRefusal(503, 'outcome-unknown');
    let body = null; try { body = await res.json(); } catch { /* generic */ }
    if (res.status === 403 || body?.code === '42501') throw new CheckinRefusal(403, 'forbidden');
    if (body?.code === '22023') throw new CheckinRefusal(422, 'registration-invalid');
    if (body?.code === 'P0001' && CHECKIN_CONFLICTS.includes(body?.details)) throw new CheckinRefusal(409, 'conflict', body.details);
    throw new CheckinRefusal(502, 'source-unavailable');
  }

  function needGoogle() {
    if (cfg.googleMode === 'off' || !cfg.credentials) throw new RegistrationSourceError('not-configured');
  }
  async function doCapabilities() {
    return {fixtureAvailable: cfg.fixture, googleMode: cfg.googleMode, googleConfigured: cfg.credentials,
      googleLive: cfg.googleLive, serviceAccountEmail: cfg.credentials ? cfg.sa : null, readOnly: true};
  }
  async function doInspect(spreadsheetId) {
    needGoogle();
    const r = reader();
    await r.authenticate();
    const info = await r.info(spreadsheetId);
    return {spreadsheetId, title: info.title, worksheets: info.worksheets.map(w => ({title: w.title, hidden: w.hidden})), serviceAccountEmail: cfg.sa};
  }
  /** Read-only connection diagnostic. Returns only readiness information: step results, header TEXT and how each was
   * mapped, and a response COUNT. It never returns a cell value, and a failure at any step is a sanitized message. */
  async function doTest(eventId, token, spreadsheetId, worksheet, mapping) {
    needGoogle();
    const r = reader();
    const out = {ok: false, stage: null, checks: [], serviceAccountEmail: cfg.sa, spreadsheet: null, worksheets: [], worksheet, columns: [], missing: [], unmatched: [],
      assessment: {found: [], absent: []}, responseCount: null, mode: cfg.googleMode};
    const step = (id, label, status, message) => { out.checks.push({id, label, status, message}); if (status === 'fail' && out.stage === null) out.stage = id; };
    const MSG = {unauthorized: 'This sheet is not shared with the connection account. Share it with the e-mail shown, as Viewer.', 'google-auth': 'The connection account could not sign in to Google. Ask the administrator.',
      'not-found': 'No spreadsheet was found with that link or ID.', 'worksheet-not-found': 'That worksheet (tab) was not found.', busy: 'Google asked us to slow down. Try again in a minute.',
      unavailable: 'Google could not be reached right now.', malformed: 'Google answered in an unexpected form.', 'not-configured': 'The Google connection is not set up on this site.'};
    const fail = (id, label, e) => step(id, label, 'fail', MSG[e instanceof RegistrationSourceError ? e.kind : 'unavailable'] ?? MSG.unavailable);
    let finalError = null;
    try { await r.authenticate(); step('google', 'Signed in to Google (read-only access)', 'pass', 'The connection account signed in.'); }
    catch (e) { fail('google', 'Signed in to Google (read-only access)', e); finalError = e; }
    let info = null;
    if (!finalError) {
      try { info = await r.info(spreadsheetId); out.spreadsheet = {title: info.title}; out.worksheets = info.worksheets.map(w => ({title: w.title, hidden: w.hidden})); step('spreadsheet', 'Spreadsheet opened', 'pass', `Found “${info.title}”.`); }
      catch (e) { fail('spreadsheet', 'Spreadsheet opened', e); finalError = e; }
    } else step('spreadsheet', 'Spreadsheet opened', 'skip', 'Skipped.');
    if (info) {
      if (info.worksheets.some(w => w.title === worksheet)) step('worksheet', 'Worksheet found', 'pass', `The “${worksheet}” tab exists.`);
      else { step('worksheet', 'Worksheet found', 'fail', MSG['worksheet-not-found']); finalError = new RegistrationSourceError('worksheet-not-found'); }
    } else step('worksheet', 'Worksheet found', 'skip', 'Skipped.');
    if (info && !finalError) {
      try {
        const head = await r.readRows(spreadsheetId, worksheet, {headerOnly: true});
        const m = mapHeaders(head[0] ?? [], mapping);
        out.columns = m.columns.filter(c => c.header !== '').slice(0, 60).map(c => ({index: c.index, header: safeHeader(c.header), field: c.field, how: c.how}));
        out.missing = m.missing; out.unmatched = m.unmatched; out.assessment = m.assessment;
        if (head.length === 0) step('headers', 'Header row read', 'fail', 'The worksheet has no header row.');
        else step('headers', 'Header row read', 'pass', `${out.columns.length} columns found.`);
        if (m.missing.length) { step('model', 'Compatible with the registration model', 'fail', 'No column could be used for the player\'s name. Choose one in the column mapping.'); finalError = new RegistrationSourceError('columns'); }
        else step('model', 'Compatible with the registration model', 'pass',
          m.assessment.found.length ? `Name found; ${m.assessment.found.length} of ${m.assessment.found.length + m.assessment.absent.length} playing-assessment columns recognized.`
            : 'Name found. No playing-assessment columns were recognized, so levels will need your review.');
        if (m.unmatched.length) step('mapping', 'Chosen columns still exist', 'warn', `${m.unmatched.length} chosen column${m.unmatched.length === 1 ? ' is' : 's are'} no longer in the sheet.`);
      } catch (e) { fail('headers', 'Header row read', e); step('model', 'Compatible with the registration model', 'skip', 'Skipped.'); finalError = e; }
      if (!finalError) {
        try { out.responseCount = await r.countResponses(spreadsheetId, worksheet); step('count', 'Responses counted', 'pass', `${out.responseCount} response${out.responseCount === 1 ? '' : 's'} (a count only; no answers were read).`); }
        catch (e) { fail('count', 'Responses counted', e); }
      }
    } else { step('headers', 'Header row read', 'skip', 'Skipped.'); step('model', 'Compatible with the registration model', 'skip', 'Skipped.'); }
    out.ok = out.checks.every(c => c.status !== 'fail');
    // record the outcome only when it is the event's own saved sheet (informational: an outcome code and a count)
    try {
      const saved = await savedSource(token, eventId);
      if (saved.configured && saved.kind === 'google-sheets' && saved.spreadsheetId === spreadsheetId && saved.worksheet === worksheet) {
        const kind = finalError instanceof RegistrationSourceError ? finalError.kind : (out.ok ? null : 'unavailable');
        await recordCheck(token, eventId, out.ok ? (out.unmatched.length || out.assessment.found.length === 0 ? 'needs-attention' : 'ready') : 'failed', out.ok ? null : kind, out.responseCount);
      }
    } catch { /* informational */ }
    return out;
  }

  function failure(e, cors) {
    if (e instanceof CheckinRefusal) return refuse(e.status, e.error, cors, e.detail ? {detail: e.detail} : {});
    if (!(e instanceof RegistrationSourceError)) return refuse(502, 'source-unavailable', cors);
    const sa = cfg.credentials ? {serviceAccountEmail: cfg.sa} : {};
    switch (e.kind) {
      case 'not-configured': return refuse(503, 'registration-not-configured', cors);
      case 'disabled': return refuse(403, 'source-disabled', cors);
      case 'not-allowed': return refuse(403, 'google-not-allowed', cors);
      case 'unauthorized': return refuse(502, 'source-unauthorized', cors, sa);
      case 'google-auth': return refuse(502, 'source-auth', cors);
      case 'not-found': return refuse(502, 'source-not-found', cors, sa);
      case 'worksheet-not-found': return refuse(502, 'source-worksheet', cors);
      case 'columns': return refuse(502, 'source-columns', cors);
      case 'invalid-source': return refuse(400, 'bad-request', cors);
      case 'forbidden': return refuse(403, 'forbidden', cors);
      case 'access-rejected': return refuse(401, 'access-rejected', cors);
      case 'busy': return refuse(503, 'source-busy', {...cors, 'retry-after': String(e.retryAfterSeconds ?? 30)});
      default: return refuse(502, 'source-unavailable', cors);
    }
  }

  return async function handle(request) {
    if (!cfg || !edge) return refuse(503, 'registration-not-configured');
    const origin = request.headers.get('origin');
    const cors = origin === cfg.staffOrigin ? {'access-control-allow-origin': origin, vary: 'Origin'} : {};
    if (request.method === 'OPTIONS') {
      return origin === cfg.staffOrigin
        ? new Response(null, {status: 204, headers: {...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600', 'cache-control': 'no-store'}})
        : refuse(403, 'forbidden');
    }
    if (request.method !== 'POST') return refuse(405, 'method-not-allowed', {allow: 'POST', ...cors});
    if (origin !== null && origin !== cfg.staffOrigin) return refuse(403, 'forbidden');
    if (new URL(request.url).origin !== cfg.staffOrigin) return refuse(404, 'not-found');   // the spectator origin never answers
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!JWT.test(token) || token.length > 10000) return refuse(401, 'access-rejected', cors);
    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return refuse(415, 'unsupported', cors);
    let body;
    try { const text = await request.text(); if (text.length > 4096) return refuse(413, 'too-large', cors); body = JSON.parse(text); } catch { return refuse(400, 'bad-request', cors); }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'bad-request', cors);
    const action = body.action === undefined ? 'load' : body.action;
    const {action: _a, ...rest} = body;
    if (typeof action !== 'string' || !Object.hasOwn(ACTION_KEYS, action) || Object.keys(rest).some(k => !ACTION_KEYS[action].includes(k))
      || typeof rest.event_id !== 'string' || !UUID.test(rest.event_id)) return refuse(400, 'bad-request', cors);
    const eventId = rest.event_id.toLowerCase();
    let spreadsheetId = null, worksheet = null, mapping = {};
    const req = {ref: null, mergeRefs: [], level: null, linkPlayerId: null};
    if (action === 'checkin') {
      const merge = rest.merge_refs === undefined ? [] : rest.merge_refs;
      if (typeof rest.ref !== 'string' || !REF_PATTERN.test(rest.ref) || !Array.isArray(merge) || merge.length > 5 || new Set(merge).size !== merge.length
        || merge.some(x => typeof x !== 'string' || !REF_PATTERN.test(x) || x === rest.ref)
        || !(rest.level === undefined || rest.level === null || (Number.isInteger(rest.level) && rest.level >= 1 && rest.level <= 5))
        || !(rest.link_player_id === undefined || rest.link_player_id === null || (typeof rest.link_player_id === 'string' && UUID.test(rest.link_player_id)))) return refuse(400, 'bad-request', cors);
      req.ref = rest.ref; req.mergeRefs = merge; req.level = rest.level ?? null; req.linkPlayerId = rest.link_player_id ? rest.link_player_id.toLowerCase() : null;
    }
    if (action === 'inspect' || action === 'test') {
      spreadsheetId = parseSpreadsheetRef(rest.spreadsheet);
      if (spreadsheetId === null) return refuse(400, 'invalid-spreadsheet', cors);
    }
    if (action === 'test') {
      if (!validWorksheetTitle(rest.worksheet)) return refuse(400, 'bad-request', cors);
      worksheet = rest.worksheet;
      mapping = cleanMapping(rest.mapping);
      if (mapping === null) return refuse(400, 'bad-request', cors);
    }
    const who = await authorize(token, eventId, ROLE_FOR[action]);
    if (who.error) { for (const [k, v] of Object.entries(cors)) who.error.headers.set(k, v); return who.error; }
    if (rateLimited(who.userId)) return refuse(429, 'rate-limited', {...cors, 'retry-after': '30'});
    try {
      if (action === 'capabilities') return json(200, await doCapabilities(), cors);
      if (action === 'inspect') return json(200, await doInspect(spreadsheetId), cors);
      if (action === 'test') return json(200, await doTest(eventId, token, spreadsheetId, worksheet, mapping), cors);
      if (action === 'lookup') return json(200, await doLookup(eventId, token, who.userId), cors);
      if (action === 'checkin') return json(200, await doCheckin(eventId, token, who.userId, req), cors);
      return json(200, await doLoad(eventId, token), cors);
    } catch (e) {
      if (action === 'load' && e instanceof RegistrationSourceError && !['disabled', 'not-allowed', 'not-configured'].includes(e.kind)) {
        // a failed live read is noted for the organizer's status panel (an outcome code only)
        await recordCheck(token, eventId, 'failed', e.kind, null);
      }
      return failure(e, cors);
    }
  };
}
