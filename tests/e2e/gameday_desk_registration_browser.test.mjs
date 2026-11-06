/** Bracket Manager registration lookup + check-in in real Chromium (desktop and phone), on a REAL-mode event on the upgraded schema,
 * with a fake Google serving a fictional sheet. Fictional people only; nothing leaves this machine. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createBrowserWorld} from './browser_world.mjs';
import {readSql, GATE, SHEET, TAB, ROWS} from './desk_world.mjs';

const T = 20000;
const toast = (page, re, timeout = T) => page.locator('#toasts .toast', {hasText: re}).waitFor({timeout});
const row = (page, name) => page.locator('.desk-reg-row', {has: page.locator('.desk-reg-name', {hasText: new RegExp('^' + name + '$')})});
const until = async (fn, label, ms = T) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } assert.fail('timed out: ' + label); };
const goCheckin = async page => { await page.locator('[data-tab="checkin"]').waitFor({timeout: T}); await page.locator('[data-tab="checkin"]').click(); await page.locator('#deskReg').waitFor({timeout: T}); };

async function deskWorld({mode = 'enabled', sourceEnabled = true} = {}) {
  const w = await createBrowserWorld({real: true, registration: 'google-only', google: {mode, sheets: {[SHEET]: {title: 'FFTT3 Sign-ups (fictional copy)', tabs: {[TAB]: ROWS}, shared: true}}}});
  Object.assign(w.registrationEnv, {REGISTRATION_REF_SECRET: crypto.randomBytes(32).toString('hex'), REGISTRATION_GATE_SECRET: GATE});
  for (const k of ['role', 'delegation', 'registration']) await w.fake.local.db.exec(readSql(k));
  await w.fake.local.admin('select fftt_private.install_registration_gate_v1($1)', [GATE]);
  w.accounts.manager = ['manager@fftt-desk-browser.invalid', 'FictionalManagerPw89!'];
  w.ids.manager = await w.fake.addAccount(...w.accounts.manager);
  await w.fake.local.rpc(w.ids.org, 'fftt_set_staff_v3', {p_event_id: w.eventId, p_email: w.accounts.manager[0], p_action: 'grant', p_role: 'bracket_manager'});
  await w.fake.local.rpc(w.ids.org, 'fftt_set_registration_source_v5', {p_event_id: w.eventId, p_source: {kind: 'google-sheets', spreadsheet_id: SHEET,
    spreadsheet_title: 'FFTT3 Sign-ups (fictional copy)', worksheet: TAB, column_map: {}, enabled: sourceEnabled}});
  w.apiBodies = [];
  const open = w.device;
  w.device = async (...a) => { const d = await open(...a); const o = d.open; d.open = async u => { const p = await o(u); p.on('request', r => { if (r.url().endsWith('/api/registrations')) w.apiBodies.push(JSON.parse(r.postData() ?? '{}')); }); return p; }; return d; };
  return w;
}
const players = w => w.fake.local.admin(`select p.display_name, p.rating, p.source, p.checked_in, (select count(*)::int from fftt_private.registration_links l where l.event_id = p.event_id and l.player_id = p.id) refs
  from fftt_private.players p where p.event_id = $1 order by p.display_name`, [w.eventId]);

test('desktop: load, search, one-tap check-in, review a duplicate group and a missing level, privacy and roster agree', {timeout: 300000}, async () => {
  const w = await deskWorld();
  try {
    const dev = await w.device('manager', {viewport: {width: 1366, height: 900}});
    await dev.signIn('manager');
    const page = dev.page;
    await goCheckin(page);
    // loads by itself the first time; the roster below starts empty
    await page.locator('.desk-reg-row').first().waitFor({timeout: T});
    assert.equal(await page.locator('.desk-reg-row').count(), 20);
    assert.match(await page.locator('#deskRegCount').innerText(), /20 registered · 0 checked in/);
    assert.equal(await page.locator('tbody tr').count(), 0, 'nobody is on the roster yet');
    const arrivals = page.locator('.manager-checkin-page .mini-kpi.lime');
    assert.equal(await arrivals.locator('span').innerText(), 'Awaiting arrival');
    assert.equal(await arrivals.locator('strong').innerText(), '20', 'the 20 sign-ups are awaiting arrival, despite an empty roster');
    assert.match(await arrivals.getAttribute('title'), /duplicate sign-ups may be counted separately/);
    const layout = await page.evaluate(() => {
      const top = document.querySelector('.manager-checkin-page > .players-overview');
      const registration = document.querySelector('#deskReg');
      const arrivals = document.querySelector('[aria-label="Event-day roster"]').closest('section');
      const [t, r, a] = [top, registration, arrivals].map(el => el.getBoundingClientRect());
      return {ordered: t.bottom <= r.top && r.bottom <= a.top,
        widths: [t.width, r.width, a.width], walkins: [...document.querySelectorAll('h2')].filter(x => x.textContent === 'Add a walk-in').length};
    });
    assert.ok(layout.ordered, 'top, registrations and arrivals appear in order');
    assert.ok(layout.widths.every(w => Math.abs(w - layout.widths[0]) < 2), 'registrations and arrivals use the full page width');
    assert.equal(layout.walkins, 1, 'one walk-in card');
    assert.equal(await page.getByRole('button', {name: 'Add to roster'}).count(), 0);
    const walkLevels = page.getByRole('radiogroup', {name: 'FFTT level for the new player'});
    assert.equal(await walkLevels.getByRole('radio').count(), 5);
    assert.equal(await walkLevels.getByRole('radio', {name: '1', exact: true}).isChecked(), true);
    await walkLevels.getByRole('radio', {name: '4', exact: true}).check();
    await page.locator('#deskRegLoad').click();
    await toast(page, /20 registered players loaded/);
    assert.equal(await page.getByRole('radio', {name: '4', exact: true}).isChecked(), true, 'walk-in level survives refresh');


    // search narrows the list live and keeps the text
    await page.fill('#bmSearch', 'marl');
    assert.deepEqual(await page.locator('.desk-reg-name').allInnerTexts(), ['Ben Marlowe']);
    assert.match(await page.locator('#deskRegCount').innerText(), /1 of 20 registered match “marl”/);
    await page.fill('#bmSearch', 'zzzz');
    await page.locator('#deskRegList .empty-state', {hasText: 'walk-in'}).waitFor();
    assert.match(await page.locator('#deskRegList .empty-state').innerText(), /form above/);
    await page.fill('#bmSearch', '');

    // one tap for a plain registration: added to the roster and checked in, at the suggested level
    await row(page, 'Ben Marlowe').locator('button', {hasText: 'Check in'}).click();
    await toast(page, /Ben Marlowe checked in\./);
    await row(page, 'Ben Marlowe').locator('.pill', {hasText: 'Checked in'}).waitFor({timeout: T});
    await page.locator('tbody tr', {hasText: 'Ben Marlowe'}).waitFor({timeout: T});
    const levelCell = page.locator('tbody tr', {hasText: 'Ben Marlowe'}).locator('[data-label="Level"]');
    assert.equal(await levelCell.locator('.rank-badge[data-level="2"] svg').count(), 1);
    assert.match(await levelCell.innerText(), /Level 2/);
    assert.equal(await levelCell.locator('select,input,button').count(), 0, 'roster level is read-only');
    await until(async () => (await arrivals.locator('strong').innerText()) === '19', 'a checked-in registrant reduces awaiting arrival');

    assert.match(await page.locator('#deskRegCount').innerText(), /1 checked in/);
    assert.deepEqual((await players(w)).map(p => [p.display_name, p.rating, p.source, p.checked_in]), [['Ben Marlowe', 2, 'registration', true]]);
    assert.equal(await row(page, 'Ben Marlowe').locator('button').count(), 0, 'no second tap is offered');

    // a duplicate group needs a decision: review, merge the other sign-ups, one roster spot
    const ada = page.locator('.desk-reg-row', {has: page.locator('.desk-reg-name', {hasText: /^Ada Quillfeather$/})}).first();
    await ada.locator('button', {hasText: 'Review & check in'}).click();
    await page.locator('dialog[open] #deskReviewLevel').waitFor();
    assert.equal(await page.locator('dialog[open] .desk-reg-merge-row input:checked').count(), 2, 'a definite duplicate group defaults to "same person"');
    await page.locator('#deskReviewGo').click();
    await toast(page, /Ada Quillfeather checked in \(2 duplicate registrations merged\)/);
    await page.locator('dialog').waitFor({state: 'detached'});
    await until(async () => (await page.locator('.desk-reg-row .pill', {hasText: /^Checked in$/}).count()) === 4, 'all three Ada sign-ups and Ben show as checked in');
    const after = await players(w);
    assert.deepEqual(after.map(p => [p.display_name, p.refs]), [['Ada Quillfeather', 3], ['Ben Marlowe', 1]]);
    assert.equal(await arrivals.locator('strong').innerText(), '16', 'three merged duplicate registrations no longer await arrival');

    // a registration with no suggested level: the level must be chosen first
    await page.fill('#bmSearch', 'kit');
    await row(page, 'Kit Alderman').locator('button', {hasText: 'Review & check in'}).click();
    assert.equal(await page.locator('#deskReviewGo').isDisabled(), true);
    await page.selectOption('#deskReviewLevel', '4');
    await page.locator('#deskReviewGo').click();
    await toast(page, /Kit Alderman checked in\./);
    assert.deepEqual((await players(w)).find(p => p.display_name === 'Kit Alderman')?.rating, 4);
    assert.equal(await arrivals.locator('strong').innerText(), '15', 'reviewed registration updates awaiting arrival');

    // an incomplete name cannot be checked in from the sheet
    await page.fill('#bmSearch', 'lia');
    const lia = row(page, 'Lia');
    assert.equal(await lia.locator('button').count(), 0);
    const liaText = await lia.innerText(); assert.ok(/walk-in/i.test(liaText) && /Name needs fixing/.test(liaText), liaText);
    await page.fill('#bmSearch', '');

    // privacy: nothing private on screen, and the browser only ever sent opaque references
    const text = await page.locator('body').innerText();
    assert.ok(!/@|example\.invalid|\b734[-. ]?555|\(734\)|555-01|PRIVATE KEY|docs\.google|SYNTHETIC_DESK_SHEET/.test(text), 'no contact, credential or sheet detail on screen');
    assert.ok(!/•••/.test(text), 'not even masked hints');
    const sent = w.apiBodies.filter(b => b.action === 'checkin');
    assert.ok(sent.length >= 3);
    for (const b of sent) assert.deepEqual(Object.keys(b).filter(k => !['action', 'event_id', 'ref', 'merge_refs', 'level'].includes(k)), [], 'only references and a level choice are sent');
    assert.ok(w.apiBodies.every(b => ['lookup', 'checkin'].includes(b.action)), 'the desk never asks for source settings');

    // walk-ins and the roster check-in are unchanged
    await page.locator('#edName').fill('Walt Winters');
    await page.getByRole('button', {name: 'Add & check in'}).click();
    await page.locator('tbody tr', {hasText: 'Walt Winters'}).waitFor({timeout: T});
    assert.equal((await players(w)).find(p => p.display_name === 'Walt Winters').rating, 4, 'walk-in uses selected level');
    assert.equal(await arrivals.locator('strong').innerText(), '15', 'a walk-in not in the sheet must not reduce awaiting arrival');
    const row1 = page.locator('tbody tr', {hasText: 'Ben Marlowe'});
    await row1.locator('button', {hasText: 'Undo'}).click();
    await row1.locator('.pill', {hasText: 'Expected'}).waitFor({timeout: T});
    await row(page, 'Ben Marlowe').locator('button', {hasText: 'Check in'}).waitFor({timeout: T});
    assert.equal(await arrivals.locator('strong').innerText(), '16', 'undoing registration check-in increases awaiting arrival');
    await page.locator('tbody tr', {hasText: 'Ada Quillfeather'}).locator('button', {hasText: 'Undo'}).click();
    await until(async () => (await arrivals.locator('strong').innerText()) === '17', 'linked duplicate group counts as one arrival after Undo');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('phone layout: the lookup fits, buttons are tappable, the dialog is usable', {timeout: 240000}, async () => {
  const w = await deskWorld();
  try {
    const dev = await w.device('phone', {viewport: {width: 390, height: 844}, mobile: true});
    await dev.signIn('manager');
    const page = dev.page;
    await goCheckin(page);
    await page.locator('.desk-reg-row').first().waitFor({timeout: T});
    assert.equal(await page.locator('.mini-kpi.lime strong').innerText(), '20', 'phone shows registration-based awaiting arrival');
    assert.equal(await page.getByRole('radiogroup', {name: 'FFTT level for the new player'}).getByRole('radio').count(), 5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, 'no sideways scrolling: ' + overflow);
    const box = await row(page, 'Cy Fennelwick').locator('button', {hasText: 'Check in'}).boundingBox();
    assert.ok(box.height >= 44 && box.width >= 60, `tappable: ${box.width}x${box.height}`);
    const rowBox = await row(page, 'Cy Fennelwick').boundingBox();
    assert.ok(rowBox.width <= 390, 'the row fits the screen');
    await page.fill('#bmSearch', 'ada');
    await page.locator('.desk-reg-row', {hasText: 'Ada Quillfeather'}).first().locator('button', {hasText: 'Review & check in'}).click();
    const dlg = await page.locator('dialog[open]').boundingBox();
    assert.ok(dlg.width <= 390 && dlg.x >= 0, 'the dialog fits the phone');
    await page.locator('dialog[open] button', {hasText: 'Cancel'}).click();
    assert.equal((await players(w)).length, 0, 'cancel changes nothing');
    await page.fill('#bmSearch', 'cy');
    await row(page, 'Cy Fennelwick').locator('button', {hasText: 'Check in'}).click();
    const rosterRow = page.locator('tbody tr', {hasText: 'Cy Fennelwick'});
    await rosterRow.waitFor({timeout: T});
    assert.equal(await rosterRow.locator('[data-label="Level"] .rank-badge[data-level="5"]').count(), 1);
    assert.equal(await rosterRow.locator('[data-label="Level"] select').count(), 0);
    const boxes = await page.evaluate(() => [...document.querySelectorAll('.manager-checkin-page > .players-overview, .manager-checkin-page > #deskReg, [aria-label="Event-day roster"]')].map(el => el.getBoundingClientRect().width));
    assert.equal(boxes.length, 3);
    assert.ok(boxes.every(width => width <= 390), 'check-in sections fit the phone');
    await page.fill('#bmSearch', 'ada');
    await row(page, 'Ada Quillfeather').first().locator('.is-attn, button').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, true);
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('failure and locked states: not set up, switched off, outage, uncertain outcome, late arrival, revoked access', {timeout: 400000}, async () => {
  const w = await deskWorld();
  try {
    const dev = await w.device('manager', {viewport: {width: 1280, height: 900}});
    await dev.signIn('manager');
    const page = dev.page;
    await goCheckin(page);
    await page.locator('.desk-reg-row').first().waitFor({timeout: T});

    // an uncertain outcome: the database applied the check-in but the answer was lost; the desk is told, refreshes, and shows the truth
    w.fake.loseNextReply('registration-adapter', '/rest/v1/rpc/fftt_bm_registration_checkin_v1');
    await row(page, 'Cy Fennelwick').locator('button', {hasText: 'Check in'}).click();
    await toast(page, /could not confirm|connection dropped|heard back/i);
    await row(page, 'Cy Fennelwick').locator('.pill', {hasText: 'Checked in'}).waitFor({timeout: T});
    assert.equal((await players(w)).filter(p => p.display_name === 'Cy Fennelwick').length, 1, 'exactly one Cy');
    // a second press is impossible (already checked in) and a replay would be idempotent anyway

    // the Organizer switches the sheet off: reload explains, the roster stays usable
    await w.fake.local.rpc(w.ids.org, 'fftt_set_registration_source_v5', {p_event_id: w.eventId, p_source: {kind: 'google-sheets', spreadsheet_id: SHEET, worksheet: TAB, column_map: {}, enabled: false}});
    await page.locator('#deskRegLoad').click();
    await page.locator('#deskRegError').waitFor({timeout: T});
    assert.match(await page.locator('#deskRegError').innerText(), /switched off|Ask the Organizer/);
    assert.equal(await page.locator('.mini-kpi.lime strong').innerText(), '—', 'an unavailable lookup cannot appear as zero or a current arrival count');
    assert.ok(await page.locator('.desk-reg-row').count() > 0, 'the earlier list stays, marked as old');
    assert.equal(await page.locator('#edName').isDisabled(), false, 'walk-ins still work');
    await w.fake.local.rpc(w.ids.org, 'fftt_set_registration_source_v5', {p_event_id: w.eventId, p_source: {kind: 'google-sheets', spreadsheet_id: SHEET, worksheet: TAB, column_map: {}, enabled: true}});

    // Google outage: generic message, nothing changed
    w.google.sheets[SHEET].shared = false; w.registrationState.cache.clear();
    await page.locator('#deskRegLoad').click();
    await page.locator('#deskRegError', {hasText: /temporarily unavailable|Ask the Organizer/}).waitFor({timeout: T});
    w.google.sheets[SHEET].shared = true; w.registrationState.cache.clear();
    await page.locator('#deskRegLoad').click();
    await toast(page, /20 registered players loaded/);
    assert.equal(await page.locator('#deskRegError').count(), 0);
    assert.equal(await page.locator('.mini-kpi.lime strong').innerText(), '19', 'recovered source restores registration count');

    // the proof secret is missing in the Function (not yet released): a clear, harmless message
    const saved = w.registrationEnv.REGISTRATION_GATE_SECRET; delete w.registrationEnv.REGISTRATION_GATE_SECRET;
    await page.locator('#deskRegLoad').click();
    await page.locator('#deskRegError', {hasText: /not set up/}).waitFor({timeout: T});
    w.registrationEnv.REGISTRATION_GATE_SECRET = saved;
    await page.locator('#deskRegLoad').click();
    await toast(page, /20 registered players loaded/);

    // late arrival: once the Championship is built the lookup is locked and says why
    const ids = [];
    for (const n of ['Dee Larkspur', 'Eli Brandtley', 'Fay Hollowell']) { await row(page, n).locator('button', {hasText: 'Check in'}).click(); await row(page, n).locator('.pill', {hasText: 'Checked in'}).waitFor({timeout: T}); }
    for (const p of await players(w)) ids.push((await w.fake.local.admin('select id from fftt_private.players where event_id=$1 and display_name=$2', [w.eventId, p.display_name]))[0].id);
    await w.fake.local.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: w.eventId, p_slots: ids, p_expected_generation: 0, p_confirm: false});
    await page.locator('[data-tab="championship"]').click();
    await page.locator('[data-tab="checkin"]').click();
    await page.locator('#deskReg .notice', {hasText: /Check-in is closed|locked/}).waitFor({timeout: T});
    assert.equal(await row(page, 'Gus Pemberly').locator('button', {hasText: 'Check in'}).isDisabled(), true);
    assert.equal(await page.getByRole('button', {name: 'Add & check in'}).isDisabled(), true, 'walk-ins are locked too (unchanged)');

    // revoked: the same still-open page cannot do anything more
    await w.fake.local.rpc(w.ids.org, 'fftt_set_staff_v3', {p_event_id: w.eventId, p_email: w.accounts.manager[0], p_action: 'revoke', p_role: null});
    const before = (await players(w)).length;
    await page.locator('#deskRegLoad').click().catch(() => {});
    await page.waitForTimeout(800);
    assert.equal((await players(w)).length, before);
    const token = await w.fake.local.rpc(w.ids.org, 'fftt_audit_log_v3', {p_event_id: w.eventId, p_limit: 5});
    assert.ok(Array.isArray(token));
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
async function axe(page, label) {
  if (!(await page.evaluate(() => typeof window.axe)).startsWith('object')) await page.addScriptTag({url: '/__test__/axe.min.js'});
  const res = await page.evaluate(rules => window.axe.run(document, {runOnly: {type: 'tag', values: rules}, resultTypes: ['violations']}), RULES);
  assert.deepEqual(res.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), [], `accessibility violations on ${label}`);
}

test('accessibility and keyboard: no WCAG A/AA violations on the lookup, a locked/error state or the review dialog; the whole flow works from the keyboard', {timeout: 300000}, async () => {
  const w = await deskWorld();
  try {
    for (const [name, vp, mobile] of [['desktop', {width: 1366, height: 900}, false], ['phone', {width: 390, height: 844}, true]]) {
      const dev = await w.device('a11y-' + name, {viewport: vp, mobile});
      await dev.signIn('manager');
      const page = dev.page;
      await goCheckin(page);
      await page.locator('.desk-reg-row').first().waitFor({timeout: T});
      await axe(page, `lookup @ ${name}`);
      await page.fill('#bmSearch', 'ada');
      await page.locator('.desk-reg-row', {hasText: 'Ada Quillfeather'}).first().locator('button', {hasText: 'Review & check in'}).click();
      await page.locator('dialog[open] #deskReviewLevel').waitFor();
      await axe(page, `review dialog @ ${name}`);
      await page.keyboard.press('Escape');
      await page.locator('dialog').waitFor({state: 'detached'});
      assert.equal((await players(w)).length, 0, 'Escape cancels without changing anything');
    }
    // keyboard only: search, tab to the action, press Enter
    const kb = await w.device('keyboard', {viewport: {width: 1280, height: 900}});
    await kb.signIn('manager');
    const page = kb.page;
    await goCheckin(page);
    await page.locator('.desk-reg-row').first().waitFor({timeout: T});
    await page.focus('#bmSearch');
    await page.keyboard.type('hal wint');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    assert.equal(focused, 'Check in Hal Wintersby', 'the first Tab from the search lands on the matching person\'s action');
    await page.keyboard.press('Enter');
    await toast(page, /Hal Wintersby checked in\./);
    assert.deepEqual((await players(w)).map(p => p.display_name), ['Hal Wintersby']);
    // a locked state is accessible too
    const ids = (await w.fake.local.admin('select id from fftt_private.players where event_id = $1', [w.eventId])).map(r => r.id);
    for (const n of ['Ivy Castelan', 'Gus Pemberly', 'Fay Hollowell']) { const r = await w.fake.local.rpc(w.ids.manager, 'fftt_event_day_walkin_v1', {p_event_id: w.eventId, p_name: n + ' Walkin', p_rating: 3}); ids.push(r.player_id); }
    await w.fake.local.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: w.eventId, p_slots: ids, p_expected_generation: 0, p_confirm: false});
    await page.locator('[data-tab="championship"]').click(); await page.locator('[data-tab="checkin"]').click();
    await page.locator('#deskReg .notice').waitFor({timeout: T});
    await axe(page, 'locked lookup');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});
