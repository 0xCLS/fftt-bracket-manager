/** V4 in real Chrome: configurable match formats on every surface (Overview, Match Desk, score dialog, bracket,
 * spectator, TV, exports) and historical Best-of-5 compatibility. Browser-SIMULATED contexts, not physical devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld, SPECT} from './browser_world.mjs';
import {roster} from './helpers.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

const T = 20000;
const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const goTab = (page, name) => page.locator('nav.tabs button', {hasText: new RegExp('^' + name + '$')}).click();
const toast = (page, re, timeout = T) => page.locator('#toasts .toast', {hasText: re}).waitFor({timeout});

async function seed(w, n, {build = false} = {}) {
  const l = w.fake.local, E = w.eventId, org = w.ids.org;
  await l.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(n)});
  await l.rpc(org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  if (build) {
    const s = await l.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
    await l.rpc(org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(s.players)), p_expected_generation: 0, p_confirm: false});
  }
}

test('formats: configured on Overview, applied to the bracket, shown to scorekeepers, spectators and the TV; an override reaches an open score dialog', {timeout: 400000}, async () => {
  const w = await createBrowserWorld();
  try {
    await seed(w, 8);
    const org = await w.device('org');
    await org.signIn('org');
    await org.page.locator('#fmt-champ-bo').waitFor({timeout: T});
    // defaults are the approved ones
    assert.deepEqual(await org.page.locator('.format-row select').evaluateAll(els => els.map(e => e.value)),
      ['3', '11', '3', '11', '1', '21', '1', '21', '3', '11']);
    assert.equal(await org.page.locator('#fmt-champ-bo option[value="5"]').count(), 0, 'Best of 5 is not offered for new configuration');
    await org.page.selectOption('#fmt-champ-bo', '1'); await org.page.selectOption('#fmt-champ-pts', '21');
    await org.page.selectOption('#fmt-champ_final-bo', '3'); await org.page.selectOption('#fmt-champ_final-pts', '21');
    // an unsaved choice survives a background refresh (the page is rebuilt when the roster changes elsewhere)
    await w.fake.local.rpc(w.ids.org, 'fftt_upsert_players_v3', {p_event_id: w.eventId, p_players: [{name: 'Zed Z.', rating: 3, rating_status: 'provisional'}]});
    await org.page.locator('.overview-next').waitFor();
    await org.page.waitForTimeout(9000);
    assert.equal(await org.page.locator('#fmt-champ-bo').inputValue(), '1', 'unsaved format choice survives the background refresh');
    await org.page.locator('button', {hasText: 'Save match formats'}).click();
    await org.page.locator('dialog[open]', {hasText: 'Change match formats?'}).waitFor();
    await org.page.locator('dialog[open] button', {hasText: 'Save formats'}).click();
    await toast(org.page, /formats saved/i);
    await goTab(org.page, 'Players');
    await org.page.locator('h2', {hasText: /Roster/}).waitFor({timeout: T});
    await org.page.locator('button', {hasText: 'Check in all'}).click();
    await goTab(org.page, 'Championship');
    await org.page.locator('button', {hasText: 'Build championship bracket'}).click();
    await org.page.locator('h2', {hasText: /Ready to play/}).waitFor({timeout: T});
    const card = org.page.locator('.queue-card').first();
    assert.match(await card.innerText(), /Best of 1 · to 21/);

    // bracket cards show each match's own format; the final differs from the rounds
    await goTab(org.page, 'Championship');
    const heads = await org.page.locator('.match-head span:first-child').allInnerTexts();
    assert.ok(heads.includes('Best of 1 · to 21') && heads.includes('Best of 3 · to 21'), JSON.stringify(heads));

    // two scorekeepers + public views
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    await a.page.locator('.queue-card').first().waitFor({timeout: T});
    await w.fake.local.rpc(w.ids.org, 'fftt_set_visibility_v3', {p_event_id: w.eventId, p_visible: true});
    const spec = await w.device('spec', PHONE); await spec.open(SPECT + '/');
    const tv = await w.device('tv', {viewport: {width: 1920, height: 1080}}); await tv.open(SPECT + '/app/tv.html');
    await a.page.locator('.queue-card').first().locator('select').selectOption('1');
    await toast(a.page, /table 1/i);
    await spec.page.locator('.board-match .fmt-line', {hasText: 'Best of 1 · to 21'}).first().waitFor({timeout: 20000});
    await tv.page.locator('.tv-line .fmt', {hasText: 'Best of 1 · to 21'}).first().waitFor({timeout: 20000});
    await spec.page.locator('nav.tabs button', {hasText: 'Bracket'}).click();
    await spec.page.locator('.match-head', {hasText: 'Best of 3 · to 21'}).first().waitFor({timeout: 20000});

    // scorekeeper: ONE game for a Best of 1; a game to 11 is refused for a game to 21
    const first = a.page.locator('.queue-card').first();
    await first.locator('button', {hasText: 'Record result'}).click();
    const dlg = a.page.locator('dialog[open]');
    assert.equal(await dlg.locator('.games input').count(), 2, 'a single game: one pair of inputs');
    assert.match(await dlg.innerText(), /Best of 1 · to 21/);
    await dlg.locator('.winner-pick label').first().click();
    await dlg.locator('.games input').nth(0).fill('11'); await dlg.locator('.games input').nth(1).fill('5');
    await dlg.locator('button', {hasText: 'Review result'}).click();
    await dlg.locator('.status.bad', {hasText: /goes to 21/}).waitFor();
    await dlg.locator('.games input').nth(0).fill('21'); await dlg.locator('.games input').nth(1).fill('20');
    await dlg.locator('button', {hasText: 'Review result'}).click();
    await dlg.locator('.status.bad', {hasText: /goes to 21/}).waitFor();
    await dlg.locator('.games input').nth(0).fill('22'); await dlg.locator('.games input').nth(1).fill('20');
    await dlg.locator('button', {hasText: 'Review result'}).click();
    await dlg.locator('.review').waitFor();
    assert.match(await dlg.locator('.review').innerText(), /22-20/);
    await dlg.locator('button', {hasText: 'Confirm and send'}).click();
    await toast(a.page, /Score saved/);

    // the organizer changes ANOTHER match's format while a scorekeeper already has its dialog open
    const second = a.page.locator('.queue-card').first();
    const names = (await second.locator('.versus').innerText()).split('\n').filter(x => x && x !== 'vs');
    await second.locator('button', {hasText: 'Record result'}).click();
    const dlg2 = a.page.locator('dialog[open]');
    await dlg2.locator('.winner-pick label').first().click();
    await dlg2.locator('.games input').nth(0).fill('21'); await dlg2.locator('.games input').nth(1).fill('12');
    await goTab(org.page, 'Match Desk');
    const orgCard = org.page.locator('.queue-card', {hasText: names[0]});
    await orgCard.locator('button', {hasText: 'Format…'}).click();
    await org.page.locator('#mfBo').selectOption('3'); await org.page.locator('#mfPts').selectOption('11');
    await org.page.locator('dialog[open] button', {hasText: 'Save format'}).click();
    await toast(org.page, /Format saved: Best of 3 · to 11/);
    await a.page.waitForTimeout(9500);   // the scorekeeper's desk refreshes in the background while the dialog stays untouched
    await dlg2.locator('button', {hasText: 'Review result'}).click();
    await dlg2.locator('.status.bad', {hasText: /organizer changed this match to Best of 3, games to 11/}).waitFor({timeout: T});
    await dlg2.locator('button', {hasText: 'Cancel'}).click();
    await a.page.locator('.queue-card', {hasText: 'Best of 3 · to 11'}).first().waitFor({timeout: T});

    // a recorded match's format is locked everywhere
    await goTab(org.page, 'Overview');
    await org.page.locator('#fmt-champ-bo').waitFor();
    assert.equal(await org.page.locator('#fmt-champ-bo').isDisabled(), true, 'championship rounds are locked once a result exists');
    assert.equal(await org.page.locator('#fmt-champ_final-bo').isDisabled(), false, 'the final category is still open');
    await org.page.locator('.format-row.is-locked').first().waitFor();

    // exports carry the format
    await goTab(org.page, 'Results & Export');
    const [dl] = await Promise.all([org.page.waitForEvent('download'), org.page.locator('button', {hasText: 'Matches (CSV)'}).click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.equal(csv.split('\r\n')[0], 'Bracket,Round,Match,Player 1,Player 2,Winner,Game scores,Table,Status,Format');
    assert.match(csv, /22-20,\d*,complete,Best of 1 to 21/);
    const [dl2] = await Promise.all([org.page.waitForEvent('download'), org.page.locator('button', {hasText: 'Results (text)'}).click()]);
    assert.match(fs.readFileSync(await dl2.path(), 'utf8'), /22-20 — Best of 1 to 21/);
    assert.deepEqual(w.pageErrors, []);
    assert.deepEqual(w.consoleErrors.filter(e => !/net::ERR|Failed to load resource/.test(e)), []);
  } finally { await w.close(); }
});

test('historical Best of 5: an unstamped final stays Best of 5 on every surface and is never rewritten', {timeout: 240000}, async () => {
  const w = await createBrowserWorld();
  try {
    await seed(w, 2, {build: true});
    await w.fake.local.admin('update fftt_private.matches set best_of = null, points_to_win = null where event_id = $1', [w.eventId]);   // pre-V4 rows
    await w.fake.local.rpc(w.ids.org, 'fftt_set_visibility_v3', {p_event_id: w.eventId, p_visible: true});
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    const card = a.page.locator('.queue-card').first();
    await card.waitFor({timeout: T});
    assert.match(await card.innerText(), /Best of 5 · to 11 · historical · Final/);
    await card.locator('button', {hasText: 'Record result'}).click();
    const dlg = a.page.locator('dialog[open]');
    assert.equal(await dlg.locator('.games input').count(), 10, 'five games');
    await dlg.locator('.winner-pick label').first().click();
    const scores = [['11', '5'], ['11', '6'], ['11', '7']];
    for (let i = 0; i < 3; i++) { await dlg.locator('.games input').nth(2 * i).fill(scores[i][0]); await dlg.locator('.games input').nth(2 * i + 1).fill(scores[i][1]); }
    await dlg.locator('button', {hasText: 'Review result'}).click();
    await dlg.locator('.review').waitFor();
    await dlg.locator('button', {hasText: 'Confirm and send'}).click();
    await toast(a.page, /Score saved/);
    const stamped = await w.fake.local.admin('select count(*)::int as n from fftt_private.matches where event_id = $1 and best_of is not null', [w.eventId]);
    assert.equal(stamped[0].n, 0, 'the historical match was not rewritten');
    const org = await w.device('org');
    await org.signIn('org');
    await goTab(org.page, 'Championship');
    await org.page.locator('.match-head', {hasText: 'Best of 5 · to 11'}).waitFor({timeout: T});
    await goTab(org.page, 'Overview');
    await org.page.locator('.notice', {hasText: 'Historical matches keep their original format'}).waitFor();
    await goTab(org.page, 'Results & Export');
    const [dl] = await Promise.all([org.page.waitForEvent('download'), org.page.locator('button', {hasText: 'Matches (CSV)'}).click()]);
    assert.match(fs.readFileSync(await dl.path(), 'utf8'), /Best of 5 to 11 \(historical\)/);
    const spec = await w.device('spec', PHONE); await spec.open(SPECT + '/');
    await spec.page.locator('nav.tabs button', {hasText: 'Bracket'}).click();
    await spec.page.locator('.match-head', {hasText: 'Best of 5 · to 11'}).waitFor({timeout: 20000});
    // a Best-of-3 score for the historical final is refused by the scorekeeper's own check before anything is sent
  } finally { await w.close(); }
});
