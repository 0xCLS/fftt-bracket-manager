/** Fictional Playwright tests (real Staff UI + real SQL, nothing hosted):
 *  - "Withdraw before play…" is shown only on a server-confirmed eligible bracket, only to Organizer/Bracket Manager,
 *    hidden on a saved game even with zero completed matches, fails closed when the verdict is unavailable, and the
 *    click-time re-check blocks a stale control;
 *  - the result-review wording never says unsaved scores are already saved. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const T = 30000;
const read = f => fs.readFileSync(new URL(`../../supabase/proposals/${f}`, import.meta.url), 'utf8');
const WITHDRAW_BUTTON = 'button:has-text("Withdraw before play")';

async function prepared({install = true} = {}) {
  const w = await createBrowserWorld({players: 8, staffRoles: true});
  const db = w.fake.local, E = w.eventId;
  await db.db.exec(read('FFTT3_REHEARSAL_WALKOVER_WITHDRAWAL_20261109_DO_NOT_APPLY.sql'));
  if (install) await db.db.exec(read('FFTT3_PREPLAY_WITHDRAWAL_ELIGIBILITY_20261110_DO_NOT_APPLY.sql'));
  await db.rpc(w.ids.org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  const snap = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  await db.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(snap.players)), p_expected_generation: 0, p_confirm: false});
  const rows = (await db.rpc(w.ids.org, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true})).filter(r => r.player_1_id && r.player_2_id);
  const generation = () => db.admin('select bracket_generation g from fftt_private.events where id=$1', [E]).then(r => r[0].g);
  const saveGameByRpc = async row => {
    await db.rpc(w.ids.org, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: row.match_id, p_table_number: 1});
    const pr = await db.rpc(w.ids.a, 'fftt_game_progress_v1', {p_event_id: E, p_match_id: row.match_id});
    return db.rpc(w.ids.a, 'fftt_save_completed_game_v1', {p_event_id: E, p_match_id: row.match_id, p_generation: pr.generation,
      p_expected_match_version: pr.match_version, p_expected_epoch: pr.epoch, p_expected_progress_version: pr.revision, p_expected_best_of: pr.best_of,
      p_expected_points_to_win: pr.points_to_win, p_submission_id: crypto.randomUUID(), p_game_index: 1, p_player_1_score: 11, p_player_2_score: 5, p_reason: null});
  };
  return {w, db, E, rows, generation, saveGameByRpc};
}
const openChampionship = async dev => { await dev.page.locator('[data-tab]', {hasText: 'Championship'}).first().click(); await dev.page.locator('.card', {hasText: 'Championship bracket'}).first().waitFor({timeout: T}); };

test('Organizer and Bracket Manager see it only while server-eligible; Scorer never; a saved game (zero completed matches) hides it; stale clicks are blocked', {timeout: 240000}, async () => {
  const {w, db, E, rows, generation, saveGameByRpc} = await prepared();
  try {
    const org = await w.device('org'), bm = await w.device('bm'), a = await w.device('a', PHONE);
    await org.signIn('org'); await bm.signIn('bm'); await a.signIn('a');
    await openChampionship(org); await openChampionship(bm);
    // eligible: visible to both
    await org.page.locator(WITHDRAW_BUTTON).waitFor({timeout: T});
    await bm.page.locator(WITHDRAW_BUTTON).waitFor({timeout: T});
    // a Scorekeeper has no Championship tab and no control anywhere
    await a.page.locator('.queue-card').first().waitFor({timeout: T});
    assert.equal(await a.page.locator('[data-tab]', {hasText: 'Championship'}).count(), 0);
    assert.equal(await a.page.getByText('Withdraw before play').count(), 0);
    const completedBefore = (await db.admin(`select count(*)::int n from fftt_private.matches where event_id=$1 and status='complete'`, [E]))[0].n;
    assert.equal(completedBefore, 0);

    // another device saves a game; this page may still show the control for a moment => the click-time check must stop it
    const gen = await generation();
    await saveGameByRpc(rows[0]);
    assert.equal((await db.admin(`select count(*)::int n from fftt_private.matches where event_id=$1 and status='complete'`, [E]))[0].n, 0, 'still zero completed matches');
    const clicked = await org.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.startsWith('Withdraw before play')); if (b) { b.click(); return true; } return false; });
    await org.page.waitForTimeout(2500);
    assert.equal(await org.page.locator('dialog[open]').count(), 0, 'the withdrawal dialog never opens on a stale control');
    if (clicked) await org.page.locator('#toasts .toast', {hasText: /game has been saved/i}).first().waitFor({timeout: T});
    assert.equal(await generation(), gen, 'nothing was regenerated');
    // and it goes away for both roles without any completed result
    await org.page.locator(WITHDRAW_BUTTON).waitFor({state: 'detached', timeout: T});
    await bm.page.locator(WITHDRAW_BUTTON).waitFor({state: 'detached', timeout: 20000});
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});

test('a completed result hides it for the Organizer', {timeout: 240000}, async () => {
  const {w, db, E, rows} = await prepared();
  try {
    const org = await w.device('org');
    await org.signIn('org'); await openChampionship(org);
    await org.page.locator(WITHDRAW_BUTTON).waitFor({timeout: T});
    await db.rpc(w.ids.a, 'fftt_submit_match_result_v2', {p_event_id: E, p_match_id: rows[0].match_id, p_bracket_generation: rows[0].bracket_generation,
      p_expected_match_version: rows[0].match_version, p_submission_id: crypto.randomUUID(), p_winner_id: rows[0].player_1_id, p_game_scores: '11-7, 11-9', p_table_number: 1});
    await org.page.locator(WITHDRAW_BUTTON).waitFor({state: 'detached', timeout: T});
  } finally { await w.close(); await db.db.close(); }
});

test('FAIL CLOSED: if the server verdict cannot be read (function not installed) the bracket is shown but the control is not', {timeout: 240000}, async () => {
  const {w, db} = await prepared({install: false});
  try {
    const org = await w.device('org');
    await org.signIn('org'); await openChampionship(org);
    await org.page.waitForTimeout(9000);   // longer than one polling interval + a full refresh
    assert.equal(await org.page.locator(WITHDRAW_BUTTON).count(), 0);
    assert.equal(await org.page.getByText('Rebuild (replaces the bracket)').count(), 1, 'the rest of the Championship view is unaffected');
  } finally { await w.close(); await db.db.close(); }
});

test('review wording: typed scores are NOT called saved; server-saved games are; the X stays available in both reviews', {timeout: 240000}, async () => {
  const {w, db, E, rows} = await prepared();
  try {
    for (const r of rows.slice(0, 2)) await db.rpc(w.ids.org, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: r.match_id, p_table_number: rows.indexOf(r) + 1});
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    const cards = a.page.locator('.queue-card');
    await cards.first().waitFor({timeout: T});
    const wording = async dlg => (await dlg.locator('#reviewSavedNote').innerText());

    // (1) scores typed on the form only
    await cards.nth(0).getByRole('button', {name: 'Record result'}).click();
    let dlg = a.page.locator('dialog[open]');
    await dlg.locator('.game-step', {hasText: /Game 1 · Unconfirmed/}).waitFor({timeout: T});
    const inputs = dlg.locator('.games input');
    for (const [i, v] of ['11', '6', '11', '4'].entries()) await inputs.nth(i).fill(v);
    await dlg.locator('.winner-pick label').first().click();
    await dlg.getByRole('button', {name: 'Review result'}).click();
    await dlg.locator('.review').waitFor({timeout: T});
    let note = await wording(dlg);
    assert.match(note, /typed on this form and have not been saved as individual games/);
    assert.doesNotMatch(note, /already saved/i, 'unsaved scores must never be called saved');
    assert.equal(await dlg.locator('button.dlg-x').isVisible(), true);
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.equal((await db.admin('select status from fftt_private.matches where id=$1', [rows[0].match_id]))[0].status, 'pending', 'closing review sent nothing');
    assert.equal((await db.admin('select count(*)::int n from fftt_private.match_game_progress where match_id=$1', [rows[0].match_id]))[0].n, 0, 'and saved no individual game');

    // (2) games saved one by one and confirmed by the server
    await cards.nth(1).getByRole('button', {name: 'Record result'}).click();
    dlg = a.page.locator('dialog[open]');
    await dlg.locator('.game-step', {hasText: /Game 1 · Unconfirmed/}).waitFor({timeout: T});
    for (const [n, x, y] of [[1, 11, 7], [2, 11, 5]]) {
      const input = dlg.locator('.games input');
      await input.nth((n - 1) * 2).fill(String(x)); await input.nth((n - 1) * 2 + 1).fill(String(y));
      await dlg.locator('button', {hasText: `Save Game ${n}`}).click();
      await dlg.locator('.game-step', {hasText: new RegExp(`Game ${n} · ${x}–${y} · Saved`)}).waitFor({timeout: T});
    }
    await dlg.getByRole('button', {name: 'Review result'}).click();
    await dlg.locator('.review').waitFor({timeout: T});
    note = await wording(dlg);
    assert.match(note, /already saved one by one and confirmed by the server/);
    assert.doesNotMatch(note, /not been saved/i);
    assert.equal(await dlg.locator('button.dlg-x').isVisible(), true);
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});

test('no review text anywhere claims unsaved scores are saved', () => {
  const ui = fs.readFileSync(new URL('../../app/staff_ui.mjs', import.meta.url), 'utf8');
  assert.equal(/The completed games are already saved/.test(ui), false);
});
