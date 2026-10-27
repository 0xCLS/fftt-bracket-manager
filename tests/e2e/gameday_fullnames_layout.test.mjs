/** Full first and last names everywhere: with LONG names, no staff, spectator or TV screen overflows horizontally or clips a name,
 * and two players who share a first name stay distinguishable on the Match Desk (tables, score dialog). Real-mode event on the
 * upgraded schema. Browser-SIMULATED viewports; fictional people only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld, SPECT} from './browser_world.mjs';
import {buildChampionship, playAllPlayable} from './helpers.mjs';

const T = 20000;
const NAMES = ['Alexandria Montgomery-Fitzgerald', 'Alexandria Whitcombe-Hargreaves', 'Bartholomew Featherstonehaugh', 'Christopherson Vandenberghe',
  'Dominique Castellanos-Rutherford', 'Evangeline Worthington-Smythe', 'Ferdinand Oluwaseun-Abernathy', 'Genevieve Ravenscroft-Delacroix'];
const VIEWPORTS = {desktop: {viewport: {width: 1440, height: 900}}, tablet: {viewport: {width: 820, height: 1180}}, phone: {viewport: {width: 390, height: 844}, mobile: true}, tv: {viewport: {width: 1920, height: 1080}}};
const goTab = (page, name) => page.locator('nav.tabs button', {hasText: new RegExp('^' + name + '$')}).click();
const overflow = page => page.evaluate(() => ({
  page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  clipped: [...document.querySelectorAll('strong, b, .reg-name, .match .name, .tv-line, td, .pill')].filter(e => {
    const cs = getComputedStyle(e); if (!e.offsetWidth || cs.visibility === 'hidden') return false;
    return (cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1;
  }).map(e => e.textContent.slice(0, 40)),
}));

test('long full names: no horizontal overflow or clipped names on staff, spectator and TV; same first names are distinguishable', {timeout: 600000}, async () => {
  const w = await createBrowserWorld({real: true});
  try {
    const l = w.fake.local, E = w.eventId, org = w.ids.org;
    await l.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: NAMES.map((name, i) => ({name, rating: 1 + (i % 5), rating_status: 'provisional'}))});
    await l.rpc(org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
    const ctx = {db: l, E, org, skA: w.ids.a, skB: w.ids.b, snap: () => l.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
    await buildChampionship(ctx);
    const desk = await l.rpc(w.ids.a, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true});
    await l.rpc(w.ids.a, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: desk[0].match_id, p_table_number: 1});
    await l.rpc(w.ids.a, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: desk[1].match_id, p_table_number: 2});
    await l.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
    const problems = [];
    const check = async (page, label) => { const o = await overflow(page); if (o.page > 0 || o.clipped.length) problems.push(`${label}: overflow ${o.page}px, clipped ${JSON.stringify(o.clipped)}`); };

    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      if (vp !== 'tv') {
        const dev = await w.device('org-' + vp, opts);
        await dev.signIn('org');
        await dev.page.locator('#evName').waitFor({timeout: T});
        for (const tab of ['Players', 'Match Desk', 'Championship', 'Results & Export']) { await goTab(dev.page, tab); await dev.page.waitForTimeout(250); await check(dev.page, `staff ${tab} @ ${vp}`); }
        // the Match Desk: table pills carry FULL names, so two "Alexandria"s are told apart
        await goTab(dev.page, 'Match Desk');
        const pills = await dev.page.locator('.pill.table-pill').allInnerTexts();
        const busy = pills.filter(t => / v /.test(t));
        assert.equal(busy.length, 2, `both occupied tables are listed @ ${vp}`);
        for (const t of busy) for (const side of t.replace(/^Table \d+ · /, '').split(' v ')) assert.ok(side.trim().split(/\s+/).length >= 2, `table pill shows a FULL name, not a first name: "${t}" @ ${vp}`);
        const open = dev.page.locator('button', {hasText: /Enter score|Record|Score/}).first();
        if (await open.count()) { await open.click(); await dev.page.locator('dialog[open] .games b').first().waitFor({timeout: T}).catch(() => {});
          const heads = await dev.page.locator('dialog[open] .games b').allInnerTexts();
          if (heads.length) assert.ok(heads.every(t => t.trim().split(/\s+/).length >= 2), `score dialog headings show full names @ ${vp}: ${heads}`);
          await check(dev.page, `score dialog @ ${vp}`); await dev.page.keyboard.press('Escape'); }
        const spec = await w.device('spec-' + vp, opts);
        await spec.open(SPECT + '/');
        await spec.page.locator('#evName').waitFor({timeout: T});
        for (const tab of ['Bracket', 'Results']) { const b = spec.page.locator('nav.tabs button', {hasText: tab}); if (await b.count()) { await b.first().click(); await spec.page.waitForTimeout(250); await check(spec.page, `spectator ${tab} @ ${vp}`); } }
      } else {
        const tv = await w.device('tv', opts);
        await tv.open(SPECT + '/app/tv.html');
        await tv.page.locator('.tv-line .tbl', {hasText: 'Table 1'}).waitFor({timeout: T});
        await check(tv.page, 'TV board');
        assert.ok(/Alexandria|Bartholomew|Christopherson|Dominique|Evangeline|Ferdinand|Genevieve/.test(await tv.page.locator('body').innerText()), 'the TV shows full names');
      }
    }
    assert.deepEqual(problems, [], 'layout problems with long full names');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});
