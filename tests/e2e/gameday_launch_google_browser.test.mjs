/** LAUNCH-MODE Google Sheets workflow in real Chrome: a REAL-mode event (synthetic_only = false) on the UPGRADED single-project
 * schema, registration read from a FAKE Google (the FFTT3 form's shape, fictional people, no network, no credentials).
 * Covers the whole organizer path (inspect, test, map, save, enable, load, duplicates, levels, check-in, walk-in) plus the
 * access rules (organizer-only, event allowlist, mode switch) and the privacy boundary (no contact data in tournament
 * records, audit log, exports, spectator projection or page). Browser-SIMULATED viewports; fictional data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createBrowserWorld} from './browser_world.mjs';
import {SYNTHETIC_FORM_CSV} from '../../server/registration/synthetic_fixture.mjs';
import {parseCsv} from '../../contracts/registration_model.mjs';
import {FAKE_SA} from './fake_google.mjs';

const T = 20000;
const SHEET = 'SYNTHETIC_LAUNCH_SHEET_0123456789abcdef';
const TAB = 'Form Responses 1';
const url = id => `https://docs.google.com/spreadsheets/d/${id}/edit?gid=0#gid=0`;
const ROWS = parseCsv(SYNTHETIC_FORM_CSV);
const goTab = (page, name) => page.locator('nav.tabs button', {hasText: new RegExp('^' + name + '$')}).click();
const toast = (page, re, timeout = T) => page.locator('#toasts .toast', {hasText: re}).waitFor({timeout});
const row = (page, name) => page.locator('.reg-row', {has: page.locator('.reg-name', {hasText: new RegExp('^' + name + '$')})});
const idle = page => page.locator('#regSetBody[aria-busy="false"]').waitFor({timeout: T});

async function launchWorld(mode = 'enabled') {
  const w = await createBrowserWorld({real: true, registration: 'google-only', google: {mode, sheets: {[SHEET]: {title: 'FFTT3 Sign-ups (fictional copy)', tabs: {[TAB]: ROWS}, shared: true}}}});
  w.registrationEnv.REGISTRATION_EVENT_IDS = w.eventId;
  w.registrationEnv.REGISTRATION_REF_SECRET = crypto.randomBytes(32).toString('hex');
  return w;
}

test('LAUNCH MODE: real-mode event, Organizer connects the form sheet, loads, de-duplicates, checks in with FULL names; nothing private leaks', {timeout: 600000}, async () => {
  const w = await launchWorld();
  try {
    assert.equal((await w.fake.local.admin('select synthetic_only from fftt_private.events where id = $1', [w.eventId]))[0].synthetic_only, false, 'the event is a real-mode event');
    const org = await w.device('org', {viewport: {width: 1440, height: 900}});
    await org.signIn('org');
    await org.page.locator('#evName').waitFor({timeout: T});
    await goTab(org.page, 'Players');
    const page = org.page;

    // 1. nothing is configured yet; on a real event the demo data is not offered and enabling IS allowed
    await page.locator('#regSetToggle').click();
    assert.deepEqual(await page.locator('.choice-card strong').allInnerTexts(), ['Google Sheet'], 'a real event offers the Google Sheet only');
    assert.equal((await page.locator('.account-email').innerText()).trim(), FAKE_SA);
    assert.equal(await page.locator('#regEnable').isDisabled(), false, 'enabling is offered on a real event');

    // 2. inspect and test: readiness only, no answers
    await page.fill('#regSheet', url(SHEET));
    await page.locator('#regCheck').click();
    await page.locator('.diag', {hasText: 'Ready to read'}).waitFor({timeout: T});
    assert.deepEqual(await page.locator('#regTab option').allInnerTexts(), [TAB]);
    assert.match(await page.locator('.diag').innerText(), /21 responses \(a count only; no answers were read\)/);
    assert.deepEqual(await page.locator('.diag-list li').evaluateAll(els => els.map(e => e.className)), Array(6).fill('diag-pass'));
    assert.deepEqual(w.google.calls.filter(c => /values/.test(c.path) && !/A1:BH1|A2:A/.test(c.path)), [], 'the diagnostic read no answer rows');

    // 3. save and enable (allowed: the event is real, the deployment is `enabled`, the event is on the allowlist)
    await idle(page);
    await page.locator('#regEnable').check();
    await page.locator('#regSave').click();
    await toast(page, /Registration source saved/);
    const saved = await w.fake.local.admin('select kind, spreadsheet_id, worksheet, enabled from fftt_private.registration_sources where event_id = $1', [w.eventId]);
    assert.deepEqual(saved, [{kind: 'google-sheets', spreadsheet_id: SHEET, worksheet: TAB, enabled: true}]);
    await page.locator('#regSetToggle').click();   // collapse

    // 4. load: full sanitized names, suggested levels with reasons, duplicates found
    await page.locator('#regLoad').click();
    await page.locator('.reg-row').first().waitFor({timeout: T});
    assert.match(await page.locator('.reg-meta').innerText(), /Google Sheet/);
    assert.equal(await page.locator('.reg-name', {hasText: /^Ben Marlowe$/}).count(), 1, 'full first and last name from the form');
    assert.match(await row(page, 'Hal Wintersby').innerText(), /Level 3 · Intermediate\s+Suggested/);
    await page.locator('#dups h2', {hasText: 'Possible duplicates (2)'}).waitFor({timeout: T});
    assert.match(await page.locator('.reg-row', {hasText: 'Lia'}).first().innerText(), /removed from the name/, 'a phone number typed into a name is cleaned and flagged');

    // 5. check-in: one by one, merge a duplicate group, then a walk-in with a full name
    await row(page, 'Ben Marlowe').locator('button', {hasText: 'Check in'}).click();
    await toast(page, /Ben Marlowe checked in/);
    await row(page, 'Dee Larkspur').locator('input[type=checkbox]').check();
    await row(page, 'Eli Brandtley').locator('input[type=checkbox]').check();
    await page.locator('.bulk-bar button', {hasText: 'Check in 2 selected'}).click();
    await toast(page, /2 players checked in/);
    await page.locator('#dups .dup-group', {hasText: 'Same e-mail'}).locator('button', {hasText: 'Same person'}).click();
    await toast(page, /Ada Quillfeather checked in \(3 registrations merged\)/);
    await page.fill('#wName', 'Walt Winters');
    await page.locator('.walk-form .seg label', {hasText: /^4$/}).click();
    await page.locator('.walk-form button', {hasText: 'Add & check in'}).click();
    await toast(page, /Walt Winters checked in/);
    await page.fill('#wName', 'walt winters');
    await page.locator('.walk-form button', {hasText: 'Add & check in'}).click();
    await page.locator('#wMsg', {hasText: 'already on the roster'}).waitFor();

    const players = await w.fake.local.admin('select display_name, source, checked_in, rating_confirmed from fftt_private.players where event_id = $1 order by display_name', [w.eventId]);
    assert.deepEqual(players.map(p => p.display_name), ['Ada Quillfeather', 'Ben Marlowe', 'Dee Larkspur', 'Eli Brandtley', 'Walt Winters']);
    assert.ok(players.every(p => p.checked_in && p.display_name.split(' ').length >= 2), 'every checked-in player has a full first and last name');
    assert.ok(players.every(p => p.display_name.trim().split(/\s+/)[1].length > 1), 'no last initial');

    // 5b. a one-word walk-in name is a SOFT rule: asked once for the full name, accepted as written on the second press
    await page.fill('#wName', 'Prince');
    await page.locator('.walk-form button', {hasText: 'Add & check in'}).click();
    await page.locator('#wMsg', {hasText: 'full first and last name'}).waitFor();
    assert.equal((await w.fake.local.admin("select count(*)::int n from fftt_private.players where display_name = 'Prince'"))[0].n, 0, 'nothing is added on the first press');
    await page.locator('.walk-form button', {hasText: 'Add & check in'}).click();
    await toast(page, /Prince checked in/);
    assert.equal((await w.fake.local.admin("select count(*)::int n from fftt_private.players where display_name = 'Prince'"))[0].n, 1, 'accepted as written on the second press');

    // The same single-player form now handles roster-only additions.
    await page.fill('#wName', 'Cher');
    await page.getByRole('button', {name: 'Add to roster', exact: true}).click();
    await page.locator('#wMsg', {hasText: 'full first and last name'}).waitFor();
    assert.equal((await w.fake.local.admin("select count(*)::int n from fftt_private.players where display_name = 'Cher'"))[0].n, 0, 'roster-only entry also asks once');
    await page.getByRole('button', {name: 'Add to roster', exact: true}).click();
    await toast(page, /Cher added to the roster/);
    const cher = await w.fake.local.admin("select checked_in from fftt_private.players where display_name = 'Cher'");
    assert.deepEqual(cher, [{checked_in: false}], 'roster entry does not imply a check-in');

    // 6. PRIVACY: contacts and questionnaire answers never reach tournament records, audit log, exports, spectator view or the page
    const E = w.eventId, O = w.ids.org;
    // participant contacts use example.invalid; the staff list in the Organizer export legitimately carries staff sign-in addresses (fftt-staging.invalid)
    const PRIVATE = /example\.invalid|555-01|734-555|Sustains rallies|Intermediate profile|Chose the|PRIVATE KEY|ya29/i;
    const tables = JSON.stringify(await w.fake.local.admin('select * from fftt_private.players where event_id = $1', [E]))
      + JSON.stringify(await w.fake.local.admin('select * from fftt_private.registration_links where event_id = $1', [E]))
      + JSON.stringify(await w.fake.local.admin('select * from fftt_private.registration_sources where event_id = $1', [E]));
    assert.ok(!PRIVATE.test(tables), 'no contact or answer in the stored rows');
    const audit = JSON.stringify(await w.fake.local.rpc(O, 'fftt_audit_log_v3', {p_event_id: E, p_limit: 200}));
    assert.ok(!PRIVATE.test(audit), 'no contact or answer in the audit log');
    assert.ok(!/spreadsheet|docs\.google/i.test(audit.replace(SHEET, '')) && !audit.includes(SHEET), 'the sheet id is not in the audit log');
    const exported = JSON.stringify(await w.fake.local.rpc(O, 'fftt_export_event_v3', {p_event_id: E}));
    assert.ok(!PRIVATE.test(exported), 'no contact or answer in the organizer export: ' + (exported.match(new RegExp('.{0,40}(' + PRIVATE.source + ').{0,40}', 'i')) ?? [''])[0]);
    assert.equal(JSON.parse(exported).synthetic_only, false);
    await w.fake.local.rpc(O, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
    assert.ok(!PRIVATE.test(JSON.stringify(await w.fake.local.publicTournaments())), 'no contact or answer in the public projection');
    await w.fake.local.rpc(O, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: false});
    assert.ok(!/\b734[-. ]?555/.test(await page.locator('body').innerText()), 'no full phone on screen');
    assert.ok(w.google.calls.every(c => c.method === 'GET' || c.path === '/token'), 'Google was only ever read');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('LAUNCH MODE access rules: scorekeepers and outsiders are refused, other events and the diagnostic/off modes read nothing', {timeout: 400000}, async () => {
  const w = await launchWorld();
  try {
    const E = w.eventId;
    const org = await w.device('org');
    await org.signIn('org');
    await org.page.locator('#evName').waitFor({timeout: T});
    await goTab(org.page, 'Players');
    await org.page.locator('#regSetToggle').click();
    await org.page.fill('#regSheet', url(SHEET));
    await org.page.locator('#regCheck').click();
    await org.page.locator('.diag', {hasText: 'Ready to read'}).waitFor({timeout: T});
    await idle(org.page);
    await org.page.locator('#regEnable').check();
    await org.page.locator('#regSave').click();
    await toast(org.page, /Registration source saved/);

    // a scorekeeper never sees the registration screen
    const a = await w.device('a', {viewport: {width: 390, height: 844}, mobile: true});
    await a.signIn('a');
    await a.page.locator('#statusline').waitFor();
    assert.equal(await a.page.locator('nav.tabs button').count(), 1, 'scorekeeper: Match Desk only');
    assert.equal(await a.page.locator('#regLoad').count(), 0);
    // the database also refuses a scorekeeper / outsider / another event for the source and the staff list
    await assert.rejects(w.fake.local.rpc(w.ids.a, 'fftt_registration_source_v5', {p_event_id: E}), /forbidden|not_found|denied/i);
    await assert.rejects(w.fake.local.rpc(w.ids.out, 'fftt_registration_source_v5', {p_event_id: E}));
    await assert.rejects(w.fake.local.rpc(w.ids.a, 'fftt_set_registration_source_v5', {p_event_id: E, p_source: {kind: 'google-sheets', spreadsheet_id: SHEET, worksheet: TAB, column_map: {}, enabled: false}}));

    // switching the deployment to diagnostic (the documented incident response) stops reads immediately; the page says so
    w.registrationEnv.REGISTRATION_GOOGLE_MODE = 'diagnostic';
    const before = w.google.calls.length;
    await org.page.locator('#regSetToggle').click().catch(() => {});
    await org.page.locator('#regLoad').click();
    await org.page.locator('#regError').waitFor({timeout: T});
    assert.equal(w.google.calls.filter((c, i) => i >= before && /values/.test(c.path)).length, 0, 'diagnostic mode reads no rows');
    // and an event that is not on the allowlist is refused even in `enabled` mode
    w.registrationEnv.REGISTRATION_GOOGLE_MODE = 'enabled';
    w.registrationEnv.REGISTRATION_EVENT_IDS = crypto.randomUUID();
    await org.page.locator('#regLoad').click();
    await org.page.locator('#regError').waitFor({timeout: T});
    assert.equal((await org.page.locator('.reg-row').count()), 0, 'no registrants for an event outside the allowlist');
    // back to normal: reads resume
    w.registrationEnv.REGISTRATION_EVENT_IDS = E;
    await org.page.locator('#regLoad').click();
    await org.page.locator('.reg-row').first().waitFor({timeout: T});
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});
