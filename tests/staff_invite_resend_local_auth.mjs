#!/usr/bin/env node
/** Replacement-invitation recovery proven against a REAL, DISPOSABLE local Supabase Auth (GoTrue) stack.
 *
 *  Runs only in CI / on a developer's own `supabase start`. It exercises the unmodified Staff directory handler with
 *  a fetch that forwards every Auth call to the local stack (the hosted project is pinned in the handler, so the
 *  host is remapped here, in the test only) and answers only the three Organizer-authorization lookups with fixed
 *  replies. One FICTIONAL account at `example.test` is used. No hosted system, real mailbox or secret is involved.
 *
 *  Proves: invite -> replacement invite reuse the SAME identity (one user), the older link is refused and leaves the
 *  account unconfirmed, the newest link returns the callback format the deployed page accepts, password setup and a
 *  later individual sign-in work, no event access appears, and a confirmed account is never re-invited.
 */
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createStaffDirectoryHandler} from '../server/staff_directory/handler.mjs';
import {C3_HOST} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';

const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], {encoding: 'utf8'}).replace(/^[^{]*/, ''));
const API = status.API_URL, ANON = status.ANON_KEY, SERVICE = status.SERVICE_ROLE_KEY, DB = status.DB_URL;
const MAIL = status.MAILPIT_URL || status.INBUCKET_URL || 'http://127.0.0.1:54324';
assert.ok(API && ANON && SERVICE && DB, 'local Supabase status must provide API, anon key, service key and DB URL');
assert.match(new URL(API).hostname, /^(127\.0\.0\.1|localhost)$/, 'refuse to run against anything but a local stack');

const ORIGIN = 'https://fftt-staff.clslifestyle.com';
const CALLBACK = ORIGIN + '/app/staff-invite.html';
const EVENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL = `fftt-invite-${Date.now().toString(36)}@example.test`;
const PASSWORD = 'Fictional-' + Math.random().toString(36).slice(2) + 'Aa1!';
const jwtShape = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;   // the exact check app/staff-invite.mjs applies
const psql = sql => execFileSync('psql', [DB, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql], {encoding: 'utf8'}).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchImpl(url, opts) {
  const u = new URL(url);
  assert.equal(u.origin, C3_HOST, 'the handler only ever calls its pinned host');
  const json = x => new Response(JSON.stringify(x), {status: 200});
  const bearer = String(opts.headers?.Authorization ?? '');
  if (u.pathname === '/auth/v1/user' && !bearer.includes(SERVICE)) return json({id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', is_anonymous: false});
  if (u.pathname === '/rest/v1/rpc/fftt_staff_role_v1') return json('organizer');
  if (u.pathname === '/rest/v1/rpc/fftt_my_events_v4') return json([{event_id: EVENT, role: 'organizer', can_create: true}]);
  return fetch(API + u.pathname + u.search, {...opts, headers: {...opts.headers}});
}
const handler = createStaffDirectoryHandler({fetchImpl, env: {STAFF_ORIGIN: ORIGIN, SUPABASE_URL: C3_HOST,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_localdisposable', SUPABASE_ADMIN_SECRET: SERVICE, STAFF_INVITE_REDIRECT_ENABLED: 'true'}});
const add = async () => {
  const res = await handler(new Request(ORIGIN + '/api/staff-directory', {method: 'POST',
    headers: {origin: ORIGIN, authorization: 'Bearer aaa.bbb.ccc', 'content-type': 'application/json'},
    body: JSON.stringify({action: 'add', event_id: EVENT, name: 'Fictional Invitee', email: EMAIL})}));
  return {status: res.status, body: await res.json()};
};

async function messages() {
  const list = await (await fetch(MAIL + '/api/v1/messages?limit=200')).json();
  const mine = (list.messages ?? []).filter(m => (m.To ?? []).some(t => t.Address?.toLowerCase() === EMAIL));
  const out = [];
  for (const m of mine.sort((a, b) => new Date(a.Created) - new Date(b.Created))) {
    const full = await (await fetch(MAIL + '/api/v1/message/' + m.ID)).json();
    const href = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(full.HTML ?? '');
    assert.ok(href, 'the invitation email contains the Supabase verification link');
    out.push(href[1].replaceAll('&amp;', '&'));
  }
  return out;
}
async function waitForMessages(n) {
  for (let i = 0; i < 40; i++) { const m = await messages(); if (m.length >= n) return m; await sleep(500); }
  throw new Error(`expected ${n} invitation email(s) in the local mail catcher`);
}
const follow = async link => {
  const res = await fetch(link, {redirect: 'manual'});
  assert.equal(res.status, 303, 'verification answers with a redirect');
  const loc = new URL(res.headers.get('location'));
  return {loc, hash: new URLSearchParams(loc.hash.slice(1)), query: loc.searchParams};
};
const userCount = () => Number(psql(`select count(*) from auth.users where lower(email)='${EMAIL}'`));
const confirmed = () => psql(`select email_confirmed_at is not null from auth.users where email='${EMAIL}'`) === 't';
const grants = () => Number(psql(`select count(*) from fftt_private.event_staff es join auth.users u on u.id=es.user_id where u.email='${EMAIL}'`));
const usersBefore = Number(psql('select count(*) from auth.users'));

// 1. First invitation: a brand-new, unconfirmed identity and exactly one email.
let r = await add();
assert.deepEqual([r.status, r.body.status], [200, 'invited'], 'first Add Staff invites');
assert.equal(userCount(), 1);
const id = psql(`select id from auth.users where email='${EMAIL}'`);
assert.equal(confirmed(), false);
const first = await waitForMessages(1);

// 2. The link was never used and is replaced: Add Staff on the same, still-unconfirmed identity sends ONE replacement.
await sleep(2500);   // supabase/config.toml sets a 1s per-user email interval for this disposable stack
r = await add();
assert.deepEqual([r.status, r.body.status], [200, 'reinvited'], 'second Add Staff re-sends to the existing account');
assert.equal(userCount(), 1, 'no second identity was created');
assert.equal(psql(`select id from auth.users where email='${EMAIL}'`), id, 'same Auth identity');
assert.equal(confirmed(), false, 'sending does not confirm the account');
const both = await waitForMessages(2);
assert.equal((await messages()).length, 2, 'exactly one replacement message was sent');
assert.notEqual(both[0], both[1], 'the replacement carries a different one-time token');

// 3. The OLD link is now refused, as an explicit expiry error the page recognises, and does not confirm the account.
const oldResult = await follow(first[0]);
assert.equal(oldResult.loc.origin + oldResult.loc.pathname, CALLBACK, 'the refusal still lands on the Staff callback page');
const errorCode = oldResult.hash.get('error_code') ?? oldResult.query.get('error_code');
assert.equal(errorCode, 'otp_expired', `old link reports otp_expired (seen in ${oldResult.hash.has('error_code') ? 'fragment' : 'query string'})`);
assert.equal(oldResult.hash.get('access_token'), null, 'no token is issued for a superseded link');
assert.equal(confirmed(), false, 'a refused link does not confirm the account');

// 4. The NEWEST link returns the exact callback format the deployed page accepts.
const fresh = await follow(both[1]);
assert.equal(fresh.loc.origin + fresh.loc.pathname, CALLBACK, 'redirect_to is honoured (the callback is on the Auth allow-list)');
assert.equal(fresh.hash.get('type'), 'invite');
const token = fresh.hash.get('access_token');
assert.ok(token && jwtShape.test(token) && token.length <= 10000, 'JWT-shaped access_token in the URL fragment');
assert.equal(confirmed(), true, 'the person\'s own click confirms the account');
assert.equal(grants(), 0, 'accepting an invitation grants no event access');

// 5. Password setup exactly as the page does it, then an individual sign-in with that password.
const put = await fetch(API + '/auth/v1/user', {method: 'PUT', headers: {apikey: ANON, Authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: JSON.stringify({password: PASSWORD})});
assert.equal(put.status, 200, 'password setup with the invitation token succeeds');
const login = await fetch(API + '/auth/v1/token?grant_type=password', {method: 'POST', headers: {apikey: ANON, 'content-type': 'application/json'}, body: JSON.stringify({email: EMAIL, password: PASSWORD})});
assert.equal(login.status, 200, 'the invitee can sign in with their own password');
const session = await login.json();
assert.ok(session.access_token, 'the invitee holds their own session');
// no event grant exists for this account (checked in the database, which is the authority for event access)
assert.equal(grants(), 0);

// 6. A confirmed account is never re-invited by Add Staff.
await sleep(1500);
r = await add();
assert.deepEqual([r.status, r.body.status], [200, 'existing'], 'confirmed account: nothing is sent');
assert.equal((await messages()).length, 2, 'no further email was sent');
assert.equal(userCount(), 1);
assert.equal(Number(psql('select count(*) from auth.users')), usersBefore + 1, 'the whole run created exactly one (fictional) identity');
console.log('OK: replacement invitation recovery verified against local GoTrue (old link refused, new link accepted, password + sign-in, no grants, no duplicate account)');
