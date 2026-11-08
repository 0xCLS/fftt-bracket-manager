/** Fictional Playwright test of the correction permissions through the real Staff UI and the real SQL.
 * Server-side denials are proven by direct RPC calls in correction_permissions.test.mjs; this suite proves the UI follows them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const T = 30000;

async function prepared() {
  const w = await createBrowserWorld({players: 8, staffRoles: true});
  const db = w.fake.local, E = w.eventId;
  await db.rpc(w.ids.org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  const snap = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  await db.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(snap.players)), p_expected_generation: 0, p_confirm: false});
  const rows = (await db.rpc(w.ids.org, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true})).filter(r => r.player_1_id && r.player_2_id);
  return {w, db, E, rows};
}
const goTab = (page, name) => page.locator('[data-tab]', {hasText: name}).first().click();
const audit = (db, E, op, matchId) => db.admin('select * from fftt_private.audit_events where event_id=$1 and operation=$2 and match_id=$3 order by created_at, id', [E, op, matchId]);

test('Scorekeeper corrects a saved game in the UI without a reason and is never offered finalized-result corrections', {timeout: 180000}, async () => {
  const {w, db, E, rows} = await prepared();
  try {
    const row = rows[0];
    await db.rpc(w.ids.org, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: row.match_id, p_table_number: 1});
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    const card = a.page.locator('.queue-card', {hasText: row.player_1_name}).first();
    await card.waitFor({timeout: T});
    // A scorekeeper has no "Recent results and corrections" card (finalized results are not theirs to correct).
    assert.equal(await a.page.locator('#recentTitle').count(), 0);
    await card.getByRole('button', {name: 'Record result'}).click();
    const dlg = a.page.locator('dialog[open]');
    await dlg.locator('.game-step', {hasText: 'Game 1 · Unconfirmed'}).waitFor({timeout: T});
    const inputs = dlg.locator('.games input');
    await inputs.nth(0).fill('11'); await inputs.nth(1).fill('7');
    await dlg.locator('button', {hasText: 'Save Game 1'}).click();
    await dlg.locator('.game-step', {hasText: /Game 1 · 11–7 · Saved/}).waitFor({timeout: T});
    // The correction control is offered to the scorekeeper, and its reason is optional.
    await dlg.locator('.game-step', {hasText: 'Game 1'}).getByRole('button', {name: 'Correct…'}).click();
    await dlg.locator('label[for="gameCorrectionReason"]', {hasText: '(optional)'}).waitFor();
    await inputs.nth(0).fill('11'); await inputs.nth(1).fill('9');
    await dlg.getByRole('button', {name: 'Save corrected Game 1'}).click();
    await dlg.locator('.game-step', {hasText: /Game 1 · 11–9 · Saved/}).waitFor({timeout: T});
    const log = await audit(db, E, 'game_corrected', row.match_id);
    assert.equal(log.length, 1);
    assert.equal(log[0].actor_id, w.ids.a); assert.equal(log[0].reason, null, 'no reason was needed or stored');
    assert.deepEqual(log[0].before_state.score, [11, 7]); assert.deepEqual(log[0].after_state.score, [11, 9]);
    // An explanation may still be given (optional), and is stored.
    await dlg.locator('.game-step', {hasText: 'Game 1'}).getByRole('button', {name: 'Correct…'}).click();
    await inputs.nth(0).fill('11'); await inputs.nth(1).fill('8');
    await dlg.locator('#gameCorrectionReason').fill('Typo');
    await dlg.getByRole('button', {name: 'Save corrected Game 1'}).click();
    await dlg.locator('.game-step', {hasText: /Game 1 · 11–8 · Saved/}).waitFor({timeout: T});
    assert.equal((await audit(db, E, 'game_corrected', row.match_id))[1].reason, 'Typo');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});

test('Bracket Manager and Organizer correct finalized results in the UI without a reason', {timeout: 240000}, async () => {
  const {w, db, E, rows} = await prepared();
  try {
    const done = [];
    for (const [i, row] of rows.slice(0, 2).entries()) {
      await db.rpc(w.ids.org, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: row.match_id, p_table_number: i + 1});
      const version = (await db.admin('select match_version v from fftt_private.matches where id=$1', [row.match_id]))[0].v;
      const r = await db.rpc(w.ids.a, 'fftt_submit_match_result_v2', {p_event_id: E, p_match_id: row.match_id, p_bracket_generation: row.bracket_generation,
        p_expected_match_version: Number(version), p_submission_id: crypto.randomUUID(), p_winner_id: row.player_1_id, p_game_scores: '11-7, 11-8', p_table_number: i + 1});
      assert.equal(r.status, 'accepted');
      done.push(row);
    }
    for (const [who, row, scores] of [['bm', done[0], '11-5, 11-6'], ['org', done[1], '11-4, 11-3']]) {
      const d = await w.device(who);
      await d.signIn(who, {event: E});
      await d.page.locator('[data-tab]').first().waitFor({timeout: T});
      await goTab(d.page, 'Match Desk');
      const open = d.page.getByRole('button', {name: `Correct the result of ${row.player_1_name} versus ${row.player_2_name}`});
      await open.waitFor({timeout: T});
      await open.click();
      const dlg = d.page.locator('dialog[open]');
      await dlg.locator('label[for="crReason"]', {hasText: '(optional)'}).waitFor();
      assert.match(await dlg.innerText(), /organizer or a Bracket Manager/i);
      await dlg.locator('#crScores').fill(scores);
      await dlg.getByRole('button', {name: 'Save correction'}).click();          // no reason typed
      await d.page.locator('#toasts .toast', {hasText: 'Correction saved.'}).waitFor({timeout: T});
      const log = await audit(db, E, 'result_corrected', row.match_id);
      assert.equal(log.length, 1, `${who} correction recorded`);
      assert.equal(log[0].actor_id, w.ids[who === 'bm' ? 'bm' : 'org']); assert.equal(log[0].reason, null);
      assert.equal(log[0].before_state.game_scores, '11-7, 11-8'); assert.equal(log[0].after_state.game_scores, scores);
    }
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});

test('Mixed-Skill Doubles: Scorekeeper records and corrects games from the Match Desk; only a Bracket Manager corrects the finalized result', {timeout: 300000}, async () => {
  const {w, db, E} = await prepared();
  try {
    const {playAllPlayable} = await import('./helpers.mjs');
    await playAllPlayable({db, E, org: w.ids.org, skA: w.ids.a, skB: w.ids.b,
      snap: () => db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E})}, {only: 'championship'});
    await db.admin('update fftt_private.events set doubles_best_of=3, doubles_points=11 where id=$1', [E]);
    const snap = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
    const finalists = new Set(snap.matches.filter(m => m.is_final).flatMap(m => [m.player_1_id, m.player_2_id]));
    const [p1, p2] = snap.players.map(p => p.id).filter(id => !finalists.has(id));
    await db.rpc(w.ids.bm, 'fftt_set_doubles_teams_v3', {p_event_id: E, p_partner_1: p1, p_partner_2: p2});
    const audit = op => db.admin('select * from fftt_private.audit_events where event_id=$1 and operation=$2 order by created_at, id', [E, op]);

    const a = await w.device('a', PHONE);
    await a.signIn('a');
    const card = a.page.locator('.doubles-desk');
    await card.waitFor({timeout: T});
    assert.equal(await a.page.locator('#recentTitle').count(), 0, 'a scorekeeper has no finalized-result corrections');
    assert.equal(await card.getByRole('button', {name: /Correct/}).count(), 0);
    await card.getByRole('button', {name: 'Record the Mixed-Skill Doubles match'}).click();
    const dlg = a.page.locator('dialog[open]');
    await dlg.locator('.game-step', {hasText: 'Game 1 · Unconfirmed'}).waitFor({timeout: T});
    const inputs = dlg.locator('.games input');
    const saveGame = async (n, x, y) => {
      await inputs.nth((n - 1) * 2).fill(String(x)); await inputs.nth((n - 1) * 2 + 1).fill(String(y));
      await dlg.locator('button', {hasText: `Save Game ${n}`}).click();
      await dlg.locator('.game-step', {hasText: new RegExp(`Game ${n} · ${x}–${y} · Saved`)}).waitFor({timeout: T});
    };
    await saveGame(1, 11, 7);
    // Correct a saved game: allowed for a scorekeeper before finalization, reason optional.
    await dlg.locator('.game-step', {hasText: 'Game 1'}).getByRole('button', {name: 'Correct…'}).click();
    await dlg.locator('label[for="doublesCorrectionReason"]', {hasText: '(optional)'}).waitFor();
    await inputs.nth(0).fill('11'); await inputs.nth(1).fill('9');
    await dlg.getByRole('button', {name: 'Save corrected Game 1'}).click();
    await dlg.locator('.game-step', {hasText: /Game 1 · 11–9 · Saved/}).waitFor({timeout: T});
    const log = await audit('doubles_game_corrected');
    assert.equal(log.length, 1); assert.equal(log[0].actor_id, w.ids.a); assert.equal(log[0].reason, null);
    assert.deepEqual(log[0].before_state.score, [11, 7]); assert.deepEqual(log[0].after_state.score, [11, 9]);
    await saveGame(2, 8, 11);
    await saveGame(3, 11, 5);
    await dlg.getByRole('button', {name: 'Review result'}).click();
    await dlg.locator('.review', {hasText: '11-9, 8-11, 11-5'}).waitFor({timeout: T});
    await dlg.getByRole('button', {name: 'Confirm and send'}).click();
    await a.page.locator('#toasts .toast', {hasText: 'Doubles result recorded.'}).waitFor({timeout: T});
    const rec = (await db.admin('select winner_team, game_scores from fftt_private.doubles_finale where event_id=$1', [E]))[0];
    assert.equal(rec.winner_team, 1); assert.equal(rec.game_scores, '11-9, 8-11, 11-5');
    // The finalized result is shown to the scorekeeper without any correction control.
    await a.page.locator('.doubles-desk', {hasText: 'Result recorded'}).waitFor({timeout: T});
    assert.equal(await a.page.locator('.doubles-desk').getByRole('button').count(), 0);

    // Bracket Manager: correct the finalized result, no reason.
    const bm = await w.device('bm');
    await bm.signIn('bm', {event: E});
    await bm.page.locator('[data-tab]').first().waitFor({timeout: T});
    await goTab(bm.page, 'Match Desk');
    await bm.page.getByRole('button', {name: 'Correct the Mixed-Skill Doubles result'}).click();
    const cd = bm.page.locator('dialog[open]');
    await cd.locator('label[for="dcReason"]', {hasText: '(optional)'}).waitFor();
    await cd.locator('#dcScores').fill('11-4, 8-11, 11-5');
    await cd.getByRole('button', {name: 'Save correction'}).click();
    await bm.page.locator('#toasts .toast', {hasText: 'Correction saved.'}).waitFor({timeout: T});
    const fix = await audit('doubles_result_corrected');
    assert.equal(fix.length, 1); assert.equal(fix[0].actor_id, w.ids.bm); assert.equal(fix[0].reason, null);
    assert.equal(fix[0].before_state.game_scores, '11-9, 8-11, 11-5'); assert.equal(fix[0].after_state.game_scores, '11-4, 8-11, 11-5');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});
