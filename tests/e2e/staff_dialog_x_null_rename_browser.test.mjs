/** Fictional Playwright tests (real Staff UI + real SQL, nothing hosted):
 *  - the literal "null" no longer renders in the Record Result dialog (regression),
 *  - the top-right X and the bottom Close share one safe close path, in singles and Mixed-Skill Doubles scoring,
 *  - an Organizer renames a COMPLETED event only from Overview > Set up your tournament. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';
import {playAllPlayable} from './helpers.mjs';

const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const T = 30000;
const RENAME_SQL = fs.readFileSync(new URL('../../supabase/proposals/FFTT3_COMPLETED_EVENT_RENAME_20261109_DO_NOT_APPLY.sql', import.meta.url), 'utf8');

async function prepared() {
  const w = await createBrowserWorld({players: 8, staffRoles: true});
  const db = w.fake.local, E = w.eventId;
  await db.db.exec(RENAME_SQL);
  await db.rpc(w.ids.org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  const snap = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  await db.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(snap.players)), p_expected_generation: 0, p_confirm: false});
  const rows = (await db.rpc(w.ids.org, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true})).filter(r => r.player_1_id && r.player_2_id);
  const ctx = {db, E, org: w.ids.org, skA: w.ids.a, skB: w.ids.b, snap: () => db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
  return {w, db, E, rows, ctx};
}
const hasNullWord = text => /(^|\s)null(\s|$)/i.test(text);
const gameRows = (db, matchId) => db.admin(`select count(*)::int n from fftt_private.match_game_scores where match_id=$1`, [matchId]).catch(() => null);
const saveGame = async (dlg, n, x, y) => {
  const inputs = dlg.locator('.games input');
  await inputs.nth((n - 1) * 2).fill(String(x)); await inputs.nth((n - 1) * 2 + 1).fill(String(y));
  await dlg.locator('button', {hasText: `Save Game ${n}`}).click();
  await dlg.locator('.game-step', {hasText: new RegExp(`Game ${n} · ${x}–${y} · Saved`)}).waitFor({timeout: T});
};

test('singles Record Result: no stray "null", X + bottom Close share one safe close, saved games and match state survive, Escape and focus work', {timeout: 240000}, async () => {
  const {w, db, E, rows} = await prepared();
  try {
    const row = rows[0];
    await db.rpc(w.ids.org, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: row.match_id, p_table_number: 1});
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    const card = a.page.locator('.queue-card', {hasText: row.player_1_name}).first();
    await card.waitFor({timeout: T});
    const open = async () => {
      await card.getByRole('button', {name: 'Record result'}).click();
      const dlg = a.page.locator('dialog[open]');
      await dlg.locator('.game-step', {hasText: /Game \d · Unconfirmed/}).waitFor({timeout: T});
      return dlg;
    };

    // --- regression: nothing saved yet => the conditional help paragraph is absent and no literal "null" text node exists
    let dlg = await open();
    assert.equal(hasNullWord(await dlg.innerText()), false, 'dialog text must not contain a literal "null"');
    assert.equal(await dlg.evaluate(el => [...el.querySelectorAll('*')].some(n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim() === 'null'))), false);
    // accessible X: named button, top-right of the dialog, big enough to tap, plus the retained bottom Close
    const x = dlg.locator('button.dlg-x');
    assert.equal(await x.count(), 1);
    assert.equal(await x.getAttribute('aria-label'), 'Close');
    assert.equal(await dlg.getByRole('button', {name: 'Close', exact: true}).count(), 2, 'X and bottom Close both have the accessible name Close');
    assert.equal(await dlg.locator('.dlg-actions button', {hasText: /^Close$/}).count(), 1, 'bottom Close retained');
    const [db0, xb] = [await dlg.boundingBox(), await x.boundingBox()];
    assert.ok(xb.x + xb.width > db0.x + db0.width / 2 && xb.y < db0.y + db0.height / 3, 'X sits in the top-right area');
    assert.ok(xb.width >= 40 && xb.height >= 40, 'X is a comfortable tap target');
    // initial keyboard focus is a working control, not the X
    assert.equal(await dlg.evaluate(el => document.activeElement?.classList.contains('dlg-x')), false);
    // X closes, nothing is sent, focus returns to the opener
    await x.click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.equal(await a.page.evaluate(() => /Record result/.test(document.activeElement?.textContent ?? '')), true, 'focus restored to the opener');
    assert.equal((await db.admin('select status from fftt_private.matches where id=$1', [row.match_id]))[0].status, 'pending');
    // bottom Close behaves identically; Escape too
    dlg = await open();
    await dlg.locator('.dlg-actions button', {hasText: /^Close$/}).click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    dlg = await open();
    await a.page.keyboard.press('Escape');
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.equal(await a.page.evaluate(() => /Record result/.test(document.activeElement?.textContent ?? '')), true, 'Escape restores focus');

    // --- saved games survive an X-close; unfinished match state is preserved
    dlg = await open();
    await saveGame(dlg, 1, 11, 7);
    assert.equal(hasNullWord(await dlg.innerText()), false);
    assert.match(await dlg.innerText(), /Saved games are preserved when you close this window/);
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.equal((await db.admin('select status from fftt_private.matches where id=$1', [row.match_id]))[0].status, 'pending');
    dlg = await a.page.locator('dialog[open]').count() ? dlg : await (async () => { await card.getByRole('button', {name: 'Record result'}).click(); return a.page.locator('dialog[open]'); })();
    await dlg.locator('.game-step', {hasText: /Game 1 · 11–7 · Saved/}).waitFor({timeout: T});

    // --- the X stays available during result review and closes it without sending
    await saveGame(dlg, 2, 11, 5);
    await dlg.getByRole('button', {name: 'Review result'}).click();
    await dlg.locator('.review').waitFor({timeout: T});
    assert.equal(hasNullWord(await dlg.innerText()), false);
    assert.equal(await dlg.locator('button.dlg-x').isVisible(), true, 'X available during review');
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.equal((await db.admin('select status from fftt_private.matches where id=$1', [row.match_id]))[0].status, 'pending', 'closing review sends nothing');
    await card.getByRole('button', {name: 'Record result'}).click();
    dlg = a.page.locator('dialog[open]');
    await dlg.locator('.game-step', {hasText: /Game 2 · 11–5 · Saved/}).waitFor({timeout: T});
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});

test('Mixed-Skill Doubles scoring dialog: same X behaviour, no stray "null", games preserved', {timeout: 240000}, async () => {
  const {w, db, E, ctx} = await prepared();
  try {
    await playAllPlayable(ctx, {only: 'championship'});
    await db.admin('update fftt_private.events set doubles_best_of=3, doubles_points=11 where id=$1', [E]);
    const snap = await ctx.snap();
    const finalists = new Set(snap.matches.filter(m => m.is_final).flatMap(m => [m.player_1_id, m.player_2_id]));
    const [p1, p2] = snap.players.map(p => p.id).filter(id => !finalists.has(id));
    await db.rpc(w.ids.bm, 'fftt_set_doubles_teams_v3', {p_event_id: E, p_partner_1: p1, p_partner_2: p2});
    const a = await w.device('a', PHONE);
    await a.signIn('a');
    const card = a.page.locator('.doubles-desk');
    await card.waitFor({timeout: T});
    const open = async (ready = /Game \d · Unconfirmed/) => {
      await card.getByRole('button', {name: 'Record the Mixed-Skill Doubles match'}).click();
      const dlg = a.page.locator('dialog[open]');
      await dlg.locator('.game-step', {hasText: ready}).waitFor({timeout: T});
      return dlg;
    };
    let dlg = await open();
    assert.equal(hasNullWord(await dlg.innerText()), false);
    assert.equal(await dlg.locator('button.dlg-x').getAttribute('aria-label'), 'Close');
    assert.equal(await dlg.locator('.dlg-actions button', {hasText: /^Close$/}).count(), 1);
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    dlg = await open();
    await saveGame(dlg, 1, 11, 6); await saveGame(dlg, 2, 11, 8);
    await dlg.getByRole('button', {name: 'Review result'}).click();
    await dlg.locator('.review').waitFor({timeout: T});
    assert.equal(await dlg.locator('button.dlg-x').isVisible(), true, 'X available during doubles review');
    await dlg.locator('button.dlg-x').click();
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.equal((await db.admin('select winner_team from fftt_private.doubles_finale where event_id=$1', [E]))[0].winner_team, null, 'closing sends no doubles result');
    dlg = await open(/Game 2 · 11–8 · Saved/);
    await a.page.keyboard.press('Escape');
    await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});

test('Organizer renames a COMPLETED event from Overview > Set up your tournament; nothing else is editable or changed', {timeout: 240000}, async () => {
  const {w, db, E, ctx} = await prepared();
  try {
    await playAllPlayable(ctx, {only: 'championship'});
    await db.rpc(w.ids.org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'complete'});
    const fp = () => db.admin(`select (select count(*)::int from fftt_private.players where event_id=$1) p,
       (select count(*)::int from fftt_private.matches where event_id=$1 and status='complete') m, (select event_date::text from fftt_private.events where id=$1) d,
       (select table_count from fftt_private.events where id=$1) t, (select lifecycle from fftt_private.events where id=$1) l`, [E]).then(r => JSON.stringify(r[0]));
    const before = await fp();
    const org = await w.device('org', {viewport: {width: 1280, height: 900}});
    await org.signIn('org');
    const form = org.page.locator('.overview-settings');
    await form.waitFor({timeout: T});
    // no abandoned title pencil / separate Edit Event popup
    assert.equal(await org.page.locator('[aria-label*="Edit event" i], .title-pencil, .edit-event').count(), 0);
    await form.locator('#evRenameNote').waitFor();
    assert.equal(await form.locator('#evDate').isDisabled(), true);
    assert.equal(await form.locator('#evTables').isDisabled(), true);
    assert.equal(await form.locator('#evName').isEnabled(), true);
    const button = form.getByRole('button', {name: /Rename completed event/});
    await button.waitFor();
    // concurrent rename by someone else => conflict is surfaced and nothing is overwritten
    await db.admin(`update fftt_private.events set event_name='FICTIONAL RENAMED ELSEWHERE' where id=$1`, [E]);
    await form.locator('#evName').fill('FICTIONAL SHOULD NOT WIN');
    await button.click();
    await org.page.locator('#toasts .toast', {hasText: /changed by someone else/}).waitFor({timeout: T});
    assert.equal((await db.admin('select event_name from fftt_private.events where id=$1', [E]))[0].event_name, 'FICTIONAL RENAMED ELSEWHERE');
    // restore the name the page saw, then rename properly
    await db.admin(`update fftt_private.events set event_name='Synthetic Rehearsal Games' where id=$1`, [E]);
    await form.locator('#evName').fill('FICTIONAL RENAMED EVENT');
    await form.getByRole('button', {name: /Rename completed event/}).click();
    await org.page.locator('#toasts .toast', {hasText: 'Event renamed.'}).waitFor({timeout: T});
    await org.page.locator('.overview-feature h1', {hasText: 'FICTIONAL RENAMED EVENT'}).waitFor({timeout: T});
    const row = (await db.admin('select event_name, lifecycle from fftt_private.events where id=$1', [E]))[0];
    assert.deepEqual(row, {event_name: 'FICTIONAL RENAMED EVENT', lifecycle: 'complete'});
    assert.equal(await fp(), before, 'players, completed matches, date, tables and lifecycle are unchanged');
    const [audit] = await db.admin(`select actor_id, before_state, after_state from fftt_private.audit_events where event_id=$1 and after_state->>'completed_rename'='true'`, [E]);
    assert.equal(audit.actor_id, w.ids.org);
    assert.equal(audit.before_state.name, 'Synthetic Rehearsal Games'); assert.equal(audit.after_state.name, 'FICTIONAL RENAMED EVENT');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});
