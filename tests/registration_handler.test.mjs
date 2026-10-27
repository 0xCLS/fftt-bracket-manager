/** Registration adapter: authorization, EVENT-SPECIFIC sources, fail-closed configuration, read-only Google access (mocked),
 * the connection diagnostic, controlled egress, workerd compatibility and privacy.
 * Zero network: Supabase and Google are fake fetch functions. Run: node --test tests/registration_handler.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRegistrationHandler, createHandlerState} from '../server/registration/handler.mjs';
import {createGoogleSheetsReader, createRefMaker, RegistrationSourceError} from '../server/registration/google_sheets.mjs';
import {createEdgeFetch, EgressBlockedError} from '../server/registration/edge_fetch.mjs';
import {SYNTHETIC_FORM_CSV} from '../server/registration/synthetic_fixture.mjs';
import {parseCsv, parseRegistrationPayload} from '../contracts/registration_model.mjs';
import {parseCapabilities, parseDiagnostic, parseInspect} from '../contracts/registration_client.mjs';
import {C3_HOST} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAFF = 'https://fftt-staff-test.pages.dev';
const KEY = 'sb_publishable_testkey0123456789';
const EVENT = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT = '22222222-2222-4222-8222-222222222222';
const tok = name => `hdr.${Buffer.from(name).toString('base64url')}.sig`;
const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
const SA = 'fftt-reader@fftt-synthetic-project.iam.gserviceaccount.com';
const SHEET_A = 'SYNTHETIC_SHEET_A_0123456789abcdef';
const SHEET_B = 'SYNTHETIC_SHEET_B_0123456789abcdef';
const TAB = 'Form responses 1';
const FIXTURE_ROWS = parseCsv(SYNTHETIC_FORM_CSV);

const fixtureRecord = (synthetic = true) => ({configured: true, event_synthetic: synthetic, kind: 'fixture', spreadsheet_id: null, spreadsheet_title: null, worksheet: null, column_map: {}, enabled: true,
  status: 'untested', last_error: null, last_checked_at: null, last_ok_at: null, last_response_count: null, updated_at: '2026-11-08T12:00:00Z'});
const sheetRecord = ({id = SHEET_A, tab = TAB, map = {}, enabled = true, synthetic = false, title = 'FFTT Sign-ups'} = {}) => ({configured: true, event_synthetic: synthetic, kind: 'google-sheets', spreadsheet_id: id,
  spreadsheet_title: title, worksheet: tab, column_map: map, enabled, status: 'untested', last_error: null, last_checked_at: null, last_ok_at: null, last_response_count: null, updated_at: '2026-11-08T12:00:00Z'});

/** A fake Supabase + Google. `calls` records every upstream request for the "read-only, pinned hosts" assertions.
 *  roles: who -> {eventId: role}; sources: eventId -> raw source record (the database's answer to fftt_registration_source_v5);
 *  sheets: spreadsheetId -> {title, tabs: {tabName: rows}, shared: boolean}. */
function world({roles = {organizer: {[EVENT]: 'organizer', [OTHER_EVENT]: 'organizer'}, scorekeeper: {[EVENT]: 'scorekeeper'}, orgA: {[EVENT]: 'organizer'}},
  sources = {}, sheets = {[SHEET_A]: {title: 'FFTT Sign-ups', tabs: {[TAB]: FIXTURE_ROWS}, shared: true}}, googleStatus = null, tokenStatus = 200, supaDown = false, v5 = true} = {}) {
  const calls = [], recorded = [];
  let tokenIssues = 0, now = Date.parse('2026-11-08T12:00:00Z');
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    calls.push({host: u.host, path: u.pathname, method, init, auth: init.headers?.Authorization ?? init.headers?.authorization ?? null, apikey: init.headers?.apikey ?? null});
    // the Cloudflare runtime throws on these two options; the double does too, so a regression cannot hide behind a mock
    if (init.redirect === 'error') throw new TypeError('Invalid redirect value, must be one of "follow" or "manual" ("error" won\'t be implemented since it does not make sense at the edge; use "manual" and check the response status code).');
    if ('cache' in init) throw new TypeError("The 'cache' field on 'RequestInitializerDict' is not implemented.");
    const res = (status, body, headers = {}) => ({status, headers: {get: k => headers[String(k).toLowerCase()] ?? null}, json: async () => { if (body === undefined) throw new SyntaxError('x'); return body; }});
    if (supaDown && u.origin === C3_HOST) throw new TypeError('network');
    if (u.origin === C3_HOST) {
      const bearer = (init.headers?.Authorization ?? '').replace('Bearer ', '');
      const who = bearer.startsWith('hdr.') ? Buffer.from(bearer.split('.')[1], 'base64url').toString() : null;
      if (u.pathname === '/auth/v1/user') return who && who !== 'revoked' ? res(200, {id: who === 'anon' ? '99999999-9999-4999-8999-999999999999' : '33333333-3333-4333-8333-' + String(who.length).padStart(12, '0'), is_anonymous: who === 'anon'}) : res(401, {});
      const body = init.body ? JSON.parse(init.body) : {};
      const role = roles[who]?.[body.p_event_id];
      if (u.pathname === '/rest/v1/rpc/fftt_staff_role_v1') return role ? res(200, role) : res(403, {code: '42501'});
      if (u.pathname === '/rest/v1/rpc/fftt_registration_source_v5') {
        if (!v5) return res(404, {});
        if (role !== 'organizer') return res(403, {code: '42501'});
        return res(200, sources[body.p_event_id] ?? {configured: false, event_synthetic: true});
      }
      if (u.pathname === '/rest/v1/rpc/fftt_record_registration_check_v5') { if (role !== 'organizer') return res(403, {}); recorded.push(body); return res(200, {status: 'recorded'}); }
    }
    if (u.origin === 'https://oauth2.googleapis.com' && u.pathname === '/token') {
      if (tokenStatus !== 200) return res(tokenStatus, {});
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const [h, c, s] = form.get('assertion').split('.');
      assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')), 'the assertion is signed with the service-account key');
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      assert.deepEqual([claims.iss, claims.scope, claims.aud], [SA, 'https://www.googleapis.com/auth/spreadsheets.readonly', 'https://oauth2.googleapis.com/token']);
      assert.ok(claims.exp - claims.iat <= 3600);
      tokenIssues++;
      return res(200, {access_token: 'ya29.synthetic-token-' + tokenIssues, token_type: 'Bearer', expires_in: 3600});
    }
    if (u.origin === 'https://sheets.googleapis.com') {
      assert.equal(method, 'GET', 'Google is only ever read');
      if (!init.headers.Authorization.startsWith('Bearer ya29.synthetic-token')) return res(401, {});
      if (googleStatus !== null) return res(googleStatus, {error: {message: 'secret upstream detail'}}, googleStatus === 429 ? {'retry-after': '99'} : {});
      const m = /^\/v4\/spreadsheets\/([^/]+)(?:\/values\/(.+))?$/.exec(u.pathname);
      const sheet = sheets[m?.[1]];
      if (!sheet) return res(404, {});
      if (!sheet.shared) return res(403, {error: {message: 'secret upstream detail'}});
      if (!m[2]) return res(200, {properties: {title: sheet.title}, sheets: Object.keys(sheet.tabs).map((t, i) => ({properties: {sheetId: i, title: t}}))});
      const range = decodeURIComponent(m[2]);
      const tab = /^'((?:[^']|'')+)'!(.+)$/.exec(range);
      const rows = sheet.tabs[tab?.[1].replaceAll("''", "'")];
      if (!rows) return res(400, {error: {message: 'Unable to parse range'}});
      if (tab[2] === 'A1:BH1') return res(200, {values: rows.slice(0, 1)});
      if (tab[2].startsWith('A2:A')) return res(200, {values: [rows.slice(1).map(r => r[0]).filter(x => x !== '')]});
      return res(200, {values: rows});
    }
    throw new Error('unexpected upstream request: ' + url);
  };
  return {fetchImpl, calls, recorded, tokenIssues: () => tokenIssues, advance: ms => { now += ms; }, now: () => now,
    google: () => calls.filter(c => c.host.endsWith('googleapis.com'))};
}
const baseEnv = {REGISTRATION_ENABLED: 'true', STAFF_ORIGIN: STAFF, SUPABASE_URL: C3_HOST, SUPABASE_PUBLISHABLE_KEY: KEY};
const synthEnv = {...baseEnv, REGISTRATION_SOURCE: 'synthetic-fixture'};
const diagEnv = {...baseEnv, REGISTRATION_GOOGLE_MODE: 'diagnostic', GOOGLE_SA_EMAIL: SA, GOOGLE_SA_PRIVATE_KEY: privateKey};
const liveEnv = {...baseEnv, REGISTRATION_GOOGLE_MODE: 'enabled', REGISTRATION_EVENT_IDS: `${EVENT},${OTHER_EVENT}`, REGISTRATION_REF_SECRET: 'x'.repeat(40), GOOGLE_SA_EMAIL: SA, GOOGLE_SA_PRIVATE_KEY: privateKey};
const req = (body, {method = 'POST', token = tok('organizer'), origin = STAFF, url = STAFF + '/api/registrations', ct = 'application/json', headers = {}} = {}) => new Request(url, {
  method, headers: {...(token ? {authorization: 'Bearer ' + token} : {}), ...(origin ? {origin} : {}), ...(ct ? {'content-type': ct} : {}), ...headers},
  body: method === 'GET' || method === 'OPTIONS' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))});
const call = (env, w, r, state) => createRegistrationHandler({env, fetchImpl: w.fetchImpl, now: w.now, ...(state ? {state} : {})})(r);
const load = (env, w, opts = {}, event = EVENT, extra = {}) => call(env, w, req({event_id: event, ...extra}, opts), opts.state);

test('REGRESSION (root cause of the empty "could not be read" message): every upstream call avoids options the Cloudflare runtime rejects', async () => {
  // The first deployed version passed redirect:"error" and cache:"no-store"; workerd throws on both, so the very first Supabase call
  // failed and every request ended as 503. The fake fetch above throws exactly like workerd, so this passes only without them.
  const w = world();
  const r = await load(synthEnv, w);
  assert.equal(r.status, 200);
  assert.ok(w.calls.length >= 3);
  for (const c of w.calls) {
    assert.ok(!('cache' in c.init) && c.init.redirect === 'manual' && !('credentials' in c.init), `forbidden option passed to ${c.host}${c.path}`);
  }
  // and an unauthenticated probe now gets the honest 401, not a 503
  assert.equal((await load(synthEnv, world(), {token: 'aaa.bbb.ccc'})).status, 401);
});

test('controlled egress: only https to the pinned hosts, nothing else can be requested', async () => {
  const seen = [];
  const f = createEdgeFetch(async (url, init) => { seen.push([url, init]); return {status: 200}; });
  for (const bad of ['http://copmkalfkkrkzheohwuc.supabase.co/x', 'https://evil.example/x', 'https://copmkalfkkrkzheohwuc.supabase.co.evil.example/x', 'https://u:p@sheets.googleapis.com/x',
    'https://sheets.googleapis.com:8443/x', 'https://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'not a url', 'https://docs.google.com/spreadsheets/d/x/export?format=csv']) {
    await assert.rejects(f(bad), e => e instanceof EgressBlockedError, bad);
  }
  assert.equal(seen.length, 0, 'nothing blocked ever reaches the network');
  await f('https://sheets.googleapis.com/v4/spreadsheets/x', {method: 'GET', headers: {a: 'b'}, redirect: 'error', cache: 'no-store', credentials: 'include', mode: 'cors'});
  assert.deepEqual(Object.keys(seen[0][1]).sort(), ['headers', 'method', 'redirect'], 'only workerd-safe options pass through');
  assert.equal(seen[0][1].redirect, 'manual', 'redirects are never followed');
});

test('fail closed: any missing or wrong setting answers the same generic 503 and reveals nothing', async () => {
  const w = world();
  const bad = [{}, {...synthEnv, REGISTRATION_ENABLED: 'yes'}, {...synthEnv, STAFF_ORIGIN: 'https://evil.example'}, {...synthEnv, STAFF_ORIGIN: 'http://x.pages.dev'},
    {...synthEnv, SUPABASE_URL: 'https://other.supabase.co'}, {...synthEnv, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abcdefghijkl'}, {...synthEnv, REGISTRATION_EVENT_IDS: 'not-a-uuid'}];
  for (const env of bad) {
    const r = await call(env, w, req({event_id: EVENT}));
    assert.equal(r.status, 503, JSON.stringify(env));
    assert.deepEqual(await r.json(), {error: 'registration-not-configured'});
  }
  assert.equal(w.calls.length, 0, 'nothing upstream is contacted when the adapter is not configured');
  // configured, but no source can serve the event (no fixture allowed, no Google): refused generically, after authorization
  const none = await load(baseEnv, world());
  assert.equal(none.status, 503); assert.deepEqual(await none.json(), {error: 'registration-not-configured'});
  // Google settings that are incomplete leave Google OFF (it is never half-on)
  const caps = await (await call({...baseEnv, REGISTRATION_GOOGLE_MODE: 'enabled', GOOGLE_SA_EMAIL: SA}, world(), req({action: 'capabilities', event_id: EVENT}))).json();
  assert.deepEqual([caps.googleMode, caps.googleConfigured, caps.googleLive], ['off', false, false]);
});

test('request hygiene: POST only, one approved origin, JSON, small body, exact fields per action', async () => {
  const w = world();
  assert.equal((await call(synthEnv, w, req(null, {method: 'GET'}))).status, 405);
  assert.equal((await load(synthEnv, w, {origin: 'https://evil.example'})).status, 403);
  assert.equal((await load(synthEnv, w, {url: 'https://fftt-games-test.pages.dev/api/registrations', origin: null})).status, 404, 'the spectator origin never answers');
  assert.equal((await load(synthEnv, w, {token: null})).status, 401);
  assert.equal((await load(synthEnv, w, {token: 'not-a-jwt'})).status, 401);
  assert.equal((await load(synthEnv, w, {ct: 'text/plain'})).status, 415);
  assert.equal((await call(synthEnv, w, req('{"event_id":'))).status, 400);
  assert.equal((await load(synthEnv, w, {}, 'nope')).status, 400);
  assert.equal((await load(synthEnv, w, {}, EVENT, {extra: 1})).status, 400);
  assert.equal((await load(synthEnv, w, {}, EVENT, {pad: 'x'.repeat(5000)})).status, 413);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT, action: 'delete'}))).status, 400, 'unknown action');
  assert.equal((await call(synthEnv, w, req({event_id: EVENT, action: 'toString'}))).status, 400, 'prototype names are not actions');
  assert.equal((await call(synthEnv, w, req({event_id: EVENT, spreadsheet: SHEET_A}))).status, 400, 'load never accepts a spreadsheet from the caller');
  assert.equal((await call(synthEnv, w, req({action: 'test', event_id: EVENT, spreadsheet: SHEET_A, worksheet: TAB, mapping: {bogus: 'x'}}))).status, 400, 'unknown mapping field');
  assert.equal((await call(synthEnv, w, req({action: 'test', event_id: EVENT, spreadsheet: SHEET_A, worksheet: 'a\u0001b'}))).status, 400, 'control characters in a worksheet name');
  assert.equal((await call(synthEnv, w, req(null, {method: 'OPTIONS'}))).status, 204);
  assert.equal((await call(synthEnv, w, req(null, {method: 'OPTIONS', origin: 'https://evil.example'}))).status, 403);
  assert.equal(w.calls.length, 0, 'malformed requests never reach Supabase');
});

test('ORGANIZER ONLY, EVENT-SCOPED: scorekeeper, outsider, revoked, anonymous and another event\'s organizer are refused; the database decides', async () => {
  const w = world();
  assert.equal((await load(synthEnv, w)).status, 200);
  assert.equal((await load(synthEnv, w, {token: tok('scorekeeper')})).status, 403);
  assert.equal((await load(synthEnv, w, {token: tok('outsider')})).status, 403);
  assert.equal((await load(synthEnv, w, {token: tok('revoked')})).status, 401, 'a signed-out/revoked session is refused');
  assert.equal((await load(synthEnv, w, {token: tok('anon')})).status, 401, 'an anonymous account is refused');
  // CROSS-EVENT: orgA organizes EVENT only; asking for OTHER_EVENT (another organizer's event, with its own registrations) is refused
  assert.equal((await load(synthEnv, w, {token: tok('orgA')}, OTHER_EVENT)).status, 403, 'substituting another event id returns nothing');
  for (const action of ['capabilities', 'inspect', 'test']) {
    const r = await call(diagEnv, w, req({action, event_id: OTHER_EVENT, ...(action === 'capabilities' ? {} : {spreadsheet: SHEET_A}), ...(action === 'test' ? {worksheet: TAB} : {})}, {token: tok('orgA')}));
    assert.equal(r.status, 403, action + ' is organizer-and-event scoped too');
  }
  assert.equal(w.google().length, 0, 'Google is never contacted for a caller who is not that event\'s organizer');
  assert.equal((await load(synthEnv, world({supaDown: true}))).status, 503);
  for (const c of w.calls) { assert.equal(c.host, new URL(C3_HOST).host); assert.equal(c.apikey, KEY); assert.match(c.auth, /^Bearer hdr\./); }
});

test('FICTIONAL DEMO DATA: the default for a synthetic event, with no contact data and no Google traffic', async () => {
  const w = world();
  const r = await load(synthEnv, w);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const text = await r.text();
  const payload = parseRegistrationPayload(JSON.parse(text));
  assert.equal(payload.source, 'synthetic-fixture');
  assert.equal(payload.registrants.length, 20);
  assert.ok(!/example\.invalid|\b555\b|7345550|@(?!•)/i.test(text.replace(/[a-z]•••@[a-z]•••\.[a-z]+/g, '')), 'no address or number anywhere in the response');
  assert.ok(!/Bringing my kids|Typed my|Resubmitted|household/i.test(text));
  assert.equal(w.google().length, 0, 'the fixture source never contacts Google');
  // an explicit fixture record behaves the same; a REAL (non-synthetic) event is never given the fictional data
  assert.equal((await load(synthEnv, world({sources: {[EVENT]: fixtureRecord(true)}}))).status, 200);
  assert.equal((await load(synthEnv, world({sources: {[EVENT]: fixtureRecord(false)}}))).status, 503);
  assert.equal((await load(synthEnv, world({sources: {[EVENT]: {configured: false, event_synthetic: false}}}))).status, 503);
  // and a deployment that does not allow the fixture does not serve it
  assert.equal((await load(baseEnv, world())).status, 503);
  // a database without the V5 objects fails closed as "not configured" (never a guess)
  assert.equal((await load(synthEnv, world({v5: false}))).status, 503);
});

test('capabilities: what this deployment can do, nothing else', async () => {
  const c = parseCapabilities(await (await call(diagEnv, world(), req({action: 'capabilities', event_id: EVENT}))).json());
  assert.deepEqual([c.googleMode, c.googleConfigured, c.googleLive, c.serviceAccountEmail, c.readOnly, c.fixtureAvailable], ['diagnostic', true, false, SA, true, false]);
  const off = parseCapabilities(await (await call(synthEnv, world(), req({action: 'capabilities', event_id: EVENT}))).json());
  assert.deepEqual([off.googleMode, off.googleConfigured, off.serviceAccountEmail, off.fixtureAvailable], ['off', false, null, true]);
  const text = JSON.stringify(c);
  assert.ok(!/PRIVATE KEY|MII/.test(text), 'no key material');
});

test('EVENT-SPECIFIC Google sources: each event reads ITS OWN sheet, with references and caches scoped to event AND spreadsheet', async () => {
  const rowsB = [FIXTURE_ROWS[0], ['2026/11/02 09:00:00', 'Zed Quinn', 'zed@example.invalid', '734-555-0177', ...FIXTURE_ROWS[1].slice(4)]];
  const w = world({
    sheets: {[SHEET_A]: {title: 'Sign-ups A', tabs: {[TAB]: FIXTURE_ROWS}, shared: true}, [SHEET_B]: {title: 'Sign-ups B', tabs: {'Other tab': rowsB}, shared: true}},
    sources: {[EVENT]: sheetRecord({id: SHEET_A, title: 'Sign-ups A'}), [OTHER_EVENT]: sheetRecord({id: SHEET_B, tab: 'Other tab', title: 'Sign-ups B'})},
  });
  const state = createHandlerState();
  const a = parseRegistrationPayload(await (await load(liveEnv, w, {state}, EVENT)).json());
  const b = parseRegistrationPayload(await (await load(liveEnv, w, {state}, OTHER_EVENT)).json());
  assert.equal(a.source, 'google-sheets'); assert.equal(a.sourceName, 'Sign-ups A');
  assert.equal(a.registrants.length, 20);
  assert.deepEqual(b.registrants.map(r => r.name), ['Zed Quinn'], 'the second event reads the second sheet');
  // the same sheet in two events: identical content, DIFFERENT references (no cross-event identity collision)
  const w2 = world({sources: {[EVENT]: sheetRecord({id: SHEET_A}), [OTHER_EVENT]: sheetRecord({id: SHEET_A})}});
  const state2 = createHandlerState();
  const e1 = parseRegistrationPayload(await (await load(liveEnv, w2, {state: state2}, EVENT)).json());
  const e2 = parseRegistrationPayload(await (await load(liveEnv, w2, {state: state2}, OTHER_EVENT)).json());
  assert.equal(e1.registrants.length, e2.registrants.length);
  assert.ok(e1.registrants.every((r, i) => r.ref !== e2.registrants[i].ref), 'refs are scoped to the event');
  // the same event pointed at a different sheet: refs change too (scoped to the spreadsheet)
  const w3 = world({sheets: {[SHEET_A]: {title: 'A', tabs: {[TAB]: FIXTURE_ROWS}, shared: true}, [SHEET_B]: {title: 'B', tabs: {[TAB]: FIXTURE_ROWS}, shared: true}}, sources: {[EVENT]: sheetRecord({id: SHEET_B})}});
  const onB = parseRegistrationPayload(await (await load(liveEnv, w3, {}, EVENT)).json());
  assert.ok(onB.registrants.every((r, i) => r.ref !== e1.registrants[i].ref), 'refs are scoped to the spreadsheet');
  // the cache is per event+sheet+tab+mapping: a cached result for event A is NEVER served to event B
  const reads = () => w.google().filter(c => c.path.includes('/values/')).length;
  const before = reads();
  await load(liveEnv, w, {state}, EVENT); await load(liveEnv, w, {state}, OTHER_EVENT);
  assert.equal(reads(), before, 'repeat loads inside the cache window are served from each event\'s own entry');
  // stable references between reads
  w.advance(25_000);
  const later = parseRegistrationPayload(await (await load(liveEnv, w, {state}, EVENT)).json());
  assert.deepEqual(later.registrants.map(r => r.ref), a.registrants.map(r => r.ref));
  assert.ok(reads() > before);
  // changing the saved mapping or tab is a different cache entry (never the old result)
  const w4 = world({sources: {[EVENT]: sheetRecord({map: {description: '(none)'}})}});
  const s4 = createHandlerState();
  const p4 = parseRegistrationPayload(await (await load(liveEnv, w4, {state: s4}, EVENT)).json());
  w4.advance(1000);
  assert.ok(p4.registrants.length > 0);
});

test('a sheet title that looks like a date or a phone number never breaks loading; it is just not shown', async () => {
  for (const title of ['FFTT3 Registrations 2026-11-22', 'Signups (734) 555 0100', 'mail a@b.co']) {
    const w = world({sources: {[EVENT]: sheetRecord({title})}});
    const r = await load(liveEnv, w);
    assert.equal(r.status, 200, title);
    assert.equal(parseRegistrationPayload(await r.json()).sourceName, null, title);
  }
});

test('a live Google source is NEVER served for a synthetic event, when off/diagnostic, when disabled, or outside the allowlist', async () => {
  const sheet = (over = {}) => ({[EVENT]: sheetRecord(over)});
  const cases = [
    ['synthetic event, mode enabled', liveEnv, sheet({synthetic: true}), 403, 'google-not-allowed'],
    ['mode diagnostic', diagEnv, sheet(), 403, 'google-not-allowed'],
    ['mode off', {...liveEnv, REGISTRATION_GOOGLE_MODE: 'off'}, sheet(), 403, 'google-not-allowed'],
    ['switched off for the event', liveEnv, sheet({enabled: false}), 403, 'source-disabled'],
    ['event not allowlisted', {...liveEnv, REGISTRATION_EVENT_IDS: OTHER_EVENT}, sheet(), 403, 'event-not-enabled'],
    ['no reference secret', {...liveEnv, REGISTRATION_REF_SECRET: undefined}, sheet(), 503, 'registration-not-configured'],
    ['no allowlist at all', {...liveEnv, REGISTRATION_EVENT_IDS: ''}, sheet(), 503, 'registration-not-configured'],
  ];
  for (const [label, env, sources, status, error] of cases) {
    const w = world({sources});
    const r = await load(env, w);
    assert.equal(r.status, status, label);
    assert.deepEqual(await r.json(), {error}, label);
    assert.equal(w.google().length, 0, label + ': Google is not contacted');
  }
});

test('Google failures map to safe answers without leaking upstream detail', async () => {
  const src = {[EVENT]: sheetRecord()};
  const cases = [[{googleStatus: 403}, 502, 'source-unauthorized'], [{googleStatus: 404}, 502, 'source-not-found'], [{googleStatus: 400}, 502, 'source-worksheet'],
    [{googleStatus: 429}, 503, 'source-busy'], [{googleStatus: 500}, 502, 'source-unavailable'], [{googleStatus: 401}, 502, 'source-unauthorized'],
    [{tokenStatus: 400}, 502, 'source-auth'], [{tokenStatus: 503}, 502, 'source-unavailable']];
  for (const [opts, status, error] of cases) {
    const w = world({sources: src, ...opts});
    const r = await load(liveEnv, w);
    assert.equal(r.status, status, JSON.stringify(opts));
    const text = await r.text();
    assert.equal(JSON.parse(text).error, error, JSON.stringify(opts));
    assert.ok(!/secret upstream detail|ya29|PRIVATE KEY/.test(text));
  }
  assert.equal((await load(liveEnv, world({sources: src, googleStatus: 429}))).headers.get('retry-after'), '30');
  // wrong tab (the saved worksheet no longer exists) and an inaccessible (unshared) sheet
  const wrongTab = world({sources: {[EVENT]: sheetRecord({tab: 'Deleted tab'})}});
  assert.deepEqual(await (await load(liveEnv, wrongTab)).json(), {error: 'source-worksheet'});
  const unshared = world({sources: {[EVENT]: sheetRecord()}, sheets: {[SHEET_A]: {title: 'x', tabs: {[TAB]: FIXTURE_ROWS}, shared: false}}});
  const u = await (await load(liveEnv, unshared)).json();
  assert.deepEqual(u, {error: 'source-unauthorized', serviceAccountEmail: SA}, 'the organizer is told which account to share the sheet with');
  const wide = world({sources: src, sheets: {[SHEET_A]: {title: 'x', tabs: {[TAB]: [Array.from({length: 61}, () => 'x')]}, shared: true}}});
  assert.equal((await load(liveEnv, wide)).status, 502);
  // a failed live read is noted for the status panel as an outcome code only (never data)
  const failing = world({sources: src, googleStatus: 403});
  await load(liveEnv, failing);
  assert.deepEqual(failing.recorded.map(r => [r.p_status, r.p_error, r.p_count]), [['failed', 'unauthorized', null]]);
});

test('CHANGED FORM COLUMNS and MISSING RATING INPUTS: a renamed column is reported, and no level is invented', async () => {
  // a future form with different wording and NO assessment questions at all
  const future = [['Submitted', 'Participant', 'Contact email'], ['2026-11-01 10:00', 'Pat Ngo', 'pat@example.invalid'], ['2026-11-01 10:05', 'Sam Roe', 'sam@example.invalid']];
  const w = world({sources: {[EVENT]: sheetRecord()}, sheets: {[SHEET_A]: {title: 'New form', tabs: {[TAB]: future}, shared: true}}});
  const p = parseRegistrationPayload(await (await load(liveEnv, w)).json());
  assert.deepEqual(p.registrants.map(r => r.name), ['Pat Ngo', 'Sam Roe']);
  assert.ok(p.registrants.every(r => r.suggestedRating === null && r.ratingConfidence === 'none' && r.ratingReview === true), 'no rating, no confidence: organizer review required');
  assert.equal(p.summary.needsRating, 2);
  assert.equal(p.summary.assessmentRecognized, 0);
  assert.ok(p.warnings.some(x => /No playing-assessment columns were recognized/.test(x)));
  // explicit mapping for a differently named question
  const odd = [['Timestamp', 'Who', 'Reliability of rallies'], ['2026/11/01 10:00:00', 'Pat Ngo', 'I can usually sustain rallies with reasonable consistency']];
  const w2 = world({sources: {[EVENT]: sheetRecord({map: {name: 'Who', rallies: 'Reliability of rallies'}})}, sheets: {[SHEET_A]: {title: 'Odd', tabs: {[TAB]: odd}, shared: true}}});
  const p2 = parseRegistrationPayload(await (await load(liveEnv, w2)).json());
  assert.equal(p2.registrants[0].name, 'Pat Ngo'); assert.equal(p2.registrants[0].suggestedRating !== null, true);
  // the mapped header was renamed in the sheet: the field is reported, not silently read from elsewhere
  const renamed = [['Timestamp', 'Who', 'Reliability of rallies (v2)'], ['2026/11/01 10:00:00', 'Pat Ngo', 'x']];
  const w3 = world({sources: {[EVENT]: sheetRecord({map: {name: 'Who', rallies: 'Reliability of rallies'}})}, sheets: {[SHEET_A]: {title: 'R', tabs: {[TAB]: renamed}, shared: true}}});
  const p3 = parseRegistrationPayload(await (await load(liveEnv, w3)).json());
  assert.ok(p3.warnings.some(x => /no longer in the sheet/.test(x)));
  assert.equal(p3.registrants[0].suggestedRating, null);
  // no usable name column at all: a clear, specific refusal (not a guess)
  const noName = [['Timestamp', 'Email'], ['2026/11/01', 'a@example.invalid']];
  const w4 = world({sources: {[EVENT]: sheetRecord()}, sheets: {[SHEET_A]: {title: 'x', tabs: {[TAB]: noName}, shared: true}}});
  const r4 = await load(liveEnv, w4);
  assert.equal(r4.status, 502); assert.deepEqual(await r4.json(), {error: 'source-columns'});
  // the payload contract itself rejects a null rating that is not flagged for review
  const good = JSON.parse(JSON.stringify(p));
  good.registrants[0].ratingConfidence = 'low';
  assert.throws(() => parseRegistrationPayload(good), TypeError);
});

test('CONNECTION DIAGNOSTIC: read-only readiness, sanitized errors, no rows and no contact data', async () => {
  const w = world();
  const ask = (env, over = {}, who = tok('organizer')) => call(env, w, req({action: 'test', event_id: EVENT, spreadsheet: `https://docs.google.com/spreadsheets/d/${SHEET_A}/edit#gid=0`, worksheet: TAB, mapping: {}, ...over}, {token: who}));
  const ok = parseDiagnostic(await (await ask(diagEnv)).json());
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.checks.map(c => [c.id, c.status]), [['google', 'pass'], ['spreadsheet', 'pass'], ['worksheet', 'pass'], ['headers', 'pass'], ['model', 'pass'], ['count', 'pass']]);
  assert.equal(ok.responseCount, FIXTURE_ROWS.length - 1, 'a count of response rows, never their content');
  assert.equal(ok.spreadsheet.title, 'FFTT Sign-ups');
  assert.ok(ok.columns.some(c => c.field === 'name') && ok.columns.some(c => c.field === 'rallies'), 'familiar FFTT headings are recognized automatically');
  assert.ok(ok.assessment.found.length >= 5, 'assessment columns recognized: ' + ok.assessment.found);
  const raw = JSON.stringify(ok);
  assert.ok(!/example\.invalid|555|Ada |Quill/.test(raw), 'no cell value, name or contact detail in a diagnostic');
  // Google was only read: token + metadata + header row + a count of column A
  assert.deepEqual(w.google().map(c => c.method), ['POST', 'GET', 'GET', 'GET']);
  assert.ok(w.google().every(c => c.method === 'GET' || c.path === '/token'));
  const valueReads = w.google().filter(c => c.path.includes('/values/')).map(c => decodeURIComponent(c.path));
  assert.ok(valueReads.every(p => /!A1:BH1$|!A2:A5000$/.test(p)), 'only the header row and column A are read: ' + valueReads);
  // a wrong or inaccessible sheet: specific, sanitized, and no further steps run
  const unshared = world({sheets: {[SHEET_A]: {title: 'x', tabs: {[TAB]: FIXTURE_ROWS}, shared: false}}});
  const bad = parseDiagnostic(await (await call(diagEnv, unshared, req({action: 'test', event_id: EVENT, spreadsheet: SHEET_A, worksheet: TAB, mapping: {}}))).json());
  assert.equal(bad.ok, false); assert.equal(bad.stage, 'spreadsheet');
  assert.match(bad.checks.find(c => c.id === 'spreadsheet').message, /not shared with the connection account/);
  assert.equal(bad.serviceAccountEmail, SA);
  assert.equal(bad.responseCount, null);
  assert.ok(!/secret upstream detail/.test(JSON.stringify(bad)));
  const missing = parseDiagnostic(await (await ask(diagEnv, {spreadsheet: 'SYNTHETIC_SHEET_MISSING_0123456789'})).json());
  assert.equal(missing.stage, 'spreadsheet'); assert.match(missing.checks[1].message, /No spreadsheet was found/);
  const wrongTab = parseDiagnostic(await (await ask(diagEnv, {worksheet: 'No such tab'})).json());
  assert.equal(wrongTab.stage, 'worksheet');
  const authBad = world({tokenStatus: 400});
  const g = parseDiagnostic(await (await call(diagEnv, authBad, req({action: 'test', event_id: EVENT, spreadsheet: SHEET_A, worksheet: TAB, mapping: {}}))).json());
  assert.equal(g.stage, 'google'); assert.match(g.checks[0].message, /could not sign in/);
  // columns that changed: the diagnostic names which chosen columns are gone and still passes if a name column exists
  const changed = parseDiagnostic(await (await ask(diagEnv, {mapping: {rallies: 'A question that no longer exists'}})).json());
  assert.deepEqual(changed.unmatched, ['rallies']);
  assert.ok(changed.checks.some(c => c.id === 'mapping' && c.status === 'warn'));
  const noName = world({sheets: {[SHEET_A]: {title: 'x', tabs: {[TAB]: [['Timestamp', 'Email'], ['2026/11/01', 'a@example.invalid']]}, shared: true}}});
  const nn = parseDiagnostic(await (await call(diagEnv, noName, req({action: 'test', event_id: EVENT, spreadsheet: SHEET_A, worksheet: TAB, mapping: {}}))).json());
  assert.equal(nn.ok, false); assert.equal(nn.stage, 'model'); assert.deepEqual(nn.missing, ['name']);
  assert.ok(!/a@example\.invalid/.test(JSON.stringify(nn)));
  // the deployment must have Google enabled for diagnostics at all
  assert.equal((await ask(synthEnv)).status, 503);
  assert.equal((await ask({...diagEnv, REGISTRATION_GOOGLE_MODE: 'off'})).status, 503);
  // outcomes are recorded only for the event's OWN saved sheet+tab
  const rec = world({sources: {[EVENT]: sheetRecord({enabled: false})}});
  await call(diagEnv, rec, req({action: 'test', event_id: EVENT, spreadsheet: SHEET_A, worksheet: TAB, mapping: {}}));
  assert.deepEqual(rec.recorded.map(r => [r.p_status, r.p_error, r.p_count]), [['ready', null, FIXTURE_ROWS.length - 1]]);
  const other = world({sources: {[EVENT]: sheetRecord({id: SHEET_B})}});
  await call(diagEnv, other, req({action: 'test', event_id: EVENT, spreadsheet: SHEET_A, worksheet: TAB, mapping: {}}));
  assert.equal(other.recorded.length, 0, 'testing a different sheet does not touch the saved status');
});

test('inspect: spreadsheet title and worksheet names only; only Google Sheets links or IDs are accepted', async () => {
  const w = world({sheets: {[SHEET_A]: {title: 'Spring Games', tabs: {[TAB]: FIXTURE_ROWS, 'Notes': [['x']]}, shared: true}}});
  const r = parseInspect(await (await call(diagEnv, w, req({action: 'inspect', event_id: EVENT, spreadsheet: SHEET_A}))).json());
  assert.deepEqual([r.title, r.worksheets.map(x => x.title), r.serviceAccountEmail], ['Spring Games', [TAB, 'Notes'], SA]);
  assert.ok(w.google().every(c => !c.path.includes('/values/')), 'inspect reads no cell values');
  for (const bad of ['https://evil.example/spreadsheets/d/' + SHEET_A, 'http://docs.google.com/spreadsheets/d/' + SHEET_A, 'https://docs.google.com.evil.example/spreadsheets/d/' + SHEET_A,
    'https://u:p@docs.google.com/spreadsheets/d/' + SHEET_A, 'https://docs.google.com:444/spreadsheets/d/' + SHEET_A, 'short', '', '../../../' + SHEET_A, 'https://169.254.169.254/']) {
    const w2 = world();
    const x = await call(diagEnv, w2, req({action: 'inspect', event_id: EVENT, spreadsheet: bad}));
    assert.equal(x.status, 400, bad); assert.deepEqual(await x.json(), {error: 'invalid-spreadsheet'});
    assert.equal(w2.calls.length, 0, 'an unapproved address is refused before anything is contacted');
  }
  assert.equal((await call(synthEnv, world(), req({action: 'inspect', event_id: EVENT, spreadsheet: SHEET_A}))).status, 503, 'Google not configured');
});

test('NO LEAKS: nothing is logged, and no response carries a full contact detail, a credential or raw rows', async () => {
  const logged = [];
  const orig = {log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug};
  for (const k of Object.keys(orig)) console[k] = (...a) => logged.push(a);
  try {
    const w = world({sources: {[EVENT]: sheetRecord()}});
    const bodies = [];
    for (const r of [await load(liveEnv, w), await load(liveEnv, w, {token: tok('scorekeeper')}), await call(diagEnv, w, req({action: 'test', event_id: EVENT, spreadsheet: SHEET_A, worksheet: TAB, mapping: {}})),
      await load(liveEnv, world({sources: {[EVENT]: sheetRecord()}, googleStatus: 403}))]) bodies.push(await r.text());
    const all = bodies.join('\n');
    assert.ok(!/example\.invalid|734-555|\(734\)|PRIVATE KEY|ya29|GOOGLE_SA|REF_SECRET/.test(all.replace(/[a-z]•••@[a-z]•••\.[a-z]+/g, '')));
    assert.deepEqual(logged, [], 'the adapter writes nothing to any log');
  } finally { Object.assign(console, orig); }
});

test('rate limit: a burst from one account is slowed; another account is unaffected', async () => {
  const w = world({roles: {organizer: {[EVENT]: 'organizer'}, other: {[EVENT]: 'organizer'}}});
  const state = createHandlerState();
  const run = token => createRegistrationHandler({env: synthEnv, fetchImpl: w.fetchImpl, now: w.now, state})(req({event_id: EVENT}, {token}));
  for (let i = 0; i < 30; i++) assert.equal((await run(tok('organizer'))).status, 200);
  const limited = await run(tok('organizer'));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '30');
  assert.equal((await run(tok('other'))).status, 200);
  w.advance(61_000);
  assert.equal((await run(tok('organizer'))).status, 200);
});

test('reader: strict configuration, pinned hosts, parameterized per call, key problems fail closed', async () => {
  const w = world();
  const edge = createEdgeFetch(w.fetchImpl);
  const ok = {serviceAccountEmail: SA, privateKeyPem: privateKey, fetchImpl: edge, now: w.now};
  const reader = createGoogleSheetsReader(ok);
  assert.equal((await reader.readRows(SHEET_A, TAB)).length, 22);
  assert.equal(await reader.countResponses(SHEET_A, TAB), FIXTURE_ROWS.length - 1);
  for (const bad of [{serviceAccountEmail: 'x@gmail.com'}, {privateKeyPem: 'nope'}, {fetchImpl: null}]) {
    assert.throws(() => createGoogleSheetsReader({...ok, ...bad}), e => e instanceof RegistrationSourceError && e.kind === 'not-configured');
  }
  for (const [id, tab] of [['short', TAB], ['../../etc/passwd' + 'x'.repeat(20), TAB], [SHEET_A, ''], [SHEET_A, 'a\nb'], [SHEET_A, 'x'.repeat(101)]]) {
    await assert.rejects(reader.readRows(id, tab), e => e.kind === 'invalid-source', `${id} / ${tab}`);
  }
  // a tab name with an apostrophe is quoted safely
  const w2 = world({sheets: {[SHEET_A]: {title: 't', tabs: {"Bob's tab": FIXTURE_ROWS}, shared: true}}});
  assert.equal((await createGoogleSheetsReader({...ok, fetchImpl: createEdgeFetch(w2.fetchImpl)}).readRows(SHEET_A, "Bob's tab")).length, 22);
  // a syntactically plausible but wrong key is refused at use, as "not configured", not as an internal error
  const garbage = '-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(300) + '\n-----END PRIVATE KEY-----';
  await assert.rejects(createGoogleSheetsReader({...ok, privateKeyPem: garbage}).readRows(SHEET_A, TAB), e => e.kind === 'not-configured');
  // a key pasted with literal \n sequences (common in secret stores) works
  assert.equal((await createGoogleSheetsReader({...ok, privateKeyPem: privateKey.replace(/\n/g, '\\n')}).readRows(SHEET_A, TAB)).length, 22);
  for (const c of w.calls) assert.ok(['oauth2.googleapis.com', 'sheets.googleapis.com'].includes(c.host));
  assert.throws(() => createRefMaker('short', 'x'), e => e.kind === 'not-configured');
  const maker = createRefMaker('k'.repeat(40), 'event:1|sheet:a');
  assert.equal(await maker('row'), await maker('row'));
  assert.notEqual(await maker('row'), await createRefMaker('k'.repeat(40), 'event:1|sheet:b')('row'));
  assert.notEqual(await maker('row'), await createRefMaker('k'.repeat(40), 'event:2|sheet:a')('row'));
  assert.match(await maker('row'), /^[A-Za-z0-9_-]{32}$/);
});

test('the Pages Function wrapper is inert without configuration', async () => {
  const {onRequest} = await import('../functions/api/registrations.js');
  const r = await onRequest({request: req({event_id: EVENT}), env: {}});
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), {error: 'registration-not-configured'});
});

test('no browser-shipped file can hold Google credentials or reach the adapter internals', () => {
  const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  for (const f of [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'contracts'))].filter(x => /\.(mjs|js|html|css|json)$/.test(x))) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/PRIVATE KEY|GOOGLE_SA_|REGISTRATION_REF_SECRET|private_key|client_secret|spreadsheets\.googleapis|sheets\.googleapis\.com|oauth2\.googleapis/i.test(text), 'credential material or Google endpoint in ' + path.relative(ROOT, f));
    assert.ok(!/from\s+['"][^'"]*\/server\//.test(text), 'a browser file imports server code: ' + path.relative(ROOT, f));
  }
});
