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
