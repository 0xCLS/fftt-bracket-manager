/** Test-only: wires the REAL client stack (password transport, session, API, score transport, staff core)
 * to the fake Supabase. A "device" is one signed-in person on one browser tab. */
import {createFakeSupabase, PUBLISHABLE} from './fake_supabase.mjs';
import {createMilestone1PasswordSupabaseTransport} from '../../contracts/milestone1_password_transport.mjs';
import {createMilestone1PasswordStaffSession} from '../../contracts/milestone1_password_session.mjs';
import {createMilestone1StaffSessionVault} from '../../contracts/milestone1_staff_session_vault.mjs';
import {createGamedayApi} from '../../contracts/gameday_api.mjs';
import {createGamedayScoreTransport} from '../../contracts/gameday_score_transport.mjs';
import {createStaffCore, createPendingLedger} from '../../app/staff_core.mjs';
import {createRegistrationClient} from '../../contracts/registration_client.mjs';
import {createRegistrationHandler, createHandlerState} from '../../server/registration/handler.mjs';

export const memoryStorage = () => {
  const m = new Map();
  return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
    get size() { return m.size; }};
};

export async function createWorld({ttlSeconds = 3600} = {}) {
  const clock = {t: Date.parse('2026-11-22T18:00:00Z')};
  const now = () => clock.t;
  const fake = await createFakeSupabase({ttlSeconds, now});
  const accounts = {
    org: ['organizer@fftt-staging.invalid', 'org-pass-' + Math.random().toString(36).slice(2)],
    a: ['scorekeeper-a@fftt-staging.invalid', 'a-pass-' + Math.random().toString(36).slice(2)],
    b: ['scorekeeper-b@fftt-staging.invalid', 'b-pass-' + Math.random().toString(36).slice(2)],
    out: ['outsider@fftt-staging.invalid', 'out-pass-' + Math.random().toString(36).slice(2)],
  };
  const ids = {};
  for (const [k, [email, pw]] of Object.entries(accounts)) ids[k] = await fake.addAccount(email, pw, {platformOrganizer: k === 'org'});
  // trusted bootstrap (the owner's SQL): one empty draft event + the three event-scoped grants
  const [ev] = await fake.local.admin(`insert into fftt_private.events(event_name,event_date,table_count,created_by)
     values ('Synthetic Rehearsal Games','2026-11-22',3,$1) returning id`, [ids.org]);
  await fake.local.admin(`insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer'),($1,$3,'scorekeeper'),($1,$4,'scorekeeper')`,
    [ev.id, ids.org, ids.a, ids.b]);
  const world = {fake, clock, now, accounts, ids, eventId: ev.id, devices: []};
  // the registration adapter (synthetic-fixture source) in front of the SAME fake backend, reached like a same-origin fetch
  const STAFF = 'https://fftt-staff-test.pages.dev', regState = createHandlerState();
  world.registrationEnv = {REGISTRATION_ENABLED: 'true', STAFF_ORIGIN: STAFF, SUPABASE_URL: fake.PROJECT, SUPABASE_PUBLISHABLE_KEY: fake.PUBLISHABLE, REGISTRATION_SOURCE: 'synthetic-fixture'};
  const registrationFetch = name => async (url, init) => {
    const offline = fake.hooks.offline.has(name);
    if (offline) throw new TypeError('Failed to fetch');
    const res = await createRegistrationHandler({env: world.registrationEnv, fetchImpl: fake.clientFetch('adapter-' + name), now, state: regState})(
      new Request(STAFF + url, {...init, headers: {...init.headers, origin: STAFF}}));
    return {status: res.status, headers: res.headers, json: () => res.json()};
  };

  world.device = (name, who, {storage = memoryStorage(), tabStorage = memoryStorage(), allowTabPersistence = false} = {}) => {
    const fetchImpl = fake.clientFetch(name);
    const online = {v: true};
    const build = () => {
      const transport = createMilestone1PasswordSupabaseTransport({publishableKey: PUBLISHABLE, allowSyntheticAuthNetwork: true, fetchImpl});
      const vault = createMilestone1StaffSessionVault({tabStorage});
      const session = createMilestone1PasswordStaffSession({transport, isOnline: () => online.v, now, vault, allowTabPersistence});
      const api = createGamedayApi({publishableKey: PUBLISHABLE, fetchImpl});
      const scoreTransport = createGamedayScoreTransport({publishableKey: PUBLISHABLE, fetchImpl});
      const registrationClient = createRegistrationClient({fetchImpl: registrationFetch(name)});
      const core = createStaffCore({session, api, scoreTransport, registrationClient, ledger: createPendingLedger(storage), now, isOnline: () => online.v});
      return {transport, session, api, scoreTransport, core};
    };
    const dev = {name, who, storage, tabStorage, online, ...build(),
      setOnline(v) { online.v = v; fake.setOffline(name, !v); },
      /** a page reload / discarded tab: new in-memory objects over the SAME storage */
      reload() { Object.assign(dev, build()); return dev; },
      async signIn(eventId = world.eventId, {keepSignedIn = false} = {}) {
        const [email, password] = accounts[who];
        const r = await dev.session.signIn({email, password, eventId, keepSignedIn});
        await dev.core.started({role: r.role, eventId});
        return r;
      },
    };
    world.devices.push(dev);
    return dev;
  };
  return world;
}
