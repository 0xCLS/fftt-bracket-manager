/** The registration adapter in front of the REAL database authorization (local PostgreSQL), with the real fake-auth
 * tokens: only a CURRENT organizer of the event gets registrations. Fictional data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './harness.mjs';
import {PROJECT, PUBLISHABLE} from './fake_supabase.mjs';
import {createRegistrationHandler, createHandlerState} from '../../server/registration/handler.mjs';
import {parseRegistrationPayload} from '../../contracts/registration_model.mjs';

const STAFF = 'https://fftt-staff-test.pages.dev';
async function tokenFor(world, who) {
  const [email, password] = world.accounts[who];
  const res = await world.fake.clientFetch('t-' + who)(PROJECT + '/auth/v1/token?grant_type=password', {method: 'POST',
    headers: {apikey: PUBLISHABLE, 'content-type': 'application/json'}, body: JSON.stringify({email, password})});
  return (await res.json()).access_token;
}
const ask = (handler, token, eventId, extra = {}) => handler(new Request(STAFF + '/api/registrations', {method: 'POST',
  headers: {...(token ? {authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json', origin: STAFF},
  body: JSON.stringify({event_id: eventId, ...extra})}));

test('only a current organizer of THIS event is served; scorekeepers, outsiders, revoked organizers and other events are not', async () => {
  const w = await createWorld();
  const env = {REGISTRATION_ENABLED: 'true', STAFF_ORIGIN: STAFF, SUPABASE_URL: PROJECT, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, REGISTRATION_SOURCE: 'synthetic-fixture'};
  const handler = createRegistrationHandler({env, fetchImpl: w.fake.clientFetch('adapter'), state: createHandlerState()});
  const org = await tokenFor(w, 'org'), a = await tokenFor(w, 'a'), out = await tokenFor(w, 'out');
  const ok = await ask(handler, org, w.eventId);
  assert.equal(ok.status, 200);
  assert.equal(parseRegistrationPayload(await ok.json()).registrants.length, 20);
  assert.equal((await ask(handler, a, w.eventId)).status, 403, 'scorekeeper');
  assert.equal((await ask(handler, out, w.eventId)).status, 403, 'outsider');
  assert.equal((await ask(handler, null, w.eventId)).status, 401, 'no token');
  assert.equal((await ask(handler, org, '99999999-9999-4999-8999-999999999999')).status, 403, 'an event the caller does not organize');
  // a second organizer-less event the caller created is not enough either
  const other = await w.fake.local.rpc(w.ids.org, 'fftt_create_event_v3', {p_name: 'Second', p_date: '2026-12-01', p_table_count: 2});
  assert.equal((await ask(handler, org, other.event_id)).status, 200, 'the caller organizes the second event too');
  assert.equal((await ask(handler, a, other.event_id)).status, 403);
  // revocation is immediate (the database is asked every time)
  await w.fake.local.rpc(w.ids.org, 'fftt_set_staff_v3', {p_event_id: w.eventId, p_email: w.accounts.a[0], p_action: 'grant', p_role: 'organizer'});
  assert.equal((await ask(handler, a, w.eventId)).status, 200, 'a newly granted organizer');
  await w.fake.local.rpc(w.ids.org, 'fftt_set_staff_v3', {p_event_id: w.eventId, p_email: w.accounts.a[0], p_action: 'revoke', p_role: null});
  assert.equal((await ask(handler, a, w.eventId)).status, 403, 'revoked organizer, same still-valid token');
  w.fake.revokeSessions(w.accounts.org[0]);
  assert.equal((await ask(handler, org, w.eventId)).status, 401, 'a signed-out session is refused');
});

test('event-specific sources through the REAL database: each event serves its own source; references never collide across events; a live Google source is refused on synthetic events', async () => {
  const w = await createWorld();
  const env = {REGISTRATION_ENABLED: 'true', STAFF_ORIGIN: STAFF, SUPABASE_URL: PROJECT, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, REGISTRATION_SOURCE: 'synthetic-fixture'};
  const handler = createRegistrationHandler({env, fetchImpl: w.fake.clientFetch('adapter'), state: createHandlerState()});
  const org = await tokenFor(w, 'org'), a = await tokenFor(w, 'a');
  const other = (await w.fake.local.rpc(w.ids.org, 'fftt_create_event_v3', {p_name: 'Second', p_date: '2026-12-01', p_table_count: 2})).event_id;
  const one = parseRegistrationPayload(await (await ask(handler, org, w.eventId)).json());
  const two = parseRegistrationPayload(await (await ask(handler, org, other)).json());
  assert.equal(one.source, 'synthetic-fixture');
  assert.ok(one.registrants.every((r, i) => r.ref !== two.registrants[i].ref), 'the same fictional person has a different reference in each event');
  // an explicit saved fixture works the same; the saved record is read under the caller's own token
  await w.fake.local.rpc(w.ids.org, 'fftt_set_registration_source_v5', {p_event_id: w.eventId, p_source: {kind: 'fixture'}});
  assert.equal((await ask(handler, org, w.eventId)).status, 200);
  // a saved Google sheet (disabled: the database refuses enabling it on a synthetic event) is never read, even in a fully "enabled" deployment
  await w.fake.local.rpc(w.ids.org, 'fftt_set_registration_source_v5', {p_event_id: other, p_source: {kind: 'google-sheets', spreadsheet_id: 'SYNTHETIC_SHEET_A_0123456789abcdef', worksheet: 'Form responses 1', column_map: {}, enabled: false}});
  const live = createRegistrationHandler({env: {...env, REGISTRATION_SOURCE: undefined, REGISTRATION_GOOGLE_MODE: 'enabled', REGISTRATION_EVENT_IDS: other, REGISTRATION_REF_SECRET: 'x'.repeat(40),
    GOOGLE_SA_EMAIL: 'fftt-reader@fftt-synthetic-project.iam.gserviceaccount.com', GOOGLE_SA_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(300) + '\n-----END PRIVATE KEY-----'},
    fetchImpl: w.fake.clientFetch('adapter2'), state: createHandlerState()});
  const refused = await ask(live, org, other);
  assert.equal(refused.status, 403); assert.deepEqual(await refused.json(), {error: 'source-disabled'});
  // CROSS-EVENT: a scorekeeper of the first event (not an organizer of the second) and a caller naming a stranger's event get nothing
  assert.equal((await ask(handler, a, other)).status, 403);
  assert.equal((await ask(handler, a, w.eventId)).status, 403);
  for (const action of ['capabilities']) assert.equal((await ask(handler, a, other, {action})).status, 403);
  // the real database answers the capabilities/test requests only to that event's organizer
  assert.equal((await ask(handler, org, other, {action: 'capabilities'})).status, 200);
});
