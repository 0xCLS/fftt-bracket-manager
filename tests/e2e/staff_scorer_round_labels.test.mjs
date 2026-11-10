/** Focused Scorer round-label regression using fake HTTPS + disposable Postgres.
 * No hosted credentials, events or production services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';
import {buildConsolation, playAllPlayable} from './helpers.mjs';
import {parseEventBrief} from '../../contracts/gameday_api.mjs';

const T = 30000;
const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const SQL = fs.readFileSync(new URL('../../supabase/proposals/FFTT3_SCORER_ROUND_DEPTH_20261110_DO_NOT_APPLY.sql', import.meta.url), 'utf8');
const EVENT = '00000000-0000-4000-8000-000000000001';
const brief = {event_id: EVENT, name: 'Synthetic test', date: '2099-11-12', tables: 2, lifecycle: 'active', generation: 1, revision: 2};

test('Scorer event brief round totals are optional on old hosts, strict and private on upgraded hosts', () => {
  assert.equal(parseEventBrief(brief).rounds, null);
  assert.deepEqual(parseEventBrief({...brief, rounds: {championship: 3, consolation: null}}).rounds, {championship: 3, consolation: null});
  assert.throws(() => parseEventBrief({...brief, rounds: {championship: 3}}));
  assert.throws(() => parseEventBrief({...brief, rounds: {championship: 3, consolation: 0}}));
  assert.throws(() => parseEventBrief({...brief, rounds: {championship: 3, consolation: null, players: []}}));
});

test('Scorer dialog and review use accurate Championship quarters, semis, Final and Consolation Final', {timeout: 240000}, async () => {
  const w = await createBrowserWorld({players: 8, staffRoles: true});
  const db = w.fake.local, E = w.eventId;
  try {
    await db.db.exec(SQL); // the proposed, still-UNDEPLOYED read-only function replacement
    await db.rpc(w.ids.org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
    const snap = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
    await db.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(snap.players)), p_expected_generation: 0, p_confirm: false});
    const ctx = {db, E, org: w.ids.org, skA: w.ids.a, skB: w.ids.b, snap: () => db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
    const initial = await db.rpc(w.ids.a, 'fftt_event_brief_v3', {p_event_id: E});
    assert.deepEqual(initial.rounds, {championship: 3, consolation: null});
    assert.equal(JSON.stringify(initial).includes('display_name'), false, 'no player roster is exposed');
    await assert.rejects(db.rpc(w.ids.out, 'fftt_event_brief_v3', {p_event_id: E}), 'an outsider cannot read even round depth');
    const a = await w.device('a', PHONE);
    await a.signIn('a');

    async function checkScorerRound(expected) {
      await a.page.locator('.queue-card').first().waitFor({timeout: T});
      await a.page.locator('.queue-card').first().getByRole('button', {name: 'Record result'}).click();
      const dlg = a.page.locator('dialog[open]');
      await dlg.locator('.game-step').first().waitFor({timeout: T});
      assert.equal(await dlg.locator('h3').first().innerText(), `Record result · ${expected}`);
      const inputs = dlg.locator('.games input');
      for (const [i, v] of ['11', '7', '11', '5'].entries()) await inputs.nth(i).fill(v);
      await dlg.locator('.winner-pick label').first().click();
      await dlg.getByRole('button', {name: 'Review result'}).click();
      await dlg.locator('.review').waitFor({timeout: T});
      assert.match(await dlg.locator('.review').innerText(), new RegExp(expected));
      await dlg.locator('button.dlg-x').click();
      await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    }

    await checkScorerRound('Championship Quarterfinals');
    assert.equal(await playAllPlayable(ctx, {only: 'championship', limit: 4}), 4);
    await a.page.reload();
    await checkScorerRound('Championship Semifinals');
    assert.equal(await playAllPlayable(ctx, {only: 'championship', limit: 2}), 2);
    await a.page.reload();
    await checkScorerRound('Championship Final');
    assert.equal(await playAllPlayable(ctx, {only: 'championship', limit: 1}), 1);
    await buildConsolation(ctx);
    const withConsolation = await db.rpc(w.ids.a, 'fftt_event_brief_v3', {p_event_id: E});
    assert.deepEqual(withConsolation.rounds, {championship: 3, consolation: 2});
    await a.page.reload();
    await checkScorerRound('Consolation Semifinals');
    assert.equal(await playAllPlayable(ctx, {only: 'consolation', limit: 2}), 2);
    await a.page.reload();
    await checkScorerRound('Consolation Final');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});
