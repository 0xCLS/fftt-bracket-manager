/** Real Chrome, real page code, real SQL behind a fake HTTPS service. One fictional tournament, run by an
 * organizer desktop, two scorekeeper phones, a spectator phone and a TV, plus an outsider.
 * This is a browser-SIMULATED rehearsal (separate isolated browser contexts on one machine). It is NOT a
 * physical-device test and is never reported as one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld, STAFF, SPECT} from './browser_world.mjs';
import {roster, playAllPlayable} from './helpers.mjs';

const SHOTS = process.env.FFTT_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, {recursive: true});
const shot = async (dev, name) => { if (SHOTS) await dev.page.screenshot({path: `${SHOTS}/${name}.png`, fullPage: true}); };
const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const T = 20000;

const goTab = (page, name) => page.locator('nav.tabs button', {hasText: new RegExp('^' + name + '$')}).click();
async function waitToast(page, re, timeout = T) {
  await page.locator('#toasts .toast', {hasText: re}).waitFor({timeout});
}
/** Record a result through the dialog. `winnerFirst`: is the first-listed player the winner. */
async function recordViaUi(page, card, {winnerFirst = true, games = null, table = null} = {}) {
  await card.locator('button', {hasText: 'Record result'}).click();
  const dlg = page.locator('dialog[open]');
  const radios = dlg.locator('.winner-pick label');
  await radios.nth(winnerFirst ? 0 : 1).click();
  const inputs = dlg.locator('.games input');
  const g = games ?? (winnerFirst ? [['11', '7'], ['11', '9']] : [['7', '11'], ['9', '11']]);
  for (let i = 0; i < g.length; i++) { await inputs.nth(2 * i).fill(g[i][0]); await inputs.nth(2 * i + 1).fill(g[i][1]); }
  if (table) await dlg.locator('#scTable').selectOption(String(table));
  await dlg.locator('button', {hasText: 'Review result'}).click();
  await dlg.locator('.review').waitFor();
  return {dlg, review: await dlg.locator('.review').textContent()};
}

test('browser rehearsal: organizer, two scorekeepers, spectator, TV and an outsider run a fictional tournament', {timeout: 600000}, async t => {
  const w = await createBrowserWorld();
  const E = w.eventId, local = w.fake.local;
  try {
    // ---------------------------------------------------------------- organizer signs in, loads players, builds
    const org = await w.device('org');
    await org.signIn('org');
    await org.page.locator('#evName').waitFor({timeout: T});
    assert.equal(await org.page.locator('#evName').inputValue(), 'Synthetic Rehearsal Games', 'selected organizer event remains correct');
    await shot(org, '01-organizer-overview');
    await goTab(org.page, 'Players');
    const list = roster(12).map(p => `${p.name}, ${p.rating}, ${p.rating_status}`).join('\n');
    await org.page.locator('#addModeBulk').click();  // unified Add players: select Paste a list
    await org.page.fill('#pBulk', list);
    await org.page.locator('button', {hasText: 'Add players to roster'}).click();
    await waitToast(org.page, /12 player/);
    await org.page.locator('button', {hasText: 'Check in all'}).click();
    const checkInConfirm = org.page.locator('dialog[open]');
    assert.match(await checkInConfirm.innerText(), /12 roster players.*physically here/s,
      'bulk attendance must explicitly warn that every roster player is marked present');
    await checkInConfirm.locator('button', {hasText: 'Cancel'}).click();
    assert.equal((await local.admin('select count(*)::int as n from fftt_private.players where event_id = $1 and checked_in', [E]))[0].n, 0,
      'cancelling a bulk check-in must not change any player');
    await org.page.locator('button', {hasText: 'Check in all'}).click();
    await org.page.locator('dialog[open] button', {hasText: 'Check in all players'}).click();
    await org.page.locator('h2', {hasText: '12 of 12 checked in'}).waitFor({timeout: T});
    assert.equal(await org.page.locator('button', {hasText: 'Check in all'}).isDisabled(), true, 'no redundant bulk attendance write');
    await org.page.locator('button', {hasText: 'Clear check-ins'}).click();
    const clearConfirm = org.page.locator('dialog[open]');
    assert.match(await clearConfirm.innerText(), /12 checked-in roster players.*check each attending player in again/s,
      'bulk clear must describe the attendance impact');
    await clearConfirm.locator('button', {hasText: 'Cancel'}).click();
    assert.equal((await local.admin('select count(*)::int as n from fftt_private.players where event_id = $1 and checked_in', [E]))[0].n, 12,
      'cancelling bulk clear must preserve attendance');
    await shot(org, '02-players');
    await goTab(org.page, 'Championship');
    await org.page.locator('button', {hasText: 'Build championship bracket'}).click();
    await org.page.locator('h2', {hasText: /Ready to play/}).waitFor({timeout: T});   // moved to the Match Desk
    await shot(org, '03-organizer-desk');

    // ---------------------------------------------------------------- two scorekeepers on phones
    const a = await w.device('a', PHONE), b = await w.device('b', PHONE);
    await a.signIn('a'); await b.signIn('b');
    await a.page.locator('.queue-card').first().waitFor({timeout: T});
    await b.page.locator('.queue-card').first().waitFor({timeout: T});
    assert.equal(await a.page.locator('nav.tabs button').count(), 1, 'a scorekeeper sees only the Match Desk');
    assert.ok(!(await a.page.locator('#app').innerText()).match(/Rating|Roster|Staff|Export|Players/), 'no organizer or rating information on a scorekeeper phone');
    const scorekeeperStatus = await a.page.locator('#statusline').innerText();
    assert.doesNotMatch(scorekeeperStatus, /0 checked in|0 matches completed|Consolation not ready/,
      'role-scoped scorekeeper view must not invent zero organizer totals');
    assert.match(scorekeeperStatus, /Match Desk only/, 'scorekeeper sees its role-scoped status');
    await shot(a, '04-scorekeeper-a-desk');

    // ---------------------------------------------------------------- spectators: nothing is public until the organizer publishes
    const spec = await w.device('spec', PHONE);
    await spec.open(SPECT + '/');
    await spec.page.locator('#main', {hasText: 'No event is public yet'}).waitFor({timeout: T});
    assert.match(await spec.page.locator('#live').innerText(), /No public event/,
      'a connected empty spectator feed must not claim to be live');
    await goTab(org.page, 'Results & Export');
    await org.page.locator('button', {hasText: 'Publish to spectators'}).click();
    await waitToast(org.page, /visible to spectators/);
    await spec.page.locator('#evName', {hasText: 'Synthetic Rehearsal Games'}).waitFor({timeout: 15000});
    // Desktop spectators must not inherit the staff sidebar's viewport-height navigation.
    // This guards the real CSS layout, not just textContent/DOM presence (mobile-only tests missed it).
    await spec.page.setViewportSize({width: 1440, height: 900});
    await spec.page.locator('#main h2', {hasText: 'Now playing'}).waitFor({timeout: T});
    const publicLayout = await spec.page.evaluate(() => {
      const nav = document.querySelector('nav.tabs');
      const main = document.querySelector('main#main');
      const n = nav.getBoundingClientRect(), m = main.getBoundingClientRect();
      return {direction: getComputedStyle(nav).flexDirection, navHeight: n.height, mainTop: m.top, leftGap: Math.abs(n.left - m.left), firstTabLeft: nav.querySelector('button').getBoundingClientRect().left, mainLeft: m.left, visible: !!main.textContent.trim()};
    });
    assert.equal(publicLayout.direction, 'row', 'desktop spectator tabs must be horizontal');
    assert.ok(publicLayout.navHeight < 100, 'desktop spectator navigation must not occupy the viewport');
    assert.ok(Math.abs(publicLayout.firstTabLeft - publicLayout.mainLeft) < 24,
      'spectator desktop tab alignment must match the centered content column');
    assert.ok(publicLayout.mainTop < 450 && publicLayout.visible, 'spectator content must be visible below the tabs');
    await spec.page.setViewportSize({width: 390, height: 844});


    // table assignment by a scorekeeper shows up as Now playing for spectators and on the TV
    const tv = await w.device('tv', {viewport: {width: 1920, height: 1080}});
    await tv.open(SPECT + '/app/tv.html');
    const first = a.page.locator('.queue-card').first();
    const firstText = await first.locator('.versus').innerText();
    await first.locator('select').selectOption('1');
    await waitToast(a.page, /table 1/i);
    await spec.page.locator('.board-match .tbl', {hasText: 'Table 1'}).waitFor({timeout: 15000});
    await tv.page.locator('.tv-line .tbl', {hasText: 'Table 1'}).waitFor({timeout: 15000});
    await shot(spec, '05-spectator-now'); await shot(tv, '06-tv');
    await b.page.locator('.queue-card.playing').waitFor({timeout: 15000});   // the other scorekeeper sees the table too
    const anotherMatch = b.page.locator('.queue-card:not(.playing)').first();
    assert.equal(await anotherMatch.locator('select option[value="1"]').isDisabled(), true,
      'an occupied table cannot be selected for another match from the other scorekeeper\'s phone');

    // ---------------------------------------------------------------- simultaneous score conflict from two phones
    const rowA = a.page.locator('.queue-card').nth(1), rowB = b.page.locator('.queue-card').nth(1);
    const names = (await rowA.locator('.versus').innerText()).split('\n').filter(x => x && x !== 'vs');
    const sameB = b.page.locator('.queue-card', {hasText: names[0]});
    const ra = await recordViaUi(a.page, rowA, {winnerFirst: true});
    const rb = await recordViaUi(b.page, sameB, {winnerFirst: false});
    assert.match(ra.review, new RegExp(names[0].split(' ')[0]));
    await shot(a, '07-score-review');
    await ra.dlg.locator('button', {hasText: 'Confirm and send'}).click();
    await waitToast(a.page, /Score saved/);
    await rb.dlg.locator('button', {hasText: 'Confirm and send'}).click();
    await waitToast(b.page, /NOT used/);
    await shot(b, '08-score-conflict');

    // ---------------------------------------------------------------- lost acknowledgment: resolved by the server receipt
    const next = b.page.locator('.queue-card').first();
    w.fake.loseNextReply('b', '/rpc/fftt_submit_match_result_v2');
    const rl = await recordViaUi(b.page, next, {winnerFirst: true});
    await rl.dlg.locator('button', {hasText: 'Confirm and send'}).click();
    await waitToast(b.page, /Score saved/);
    assert.equal(w.requests.filter(r => r.device === 'b' && r.path.endsWith('fftt_submit_match_result_v2')).length, 2, 'exactly one send for the lost-ack score (plus the conflict score)');
    assert.equal(await b.page.locator('.notice.warn', {hasText: 'not confirmed'}).count(), 0);

    // ---------------------------------------------------------------- organizer: no-show and correction
    await org.page.reload();   // a reload of the organizer tab: the session is not persisted, so sign in again
    await org.page.locator('#signIn:not([disabled])').waitFor({timeout: T});
    await org.signIn('org');
    await org.page.locator('#evName').waitFor({timeout: T});
    assert.equal(await org.page.locator('#evName').inputValue(), 'Synthetic Rehearsal Games', 'selected organizer event remains correct');
    await goTab(org.page, 'Match Desk');
    const nsCard = org.page.locator('.queue-card').last();
    await nsCard.locator('button', {hasText: 'No-show…'}).click();
    const dlg = org.page.locator('dialog[open]');
    await dlg.locator('.winner-pick label').first().click();
    await dlg.locator('button', {hasText: 'Record no-show'}).click();
    await waitToast(org.page, /No-show recorded/);
    await org.page.locator('button', {hasText: 'Correct…'}).first().click();
    const cd = org.page.locator('dialog[open]');
    await cd.locator('#crReason').fill('Scorekeeper tapped the wrong player');
    await cd.locator('.winner-pick label').nth(1).click();
    await cd.locator('button', {hasText: 'Save correction'}).click();
    await waitToast(org.page, /Correction saved|changed|already/i);

    // ---------------------------------------------------------------- finish the championship quickly server-side, then continue in the UI
    const ctx = {db: local, E, org: w.ids.org, skA: w.ids.a, skB: w.ids.b, snap: () => local.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
    await playAllPlayable(ctx, {only: 'championship'});
    await goTab(org.page, 'Consolation');
    await org.page.locator('button', {hasText: 'Build consolation bracket'}).waitFor({timeout: 15000});
    await shot(org, '09-consolation-ready');
    await org.page.locator('button', {hasText: 'Build consolation bracket'}).click();
    await org.page.locator('h2', {hasText: /Ready to play/}).waitFor({timeout: T});
    await playAllPlayable(ctx, {only: 'consolation'});
    await goTab(org.page, 'Doubles Finale');
    await org.page.locator('button', {hasText: 'Suggest balanced partners'}).waitFor({timeout: 15000});
    await org.page.locator('button', {hasText: 'Suggest balanced partners'}).click();
    await org.page.locator('button', {hasText: 'Save teams'}).click();
    await waitToast(org.page, /Teams saved/);
    await org.page.locator('.winner-pick label', {hasText: 'Team A won'}).click();
    await org.page.locator('#dbScores').fill('11-8, 9-11, 11-7');
    await org.page.locator('button', {hasText: 'Record doubles result'}).click();
    await waitToast(org.page, /Doubles result recorded/);
    await shot(org, '10-doubles');

    // ---------------------------------------------------------------- results, exports, spectators see the champion
    await goTab(org.page, 'Results & Export');
    await org.page.locator('h2', {hasText: 'Final standings'}).waitFor();
    assert.match(await org.page.locator('.card', {hasText: 'Final standings'}).innerText(), /singles champion/i);
    await shot(org, '11-results');
    const [dl] = await Promise.all([org.page.waitForEvent('download'), org.page.locator('button', {hasText: 'Private backup'}).click()]);
    const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(backup.format, 'fftt-event-export-v3');
    assert.equal(backup.snapshot.players.length, 12);
    const [dl2] = await Promise.all([org.page.waitForEvent('download'), org.page.locator('button', {hasText: 'Results (text)'}).click()]);
    const resultsTxt = fs.readFileSync(await dl2.path(), 'utf8');
    assert.match(resultsTxt, /Singles Champion/); assert.doesNotMatch(resultsTxt, /rating/i);
    assert.match(resultsTxt, /Mixed-Skill Doubles game scores \(Team A–Team B\): 11-8, 9-11, 11-7/);
    const [csvDl] = await Promise.all([org.page.waitForEvent('download'), org.page.locator('button', {hasText: 'Matches (CSV)'}).click()]);
    const matchCsv = fs.readFileSync(await csvDl.path(), 'utf8');
    assert.match(matchCsv, /doubles,1,D-FINAL/);
    assert.match(matchCsv, /11-8, 9-11, 11-7/);
    assert.doesNotMatch(matchCsv, /rating|00000000-0000-4000|@/i);
    await org.page.locator('button', {hasText: 'Mark event complete'}).click();
    await org.page.locator('dialog[open]', {hasText: 'An organizer may still make audited corrections'}).waitFor({timeout: T});
    await org.page.locator('dialog[open] button', {hasText: 'Mark complete'}).click();
    await waitToast(org.page, /marked complete/);

    await spec.page.locator('nav.tabs button', {hasText: 'Results'}).click();
    await spec.page.locator('.champion-banner').waitFor({timeout: 15000});
    await tv.page.locator('.champ').first().waitFor({timeout: 15000});
    await shot(spec, '12-spectator-final'); await shot(tv, '13-tv-final');

    // ---------------------------------------------------------------- privacy: nothing private reaches spectators or the TV
    for (const dev of [spec, tv]) {
      const text = await dev.page.locator('body').innerText();
      assert.ok(!/\brating\b|\bLevel [1-5]\b|@|organizer|scorekeeper/i.test(text), `${dev.name} shows no private information`);
      const reqs = w.requests.filter(r => r.device === dev.name);
      assert.ok(reqs.length > 0);
      assert.ok(reqs.every(r => r.path === '/rest/v1/fftt_public_tournament_v1' && r.auth === false), `${dev.name} uses only the anonymous public view`);
    }

    // ---------------------------------------------------------------- revocation: the organizer removes scorekeeper B; B's phone is signed out
    await goTab(org.page, 'Staff');
    const row = org.page.locator('tr', {hasText: w.accounts.b[0]});
    await row.locator('button', {hasText: 'Revoke'}).click();
    await org.page.locator('dialog[open] button', {hasText: 'Revoke'}).click();
    await waitToast(org.page, /Access revoked/);
    await b.page.locator('#signin:not([hidden])').waitFor({timeout: 20000});
    assert.match(await b.page.locator('#signInStatus').textContent(), /access ended|session ended/i);
    assert.equal(await b.page.locator('.queue-card').count(), 0, 'private rows are gone');

    // ---------------------------------------------------------------- an outsider cannot get in
    const out = await w.device('out', PHONE);
    await out.signIn('out');
    await out.page.locator('#signInStatus', {hasText: /does not have access/i}).waitFor({timeout: T});
    assert.equal(await out.page.locator('#app:not([hidden])').count(), 0);

    // ---------------------------------------------------------------- no browser-side problems anywhere
    assert.deepEqual(w.pageErrors, []);
    assert.deepEqual(w.consoleErrors.filter(e => !/net::ERR|Failed to load resource/.test(e)), [], 'no CSP violations or console errors');
  } finally { await w.close(); }
});
