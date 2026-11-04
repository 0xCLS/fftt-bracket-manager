import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSimCloud,EVENT,OTHER_EVENT} from './milestone1_sim_cloud.mjs';
import {makePasswordClient} from './milestone1_sim_password_clients.mjs';
import {StaffSignInError} from '../contracts/milestone1_password_transport.mjs';
import {createMilestone1StaffAccessGate} from '../contracts/milestone1_staff_access_gate.mjs';
import {createMilestone1StaffSessionVault} from '../contracts/milestone1_staff_session_vault.mjs';
import {tabStorage} from './milestone1_sim_clients.mjs';

// Regression: a person whose ONLY role is Bracket Manager was refused at sign-in with "does not have access to an event",
// because the independent role gate and the tab-session vault still whitelisted just organizer and scorekeeper.
const MAIL = 'bracket-manager@example.invalid';
const pw = () => 'pw-' + randomUUID();
const names = {[EVENT]: 'Synthetic event one', [OTHER_EVENT]: 'Synthetic event two'};
const kindOf = async p => { try { await p; return 'ok'; } catch (e) { return e instanceof StaffSignInError ? e.kind : 'other:' + e?.message; } };

function world(roles) {
  const cloud = createSimCloud(), password = pw(), id = cloud.addUser(MAIL, password);
  for (const [event, role] of Object.entries(roles)) cloud.grant(id, event, role);
  const listEvents = async () => Object.keys(roles).map(eventId => ({eventId, name: names[eventId], date: '2099-01-01', lifecycle: 'active', role: roles[eventId]}));
  return {cloud, id, password, client: (name, o) => makePasswordClient(cloud, name, {listEvents, ...o})};
}

test('a Bracket Manager with two events chooses one by name and is admitted with that role', async () => {
  const {password, client} = world({[EVENT]: 'bracket_manager', [OTHER_EVENT]: 'bracket_manager'});
  const c = client('bm');
  const offered = await c.session.signIn({email: MAIL, password});
  assert.deepEqual(offered.choose.events.map(e => e.role), ['bracket_manager', 'bracket_manager']);
  const r = await offered.finish(EVENT);
  assert.deepEqual([r.role, r.scoreWritesEnabled], ['bracket_manager', false]);
});

test('a Bracket Manager with a single event is admitted directly, and with an explicit event id', async () => {
  const {password, client} = world({[EVENT]: 'bracket_manager'});
  assert.equal((await client('one').session.signIn({email: MAIL, password})).role, 'bracket_manager');
  assert.equal((await client('explicit').session.signIn({email: MAIL, password, eventId: EVENT})).role, 'bracket_manager');
});

test('a kept Bracket Manager session survives a refresh (vault restore) with the same role', async () => {
  const {password, client} = world({[EVENT]: 'bracket_manager'});
  const c = client('keep', {allowTabPersistence: true, storage: tabStorage()});
  const r = await c.session.signIn({email: MAIL, password, eventId: EVENT, keepSignedIn: true});
  assert.deepEqual([r.role, r.persisted], ['bracket_manager', true]);
  assert.equal(c.vault.read()?.role, 'bracket_manager');
  const restored = await c.reload().session.restore();
  assert.equal(restored?.role, 'bracket_manager');
});

test('the role gate admits bracket_manager but still refuses unknown, changed and revoked roles', async () => {
  let role = 'bracket_manager';
  const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', EV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const gate = createMilestone1StaffAccessGate({getAccessToken: async () => 'header.payload.signature',
    readIdentity: async () => ({id: ID, is_anonymous: false}), readRole: async () => role, isOnline: () => true, now: () => 10000});
  assert.equal((await gate.verify({eventId: EV, expiresAt: 70000})).role, 'bracket_manager');
  assert.deepEqual(await gate.withFreshRole(EV, async () => ({ok: true})), {ok: true});
  role = 'scorekeeper';   // a role change under a live session must not be accepted silently
  await assert.rejects(() => gate.withFreshRole(EV, async () => true));
  for (const bad of ['outsider', 'admin', '', null, undefined]) {
    role = bad;
    await assert.rejects(() => gate.verify({eventId: EV, expiresAt: 70000}), `role ${String(bad)} must stay refused`);
  }
});

test('the session vault stores bracket_manager but still rejects any other role', () => {
  const storage = tabStorage(), vault = createMilestone1StaffSessionVault({tabStorage: storage});
  const entry = {v: 1, refreshToken: 'refresh-token-value-1234', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'bracket_manager', startedAt: 1000, lastActiveAt: 2000};
  assert.equal(vault.write(entry), true);
  assert.equal(vault.read().role, 'bracket_manager');
  for (const role of ['admin', 'owner', 'Bracket_Manager', '']) assert.equal(vault.write({...entry, role}), false, `vault must refuse ${role}`);
});
