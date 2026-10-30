/** Registration adapter request handler (SERVER-SIDE, runtime-agnostic: Cloudflare Pages Functions, Node, tests).
 *
 *   POST /api/registrations   Authorization: Bearer <the signed-in person's own Supabase access token>
 *     {"action":"load","event_id":uuid}                                      -> the event's registrants (default action)
 *     {"action":"capabilities","event_id":uuid}                              -> what this deployment can do (no data)
 *     {"action":"inspect","event_id":uuid,"spreadsheet":"<url or id>"}       -> spreadsheet title + worksheet names
 *     {"action":"test","event_id":uuid,"spreadsheet","worksheet","mapping"}  -> read-only connection diagnostic (no rows)
 *
 * Contract:
 *  - ORGANIZER ONLY, EVENT-SCOPED. The caller's own token is checked against the Supabase project on every request: the
 *    session must be valid (/auth/v1/user) AND the database must report the caller's CURRENT role for THAT event as
 *    `organizer` (fftt_staff_role_v1). The event's saved registration source is then read from the database under the
 *    same token (fftt_registration_source_v5, itself organizer-only for that event). The server never takes a spreadsheet
 *    id from the request for `load`: it reads the sheet the event's organizer saved. A signed-in organizer who substitutes
 *    another event's id is refused by the database check, so no other event's sheet or registrations are reachable.
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
 * GOOGLE_SA_PRIVATE_KEY (and, for `enabled`, REGISTRATION_REF_SECRET and an event allowlist REGISTRATION_EVENT_IDS). */
import {C3_HOST} from '../../contracts/phase1c_c3_readonly_supabase_transport.mjs';
import {buildRegistrants, looksLikeContact, mapHeaders, parseCsv, parseRegistrationPayload} from '../../contracts/registration_model.mjs';
import {cleanMapping, mappingKey, parseSourceRecord, parseSpreadsheetRef, validWorksheetTitle} from '../../contracts/registration_source.mjs';
import {createGoogleSheetsReader, createRefMaker, RegistrationSourceError} from './google_sheets.mjs';
import {createEdgeFetch, EDGE_HOSTS} from './edge_fetch.mjs';
import {SYNTHETIC_FORM_CSV} from './synthetic_fixture.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const KEY = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;
// A dedicated *.pages.dev project, or the one exact permanent production staff hostname (never a wildcard or sibling subdomain).
const STAFF_ORIGIN = /^https:\/\/(?:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev|fftt-staff\.clslifestyle\.com)$/;
const CACHE_MS = 20_000, CACHE_MAX = 24, RATE_WINDOW_MS = 60_000, RATE_MAX = 30;
const FIXTURE_SECRET = 'synthetic-fixture-reference-secret-0001';   // fictional data only: not a secret
const ACTION_KEYS = Object.freeze({load: ['event_id'], capabilities: ['event_id'], inspect: ['event_id', 'spreadsheet'], test: ['event_id', 'spreadsheet', 'worksheet', 'mapping']});

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
    const allow = String(e.REGISTRATION_EVENT_IDS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (allow.some(x => !UUID.test(x))) return null;
    const mode = ['off', 'diagnostic', 'enabled'].includes(e.REGISTRATION_GOOGLE_MODE) ? e.REGISTRATION_GOOGLE_MODE : 'off';
    const credentials = typeof e.GOOGLE_SA_EMAIL === 'string' && typeof e.GOOGLE_SA_PRIVATE_KEY === 'string' && e.GOOGLE_SA_PRIVATE_KEY.includes('BEGIN PRIVATE KEY');
    const refSecret = typeof e.REGISTRATION_REF_SECRET === 'string' && e.REGISTRATION_REF_SECRET.length >= 32 ? e.REGISTRATION_REF_SECRET : null;
    return {
      staffOrigin: e.STAFF_ORIGIN, publishableKey: e.SUPABASE_PUBLISHABLE_KEY, allow,
      fixture: e.REGISTRATION_FIXTURE === 'true' || e.REGISTRATION_SOURCE === 'synthetic-fixture',
      googleMode: credentials ? mode : 'off', googleRequested: mode, sa: e.GOOGLE_SA_EMAIL, key: e.GOOGLE_SA_PRIVATE_KEY, credentials,
      // a live source needs the explicit event allowlist AND a reference secret, in addition to mode `enabled`
      googleLive: mode === 'enabled' && credentials && refSecret !== null && allow.length > 0, refSecret,
    };
  }

  async function supa(path, token, body) {
    try {
      return await edge(C3_HOST + path, {method: body === undefined ? 'GET' : 'POST',
        headers: {apikey: cfg.publishableKey, Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        body: body === undefined ? undefined : JSON.stringify(body)});
    } catch { return null; }
  }

  async function authorizeOrganizer(token, eventId) {
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
    if (r !== 'organizer') return {error: refuse(403, 'forbidden')};
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
  async function doLoad(eventId, token) {
    const src = await savedSource(token, eventId);
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
      if (!cfg.allow.includes(eventId)) throw new RegistrationSourceError('event-not-enabled');
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
    if (kind === 'google-sheets') await recordCheck(token, eventId, 'ready', null, payload.registrants.length);
    return payload;
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
    if (!(e instanceof RegistrationSourceError)) return refuse(502, 'source-unavailable', cors);
    const sa = cfg.credentials ? {serviceAccountEmail: cfg.sa} : {};
    switch (e.kind) {
      case 'not-configured': return refuse(503, 'registration-not-configured', cors);
      case 'disabled': return refuse(403, 'source-disabled', cors);
      case 'not-allowed': return refuse(403, 'google-not-allowed', cors);
      case 'event-not-enabled': return refuse(403, 'event-not-enabled', cors);
      case 'unauthorized': return refuse(502, 'source-unauthorized', cors, sa);
      case 'google-auth': return refuse(502, 'source-auth', cors);
      case 'not-found': return refuse(502, 'source-not-found', cors, sa);
      case 'worksheet-not-found': return refuse(502, 'source-worksheet', cors);
      case 'columns': return refuse(502, 'source-columns', cors);
      case 'invalid-source': return refuse(400, 'bad-request', cors);
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
    const who = await authorizeOrganizer(token, eventId);
    if (who.error) { for (const [k, v] of Object.entries(cors)) who.error.headers.set(k, v); return who.error; }
    if (rateLimited(who.userId)) return refuse(429, 'rate-limited', {...cors, 'retry-after': '30'});
    try {
      if (action === 'capabilities') return json(200, await doCapabilities(), cors);
      if (action === 'inspect') return json(200, await doInspect(spreadsheetId), cors);
      if (action === 'test') return json(200, await doTest(eventId, token, spreadsheetId, worksheet, mapping), cors);
      return json(200, await doLoad(eventId, token), cors);
    } catch (e) {
      if (action === 'load' && e instanceof RegistrationSourceError && !['disabled', 'not-allowed', 'event-not-enabled', 'not-configured'].includes(e.kind)) {
        // a failed live read is noted for the organizer's status panel (an outcome code only)
        await recordCheck(token, eventId, 'failed', e.kind, null);
      }
      return failure(e, cors);
    }
  };
}
