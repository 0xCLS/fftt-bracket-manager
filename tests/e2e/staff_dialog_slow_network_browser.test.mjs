/** Regression for PR #84 CI run 42763342815: on a slow network the Record Result dialog must still load its server-confirmed games.
 * Root cause: the dialog's read passed wait:false (meant for polling), so while a background poll held the session's one-at-a-time lock the read was
 * skipped as "busy" and the dialog stayed on "Loading verified game scores…" with "Completed-game records are unavailable".
 * Here every request takes 250 ms, so a poll is in flight for a large share of the time. Fictional data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const T = 45000;

test('slow network: scoring dialogs always load their saved games; a saved game survives close and reopen; a second match opens too', {timeout: 240000}, async () => {
  const w = await createBrowserWorld({players: 8, staffRoles: true});
  const db = w.fake.local, E = w.eventId;
  try {
    await db.rpc(w.ids.org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
    const snap = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
    await db.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(snap.players)), p_expected_generation: 0, p_confirm: false});
    const rows = (await db.rpc(w.ids.org, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true})).filter(r => r.player_1_id && r.player_2_id);
    for (const [i, r] of rows.slice(0, 2).entries()) await db.rpc(w.ids.org, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: r.match_id, p_table_number: i + 1});
    w.fake.hooks.delayMs = 250;                      // every request is slow, as on a busy CI runner or a weak venue connection, from sign-in on
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    const cards = a.page.locator('.queue-card');
    await cards.first().waitFor({timeout: T});
    const open = async (n, ready) => {
      await cards.nth(n).getByRole('button', {name: 'Record result'}).click();
      const dlg = a.page.locator('dialog[open]');
      await dlg.locator('.game-step', {hasText: ready}).waitFor({timeout: T});
      return dlg;
    };
    const saveGame = async (dlg, n, x, y) => {
      const input = dlg.locator('.games input');
      await input.nth((n - 1) * 2).fill(String(x)); await input.nth((n - 1) * 2 + 1).fill(String(y));
      await dlg.locator('button', {hasText: `Save Game ${n}`}).click();
      await dlg.locator('.game-step', {hasText: new RegExp(`Game ${n} · ${x}–${y} · Saved`)}).waitFor({timeout: T});
    };
    // first match: open, save two games, close with X, reopen (decided match shows both games Saved)
    let dlg = await open(0, /Game 1 · Unconfirmed/);
    await saveGame(dlg, 1, 11, 7); await saveGame(dlg, 2, 11, 5);
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    dlg = await open(0, /Game 2 · 11–5 · Saved/);
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    // second match opens normally (CI failure #2)
    dlg = await open(1, /Game 1 · Unconfirmed/);
    assert.equal(await dlg.getByText('Completed-game records are unavailable').count(), 0);
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.deepEqual((await db.admin('select games from fftt_private.match_game_progress where match_id=$1', [rows[0].match_id]))[0].games, [[11, 7], [11, 5]]);
    assert.equal((await db.admin('select count(*)::int n from fftt_private.match_game_progress where match_id=$1', [rows[1].match_id]))[0].n, 0, 'opening the second match saved nothing');
    assert.deepEqual(w.pageErrors, []);
  } finally { w.fake.hooks.delayMs = 0; await w.close(); await db.db.close(); }
});
