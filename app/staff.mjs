/** FFTT Bracket Manager (staging) — staff entry point. Opening this page sends nothing. Network is allowed only
 * when the page address passes the origin policy (a dedicated staging origin, or the approved local profile).
 * Sign-in is email + password for accounts the administrator already created: there is no sign-up path.
 * Access tokens live in memory only; the optional "keep me signed in" mirrors a rotating refresh token into
 * this tab's sessionStorage (never localStorage) and is erased on sign-out. */
import {assessMilestone1DeviceReadiness} from '../contracts/milestone1_device_origin_policy.mjs';
import {createMilestone1PasswordSupabaseTransport, StaffSignInError} from '../contracts/milestone1_password_transport.mjs';
import {createMilestone1StaffSessionVault} from '../contracts/milestone1_staff_session_vault.mjs';
import {createMilestone1PasswordStaffSession} from '../contracts/milestone1_password_session.mjs';
import {createMilestone1EmailCodeRecovery} from '../contracts/milestone1_email_code_recovery.mjs';
import {createGamedayApi} from '../contracts/gameday_api.mjs';
import {createGamedayScoreTransport} from '../contracts/gameday_score_transport.mjs';
import {createRegistrationClient} from '../contracts/registration_client.mjs';
import {createStaffCore, createPendingLedger, POLL_MS} from './staff_core.mjs';
import {createStaffUi} from './staff_ui.mjs';
import {PUBLISHABLE_KEY} from './config.mjs';
import {$, toast, h, clear, attachPasswordToggle} from './dom.mjs';

const PAGE = '/app/staff.html';
// Enabled by the organizer's October 23, 2026 consolidated synthetic staging approval. The sign-in
// origin policy below still decides whether THIS address may talk to the service at all.
const HOSTED_PASSWORD_AUTH_ENABLED = true;
const ALLOW_TAB_PERSISTENCE = true; // build-level permission; each person still has to opt in
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const say = (id, text, cls = '') => { const el = $(id); el.textContent = text; el.className = 'status' + (cls ? ' ' + cls : ''); };

async function loadProfile() {
  try {
    const r = await fetch('./origin-profile.json', {cache: 'no-store', credentials: 'omit'});
    if (!r.ok) return {};
    const j = await r.json();
    return j !== null && typeof j === 'object' ? j : {};
  } catch { return {}; }
}
const profile = await loadProfile();
let readiness;
try {
  readiness = assessMilestone1DeviceReadiness({
    href: window.location.origin + window.location.pathname, pagePath: PAGE,
    approvedHttpsOrigins: Array.isArray(profile.approvedHttpsOrigins) ? profile.approvedHttpsOrigins : [],
    approvedPublicStaticOrigins: Array.isArray(profile.approvedPublicStaticOrigins) ? profile.approvedPublicStaticOrigins : [],
    expectedEnvironment: typeof profile.environment === 'string' ? profile.environment : null,
    isSecureContext: window.isSecureContext, isTopLevel: window.top === window, cryptoImpl: window.crypto,
    tabStorage: window.sessionStorage, isOnline: () => navigator.onLine,
  });
} catch { readiness = {ready: false, checks: [], blockers: ['origin-profile-invalid']}; }
const networkAllowed = readiness.ready === true && HOSTED_PASSWORD_AUTH_ENABLED;
$('envBanner').textContent = (readiness.environment ? readiness.environment.toUpperCase() + ' · ' : '') + 'REHEARSE WITH FICTIONAL PLAYERS · REAL REGISTRATION NAMES MAY BE VISIBLE';
for (const c of readiness.checks) $('readiness').append(Object.assign(document.createElement('li'), {textContent: (c.pass ? '✔ ' : '✘ ') + c.id.replaceAll('-', ' ')}));
for (const b of readiness.blockers.filter(x => !readiness.checks.some(c => c.id === x))) {
  $('readiness').append(Object.assign(document.createElement('li'), {textContent: '✘ ' + b.replaceAll('-', ' ')}));
}
$('originStatus').textContent = !readiness.ready ? 'BLOCKED · this address is not approved for staff sign-in.' : 'This address is approved.';
$('signin').hidden = false;

// ---- non-secret convenience: the last event, and an event link (?event=…)
const params = new URLSearchParams(window.location.search);
const linked = params.get('event');
// A link carries its event: use it. Otherwise nothing is typed: after sign-in the person chooses their event by name.
if (linked && UUID.test(linked)) { $('eventId').value = linked; $('eventIdBox').open = true; }
let lastEvent = null;
try { lastEvent = localStorage.getItem('fftt.staff.lastEvent'); if (!UUID.test(lastEvent ?? '')) lastEvent = null; } catch { /* storage unavailable */ }

const spectatorOrigin = (() => {
  try { const u = new URL(profile.spectatorOrigin); return u.protocol === 'https:' && /\.pages\.dev$/.test(u.hostname) ? u.origin : null; } catch { return null; }
})();
const config = {spectatorUrl: spectatorOrigin && spectatorOrigin + '/', tvUrl: spectatorOrigin && spectatorOrigin + '/app/tv.html'};

let session = null, recovery = null, core = null, ui = null;
function showApp() { $('signin').hidden = true; $('app').hidden = false; }
function showSignIn(message, cls = '') {
  hideChooser(); $('loginForm').hidden = false; $('recoveryBox').hidden = false;
  $('app').hidden = true; $('signin').hidden = false; $('password').value = ''; $('code').value = '';
  if (message) say('signInStatus', message, cls);
}
const wait = ms => { const n = Math.max(1, Math.ceil(ms / 1000)); return n < 90 ? n + ' seconds' : Math.ceil(n / 60) + ' minutes'; };
function signInMessage(e) {
  const kind = e instanceof StaffSignInError ? e.kind : 'unavailable';
  return ({
    'invalid-input': 'Check the email and password, then try again.',
    'invalid-credentials': 'Email or password not recognised.', 'invalid-code': 'That code was not accepted.',
    'rate-limited': 'Too many attempts. Please wait ' + wait(e.retryAfterMs ?? 60000) + '.',
    'cooldown': 'Please wait ' + wait(e.retryAfterMs ?? 60000) + ' before trying again.',
    'network': 'You appear to be offline. Nothing was sent.', 'unavailable': 'Sign-in is temporarily unavailable. Try again shortly.',
    'not-authorized': 'This account does not have access to an event. Ask the organizer.', 'expired': 'Your session ended. Please sign in again.',
    'revoked': 'Your access ended. Sign in again if you should still have access.', 'busy': 'One moment…', 'locked': 'One moment…',
  })[kind] ?? 'Sign-in is temporarily unavailable. Try again shortly.';
}

if (networkAllowed) {
  const fetchImpl = (url, init) => fetch(url, init);
  const transport = createMilestone1PasswordSupabaseTransport({publishableKey: PUBLISHABLE_KEY, allowSyntheticAuthNetwork: true, fetchImpl});
  const vault = createMilestone1StaffSessionVault({tabStorage: window.sessionStorage});
  const api = createGamedayApi({publishableKey: PUBLISHABLE_KEY, fetchImpl});
  const scoreTransport = createGamedayScoreTransport({publishableKey: PUBLISHABLE_KEY, fetchImpl});
  const registrationClient = createRegistrationClient({fetchImpl});   // same-origin, organizer-only, read-only
  session = createMilestone1PasswordStaffSession({transport, isOnline: () => navigator.onLine, vault, allowTabPersistence: ALLOW_TAB_PERSISTENCE,
    listEvents: ({token}) => api.myEvents(token, {})});
  recovery = createMilestone1EmailCodeRecovery({transport, adopt: session.adoptVerifiedSession});
  let storage = null; try { storage = window.localStorage; } catch { storage = null; }
  const ledger = createPendingLedger(storage ?? {getItem: () => null, setItem: () => { throw new Error('no storage'); }, removeItem: () => {}});
  core = createStaffCore({session, api, scoreTransport, registrationClient, ledger, isOnline: () => navigator.onLine, onChange: () => {
    if (!core.state.signedIn && !$('app').hidden) { showSignIn(core.state.endedReason ?? 'Your session ended. Please sign in again.', 'bad'); return; }
    ui?.render();
  }});
  ui = createStaffUi({core, config, els: {main: $('main'), tabs: $('tabs'), status: $('statusline'), banner: $('banner'), eventSelect: $('eventSelect'), eventSwitch: $('eventSwitch')}});
  $('eventSelect').addEventListener('change', async ev => { const r = await core.selectEvent(ev.target.value); if (!r.ok) toast(r.message, 'bad'); ui.openTab(core.state.role === 'organizer' ? 'overview' : 'desk'); });
}
$('signIn').disabled = !networkAllowed; $('requestCode').disabled = !networkAllowed; $('verifyCode').disabled = !networkAllowed;

async function enter(r, eventIdHint) {
  const eventId = session.currentEventId ?? eventIdHint;
  try { localStorage.setItem('fftt.staff.lastEvent', eventId); } catch { /* optional */ }
  hideChooser();
  showApp();
  // start() records the role synchronously; choose the landing tab BEFORE the slow first load so a tab the
  // person taps while it loads is never overwritten afterwards
  const loaded = core.started({role: r.role, eventId});
  ui.openTab(r.role === 'organizer' ? 'overview' : 'desk');
  await loaded;
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, () => session?.touch(), {passive: true});
attachPasswordToggle($('password'), $('togglePassword'));
// ---- choosing an event by NAME (after the password / code proof, when no event id was given)
let choice = null;
function hideChooser() { $('eventChooser').hidden = true; clear($('chooserList')); $('chooserStatus').textContent = ''; choice = null; }
function showChooser(c) {
  choice = c;
  $('loginForm').hidden = true; $('recoveryBox').hidden = true; $('eventChooser').hidden = false;
  const list = $('chooserList'); clear(list);
  const preselect = c.choose.events.some(e => e.eventId === lastEvent) ? lastEvent : c.choose.events[0].eventId;
  for (const e of c.choose.events) {
    list.append(h('label', {class: 'chooser-option'},
      h('input', {type: 'radio', name: 'chooseEvent', value: e.eventId, checked: e.eventId === preselect}),
      h('span', {class: 'chooser-card'},
        h('strong', {text: e.name}),
        h('span', {class: 'chooser-meta'}, h('span', {text: e.date}),
          h('span', {class: 'pill ' + (e.lifecycle === 'archived' ? 'warn' : e.lifecycle === 'active' ? 'good' : 'blue'), text: e.lifecycle === 'complete' ? 'Completed' : e.lifecycle[0].toUpperCase() + e.lifecycle.slice(1)}),
          h('span', {class: 'pill', text: e.role === 'organizer' ? 'Organizer' : 'Scorekeeper'})))));
  }
  say('signInStatus', ''); $('chooserList').querySelector('input:checked')?.focus();
}
function leaveChooser(message = '', cls = '') {
  hideChooser(); $('loginForm').hidden = false; $('recoveryBox').hidden = false;
  if (message) say('signInStatus', message, cls);
}
$('chooserGo').addEventListener('click', async () => {
  const picked = $('chooserList').querySelector('input:checked')?.value;
  if (!choice || !picked) { say('chooserStatus', 'Choose an event to continue.', 'bad'); return; }
  $('chooserGo').disabled = true; say('chooserStatus', 'Opening the event…');
  try { const r = await choice.finish(picked); say('chooserStatus', ''); await enter(r, picked); }
  catch (err) { const m = signInMessage(err); leaveChooser(err instanceof StaffSignInError && ['expired', 'invalid-input'].includes(err.kind) ? 'That took too long. Please sign in again.' : m, 'bad'); }
  finally { $('chooserGo').disabled = false; }
});
$('chooserCancel').addEventListener('click', async () => { const c = choice; hideChooser(); await c?.cancel(); leaveChooser('Cancelled. Nothing was opened.'); });

/** Both sign-in routes end here: enter the event, or offer the person's own events by name. */
async function proceed(r, eventId) {
  if (r?.choose) { showChooser(r); return; }
  say('signInStatus', ''); await enter(r, eventId);
}
const typedEventId = () => $('eventId').value.trim();
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (session === null) return;
  const email = $('email').value, password = $('password').value, eventId = typedEventId();
  if (eventId && !UUID.test(eventId)) { say('signInStatus', 'That event ID does not look right. Clear it to choose your event by name.', 'bad'); return; }
  $('password').value = ''; // the password leaves the page the moment it is submitted
  $('signIn').disabled = true; $('loginForm').setAttribute('aria-busy', 'true'); say('signInStatus', 'Signing in…');
  try {
    const r = await session.signIn({email, password, eventId: eventId || null, keepSignedIn: $('keepSignedIn').checked});
    await proceed(r, eventId);
  } catch (err) { say('signInStatus', signInMessage(err), 'bad'); }
  finally { $('signIn').disabled = !networkAllowed; $('loginForm').removeAttribute('aria-busy'); }
});
$('requestCode').addEventListener('click', async () => {
  try { await recovery.request($('recoveryEmail').value); say('recoveryStatus', 'If this address belongs to an authorised account, a code was sent. It expires soon.', 'good'); }
  catch (err) { say('recoveryStatus', signInMessage(err), 'bad'); }
});
$('verifyCode').addEventListener('click', async () => {
  const code = $('code').value.trim(), eventId = typedEventId(); $('code').value = '';
  if (eventId && !UUID.test(eventId)) { say('recoveryStatus', 'That event ID does not look right. Clear it to choose your event by name.', 'bad'); return; }
  try {
    const r = await recovery.verify({email: $('recoveryEmail').value, code, eventId: eventId || null, keepSignedIn: $('keepSignedIn').checked});
    say('recoveryStatus', ''); await proceed(r, eventId);
  } catch (err) { say('recoveryStatus', signInMessage(err), 'bad'); }
});
async function leave(global) {
  const r = await session.signOut({global});
  core.signedOut();
  showSignIn(r.serverRevoked ? 'Signed out.' : 'Signed out on this device. The server could not be reached; ask the organizer to end any other session.');
}
$('signOut').addEventListener('click', () => leave(false));
$('signOutAll').addEventListener('click', () => leave(true));

// ---- mobile background / resume: drop private views while hidden, re-prove identity and role on return
async function resumeNow() {
  const r = await core.resume();
  $('reconnect').hidden = r.ok || !r.retry;
  if (!r.ok && !r.retry && !core.state.signedIn) showSignIn(core.state.endedReason ?? 'Your session ended. Please sign in again.', 'bad');
}
if (core) {
  $('reconnect').addEventListener('click', resumeNow);
  document.addEventListener('visibilitychange', () => {
    if (!core.state.signedIn) return;
    if (document.hidden) { session.suspend(); core.pause(); } else resumeNow();
  });
  window.addEventListener('online', () => { if (core.state.signedIn && !document.hidden) core.refresh({force: true}); });
  window.addEventListener('offline', () => ui.render(true));
  setInterval(() => { if (core.state.signedIn && !document.hidden) core.refresh(); }, POLL_MS);
  // A reload or a discarded mobile tab: renew from the opt-in tab vault, otherwise show the sign-in form.
  if (session.status.authenticated === false) {
    try {
      const probe = createMilestone1StaffSessionVault({tabStorage: window.sessionStorage}).read();
      if (probe !== null) {
        say('signInStatus', 'Restoring your session…');
        const r = await session.restore();
        say('signInStatus', ''); await enter({role: r.role}, session.currentEventId);
      }
    } catch (err) {
      say('signInStatus', err instanceof StaffSignInError && ['network', 'unavailable', 'rate-limited'].includes(err.kind)
        ? signInMessage(err) + ' Your saved session is kept; reload to retry.' : signInMessage(err), 'bad');
    }
  }
}
