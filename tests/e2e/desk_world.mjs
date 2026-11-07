/** Test-only: the Bracket Manager registration desk against the REAL SQL (PGlite) with the real Pages Function in front of it.
 * Two real-mode events share ONE fictional Google sheet (the November 8 / November 22 situation); a fake Google serves it.
 * Everything is fictional; nothing leaves this machine. The test plays three parts: the browser (a person's own token), the
 * Pages Function (the real handler) and, for forgery tests only, an attacker who holds the wrong or no gate secret. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFakeSupabase, PROJECT, PUBLISHABLE} from './fake_supabase.mjs';
import {createFakeGoogle, fakeGoogleEnv, GOOGLE_HOSTS} from './fake_google.mjs';
import {createRegistrationHandler, createHandlerState} from '../../server/registration/handler.mjs';
import {SYNTHETIC_FORM_CSV} from '../../server/registration/synthetic_fixture.mjs';
import {parseCsv} from '../../contracts/registration_model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SQL = {
  role: 'supabase/proposals/FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql',
  delegation: 'supabase/proposals/FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql',
  registration: 'supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql',
  rollback: 'supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_ROLLBACK_DO_NOT_APPLY.sql',
};
export const readSql = key => fs.readFileSync(path.join(ROOT, SQL[key]), 'utf8');
export const STAFF = 'https://fftt-staff-test.pages.dev';
export const GATE = 'fictional-desk-gate-secret-0123456789abcdef';
export const SHEET = 'SYNTHETIC_DESK_SHEET_0123456789abcdef';
export const TAB = 'Form Responses 1';
export const ROWS = parseCsv(SYNTHETIC_FORM_CSV);

/** @param {{upgraded?: boolean, gate?: string|null, installGate?: boolean, layers?: boolean}} o */
export async function createDeskWorld({upgraded = true, gate = GATE, installGate = true, layers = true} = {}) {
  const fake = await createFakeSupabase({upgraded});
  const accounts = {};
  const ids = {};
  const add = async (key, platformOrganizer = false) => {
    accounts[key] = [`${key}@fftt-desk.invalid`, `desk-pass-${key}-${Math.random().toString(36).slice(2)}`];
    ids[key] = await fake.addAccount(...accounts[key], {platformOrganizer});
  };
  await add('org', true);
  for (const k of ['bm1', 'bm2', 'scorer', 'outsider', 'revoked', 'org2']) await add(k);
  if (layers) {
    await fake.local.db.exec(readSql('role'));
    await fake.local.db.exec(readSql('delegation'));
    await fake.local.db.exec(readSql('registration'));
  }
  if (installGate) await fake.local.admin('select fftt_private.install_registration_gate_v1($1)', [GATE]);

  const rpc = (who, fn, args) => fake.local.rpc(ids[who], fn, args);
  const grant = (who, eventId, role) => rpc('org', 'fftt_set_staff_v3', {p_event_id: eventId, p_email: accounts[who][0], p_action: 'grant', p_role: role});
  const revoke = (who, eventId) => rpc('org', 'fftt_set_staff_v3', {p_event_id: eventId, p_email: accounts[who][0], p_action: 'revoke', p_role: null});
  const newEvent = async (name, date) => (await rpc('org', 'fftt_create_event_v3', {p_name: name, p_date: date, p_table_count: 2})).event_id;
  const source = (eventId, over = {}) => rpc('org', 'fftt_set_registration_source_v5', {p_event_id: eventId, p_source: {kind: 'google-sheets', spreadsheet_id: SHEET,
    spreadsheet_title: 'FFTT3 Sign-ups (fictional copy)', worksheet: TAB, column_map: {}, enabled: true, ...over}});

  const google = createFakeGoogle({sheets: {[SHEET]: {title: 'FFTT3 Sign-ups (fictional copy)', tabs: {[TAB]: ROWS}, shared: true}}});
  const supabaseFetch = fake.clientFetch('function');
  const adapterFetch = async (url, init = {}) => {
    if (init.redirect === 'error' || 'cache' in init) throw new TypeError('option not supported by the Workers runtime');
    if (GOOGLE_HOSTS.includes(new URL(url).host)) return google.fetch(url, init);
    return supabaseFetch(url, init);
  };
  const env = {REGISTRATION_ENABLED: 'true', STAFF_ORIGIN: STAFF, SUPABASE_URL: PROJECT, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    REGISTRATION_GOOGLE_MODE: 'enabled', REGISTRATION_REF_SECRET: crypto.randomBytes(32).toString('hex'), ...fakeGoogleEnv,
    ...(gate ? {REGISTRATION_GATE_SECRET: gate} : {})};
  const world = {fake, accounts, ids, google, env, rpc, grant, revoke, newEvent, source, adapterFetch, state: createHandlerState(), tokens: new Map()};
  world.handler = () => createRegistrationHandler({env: world.env, fetchImpl: adapterFetch, state: world.state});
  world.token = async who => {
    if (world.tokens.has(who)) return world.tokens.get(who);
    const [email, password] = accounts[who];
    const res = await fake.clientFetch('t-' + who)(PROJECT + '/auth/v1/token?grant_type=password', {method: 'POST',
      headers: {apikey: PUBLISHABLE, 'content-type': 'application/json'}, body: JSON.stringify({email, password})});
    const token = (await res.json()).access_token;
    world.tokens.set(who, token);
    return token;
  };
  /** One request to the Function as `who` (null = no token). Returns {status, body}. */
  world.ask = async (who, eventId, body = {}, {handler = world.handler()} = {}) => {
    const token = who ? await world.token(who) : null;
    const res = await handler(new Request(STAFF + '/api/registrations', {method: 'POST',
      headers: {...(token ? {authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json', origin: STAFF}, body: JSON.stringify({event_id: eventId, ...body})}));
    return {status: res.status, body: await res.json()};
  };
  world.lookup = async (who, eventId) => world.ask(who, eventId, {action: 'lookup'});
  world.checkin = async (who, eventId, body) => world.ask(who, eventId, {action: 'checkin', ...body});
  world.roster = eventId => fake.local.admin(`select p.id, p.display_name, p.rating, p.rating_status, p.rating_confirmed, p.source, p.checked_in,
      (select array_agg(l.ref order by l.ref) from fftt_private.registration_links l where l.event_id = p.event_id and l.player_id = p.id) refs
    from fftt_private.players p where p.event_id = $1 order by p.display_name`, [eventId]);
  world.audit = eventId => fake.local.admin(`select operation, actor_id, after_state from fftt_private.audit_events where event_id = $1 order by 1`, [eventId]);
  return world;
}
