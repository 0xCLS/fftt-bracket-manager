/** Responsive layout, accessibility (axe-core, WCAG A/AA rules), keyboard use and tap-target size, in real Chrome.
 * Browser-SIMULATED viewports on one machine; not a physical-device test. Fictional data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld, SPECT} from './browser_world.mjs';
import {roster} from './helpers.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

const T = 20000;
const SHOTS = process.env.FFTT_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, {recursive: true});
const VIEWPORTS = {phone: {viewport: {width: 390, height: 844}, mobile: true}, tablet: {viewport: {width: 820, height: 1180}}, desktop: {viewport: {width: 1440, height: 900}}};
const TABS = ['Overview', 'Players', 'Championship', 'Consolation', 'Match Desk', 'Doubles Finale', 'Results & Export', 'Staff'];
const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function stage(w) {
  const l = w.fake.local, E = w.eventId, o = w.ids.org;
  await l.rpc(o, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(12)});
  await l.rpc(o, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  const s = await l.rpc(o, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  await l.rpc(o, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(s.players)), p_expected_generation: 0, p_confirm: false});
  await l.rpc(o, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
}
async function axe(page, label) {
  if (!(await page.evaluate(() => typeof window.axe)).startsWith('object')) await page.addScriptTag({url: '/__test__/axe.min.js'});
  const res = await page.evaluate(rules => window.axe.run(document, {runOnly: {type: 'tag', values: rules}, resultTypes: ['violations']}), RULES);
  const bad = res.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  if (process.env.AUDIT_SOFT) { if (bad.length) console.log('AXE', label, JSON.stringify(res.violations.map(v => [v.id, v.nodes.flatMap(n => n.target.concat(n.any.map(a => a.message.slice(0, 90))))]))); return; }
  assert.deepEqual(bad, [], `accessibility violations on ${label}`);
}
const overflow = page => page.evaluate(() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth}));
async function smallTargets(page, min) {
  return page.evaluate(min => [...document.querySelectorAll('button, select, input:not([type=radio]):not([type=checkbox]):not([type=file]), summary, textarea')]
    .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('.sr-only'); })
    .filter(e => e.getBoundingClientRect().height < min).map(e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(e.getBoundingClientRect().height)}px`), min);
}

test('organizer screens: no horizontal overflow, no accessibility violations, usable targets, at phone / tablet / desktop widths', {timeout: 900000}, async () => {
  const w = await createBrowserWorld();
  try {
    await stage(w);
    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      const org = await w.device('org-' + vp, opts);
      await org.signIn('org');
      await org.page.locator('#evName').waitFor({timeout: T});
      for (const tab of TABS) {
        await org.page.locator('nav.tabs button', {hasText: new RegExp('^' + tab + '$')}).click();
        await org.page.waitForTimeout(450);
        if (tab === 'Players') { await org.page.locator('#regLoad').click(); await org.page.locator('.reg-row').first().waitFor({timeout: T}); await org.page.locator('.reg-row button', {hasText: 'Edit'}).first().click(); }
        const label = `${tab} @ ${vp}`;
        const o = await overflow(org.page);
        assert.ok(o.sw <= o.iw + 1, `horizontal overflow on ${label}: ${o.sw} > ${o.iw}`);
        await axe(org.page, label);
        if (vp === 'phone') {
          const small = await smallTargets(org.page, 36);
          if (process.env.AUDIT_SOFT) { if (small.length) console.log('SMALL', label, JSON.stringify(small)); } else assert.deepEqual(small, [], `targets under 36px on ${label}`);
        }
        if (SHOTS) await org.page.screenshot({path: `${SHOTS}/${vp}-${tab.replace(/\W+/g, '-')}.png`, fullPage: true});
      }
      // dialogs: the score dialog is accessible and fits a phone
      await org.page.locator('nav.tabs button', {hasText: /^Match Desk$/}).click();
      await org.page.locator('.queue-card button', {hasText: 'Record result'}).first().click();
      const dlg = org.page.locator('dialog[open]');
      await dlg.waitFor();
      await axe(org.page, `score dialog @ ${vp}`);
      const box = await dlg.boundingBox();
      assert.ok(box.x >= -1 && box.x + box.width <= opts.viewport.width + 1, 'the dialog fits the viewport width');
      await org.page.keyboard.press('Escape');
      await dlg.waitFor({state: 'detached'});
      assert.deepEqual(w.pageErrors, []);
    }
    // public displays
    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      const spec = await w.device('spec-' + vp, opts);
      await spec.open(SPECT + '/');
      await spec.page.locator('#evName', {hasText: 'Synthetic'}).waitFor({timeout: T});
      for (const t of ['Now & next', 'Bracket', 'Results']) {
        await spec.page.locator('nav.tabs button', {hasText: t}).click();
        await spec.page.waitForTimeout(300);
        const o = await overflow(spec.page);
        assert.ok(o.sw <= o.iw + 1, `spectator overflow on ${t} @ ${vp}`);
        await axe(spec.page, `spectator ${t} @ ${vp}`);
      }
    }
    const tv = await w.device('tv', {viewport: {width: 1920, height: 1080}});
    await tv.open(SPECT + '/app/tv.html');
    await tv.page.locator('#live', {hasText: 'LIVE'}).waitFor({timeout: T});
    await axe(tv.page, 'TV board');
  } finally { await w.close(); }
});

test('keyboard: sign-in order, event chooser, skip link, dialog focus and Escape', {timeout: 300000}, async () => {
  const w = await createBrowserWorld();
  try {
    await w.fake.local.rpc(w.ids.org, 'fftt_create_event_v3', {p_name: 'Second Event', p_date: '2027-02-02', p_table_count: 2});
    await stage(w);
    const d = await w.device('org');
    const page = await d.open((await import('./browser_world.mjs')).STAFF + '/app/staff.html');
    await page.waitForSelector('#signIn:not([disabled])');
    await axe(page, 'sign-in');
    // Tab order: email, password, show/hide, optional event box, keep signed in, sign in
    const order = [];
    await page.focus('#email');
    for (let i = 0; i < 5; i++) { order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.tagName)); await page.keyboard.press('Tab'); }
    assert.deepEqual(order, ['email', 'password', 'togglePassword', 'SUMMARY', 'keepSignedIn']);
    await page.fill('#email', w.accounts.org[0]); await page.fill('#password', w.accounts.org[1]);
    await page.keyboard.press('Enter');                       // submit from the keyboard
    await page.locator('#eventChooser:not([hidden])').waitFor({timeout: T});
    await axe(page, 'event chooser');
    assert.equal(await page.evaluate(() => document.activeElement.name), 'chooseEvent', 'focus moves into the chooser');
    await page.keyboard.press('ArrowDown');                   // radios work with the arrow keys
    await page.keyboard.press('Tab');                         // one Tab leaves the radio group for Continue
    assert.equal(await page.evaluate(() => document.activeElement.id), 'chooserGo');
    await page.keyboard.press('Enter');
    await page.locator('#evName').waitFor({timeout: T});
    // skip link is the first thing a keyboard user reaches and lands on the content
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
    // dialogs: focus goes in, Escape closes, focus returns to the button that opened it
    await page.locator('nav.tabs button', {hasText: /^Match Desk$/}).click();
    const opener = page.locator('.queue-card button', {hasText: 'Record result'}).first();
    await opener.focus(); await page.keyboard.press('Enter');
    const dlg = page.locator('dialog[open]'); await dlg.waitFor();
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true, 'focus is inside the dialog');
    await page.keyboard.press('Escape'); await dlg.waitFor({state: 'detached'});
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Record result', 'focus returns to the opener');
  } finally { await w.close(); }
});
