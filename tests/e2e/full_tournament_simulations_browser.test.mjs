/** Complete tournament Playwright simulations. Fictional identities and disposable SQL only.
 * The actual Staff/Spectator HTML, roles, RPCs and scoring UI are exercised.
 * No production host, live event, registration source, or hosted Showcase is contacted.
 *
 * Run: FFTT_CHROME_CHANNEL=none node --test tests/e2e/full_tournament_simulations_browser.test.mjs
 * Set FFTT_SIM_SAVE_EVERY_GAME=1 to save each game separately (slower).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld, SPECT} from './browser_world.mjs';
import {roster, scoreFor, swap} from './helpers.mjs';

const T = 30000;
const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const scenarios = [
  {name: '8-player standard', players: 8, consBo: 1, consPts: 21},
  {name: '13-player uneven field/byes', players: 13, consBo: 1, consPts: 21},
  {name: '31-player proposed Consolation', players: 31, consBo: 3, consPts: 11},
];
const tab = (p, name) => p.locator('[data-tab="' + name + '"]').click();
const toast = (p, value) => p.locator('#toasts .toast', {hasText: value}).waitFor({timeout: T});
function fictional(count) {
  return [...roster(Math.min(count, 24)),
    ...Array.from({length: Math.max(0, count - 24)}, (_, i) => ({
      name: 'Fictional Entrant ' + String(i + 25).padStart(2, '0'),
      rating: 1 + i % 5, rating_status: 'provisional',
    }))];
}
async function finalRow(db, matchId) {
  const [m] = await db.admin('select status,game_scores,winner_id from fftt_private.matches where id=$1', [matchId]);
  assert.equal(m?.status, 'complete', 'SQL, not a closed dialog, proves a score was accepted');
  return m;
}
async function playMatch(device, db, m, i, saveEveryGame) {
  // Reload the signed-in real UI to consume another scorer's latest results.
  await device.page.reload({waitUntil: 'domcontentloaded'});
  const card = device.page.locator('.queue-card', {hasText: m.player_1_name}).first();
  await card.waitFor({timeout: T});
  assert.match(await card.getAttribute('aria-label'), /versus/);
  await card.getByRole('button', {name: 'Record result'}).click();
  const dialog = device.page.locator('dialog[open]');
  await dialog.locator('.game-step', {hasText: 'Game 1 · Unconfirmed'}).waitFor({timeout: T});
  const second = i % 4 === 0;
  const score = second ? swap(scoreFor(m.best_of, m.points_to_win, i))
    : scoreFor(m.best_of, m.points_to_win, i);
  const games = score.split(', ').map(s => s.split('-').map(Number));
  const save = saveEveryGame || i === 0 || !!m.is_championship_final || i % 9 === 3;
  if (!save) await dialog.locator('.winner-pick label').nth(second ? 1 : 0).click();
  for (let j = 0; j < games.length; j++) {
    const [a,b] = games[j];
    await dialog.locator('.games input').nth(j * 2).fill(String(a));
    await dialog.locator('.games input').nth(j * 2 + 1).fill(String(b));
    if (save) {
      await dialog.getByRole('button', {name: 'Save Game ' + (j + 1)}).click();
      await dialog.locator('.game-step', {hasText: 'Game ' + (j + 1) + ' · ' + a + '–' + b + ' · Saved'}).waitFor({timeout: T});
      const [pending] = await db.admin('select status from fftt_private.matches where id=$1', [m.match_id]);
      assert.equal(pending.status, 'pending', 'An individually saved game cannot advance a bracket');
    }
  }
  await dialog.getByRole('button', {name: 'Review result'}).click();
  await dialog.locator('.review', {hasText: score}).waitFor({timeout: T});
  await dialog.getByRole('button', {name: 'Confirm and send'}).click();
  await dialog.waitFor({state: 'detached', timeout: T});
  const result = await finalRow(db, m.match_id);
  assert.equal(result.game_scores, score);
  assert.equal(result.winner_id, second ? m.player_2_id : m.player_1_id);
  return {saved: save ? games.length : 0, final: !!m.is_championship_final};
}
async function runBracket(world, devices, kind, saveEveryGame) {
  const db = world.fake.local;
  let played = 0, saved = 0, finals = 0;
  while (played < 90) {
    const queue = (await db.rpc(world.ids.a, 'fftt_matchdesk_v2', {p_event_id: world.eventId}, {rows:true}))
      .filter(m => m.bracket === kind);
    const match = queue.find(m => m.table_number) ?? queue[0];
    if (!match) break;
    const r = await playMatch(devices[played % devices.length], db, match, played + (kind === 'consolation' ? 2 : 0), saveEveryGame);
    played++;
    saved += r.saved;
    finals += Number(r.final);
  }
  assert.ok(played > 0 && played < 90, kind + ' must terminate');
  const left = await db.rpc(world.ids.a, 'fftt_matchdesk_v2', {p_event_id:world.eventId}, {rows:true});
  assert.equal(left.filter(m => m.bracket === kind).length, 0, kind + ' has no pending playable match');
  return {played, savedGames:saved, finals};
}
async function prepareThreeTables(world, bm) {
  const db = world.fake.local;
  const rows = await db.rpc(world.ids.a, 'fftt_matchdesk_v2', {p_event_id:world.eventId}, {rows:true});
  assert.ok(rows.length >= 3, 'Three opening matches available');
  await tab(bm.page, 'desk');
  for (let i = 0; i < 3; i++) {
    const card = bm.page.locator('.queue-card', {hasText:rows[i].player_1_name}).first();
    await card.waitFor({timeout:T});
    await card.locator('select').selectOption(String(i + 1));
    await toast(bm.page, 'Assigned to table ' + (i + 1) + '.');
    const [r] = await db.admin('select table_number from fftt_private.matches where id=$1', [rows[i].match_id]);
    assert.equal(r.table_number, i + 1);
  }
}
async function scoreDoubles(world, scorer, team) {
  await scorer.page.reload({waitUntil:'domcontentloaded'});
  const button = scorer.page.getByRole('button', {name:'Record the Mixed-Skill Doubles match'});
  await button.waitFor({timeout:T});
  await button.click();
  const dlg = scorer.page.locator('dialog[open]');
  await dlg.getByRole('button', {name:'Save Game 1'}).waitFor({timeout:T});
  const a = team === 1 ? 21 : 16, b = team === 1 ? 16 : 21;
  await dlg.getByRole('textbox', {name:'Game 1, Team A'}).fill(String(a));
  await dlg.getByRole('textbox', {name:'Game 1, Team B'}).fill(String(b));
  await dlg.getByRole('button', {name:'Save Game 1'}).click();
  await dlg.locator('.game-step', {hasText:'Game 1 · ' + a + '–' + b + ' · Saved'}).waitFor({timeout:T});
  const d = await world.fake.local.rpc(world.ids.a, 'fftt_doubles_desk_v1', {p_event_id:world.eventId});
  assert.equal(d.status, 'ready', 'A saved doubles game is not an official result');
  await dlg.getByRole('button', {name:'Review result'}).click();
  await dlg.locator('.review', {hasText:a + '-' + b}).waitFor({timeout:T});
  await dlg.getByRole('button', {name:'Confirm and send'}).click();
  await dlg.waitFor({state:'detached', timeout:T});
  await toast(scorer.page, 'Doubles result recorded.');
}
for (const scenario of scenarios) {
  test('Full UI tournament: ' + scenario.name, {timeout:900000}, async () => {
    const w = await createBrowserWorld({staffRoles:true, registration:null});
    const db = w.fake.local;
    const report = {players:scenario.players, tables:3, consolationFormat:
      'Best of ' + scenario.consBo + ' to ' + scenario.consPts};
    try {
      // Only test fixtures are loaded by RPC; tournament operations use real UI.
      await db.rpc(w.ids.org, 'fftt_upsert_players_v3',
        {p_event_id:w.eventId, p_players:fictional(scenario.players)});
      const org = await w.device('org');
      await org.signIn('org');
      await org.page.locator('#fmt-champ-bo').waitFor({timeout:T});
      assert.equal(await org.page.locator('#evTables').inputValue(), '3');
      if (scenario.consBo === 3) {
        for (const suffix of ['cons', 'cons_final']) {
          await org.page.locator('#fmt-' + suffix + '-bo').selectOption('3');
          await org.page.locator('#fmt-' + suffix + '-pts').selectOption('11');
        }
        await org.page.getByRole('button', {name:'Save match formats'}).click();
        await org.page.locator('dialog[open]').getByRole('button', {name:'Save formats'}).click();
        await toast(org.page, /formats saved/i);
      }
      await tab(org.page, 'players');
      await org.page.getByRole('button', {name:'Check in all', exact:true}).click();
      const checkin = org.page.locator('dialog[open]');
      await checkin.getByRole('button', {name:'Check in all players', exact:true}).click();
      await checkin.waitFor({state:'detached',timeout:T});
      let snapshot = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id:w.eventId});
      assert.equal(snapshot.players.filter(p => p.checked_in).length, scenario.players);
      // A third independent fictional scorer validates all three table stations.
      w.accounts.c = ['scorekeeper-c@fftt-staging.invalid', 'TestScorerC-2026-Aa1!'];
      w.ids.c = await w.fake.addAccount(w.accounts.c[0], w.accounts.c[1]);
      await db.rpc(w.ids.org, 'fftt_set_staff_v3', {
        p_event_id:w.eventId, p_email:w.accounts.c[0], p_action:'grant', p_role:'scorekeeper',
      });
      const bm = await w.device('bm');
      await bm.signIn('bm');
      await tab(bm.page, 'championship');
      await bm.page.getByRole('button', {name:'Build championship bracket'}).click();
      await toast(bm.page, 'Championship bracket built.');
      const a = await w.device('scorer-a', PHONE), b = await w.device('scorer-b', PHONE),
        c = await w.device('scorer-c', PHONE);
      await a.signIn('a'); await b.signIn('b'); await c.signIn('c');
      await prepareThreeTables(w, bm);
      const saveEveryGame = process.env.FFTT_SIM_SAVE_EVERY_GAME === '1';
      report.championship = await runBracket(w, [a,b,c], 'championship', saveEveryGame);
      snapshot = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id:w.eventId});
      assert.equal(snapshot.brackets.find(b => b.kind === 'championship')?.status, 'complete');
      assert.equal(report.championship.played, scenario.players - 1, 'Every Championship match played');
      assert.equal(report.championship.finals, 1, 'One Championship final');
      assert.ok(snapshot.consolation_candidates.length >= 2);
      await bm.page.reload({waitUntil:'domcontentloaded'});
      await tab(bm.page, 'consolation');
      const build = bm.page.getByRole('button', {name:'Build consolation bracket'});
      await build.waitFor({timeout:T});
      assert.equal(await build.isEnabled(), true);
      await build.click();
      await toast(bm.page, 'Consolation bracket built.');
      report.consolation = await runBracket(w, [a,b,c], 'consolation', saveEveryGame);
      snapshot = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id:w.eventId});
      assert.equal(snapshot.brackets.length, 2);
      assert.ok(snapshot.brackets.every(b => b.status === 'complete'), 'Both brackets complete');
      const playedCons = snapshot.matches.filter(m => m.bracket === 'consolation' && m.status === 'complete');
      assert.ok(playedCons.length > 0);
      assert.ok(playedCons.every(m => m.best_of === scenario.consBo && m.points === scenario.consPts),
        'All Consolation matches use selected format');
      await bm.page.reload({waitUntil:'domcontentloaded'});
      await tab(bm.page, 'finale');
      await bm.page.getByRole('button', {name:'Suggest balanced partners'}).click();
      const partnerA = await bm.page.locator('#dbA').inputValue();
      const partnerB = await bm.page.locator('#dbB').inputValue();
      assert.ok(partnerA && partnerB && partnerA !== partnerB);
      await bm.page.getByRole('button', {name:'Save teams'}).click();
      await toast(bm.page, 'Teams saved.');
      const team = scenario.players % 2 ? 2 : 1;
      await scoreDoubles(w, a, team);
      await org.page.reload({waitUntil:'domcontentloaded'});
      await tab(org.page, 'results');
      await org.page.getByRole('button', {name:'Publish to spectators'}).click();
      await toast(org.page, 'Now visible to spectators.');
      const pub = (await db.publicTournaments()).find(x => x.event_name === 'Synthetic Rehearsal Games');
      assert.ok(pub, 'Visible only on the fake public projection');
      assert.equal(pub.finale.status, 'complete');
      assert.equal(pub.finale.winner_team, team);
      assert.equal(pub.finale.game_scores, team === 1 ? '21-16' : '16-21');
      assert.doesNotMatch(JSON.stringify(pub), /@|phone|rating_status|actor_id|submission_id/);
      const spectator = await w.device('spectator');
      await spectator.open(SPECT + '/');
      await spectator.page.locator('.board-match').first().waitFor({timeout:T});
      await bm.page.reload({waitUntil:'domcontentloaded'});
      await tab(bm.page, 'wrap');
      const finish = bm.page.getByRole('button', {name:'Mark event complete'});
      assert.equal(await finish.isEnabled(), true);
      await finish.click();
      await bm.page.locator('dialog[open]').getByRole('button', {name:'Mark complete'}).click();
      await toast(bm.page, 'Event complete.');
      const [event] = await db.admin('select lifecycle,table_count from fftt_private.events where id=$1', [w.eventId]);
      assert.equal(event.lifecycle, 'complete');
      assert.equal(event.table_count, 3);
      assert.deepEqual(w.pageErrors, []);
      report.doubles = {winnerTeam:team, score:pub.finale.game_scores};
      report.status = 'PASS';
      console.log('FFTT_TOURNAMENT_SIMULATION ' + JSON.stringify(report));
    } finally {
      await w.close();
      await db.db.close();
    }
  });
}
