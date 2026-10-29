/** Signing in WITHOUT typing an event id: the session still ends up scoped to one event whose role is proven
 * independently; the event list is the person's own (their token); held tokens are cleaned up. Zero network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimCloud, EVENT, OTHER_EVENT} from './milestone1_sim_cloud.mjs';
import {makePasswordClient} from './milestone1_sim_password_clients.mjs';
import {StaffSignInError} from '../contracts/milestone1_password_transport.mjs';

const MAIL = 'organizer@example.invalid', PASS = 'pw-discovery-1';
const ev = (eventId, name, lifecycle = 'active', role = 'organizer', date = '2026-11-22') => ({eventId, name, date, lifecycle, role});
const kind = async p => { try { await p; return 'ok'; } catch (e) { return e instanceof StaffSignInError ? e.kind : 'other:' + e?.message; } };
function world(list, {grants = [EVENT, OTHER_EVENT], ...policy} = {}) {
  const cloud = createSimCloud();
  const id = cloud.addUser(MAIL, PASS);
  for (const g of grants) cloud.grant(id, g, 'organizer');
  const calls = {list: 0, tokens: []};
  const listEvents = async ({token}) => { calls.list++; calls.tokens.push(token); return typeof list === 'function' ? list() : list; };
  return {cloud, id, calls, client: name => makePasswordClient(cloud, name, {listEvents, ...policy})};
}

test('one event: signing in without an event id enters it directly (role proven for that event)', async () => {
  const {client, calls} = world([ev(EVENT, 'FFTT3 Rehearsal')], {grants: [EVENT]});
  const a = client('a');
  const r = await a.session.signIn({email: MAIL, password: PASS});
  assert.equal(r.role, 'organizer');
  assert.equal(a.session.currentEventId, EVENT);
  assert.equal(calls.list, 1);
  assert.equal(a.session.status.eventScoped, true);
});

test('several events: the person chooses by NAME; only then is a session scoped, and the role is re-proven for the choice', async () => {
  const {client, cloud} = world([ev(OTHER_EVENT, 'Old Archive', 'archived'), ev(EVENT, 'FFTT3 Rehearsal'), ev('00000000-1111-4111-8111-000000000abc', 'Done', 'complete', 'organizer', '2026-08-23')]);
  const a = client('a');
  const r = await a.session.signIn({email: MAIL, password: PASS});
  assert.ok(r.choose, 'a choice is offered');
  assert.deepEqual(r.choose.events.map(e => e.name), ['FFTT3 Rehearsal', 'Done', 'Old Archive'], 'current first, archived last');
  assert.equal(a.session.status.eventScoped, false, 'no session exists before a choice');
  assert.equal(await kind(a.session.readDesk()), 'expired');
  const done = await r.finish(EVENT);
  assert.equal(done.role, 'organizer');
  assert.equal(a.session.currentEventId, EVENT);
  assert.equal(a.session.status.eventScoped, true);
  assert.equal(await kind(r.finish(EVENT)), 'expired', 'a choice is single use');
  assert.equal(cloud.familyCount(), 1);
});

test('a choice outside the offered list, or one the account cannot hold, is refused and signs the tokens out', async () => {
  const {client, cloud} = world([ev(EVENT, 'A'), ev(OTHER_EVENT, 'B')], {grants: [EVENT]});   // B is listed but NOT granted
  const a = client('a');
  const r = await a.session.signIn({email: MAIL, password: PASS});
  assert.equal(await kind(r.finish('00000000-1111-4111-8111-0000000000ff')), 'invalid-input');
  assert.equal(await kind(r.finish(OTHER_EVENT)), 'not-authorized', 'the independent role proof refuses an event without a grant');
  assert.equal(a.session.status.eventScoped, false);
  assert.equal(cloud.familyCount(), 0, 'the half-open server session was ended');
});

test('cancel and expiry sign the held session out on the server; a new sign-in replaces a pending choice', async () => {
  const {client, cloud} = world([ev(EVENT, 'A'), ev(OTHER_EVENT, 'B')]);
  const a = client('a');
  const r1 = await a.session.signIn({email: MAIL, password: PASS});
  assert.equal(cloud.familyCount(), 1);
  await r1.cancel();
  assert.equal(cloud.familyCount(), 0);
  assert.equal(await kind(r1.finish(EVENT)), 'expired');
  const r2 = await a.session.signIn({email: MAIL, password: PASS});
  const r3 = await a.session.signIn({email: MAIL, password: PASS});
  assert.equal(cloud.familyCount(), 1, 'the first pending session was replaced, not orphaned');
  assert.equal(await kind(r2.finish(EVENT)), 'expired');
  cloud.clock.t += 6 * 60_000;
  assert.equal(await kind(r3.finish(EVENT)), 'expired', 'a choice older than five minutes is dead');
  assert.equal(cloud.familyCount(), 0);
});

test('no events at all, a failing list, or a missing list function: refused cleanly, nothing left signed in', async () => {
  for (const list of [[], () => { throw new Error('boom'); }, () => 'not-an-array', [{eventId: 'bad', name: 'x'}]]) {
    const {client, cloud} = world(list);
    const a = client('a');
    const k = await kind(a.session.signIn({email: MAIL, password: PASS}));
    assert.ok(['not-authorized', 'unavailable'].includes(k), k);
    assert.equal(cloud.familyCount(), 0);
    assert.equal(a.session.status.eventScoped, false);
  }
  const cloud = createSimCloud(); cloud.grant(cloud.addUser(MAIL, PASS), EVENT, 'organizer');
  const bare = makePasswordClient(cloud, 'bare');            // no listEvents wired: an event id stays mandatory
  assert.equal(await kind(bare.session.signIn({email: MAIL, password: PASS})), 'invalid-input');
  assert.equal(cloud.familyCount(), 0);
  assert.equal(await kind(bare.session.signIn({email: MAIL, password: PASS, eventId: EVENT})), 'ok', 'the original event-id sign-in is untouched');
});

test('the event list is read with the person\'s own fresh token, after an identity check', async () => {
  const {client, calls, cloud, id} = world([ev(EVENT, 'A'), ev(OTHER_EVENT, 'B')]);
  const a = client('a');
  await a.session.signIn({email: MAIL, password: PASS});
  assert.equal(calls.tokens.length, 1);
  assert.equal(calls.tokens[0], cloud.latestToken(id));
  assert.ok(cloud.log.some(l => l.path === '/auth/v1/user'), 'identity is checked before the list is trusted');
});

test('sign-in with an explicit event id never consults the event list', async () => {
  const {client, calls} = world([ev(EVENT, 'A'), ev(OTHER_EVENT, 'B')]);
  const a = client('a');
  assert.equal((await a.session.signIn({email: MAIL, password: PASS, eventId: EVENT})).role, 'organizer');
  assert.equal(calls.list, 0);
});

test('emailed-code recovery also works without an event id', async () => {
  const {client, cloud} = world([ev(EVENT, 'A'), ev(OTHER_EVENT, 'B')]);
  const a = client('a');
  await a.recovery.request(MAIL);
  const r = await a.recovery.verify({email: MAIL, code: cloud.peekCode(MAIL)});
  assert.ok(r.choose);
  assert.equal((await r.finish(OTHER_EVENT)).role, 'organizer');
  assert.equal(a.session.currentEventId, OTHER_EVENT);
});
