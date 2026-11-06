/** The Bracket Manager desk's proof contract and wire shapes, with no database: the exact bytes the Function signs (the SQL verifies
 * the same bytes; tests/e2e/bm_registration_lookup.test.mjs pins the two against each other), the strict desk payload, the client's
 * request/answer handling and the Function's role boundaries with a minimal mocked Supabase. Fictional data only; zero network.
 * Run: node --test tests/registration_gate.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createGate, checkinFields, sourceFingerprint, GATE_LIFETIME_SECONDS} from '../server/registration/gate.mjs';
import {createRegistrationHandler, createHandlerState} from '../server/registration/handler.mjs';
import {createRegistrationClient, parseLookupPayload, parseCheckinResult, RegistrationClientError} from '../contracts/registration_client.mjs';
import {C3_HOST} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';

const SEP = '\u001f';
const SECRET = 'fictional-gate-secret-0123456789abcdef!!';
const hmac = (secret, msg) => crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(msg, 'utf8')).digest('hex');
const EVENT = '11111111-1111-4111-8111-111111111111', USER = '33333333-3333-4333-8333-000000000001';

test('a proof is HMAC-SHA256 over the documented fields, lower-cased ids, a 45-second expiry; the secret must be 32-200 characters', async () => {
  const t = Date.parse('2026-11-08T12:00:00Z');
  const gate = createGate(SECRET, {now: () => t});
  const fields = checkinFields('fixture', [{ref: 'A'.repeat(32), name: 'Ben Marlowe', rating: 2}, {ref: 'B'.repeat(32), same_as_ref: 'A'.repeat(32), name: 'Ben M', rating: 2}]);
  assert.equal(fields, ['fixture', 'A'.repeat(32), '', 'Ben Marlowe', '2', 'B'.repeat(32), 'A'.repeat(32), 'Ben M', '2'].join(SEP));
  const {exp, proof} = await gate.sign('checkin', EVENT.toUpperCase(), USER.toUpperCase(), fields);
  assert.equal(exp, Math.floor(t / 1000) + GATE_LIFETIME_SECONDS); assert.equal(GATE_LIFETIME_SECONDS, 45);
  assert.equal(proof, hmac(SECRET, ['fftt-reg-gate-v1', 'checkin', EVENT, USER, String(exp), fields].join(SEP)));
  // a golden value: changing the layout silently would break the database's verification
  assert.equal((await gate.sign('lookup', EVENT, USER)).proof, hmac(SECRET, `fftt-reg-gate-v1${SEP}lookup${SEP}${EVENT}${SEP}${USER}${SEP}${exp}${SEP}`));
  for (const x of [undefined, null, '', 'short', 'x'.repeat(31), 'x'.repeat(201), 42]) assert.equal(createGate(x), null);
  assert.ok(createGate('x'.repeat(32)) && createGate('x'.repeat(200)));
  // every field changes the proof
  const base = (await gate.sign('checkin', EVENT, USER, fields)).proof;
  for (const alt of [gate.sign('lookup', EVENT, USER, fields), gate.sign('checkin', '22222222-2222-4222-8222-222222222222', USER, fields), gate.sign('checkin', EVENT, USER.replace('1', '2'), fields), gate.sign('checkin', EVENT, USER, fields + 'x')])
    assert.notEqual((await alt).proof, base);
});

test('the source fingerprint is "fixture" or sha256(kind, spreadsheet id, worksheet) and changes with either', async () => {
  assert.equal(await sourceFingerprint({configured: false}), 'fixture');
  assert.equal(await sourceFingerprint({configured: true, kind: 'fixture'}), 'fixture');
  const src = {configured: true, kind: 'google-sheets', spreadsheetId: 'SYNTHETIC_SHEET_A_0123456789abcdef', worksheet: 'Form responses 1'};
  assert.equal(await sourceFingerprint(src), crypto.createHash('sha256').update(['google-sheets', src.spreadsheetId, src.worksheet].join(SEP)).digest('hex'));
  assert.notEqual(await sourceFingerprint(src), await sourceFingerprint({...src, worksheet: 'Other'}));
  assert.notEqual(await sourceFingerprint(src), await sourceFingerprint({...src, spreadsheetId: 'SYNTHETIC_SHEET_B_0123456789abcdef'}));
});

const REG = (over = {}) => ({ref: 'R'.repeat(32), name: 'Ben Marlowe', registeredAt: '2026/11/01 09:12:01', suggestedRating: 2, ratingConfidence: 'high', ratingBasis: ['Plays weekly'], ratingReview: false,
  nameIssue: null, duplicate: null, roster: null, ...over});
const PAYLOAD = (over = {}) => ({source: 'google-sheets', sourceName: 'Sign-ups', fetchedAt: '2026-11-08T12:00:00.000Z', checkInOpen: true, rosterSize: 0, registrants: [REG()], duplicates: [],
  summary: {total: 1, duplicateGroups: 0, needsNameFix: 0, lowConfidence: 0, needsRating: 0}, warnings: [], ...over});

test('the desk payload contract is a strict allowlist: no contact hints, no extra keys, no contact text, no bad roster state', () => {
  const ok = parseLookupPayload(PAYLOAD());
  assert.deepEqual(Object.keys(ok.registrants[0]).sort(), ['duplicate', 'name', 'nameIssue', 'ratingBasis', 'ratingConfidence', 'ratingReview', 'ref', 'registeredAt', 'roster', 'suggestedRating']);
  assert.ok(Object.isFrozen(ok) && Object.isFrozen(ok.registrants[0]));
  const bad = [PAYLOAD({registrants: [{...REG(), hint: {email: 'b•••@e•••.invalid', phone: null}}]}), PAYLOAD({registrants: [{...REG(), shortName: 'Ben M'}]}), PAYLOAD({extra: 1}),
    PAYLOAD({registrants: [REG({name: 'ben@example.invalid'})]}), PAYLOAD({registrants: [REG({name: 'Call 734 555 0101'})]}), PAYLOAD({registrants: [REG({ratingBasis: ['mail me at a@b.co']})]}),
    PAYLOAD({registrants: [REG(), REG()]}), PAYLOAD({registrants: [REG({ref: 'short'})]}), PAYLOAD({registrants: [REG({suggestedRating: 7})]}),
    PAYLOAD({registrants: [REG({roster: {playerId: 'not-a-uuid', checkedIn: true}})]}), PAYLOAD({registrants: [REG({roster: {playerId: EVENT, checkedIn: true, extra: 1}})]}),
    PAYLOAD({sourceName: 'call (734) 555-0101'}), PAYLOAD({source: 'csv-import'}), PAYLOAD({checkInOpen: 'yes'}),
    PAYLOAD({registrants: [REG({duplicate: {group: 'g1', reasons: ['same-email'], strength: 'definite'}})], duplicates: [{id: 'g1', reasons: ['same-email'], strength: 'definite', refs: ['R'.repeat(32), 'Z'.repeat(32)]}]})];
  for (const [i, b] of bad.entries()) assert.throws(() => parseLookupPayload(b), RegistrationClientError, 'case ' + i);
  assert.deepEqual(parseCheckinResult({status: 'saved', outcome: 'created', playerId: EVENT.toUpperCase(), eventRevision: 5}), {status: 'saved', outcome: 'created', playerId: EVENT, eventRevision: 5});
  for (const b of [{}, {status: 'ok', outcome: 'created', playerId: EVENT, eventRevision: 1}, {status: 'saved', outcome: 'created', playerId: EVENT, eventRevision: 1, name: 'Ben'}, {status: 'saved', outcome: 'created', playerId: 'x', eventRevision: 1}])
    assert.throws(() => parseCheckinResult(b), RegistrationClientError);
});

/** The client: what it sends (opaque reference and an optional level only) and how it explains each refusal. */
test('the client sends only an opaque reference, an optional level, merge references and a roster link; every refusal maps to a specific, sanitized kind', async () => {
  const seen = [];
  const answer = (status, body) => async (url, init) => { seen.push(JSON.parse(init.body)); return {status, json: async () => body}; };
  const tok = 'aaa.bbb.ccc';
  const ref = 'R'.repeat(32);
  const client = (status, body) => createRegistrationClient({fetchImpl: answer(status, body)});
  assert.deepEqual(await client(200, {status: 'saved', outcome: 'created', playerId: EVENT, eventRevision: 3}).checkin(tok, {eventId: EVENT, ref, mergeRefs: ['M'.repeat(32)], level: 4, linkPlayerId: EVENT}),
    {status: 'saved', outcome: 'created', playerId: EVENT, eventRevision: 3});
  assert.deepEqual(seen.at(-1), {action: 'checkin', event_id: EVENT, ref, merge_refs: ['M'.repeat(32)], level: 4, link_player_id: EVENT});
  await client(200, {status: 'saved', outcome: 'created', playerId: EVENT, eventRevision: 3}).checkin(tok, {eventId: EVENT, ref});
  assert.deepEqual(seen.at(-1), {action: 'checkin', event_id: EVENT, ref}, 'nothing else is ever sent');
  await assert.rejects(client(200, {}).checkin(tok, {eventId: EVENT, ref: 'bad ref'}), e => e.kind === 'malformed');
  const kind = async (status, body) => client(status, body).checkin(tok, {eventId: EVENT, ref}).catch(e => [e.kind, e.detail]);
  assert.deepEqual(await kind(404, {error: 'registration-not-found'}), ['registration-not-found', null]);
  assert.deepEqual(await kind(422, {error: 'name-incomplete'}), ['name-incomplete', null]);
  assert.deepEqual(await kind(422, {error: 'level-required'}), ['level-required', null]);
  assert.deepEqual(await kind(409, {error: 'conflict', detail: 'bracket-locked'}), ['conflict', 'bracket-locked']);
  assert.deepEqual(await kind(409, {error: 'conflict', detail: 'SELECT * FROM secrets'}), ['conflict', null], 'only allowlisted details survive');
  assert.deepEqual(await kind(503, {error: 'outcome-unknown'}), ['outcome-unknown', null]);
  assert.deepEqual(await kind(503, {error: 'registration-not-configured'}), ['not-configured', null]);
  assert.deepEqual(await kind(403, {error: 'forbidden'}), ['forbidden', null]);
  assert.deepEqual(await kind(401, {error: 'access-rejected'}), ['access-rejected', null]);
  assert.deepEqual(await kind(200, {status: 'saved', outcome: 'created', playerId: EVENT, eventRevision: 1, name: 'leak'}), ['malformed', null]);
  await assert.rejects(createRegistrationClient({fetchImpl: async () => { throw new TypeError('x'); }}).lookup(tok, {eventId: EVENT}), e => e.kind === 'network');
});

/** The Function with a minimal mocked Supabase: roles, proofs verified by an INDEPENDENT HMAC, and what reaches the database. */
function mock({role = 'bracket_manager', gateSecret = SECRET, links = [], source = null, rpcThrows = false, rpcStatus = 200, rpcBody = null} = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); calls.push({path: u.pathname, body: init.body ? JSON.parse(init.body) : null});
    const res = (status, body) => ({status, headers: {get: () => null}, json: async () => body});
    if (u.origin !== C3_HOST) throw new Error('unexpected host ' + u.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const verify = (purpose, fields) => body.p_proof === hmac(gateSecret, ['fftt-reg-gate-v1', purpose, EVENT, USER, String(body.p_exp), fields].join(SEP));
    if (u.pathname === '/auth/v1/user') return res(200, {id: USER, is_anonymous: false});
    if (u.pathname === '/rest/v1/rpc/fftt_staff_role_v1') return role ? res(200, role) : res(403, {});
    if (u.pathname === '/rest/v1/rpc/fftt_bm_registration_lookup_v1') {
      if (!verify('lookup', '')) return res(403, {code: '42501'});
      return res(200, source ?? {configured: false, event_synthetic: true, kind: null, spreadsheet_id: null, spreadsheet_title: null, worksheet: null, column_map: {}, enabled: false,
        source_fp: 'fixture', check_in_open: true, roster_size: 0, links});
    }
    if (u.pathname === '/rest/v1/rpc/fftt_bm_registration_checkin_v1') {
      if (rpcThrows) throw new TypeError('network');
      if (rpcBody) return res(rpcStatus, rpcBody);
      if (!verify('checkin', body.p_source_fp + body.p_items.map(i => `${SEP}${i.ref}${SEP}${i.same_as_ref ?? ''}${SEP}${i.name}${SEP}${i.rating}`).join(''))) return res(403, {code: '42501'});
      return res(200, {status: 'saved', outcome: 'created', player_id: '44444444-4444-4444-8444-444444444444', event_revision: 9});
    }
    return res(404, {});
  };
  const env = {REGISTRATION_ENABLED: 'true', STAFF_ORIGIN: 'https://fftt-staff-test.pages.dev', SUPABASE_URL: C3_HOST, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testkey0123456789', REGISTRATION_FIXTURE: 'true',
    ...(gateSecret ? {REGISTRATION_GATE_SECRET: gateSecret} : {})};
  const handler = createRegistrationHandler({env, fetchImpl, state: createHandlerState()});
  const ask = body => handler(new Request('https://fftt-staff-test.pages.dev/api/registrations', {method: 'POST', headers: {authorization: 'Bearer aaa.bbb.ccc', 'content-type': 'application/json', origin: 'https://fftt-staff-test.pages.dev'},
    body: JSON.stringify({event_id: EVENT, ...body})}));
  return {ask, calls};
}

test('Function: only the Bracket Manager role reaches the desk database functions; no proof is ever made for anyone else', async () => {
  for (const role of ['organizer', 'scorekeeper', null]) {
    const m = mock({role});
    assert.equal((await m.ask({action: 'lookup'})).status, 403, String(role));
    assert.equal((await m.ask({action: 'checkin', ref: 'R'.repeat(32)})).status, 403, String(role));
    assert.ok(!m.calls.some(c => c.path.includes('fftt_bm_')), 'the desk functions were never called for ' + role);
  }
  const m = mock({role: 'bracket_manager'});
  for (const action of ['load', 'capabilities']) { assert.equal((await m.ask({action})).status, 403, action); }
  assert.equal((await m.ask({action: 'inspect', spreadsheet: 'SYNTHETIC_SHEET_A_0123456789abcdef'})).status, 403);
  assert.ok(!m.calls.some(c => c.path.includes('fftt_registration_source_v5')), 'the Bracket Manager never triggers the source RPC');
});

test('Function: a lookup carries a valid proof and answers the desk shape; a check-in sends the SHEET\'s name and level signed, never the browser\'s', async () => {
  const m = mock();
  const look = await m.ask({action: 'lookup'});
  assert.equal(look.status, 200);
  const body = await look.json();
  const text = JSON.stringify(body);
  assert.ok(!/example\.invalid|555|"hint"|shortName|@/.test(text));
  parseLookupPayload(body);
  const ben = body.registrants.find(r => r.name === 'Ben Marlowe');
  const lookupCall = m.calls.find(c => c.path.endsWith('fftt_bm_registration_lookup_v1'));
  assert.deepEqual(Object.keys(lookupCall.body).sort(), ['p_event_id', 'p_exp', 'p_proof']);
  // the browser may not name a player or a rating
  for (const extra of [{name: 'Invented Person'}, {rating: 5}, {player_id: EVENT}, {source: 'registration'}]) assert.equal((await m.ask({action: 'checkin', ref: ben.ref, ...extra})).status, 400);
  assert.equal((await m.ask({action: 'checkin', ref: 'x'})).status, 400);
  assert.equal((await m.ask({action: 'checkin', ref: ben.ref, level: 9})).status, 400);
  assert.equal((await m.ask({action: 'checkin', ref: crypto.randomBytes(24).toString('base64url')})).status, 404, 'an unknown reference');
  const done = await m.ask({action: 'checkin', ref: ben.ref});
  assert.deepEqual(await done.json(), {status: 'saved', outcome: 'created', playerId: '44444444-4444-4444-8444-444444444444', eventRevision: 9});
  const sent = m.calls.filter(c => c.path.endsWith('fftt_bm_registration_checkin_v1')).at(-1).body;
  assert.deepEqual(sent.p_items, [{ref: ben.ref, name: 'Ben Marlowe', rating: ben.suggestedRating}]);
  assert.equal(sent.p_source_fp, 'fixture');
  assert.ok(sent.p_exp - Date.now() / 1000 <= 46);
  // a desk-chosen level is the only thing the browser can change
  await m.ask({action: 'checkin', ref: ben.ref, level: 5});
  assert.equal(m.calls.filter(c => c.path.endsWith('fftt_bm_registration_checkin_v1')).at(-1).body.p_items[0].rating, 5);
});

test('Function: secrets and database answers fail closed with sanitized codes (no secret, no raw database text)', async () => {
  for (const gateSecret of [null, 'short']) {
    const m = mock({gateSecret});
    const r = await m.ask({action: 'lookup'});
    assert.deepEqual([r.status, (await r.json()).error], [503, 'registration-not-configured']);
    assert.ok(!m.calls.some(c => c.path.includes('fftt_bm_')));
  }
  // the database holds a different key: it refuses the proof
  const other = createRegistrationHandler({env: {REGISTRATION_ENABLED: 'true', STAFF_ORIGIN: 'https://fftt-staff-test.pages.dev', SUPABASE_URL: C3_HOST, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testkey0123456789', REGISTRATION_FIXTURE: 'true',
    REGISTRATION_GATE_SECRET: 'a-different-secret-that-is-long-enough-00'}, fetchImpl: async (url, init = {}) => {
    const res = (status, body) => ({status, headers: {get: () => null}, json: async () => body});
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') return res(200, {id: USER}); if (u.pathname.endsWith('fftt_staff_role_v1')) return res(200, 'bracket_manager');
    return res(403, {code: '42501', message: 'forbidden', details: 'attestation'});
  }, state: createHandlerState()});
  const r = await other(new Request('https://fftt-staff-test.pages.dev/api/registrations', {method: 'POST', headers: {authorization: 'Bearer aaa.bbb.ccc', 'content-type': 'application/json'}, body: JSON.stringify({event_id: EVENT, action: 'lookup'})}));
  assert.deepEqual([r.status, await r.json()], [403, {error: 'forbidden'}]);
  // a lost reply is reported as an unknown outcome, never as success or as a plain failure
  const lost = mock({rpcThrows: true});
  const ben = (await (await lost.ask({action: 'lookup'})).json()).registrants[1];
  const u = await lost.ask({action: 'checkin', ref: ben.ref});
  assert.deepEqual([u.status, await u.json()], [503, {error: 'outcome-unknown'}]);
  // database refusals become allowlisted details; anything else is generic
  for (const [status, body, expected] of [[400, {code: 'P0001', message: 'fftt_conflict', details: 'bracket-locked'}, [409, {error: 'conflict', detail: 'bracket-locked'}]],
    [400, {code: 'P0001', message: 'fftt_conflict', details: 'secret table name'}, [502, {error: 'source-unavailable'}]],
    [400, {code: '22023', message: 'fftt_validation_error', details: 'player-name'}, [422, {error: 'registration-invalid'}]],
    [403, {code: '42501', message: 'forbidden'}, [403, {error: 'forbidden'}]], [500, {message: 'boom'}, [503, {error: 'outcome-unknown'}]],
    [404, {message: 'function not found'}, [503, {error: 'registration-not-configured'}]], [200, {status: 'saved', outcome: 'created', player_id: 'bad', event_revision: 1}, [503, {error: 'outcome-unknown'}]]]) {
    const m = mock({rpcStatus: status, rpcBody: body});
    const reg = (await (await m.ask({action: 'lookup'})).json()).registrants[1];
    const res = await m.ask({action: 'checkin', ref: reg.ref});
    assert.deepEqual([res.status, await res.json()], expected, JSON.stringify(body));
  }
});
