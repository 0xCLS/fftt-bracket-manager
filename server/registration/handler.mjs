/** Registration adapter request handler (SERVER-SIDE, runtime-agnostic: Cloudflare Pages Functions, Node, tests).
 *
 *   POST /api/registrations   Authorization: Bearer <the signed-in person's own Supabase access token>
 *                             {"event_id": "<uuid>"}
 *   -> 200 {source, fetchedAt, registrants[], duplicates[], summary, warnings[]}   (contracts/registration_model.mjs)
 *
 * Contract:
 *  - ORGANIZER ONLY. The caller's own token is checked twice against the Supabase project: the session must still be
 *    valid (/auth/v1/user), and the database itself must report the caller's CURRENT role for THIS event as
 *    `organizer` (fftt_staff_role_v1). A scorekeeper, an outsider, a revoked organizer, an anonymous caller and a
 *    different project's token are all refused. This module holds no privileged Supabase key.
 *  - READ-ONLY. The only upstream calls are Google's token endpoint and one Sheets `values.get`.
 *  - FAIL CLOSED. Anything not configured, or any event not explicitly allowlisted for the Google source, is refused
 *    with a generic answer that reveals nothing about which setting is missing.
 *  - NO CONTACT DATA LEAVES. Rows are reduced by the registration model to an allowlisted, masked shape; the raw rows
 *    are never returned, cached beyond a short in-memory window, or logged.
 *  - Same-origin only: the single approved staff origin may call it; there is no wildcard CORS.
 */
import {C3_HOST} from '../../contracts/phase1c_c3_readonly_supabase_transport.mjs';
import {buildRegistrants, parseCsv, parseRegistrationPayload} from '../../contracts/registration_model.mjs';
import {createGoogleSheetsReader, createRefMaker, RegistrationSourceError} from './google_sheets.mjs';
import {SYNTHETIC_FORM_CSV} from './synthetic_fixture.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const KEY = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;
const STAFF_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/;
const CACHE_MS = 20_000, RATE_WINDOW_MS = 60_000, RATE_MAX = 12;

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', ...headers}});
const refuse = (status, error, headers) => json(status, {error}, headers);

/** `state` lets a long-lived isolate share the rate counters and the short-lived cache across requests. */
export const createHandlerState = () => ({rate: new Map(), cache: null, reader: null});

export function createRegistrationHandler({env = {}, fetchImpl, now = () => Date.now(), state = createHandlerState()} = {}) {
  const cfg = readConfig(env);
  const rate = state.rate;    // user id -> recent request times
  // state.cache: {at, payload, key} — registrants only (already reduced), never raw rows

  function readConfig(e) {
    if (e.REGISTRATION_ENABLED !== 'true' || !STAFF_ORIGIN.test(e.STAFF_ORIGIN ?? '') || e.SUPABASE_URL !== C3_HOST
      || !KEY.test(e.SUPABASE_PUBLISHABLE_KEY ?? '')) return null;
    const allow = String(e.REGISTRATION_EVENT_IDS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (allow.some(x => !UUID.test(x))) return null;
    const source = e.REGISTRATION_SOURCE ?? 'google-sheets';
    if (source === 'synthetic-fixture') return {source, staffOrigin: e.STAFF_ORIGIN, allow, secret: 'synthetic-fixture-reference-secret-0001', publishableKey: e.SUPABASE_PUBLISHABLE_KEY};
    // The real source REQUIRES an explicit event allowlist, so a fictional event can never pull registrations.
    if (source !== 'google-sheets' || allow.length === 0 || typeof e.REGISTRATION_REF_SECRET !== 'string' || e.REGISTRATION_REF_SECRET.length < 32) return null;
    return {source, staffOrigin: e.STAFF_ORIGIN, allow, secret: e.REGISTRATION_REF_SECRET, publishableKey: e.SUPABASE_PUBLISHABLE_KEY,
      sa: e.GOOGLE_SA_EMAIL, key: e.GOOGLE_SA_PRIVATE_KEY, sheetId: e.REGISTRATION_SHEET_ID, range: e.REGISTRATION_SHEET_RANGE};
  }

  async function supa(path, token, body) {
    try {
      return await fetchImpl(C3_HOST + path, {method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
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

  function rateLimited(userId) {
    const t = now();
    const hits = (rate.get(userId) ?? []).filter(x => t - x < RATE_WINDOW_MS);
    if (hits.length >= RATE_MAX) { rate.set(userId, hits); return true; }
    hits.push(t); rate.set(userId, hits);
    if (rate.size > 500) for (const [k, v] of rate) if (v.every(x => t - x >= RATE_WINDOW_MS)) rate.delete(k);
    return false;
  }

  async function load() {
    const cacheKey = cfg.source + '|' + (cfg.sheetId ?? '') + '|' + (cfg.range ?? '');
    if (state.cache && state.cache.key === cacheKey && now() - state.cache.at < CACHE_MS) return state.cache.payload;
    const refFor = createRefMaker(cfg.secret, cfg.source === 'google-sheets' ? cfg.sheetId : 'synthetic-fixture');
    let rows;
    if (cfg.source === 'synthetic-fixture') rows = parseCsv(SYNTHETIC_FORM_CSV);
    else {
      // one reader per isolate: it keeps the short-lived OAuth token, so a read does not re-sign and re-authorize every time
      if (state.reader?.key !== cacheKey) state.reader = {key: cacheKey, value: createGoogleSheetsReader({serviceAccountEmail: cfg.sa, privateKeyPem: cfg.key, sheetId: cfg.sheetId, range: cfg.range, fetchImpl, now})};
      rows = await state.reader.value.readRows();
    }
    const built = await buildRegistrants(rows, {refFor});
    const payload = parseRegistrationPayload({source: cfg.source, fetchedAt: new Date(now()).toISOString(), ...built});
    state.cache = {at: now(), payload, key: cacheKey};
    return payload;
  }

  return async function handle(request) {
    if (!cfg) return refuse(503, 'registration-not-configured');
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
    try { const text = await request.text(); if (text.length > 1024) return refuse(413, 'too-large', cors); body = JSON.parse(text); } catch { return refuse(400, 'bad-request', cors); }
    if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'event_id') || typeof body.event_id !== 'string' || !UUID.test(body.event_id)) {
      return refuse(400, 'bad-request', cors);
    }
    const eventId = body.event_id.toLowerCase();
    const who = await authorizeOrganizer(token, eventId);
    if (who.error) { for (const [k, v] of Object.entries(cors)) who.error.headers.set(k, v); return who.error; }
    if (rateLimited(who.userId)) return refuse(429, 'rate-limited', {...cors, 'retry-after': '30'});
    if (cfg.allow.length && !cfg.allow.includes(eventId)) return refuse(403, 'event-not-enabled', cors);
    try {
      return json(200, await load(), cors);
    } catch (e) {
      if (!(e instanceof RegistrationSourceError)) return refuse(502, 'source-unavailable', cors);
      switch (e.kind) {
        case 'not-configured': return refuse(503, 'registration-not-configured', cors);
        case 'unauthorized': return refuse(502, 'source-unauthorized', cors);
        case 'not-found': return refuse(502, 'source-not-found', cors);
        case 'busy': return refuse(503, 'source-busy', {...cors, 'retry-after': String(e.retryAfterSeconds ?? 30)});
        default: return refuse(502, 'source-unavailable', cors);
      }
    }
  };
}
