/** Registration adapter: authorization, fail-closed configuration, read-only Google access (mocked), privacy.
 * Zero network: Supabase and Google are fake fetch functions. Run: node --test tests/registration_handler.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRegistrationHandler, createHandlerState} from '../server/registration/handler.mjs';
import {createGoogleSheetsReader, createRefMaker, RegistrationSourceError} from '../server/registration/google_sheets.mjs';
import {SYNTHETIC_FORM_CSV} from '../server/registration/synthetic_fixture.mjs';
import {parseCsv, parseRegistrationPayload} from '../contracts/registration_model.mjs';
import {C3_HOST} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAFF = 'https://fftt-staff-test.pages.dev';
const KEY = 'sb_publishable_testkey0123456789';
const EVENT = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT = '22222222-2222-4222-8222-222222222222';
const tok = name => `hdr.${Buffer.from(name).toString('base64url')}.sig`;
const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
const SA = 'fftt-reader@fftt-synthetic-project.iam.gserviceaccount.com';
const SHEET = 'SYNTHETIC_SHEET_ID_0123456789abcdef';
const RANGE = 'Form Responses 1!A:Z';

/** A fake Supabase + Google. `calls` records every upstream request for the "read-only, pinned hosts" assertions. */
function world({roles = {organizer: 'organizer', scorekeeper: 'scorekeeper'}, rows = parseCsv(SYNTHETIC_FORM_CSV), googleStatus = 200, tokenStatus = 200, anon = new Set(), supaDown = false} = {}) {
  const calls = [];
  let tokenIssues = 0, now = Date.parse('2026-11-08T12:00:00Z');
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    calls.push({host: u.host, path: u.pathname, method, auth: init.headers?.Authorization ?? init.headers?.authorization ?? null, apikey: init.headers?.apikey ?? null});
    const res = (status, body, headers = {}) => ({status, headers: {get: k => headers[String(k).toLowerCase()] ?? null}, json: async () => { if (body === undefined) throw new SyntaxError('x'); return body; }});
    if (supaDown && u.origin === C3_HOST) throw new TypeError('network');
    if (u.origin === C3_HOST) {
      const bearer = (init.headers?.Authorization ?? '').replace('Bearer ', '');
      const who = bearer.startsWith('hdr.') ? Buffer.from(bearer.split('.')[1], 'base64url').toString() : null;
      if (u.pathname === '/auth/v1/user') return who && who !== 'revoked' ? res(200, {id: who === 'anon' ? '99999999-9999-4999-8999-999999999999' : '33333333-3333-4333-8333-' + String(who.length).padStart(12, '0'), is_anonymous: who === 'anon'}) : res(401, {});
      if (u.pathname === '/rest/v1/rpc/fftt_staff_role_v1') {
        const ev = JSON.parse(init.body).p_event_id;
        const role = roles[who];
        return role && ev === EVENT ? res(200, role) : res(403, {code: '42501'});
      }
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
      assert.equal(method, 'GET');
      assert.match(u.pathname, new RegExp(`^/v4/spreadsheets/${SHEET}/values/Form%20Responses%201!A%3AZ$`));
      if (!init.headers.Authorization.startsWith('Bearer ya29.synthetic-token')) return res(401, {});
      return googleStatus === 200 ? res(200, {values: rows}) : res(googleStatus, {error: {message: 'secret upstream detail'}}, googleStatus === 429 ? {'retry-after': '99'} : {});
    }
    throw new Error('unexpected upstream request: ' + url);
  };
  return {fetchImpl, calls, tokenIssues: () => tokenIssues, advance: ms => { now += ms; }, now: () => now};
}
const baseEnv = {REGISTRATION_ENABLED: 'true', STAFF_ORIGIN: STAFF, SUPABASE_URL: C3_HOST, SUPABASE_PUBLISHABLE_KEY: KEY};
const synthEnv = {...baseEnv, REGISTRATION_SOURCE: 'synthetic-fixture'};
const googleEnv = {...baseEnv, REGISTRATION_SOURCE: 'google-sheets', REGISTRATION_EVENT_IDS: EVENT, REGISTRATION_REF_SECRET: 'x'.repeat(40),
  GOOGLE_SA_EMAIL: SA, GOOGLE_SA_PRIVATE_KEY: privateKey, REGISTRATION_SHEET_ID: SHEET, REGISTRATION_SHEET_RANGE: RANGE};
const req = (body, {method = 'POST', token = tok('organizer'), origin = STAFF, url = STAFF + '/api/registrations', ct = 'application/json', headers = {}} = {}) => new Request(url, {
  method, headers: {...(token ? {authorization: 'Bearer ' + token} : {}), ...(origin ? {origin} : {}), ...(ct ? {'content-type': ct} : {}), ...headers},
  body: method === 'GET' || method === 'OPTIONS' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))});
const call = (env, w, r) => createRegistrationHandler({env, fetchImpl: w.fetchImpl, now: w.now})(r);

test('fail closed: any missing or wrong setting answers the same generic 503 and reveals nothing', async () => {
  const w = world();
  const bad = [{}, {...synthEnv, REGISTRATION_ENABLED: 'yes'}, {...synthEnv, STAFF_ORIGIN: 'https://evil.example'}, {...synthEnv, STAFF_ORIGIN: 'http://x.pages.dev'},
    {...synthEnv, SUPABASE_URL: 'https://other.supabase.co'}, {...synthEnv, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abcdefghijkl'},
    {...synthEnv, REGISTRATION_EVENT_IDS: 'not-a-uuid'}, {...googleEnv, REGISTRATION_EVENT_IDS: ''}, {...googleEnv, REGISTRATION_EVENT_IDS: undefined},
    {...googleEnv, REGISTRATION_REF_SECRET: 'short'}, {...googleEnv, REGISTRATION_SOURCE: 'excel'}];
  for (const env of bad) {
    const r = await call(env, w, req({event_id: EVENT}));
    assert.equal(r.status, 503, JSON.stringify(env));
    assert.deepEqual(await r.json(), {error: 'registration-not-configured'});
  }
  assert.equal(w.calls.length, 0, 'nothing upstream is contacted when the adapter is not configured');
  // a configured source whose Google settings are incomplete is refused at read time, also generically (after authorization)
  const r = await call({...googleEnv, GOOGLE_SA_EMAIL: 'nope'}, w, req({event_id: EVENT}));
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), {error: 'registration-not-configured'});
});

test('request hygiene: POST only, one approved origin, JSON, small body, exact fields', async () => {
  const w = world();
  assert.equal((await call(synthEnv, w, req(null, {method: 'GET'}))).status, 405);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {origin: 'https://evil.example'}))).status, 403);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {url: 'https://fftt-games-test.pages.dev/api/registrations', origin: null}))).status, 404, 'the spectator origin never answers');
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {token: null}))).status, 401);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {token: 'not-a-jwt'}))).status, 401);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {ct: 'text/plain'}))).status, 415);
  assert.equal((await call(synthEnv, w, req('{"event_id":'))).status, 400);
  assert.equal((await call(synthEnv, w, req({event_id: 'nope'}))).status, 400);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT, extra: 1}))).status, 400);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT, pad: 'x'.repeat(2000)}))).status, 413);
  assert.equal((await call(synthEnv, w, req(null, {method: 'OPTIONS'}))).status, 204);
  assert.equal((await call(synthEnv, w, req(null, {method: 'OPTIONS', origin: 'https://evil.example'}))).status, 403);
  const pre = await call(synthEnv, w, req(null, {method: 'OPTIONS'}));
  assert.equal(pre.headers.get('access-control-allow-origin'), STAFF);
  assert.equal(w.calls.length, 0, 'malformed requests never reach Supabase');
});

test('ORGANIZER ONLY: scorekeeper, outsider, revoked, anonymous and expired callers are refused; the database decides', async () => {
  const w = world({roles: {organizer: 'organizer', scorekeeper: 'scorekeeper'}});
  const ok = await call(synthEnv, w, req({event_id: EVENT}));
  assert.equal(ok.status, 200);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {token: tok('scorekeeper')}))).status, 403);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {token: tok('outsider')}))).status, 403);
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {token: tok('revoked')}))).status, 401, 'a signed-out/revoked session is refused');
  assert.equal((await call(synthEnv, w, req({event_id: EVENT}, {token: tok('anon')}))).status, 401, 'an anonymous account is refused');
  assert.equal((await call(synthEnv, w, req({event_id: OTHER_EVENT}))).status, 403, 'an organizer of another event gets nothing for this one');
  const down = world({supaDown: true});
  assert.equal((await call(synthEnv, down, req({event_id: EVENT}))).status, 503);
  // every upstream call is the caller's OWN token + the publishable key; no privileged key, no other host
  for (const c of w.calls) {
    assert.equal(c.host, new URL(C3_HOST).host);
    assert.equal(c.apikey, KEY);
    assert.match(c.auth, /^Bearer hdr\./);
  }
});

test('the synthetic-fixture source returns reviewable registrants with NO contact data', async () => {
  const w = world();
  const r = await call(synthEnv, w, req({event_id: EVENT}));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const text = await r.text();
  const payload = parseRegistrationPayload(JSON.parse(text));
  assert.equal(payload.source, 'synthetic-fixture');
  assert.equal(payload.registrants.length, 20);
  assert.ok(!/example\.invalid|\b555\b|7345550|@(?!•)/i.test(text.replace(/[a-z]•••@[a-z]•••\.[a-z]+/g, '')), 'no address or number anywhere in the response');
  assert.ok(!/Bringing my kids|Typed my|Resubmitted|household/i.test(text));
  assert.equal(w.calls.filter(c => c.host.includes('google')).length, 0, 'the fixture source never contacts Google');
});

test('Google source: read-only, signed service-account assertion, one token + one GET, short cache, reference stability', async () => {
  const w = world();
  const state = createHandlerState();
  const run = () => createRegistrationHandler({env: googleEnv, fetchImpl: w.fetchImpl, now: w.now, state})(req({event_id: EVENT}));
  const first = await run();
  assert.equal(first.status, 200);
  const p1 = parseRegistrationPayload(await first.json());
  assert.equal(p1.source, 'google-sheets');
  const g = () => w.calls.filter(c => c.host.endsWith('googleapis.com'));
  assert.deepEqual(g().map(c => `${c.method} ${c.host}${c.path.slice(0, 3)}`), ['POST oauth2.googleapis.com/to', 'GET sheets.googleapis.com/v4']);
  assert.ok(g().every(c => c.method === 'GET' || c.path === '/token'), 'no write call exists');
  // second request inside the cache window: no Google traffic at all
  await run(); assert.equal(g().length, 2);
  // after the window: one more GET, the OAuth token is reused
  w.advance(25_000);
  const later = parseRegistrationPayload(await (await run()).json());
  assert.equal(g().length, 3); assert.equal(w.tokenIssues(), 1);
  assert.deepEqual(later.registrants.map(x => x.ref), p1.registrants.map(x => x.ref), 'references are stable between reads');
  // references depend on the secret: another secret yields different references (so refs cannot be recomputed from a guess)
  const w2 = world();
  const other = parseRegistrationPayload(await (await createRegistrationHandler({env: {...googleEnv, REGISTRATION_REF_SECRET: 'y'.repeat(40)}, fetchImpl: w2.fetchImpl, now: w2.now})(req({event_id: EVENT}))).json());
  assert.notEqual(other.registrants[0].ref, p1.registrants[0].ref);
  // the secret key never appears in a response
  assert.ok(!JSON.stringify(p1).includes('PRIVATE KEY'));
});

test('Google source requires the event to be allowlisted: other events (even the caller\'s own) are refused', async () => {
  const w = world({roles: {organizer: 'organizer'}});
  const w2 = world();
  const env = {...googleEnv, REGISTRATION_EVENT_IDS: OTHER_EVENT.toUpperCase()};
  const r = await call(env, w2, req({event_id: EVENT}));
  assert.equal(r.status, 403); assert.deepEqual(await r.json(), {error: 'event-not-enabled'});
  assert.equal(w2.calls.filter(c => c.host.endsWith('googleapis.com')).length, 0, 'Google is not contacted for a non-allowlisted event');
  assert.equal(w.calls.length, 0);
});

test('Google failures map to safe answers without leaking upstream detail', async () => {
  const cases = [[{googleStatus: 403}, 502, 'source-unauthorized'], [{googleStatus: 404}, 502, 'source-not-found'], [{googleStatus: 400}, 502, 'source-not-found'],
    [{googleStatus: 429}, 503, 'source-busy'], [{googleStatus: 500}, 502, 'source-unavailable'], [{googleStatus: 401}, 502, 'source-unauthorized'],
    [{tokenStatus: 400}, 502, 'source-unauthorized'], [{tokenStatus: 503}, 502, 'source-unavailable']];
  for (const [opts, status, error] of cases) {
    const w = world(opts);
    const r = await call(googleEnv, w, req({event_id: EVENT}));
    assert.equal(r.status, status, JSON.stringify(opts));
    const text = await r.text();
    assert.deepEqual(JSON.parse(text), {error}, JSON.stringify(opts));
    assert.ok(!/secret upstream detail|ya29/.test(text));
  }
  assert.equal((await call(googleEnv, world({googleStatus: 429}), req({event_id: EVENT}))).headers.get('retry-after'), '30');
  const malformed = world({rows: 'nonsense'});
  assert.equal((await call(googleEnv, malformed, req({event_id: EVENT}))).status, 502);
  const wide = world({rows: [Array.from({length: 61}, () => 'x')]});
  assert.equal((await call(googleEnv, wide, req({event_id: EVENT}))).status, 502);
});

test('a sheet with no usable name column is reported, never guessed at', async () => {
  const w = world({rows: [['Timestamp', 'Email'], ['2026/11/01', 'a@example.invalid']]});
  const r = parseRegistrationPayload(await (await call(googleEnv, w, req({event_id: EVENT}))).json());
  assert.equal(r.registrants.length, 0);
  assert.match(r.warnings[0], /No name column/);
});

test('rate limit: a burst from one account is slowed; another account is unaffected', async () => {
  const w = world({roles: {organizer: 'organizer', other: 'organizer'}});
  const state = createHandlerState();
  const run = token => createRegistrationHandler({env: synthEnv, fetchImpl: w.fetchImpl, now: w.now, state})(req({event_id: EVENT}, {token}));
  for (let i = 0; i < 12; i++) assert.equal((await run(tok('organizer'))).status, 200);
  const limited = await run(tok('organizer'));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '30');
  assert.equal((await run(tok('other'))).status, 200);
  w.advance(61_000);
  assert.equal((await run(tok('organizer'))).status, 200);
});

test('reader: strict configuration, pinned hosts, key problems fail closed', async () => {
  const w = world();
  const ok = {serviceAccountEmail: SA, privateKeyPem: privateKey, sheetId: SHEET, range: RANGE, fetchImpl: w.fetchImpl, now: w.now};
  assert.equal((await createGoogleSheetsReader(ok).readRows()).length, 22);
  for (const bad of [{serviceAccountEmail: 'x@gmail.com'}, {sheetId: 'short'}, {sheetId: '../../etc/passwd' + 'x'.repeat(20)}, {range: 'A1; DROP'}, {range: ''},
    {privateKeyPem: 'nope'}, {fetchImpl: null}]) {
    assert.throws(() => createGoogleSheetsReader({...ok, ...bad}), e => e instanceof RegistrationSourceError && e.kind === 'not-configured');
  }
  // a syntactically plausible but wrong key is refused at use, as "not configured", not as an internal error
  const garbage = '-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(300) + '\n-----END PRIVATE KEY-----';
  await assert.rejects(createGoogleSheetsReader({...ok, privateKeyPem: garbage}).readRows(), e => e.kind === 'not-configured');
  // a key pasted with literal \n sequences (common in secret stores) works
  const escaped = privateKey.replace(/\n/g, '\\n');
  assert.equal((await createGoogleSheetsReader({...ok, privateKeyPem: escaped}).readRows()).length, 22);
  // every upstream URL is on the two pinned Google hosts
  for (const c of w.calls) assert.ok(['oauth2.googleapis.com', 'sheets.googleapis.com'].includes(c.host));
  assert.throws(() => createRefMaker('short', 'x'), e => e.kind === 'not-configured');
  const maker = createRefMaker('k'.repeat(40), 'sheet-a');
  assert.equal(await maker('row'), await maker('row'));
  assert.notEqual(await maker('row'), await createRefMaker('k'.repeat(40), 'sheet-b')('row'));
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
