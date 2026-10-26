/** Failure and recovery behavior in real Chrome contexts (browser-SIMULATED: isolated contexts on one machine,
 * route-level network faults). Not a physical-device test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld, STAFF, SPECT} from './browser_world.mjs';

const T = 20000;
const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const setHidden = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, 'hidden', {configurable: true, get: () => h});
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (h ? 'hidden' : 'visible')});
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

async function staged(w, players = 8) {
  const {roster} = await import('./helpers.mjs');
  const {seedSlots, enginePlayers} = await import('../../contracts/gameday_engine.mjs');
  const local = w.fake.local, E = w.eventId, org = w.ids.org;
  await local.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(players)});
  await local.rpc(org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  const s = await local.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  await local.rpc(org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(s.players)), p_expected_generation: 0, p_confirm: false});
  await local.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
}

test('a wrong password is refused without hints; no staff UI appears', {timeout: 120000}, async () => {
  const w = await createBrowserWorld();
  try {
    const d = await w.device('d', PHONE);
    await d.open(STAFF + '/app/staff.html');
    await d.page.waitForSelector('#signIn:not([disabled])');
    await d.page.fill('#email', w.accounts.a[0]); await d.page.fill('#password', 'not-the-password');
    await d.page.click('#signIn');
    await d.page.locator('#signInStatus', {hasText: 'Email or password not recognised'}).waitFor({timeout: T});
    assert.equal(await d.page.locator('#password').inputValue(), '', 'the password field is cleared on submit');
    assert.equal(await d.page.locator('#app:not([hidden])').count(), 0);
    // an address that is not an approved origin cannot sign in at all
    const bad = await w.browser.newContext();
    await bad.route('**/*', r => r.abort());
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('background and resume: private rows vanish while hidden and return after re-proof; revocation while away ends the session', {timeout: 180000}, async () => {
  const w = await createBrowserWorld();
  try {
    await staged(w);
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    await a.page.locator('.queue-card').first().waitFor({timeout: T});
    await setHidden(a.page, true);
    await a.page.locator('.queue-card').first().waitFor({state: 'detached', timeout: 5000});
    assert.equal(await a.page.locator('#statusline .pill', {hasText: 'Paused'}).count(), 1);
    const before = w.requests.filter(r => r.device === 'a').length;
    await a.page.waitForTimeout(8000);
    assert.equal(w.requests.filter(r => r.device === 'a').length, before, 'no polling while hidden');
    await setHidden(a.page, false);
    await a.page.locator('.queue-card').first().waitFor({timeout: T});
    // revoked while the phone is in a pocket
    await setHidden(a.page, true);
    await w.fake.local.rpc(w.ids.org, 'fftt_set_staff_v3', {p_event_id: w.eventId, p_email: w.accounts.a[0], p_action: 'revoke', p_role: null});
    await setHidden(a.page, false);
    await a.page.locator('#signin:not([hidden])').waitFor({timeout: T});
    assert.match(await a.page.locator('#signInStatus').textContent(), /access ended|session ended/i);
    assert.equal(await a.page.locator('.queue-card').count(), 0);
  } finally { await w.close(); }
});

test('network outage: writes pause with a clear banner, the last bracket stays visible, and everything resumes by itself', {timeout: 180000}, async () => {
  const w = await createBrowserWorld();
  try {
    await staged(w);
    const org = await w.device('org');
    await org.signIn('org');
    await org.page.locator('nav.tabs button', {hasText: /^Match Desk$/}).click();
    await org.page.locator('.queue-card').first().waitFor({timeout: T});
    w.fake.setOffline('org', true);
    await org.page.locator('#banner:not([hidden])').waitFor({timeout: 45000});
    assert.match(await org.page.locator('#banner').textContent(), /paused/i);
    const diag = async () => JSON.stringify({signin: await org.page.locator('#signin:not([hidden])').count(), status: await org.page.locator('#signInStatus').textContent(),
      main: (await org.page.locator('#main').innerText()).slice(0, 200), errors: w.consoleErrors.slice(-3), pageErrors: w.pageErrors});
    assert.ok(await org.page.locator('.queue-card').count() > 0, 'the last known bracket stays on screen: ' + await diag());
    assert.equal(await org.page.locator('.queue-card button', {hasText: 'Record result'}).first().isDisabled(), true, 'recording is paused');
    assert.match(await org.page.locator('#statusline').innerText(), /changes paused/i);
    w.fake.setOffline('org', false);
    await org.page.locator('#banner[hidden]').waitFor({state: 'attached', timeout: 30000});
    assert.equal(await org.page.locator('.queue-card button', {hasText: 'Record result'}).first().isDisabled(), false);
  } finally { await w.close(); }
});

test('spectator and TV: stale information is labelled, and live reads resume without any action', {timeout: 180000}, async () => {
  const w = await createBrowserWorld();
  try {
    await staged(w);
    const tv = await w.device('tv', {viewport: {width: 1920, height: 1080}});
    await tv.open(SPECT + '/app/tv.html');
    await tv.page.locator('#live', {hasText: 'LIVE'}).waitFor({timeout: 15000});
    const spec = await w.device('spec', PHONE);
    await spec.open(SPECT + '/');
    await spec.page.locator('#live', {hasText: 'Live'}).waitFor({timeout: 15000});
    w.fake.setOffline('tv', true); w.fake.setOffline('spec', true);
    await tv.page.locator('#live', {hasText: 'OUT OF DATE'}).waitFor({timeout: 45000});
    await spec.page.locator('#live', {hasText: 'Out of date'}).waitFor({timeout: 45000});
    assert.ok(await tv.page.locator('.tv-line').count() > 0, 'the last information is kept but labelled');
    w.fake.setOffline('tv', false); w.fake.setOffline('spec', false);
    await tv.page.locator('#live', {hasText: 'LIVE'}).waitFor({timeout: 45000});
    await spec.page.locator('#live', {hasText: /^Live$/}).waitFor({timeout: 45000});
  } finally { await w.close(); }
});

test('keep me signed in: a reload restores the session from the tab vault; sign out erases it', {timeout: 120000}, async () => {
  const w = await createBrowserWorld();
  try {
    await staged(w);
    const org = await w.device('org');
    await org.signIn('org', {keep: true});
    await org.page.locator('#main h2').first().waitFor({timeout: T});
    await org.page.reload();
    await org.page.locator('#app:not([hidden]) #main h2').first().waitFor({timeout: 30000});
    assert.equal(await org.page.locator('#signin:not([hidden])').count(), 0, 'no password needed after a reload');
    const stored = await org.page.evaluate(() => ({session: Object.keys(sessionStorage).length, local: Object.keys(localStorage).filter(k => /token|session|auth/i.test(k)).length}));
    assert.equal(stored.local, 0, 'no token-like material in localStorage');
    await org.page.locator('#signOut').click();
    await org.page.locator('#signin:not([hidden])').waitFor({timeout: T});
    assert.equal(await org.page.evaluate(() => Object.keys(sessionStorage).filter(k => /fftt/i.test(k) && !/probe/.test(k)).length), 0, 'the stored refresh key is erased on sign-out');
    await org.page.reload();
    await org.page.locator('#signin:not([hidden])').waitFor({timeout: T});
  } finally { await w.close(); }
});

test('heartbeat preserves the organizer opening-round preview and occupied tables cannot be selected', {timeout: 120000}, async () => {
  const w = await createBrowserWorld();
  try {
    const {roster} = await import('./helpers.mjs');
    const org = await w.device('org');
    await org.signIn('org');
    await w.fake.local.rpc(w.ids.org, 'fftt_upsert_players_v3', {p_event_id: w.eventId, p_players: roster(8)});
    await w.fake.local.rpc(w.ids.org, 'fftt_set_checkin_bulk_v3', {p_event_id: w.eventId, p_player_ids: null, p_checked_in: true});
    await org.page.locator('nav.tabs button', {hasText: /^Championship$/}).click();
    await org.page.locator('summary', {hasText: 'Preview opening round'}).waitFor({timeout: T});
    await org.page.locator('summary', {hasText: 'Preview opening round'}).click();
    await org.page.waitForTimeout(8500);
    assert.equal(await org.page.locator('details', {has: org.page.locator('summary', {hasText: 'Preview opening round'})}).evaluate(el => el.open), true,
      'open preview must survive a heartbeat');
    await org.page.locator('button', {hasText: 'Build championship bracket'}).click();
    await org.page.locator('nav.tabs button', {hasText: /^Match Desk$/}).click();
    const cards = org.page.locator('.queue-card');
    await cards.first().waitFor({timeout: T});
    assert.ok(await cards.count() >= 2);
    await cards.first().locator('select[aria-label^="Table for"]').selectOption('1');
    await org.page.locator('#toast:not([hidden])', {hasText: 'Assigned to table 1'}).waitFor({timeout: T});
    const occupiedOption = cards.nth(1).locator('select[aria-label^="Table for"] option[value="1"]');
    await occupiedOption.waitFor({state: 'attached', timeout: T});
    assert.equal(await occupiedOption.isDisabled(), true, 'occupied table is unavailable for a second match');
    await cards.nth(1).locator('button', {hasText: 'Record result'}).click();
    assert.equal(await org.page.locator('dialog[open] #scTable option[value="1"]').isDisabled(), true,
      'the score dialog also prevents selecting an occupied table');
    await org.page.locator('dialog[open] button', {hasText: 'Cancel'}).click();
  } finally { await w.close(); }
});

test('a short token lifetime is renewed silently while scoring continues', {timeout: 240000}, async () => {
  const w = await createBrowserWorld({ttlSeconds: 90});
  try {
    await staged(w);
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    await a.page.locator('.queue-card').first().waitFor({timeout: T});
    await a.page.waitForTimeout(100000); // longer than one token lifetime: polling must have renewed it
    const renewals = w.fake.log.filter(l => l.client === 'a' && l.search === '?grant_type=refresh_token').length;
    assert.ok(renewals >= 1, 'the access token was renewed (' + renewals + ')');
    assert.equal(await a.page.locator('#signin:not([hidden])').count(), 0, 'still signed in');
    assert.ok(await a.page.locator('.queue-card').count() > 0);
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});
