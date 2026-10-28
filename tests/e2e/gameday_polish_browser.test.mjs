/** UI/UX polish in real Chrome: one spacing system across the whole app, the in-field password toggle, equal square score tiles with
 * correct winner/loser colouring and player order, full-width Overview formats, compact notifications, wording for every registration
 * state and the event-specific Registration settings (fake Google, no network). Browser-SIMULATED viewports; fictional data only.
 * Set FFTT_SHOTS=<dir> to also write the screenshots used for visual review. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld, SPECT, STAFF} from './browser_world.mjs';
import {roster, buildChampionship, buildConsolation, playAllPlayable} from './helpers.mjs';
import {FAKE_SA} from './fake_google.mjs';
import {SYNTHETIC_FORM_CSV} from '../../server/registration/synthetic_fixture.mjs';
import {parseCsv} from '../../contracts/registration_model.mjs';

const T = 20000;
const SHOTS = process.env.FFTT_SHOTS ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, {recursive: true});
const VIEWPORTS = {desktop: {viewport: {width: 1440, height: 900}}, tablet: {viewport: {width: 820, height: 1180}}, phone: {viewport: {width: 390, height: 844}, mobile: true}};
const goTab = (page, name) => page.locator('nav.tabs button', {hasText: new RegExp('^' + name + '$')}).click();
const toast = (page, re, timeout = T) => page.locator('#toasts .toast', {hasText: re}).waitFor({timeout});
const shot = async (page, name) => { if (SHOTS) await page.screenshot({path: `${SHOTS}/${name}.png`, fullPage: true}); };

const SHEET_OK = 'SYNTHETIC_SHEET_A_0123456789abcdef';
const SHEET_PRIVATE = 'SYNTHETIC_SHEET_X_0123456789abcdef';
const SHEET_NEW = 'SYNTHETIC_SHEET_N_0123456789abcdef';
const TAB = 'Form responses 1';
const url = id => `https://docs.google.com/spreadsheets/d/${id}/edit?gid=0#gid=0`;
const FIXTURE_ROWS = parseCsv(SYNTHETIC_FORM_CSV);
const NEW_FORM = [['Submitted', 'Participant', 'Contact email'], ['2026-11-01 10:00', 'Pat Ngo', 'pat@example.invalid'], ['2026-11-01 10:05', 'Sam Roe', 'sam@example.invalid']];
const google = () => ({mode: 'diagnostic', sheets: {
  [SHEET_OK]: {title: 'FFTT3 Sign-ups (fictional copy)', tabs: {[TAB]: FIXTURE_ROWS, Notes: [['x']]}, shared: true},
  [SHEET_PRIVATE]: {title: 'Private sheet', tabs: {[TAB]: FIXTURE_ROWS}, shared: false},
  [SHEET_NEW]: {title: 'Future form', tabs: {[TAB]: NEW_FORM}, shared: true}}});

/** A played-out fictional tournament: Bo3/11 championship (final left UNSTAMPED = historical Best of 5), Bo1/21 consolation. */
async function stageTournament(w, {doubles = false} = {}) {
  const l = w.fake.local, E = w.eventId, org = w.ids.org;
  const ctx = {db: l, E, org, skA: w.ids.a, skB: w.ids.b, snap: () => l.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
  await l.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(8)});
  await l.rpc(org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  await buildChampionship(ctx);
  await l.admin('update fftt_private.matches set best_of = null, points_to_win = null where event_id = $1 and is_championship_final', [E]);
  await playAllPlayable(ctx, {only: 'championship'});
  await buildConsolation(ctx);
  await playAllPlayable(ctx, {only: 'consolation'});
  const snap = await ctx.snap();
  const final = snap.matches.find(m => m.is_final && m.bracket === 'championship');
  const placed = snap.consolation_candidates.filter(c => c.state === 'placed').map(c => c.player_id).filter(id => ![final.player_1_id, final.player_2_id].includes(id));
  if (doubles) {
    await l.rpc(org, 'fftt_set_doubles_teams_v3', {p_event_id: E, p_partner_1: placed[0], p_partner_2: placed[1]});
    await l.rpc(org, 'fftt_record_doubles_result_v3', {p_event_id: E, p_winner_team: 2, p_game_scores: '8-11, 11-9, 10-12'});
  }
  await l.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
  return {ctx, snap};
}

/** In-page audit: related controls must never touch. Returns the offending pairs. */
const SPACING = () => {
  const VERT = 10, HORIZ = 6;
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('.sr-only') && !(e.closest('details:not([open])') && !e.closest('summary')); };
  const scope = document.querySelector('dialog[open]') ?? document;   // behind a modal dialog the page is inert: audit what the person can actually reach
  const controls = [...scope.querySelectorAll('button, select, input:not([type=radio]):not([type=checkbox]):not([type=file]):not([type=hidden]), textarea')]
    .filter(vis).filter(e => !e.classList.contains('pw-toggle') && !e.closest('.seg, nav.tabs, .toasts, .chips, .games, .reg-pick, .bracket'));
  const name = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label').slice(0, 24)}]` : ''}${e.textContent && e.tagName === 'BUTTON' ? `"${e.textContent.trim().slice(0, 22)}"` : ''}`;
  const out = [];
  for (const b of controls) {
    const rb = b.getBoundingClientRect();
    for (const a of controls) {
      if (a === b || a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 4 && rb.top >= ra.bottom - 1 && rb.top - ra.bottom < VERT) out.push(`${name(a)} -> ${name(b)} vertical gap ${(rb.top - ra.bottom).toFixed(1)}px`);
      else if (oy > 4 && rb.left >= ra.right - 1 && rb.left - ra.right < HORIZ) out.push(`${name(a)} | ${name(b)} horizontal gap ${(rb.left - ra.right).toFixed(1)}px`);
    }
  }
  // a label sits just above its own field (not floating away, not glued on)
  for (const l of scope.querySelectorAll('label[for]')) {
    if (!vis(l) || l.classList.contains('check') || l.closest('.map-row')) continue;
    const f = document.getElementById(l.getAttribute('for'));
    if (!f || !vis(f)) continue;
    const rl = l.getBoundingClientRect(), rf = f.getBoundingClientRect();
    if (rf.top >= rl.bottom - 1 && Math.abs(rf.left - rl.left) < 40) { const g = rf.top - rl.bottom; if (g < 2 || g > 14) out.push(`label "${l.textContent.trim().slice(0, 24)}" -> #${f.id} gap ${g.toFixed(1)}px`); }
  }
  const o = {sw: document.documentElement.scrollWidth, iw: window.innerWidth};
  if (o.sw > o.iw + 1) {
    const culprits = [];
    for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width && r.right > o.iw + 1) { let p = e, scroller = false; while ((p = p.parentElement)) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { scroller = true; break; } } if (!scroller) culprits.push(`${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}#${e.id}@${Math.round(r.right)}`); } }
    out.push(`horizontal overflow ${o.sw} > ${o.iw}: ${culprits.slice(0, 5).join(' ')}`);
  }
  return out;
};
const idle = page => page.locator('#regSetBody[aria-busy="false"]').waitFor({timeout: T});   // no request in flight: safe to interact
const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** axe-core (WCAG A/AA incl. colour contrast) on whatever is on screen right now. */
async function axe(page, label) {
  if (!(await page.evaluate(() => typeof window.axe)).startsWith('object')) await page.addScriptTag({url: '/__test__/axe.min.js'});
  const res = await page.evaluate(rules => window.axe.run(document, {runOnly: {type: 'tag', values: rules}, resultTypes: ['violations']}), RULES);
  assert.deepEqual(res.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), [], `accessibility violations on ${label}`);
}
const found = [];
/** Collects every problem on every page (so one run shows the whole picture); the test asserts the list is empty at the end. */
const spacing = async (page, label) => { for (const b of await page.evaluate(SPACING)) found.push(`${label}: ${b}`); };

test('SPACING: one rhythm everywhere. Related controls never touch (Doubles, Staff, Players, settings, sign-in, recovery, dialogs) at desktop, tablet and phone', {timeout: 900000}, async () => {
  const w = await createBrowserWorld({google: google()});
  try {
    await stageTournament(w);
    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      // sign-in, with the recovery section open (its buttons used to sit against their inputs)
      const out = await w.device('signin-' + vp, opts);
      await out.open(STAFF + '/app/staff.html');
      await out.page.waitForSelector('#signIn:not([disabled])');
      await spacing(out.page, `sign-in @ ${vp}`);
      await out.page.locator('#recoveryBox summary').click();
      await out.page.locator('#eventIdBox summary').click();
      await spacing(out.page, `sign-in with recovery open @ ${vp}`);
      await shot(out.page, `${vp}-signin-recovery`);
      const org = await w.device('org-' + vp, opts);
      await org.signIn('org');
      await org.page.locator('#evName').waitFor({timeout: T});
      await spacing(org.page, `Overview @ ${vp}`);
      // cells of the event-setup grid align (a shared stacking rule once pushed the date field lower than the name field)
      const tops = await org.page.evaluate(() => ['evName', 'evDate'].map(id => document.getElementById(id).getBoundingClientRect().top));
      if (vp !== 'phone') assert.ok(Math.abs(tops[0] - tops[1]) < 1, `event name and date fields share a baseline @ ${vp}: ${tops}`);
      await goTab(org.page, 'Players');
      // Check-in workspace is a single accessible flow on tablet/phone and a
      // two-column registration + walk-in station on roomy desktop.
      const layout = await org.page.evaluate(() => {
        const page = document.querySelector('.players-page').getBoundingClientRect();
        const settings = document.querySelector('.players-registration-config .reg-settings').getBoundingClientRect();
        const reg = document.querySelector('.players-page > .reg-card').getBoundingClientRect();
        const add = document.querySelector('.players-add-column #addTitle').closest('.card').getBoundingClientRect();
        const snapshot = document.querySelector('.players-snapshot').getBoundingClientRect();
        const tiles = [...document.querySelectorAll('.players-snapshot .mini-kpi')].map(e => e.getBoundingClientRect());
        const roster = document.getElementById('rosterTitle').closest('.card').getBoundingClientRect();
        return {width:page.width,settings:{top:settings.top,bottom:settings.bottom,left:settings.left,right:settings.right},
          reg:{top:reg.top,bottom:reg.bottom,left:reg.left,right:reg.right},
          add:{top:add.top,left:add.left,bottom:add.bottom,right:add.right},snapshot:{top:snapshot.top,bottom:snapshot.bottom,left:snapshot.left,right:snapshot.right},
          tiles:tiles.map(t=>({width:t.width,height:t.height})),rosterTop:roster.top,
          score:getComputedStyle(document.documentElement).getPropertyValue('--tile').trim()};
      });
      assert.equal(layout.score, '26px', 'scores use the reduced size');
      assert.ok(layout.add.top < layout.settings.top, 'Add players and snapshot precede registration configuration');
      assert.equal(layout.tiles.length, 4, 'four status tiles share the Overview-style snapshot');
      assert.ok(layout.tiles.every(t => t.width > 100 && t.height >= 100), 'snapshot tiles remain comfortably readable');
      if (layout.width > 980) assert.ok(layout.snapshot.left >= layout.add.right - 2, `overview snapshot sits beside Add players @ ${vp}`);
      else assert.ok(layout.snapshot.top >= layout.add.bottom - 2, `overview snapshot stacks after Add players @ ${vp}`);
      assert.ok(layout.reg.top >= Math.max(layout.add.bottom, layout.snapshot.bottom) - 2, 'registrations follow the top overview');
      assert.ok(Math.abs(layout.settings.left - layout.reg.left) <= 2 &&
        Math.abs(layout.settings.right - layout.reg.right) <= 2, 'registration settings and list are both full width');
      assert.ok(layout.settings.top >= layout.reg.bottom - 2, 'advanced connection settings follow registrations');
      assert.ok(layout.rosterTop >= layout.settings.bottom - 2, 'roster follows advanced settings');
      assert.equal(await org.page.locator('#regSetToggle').getAttribute('aria-expanded'), 'false', 'advanced settings start collapsed');
      assert.equal(await org.page.locator('.add-players-card').count(), 1, 'exactly one combined add-player workspace');
      assert.equal(await org.page.locator('#addModeOne').getAttribute('aria-selected'), 'true', 'single-player entry is the default');
      assert.equal(await org.page.locator('.add-one-actions button').count(), 2, 'Add to roster and Add & check in remain separate actions');
      await org.page.locator('#addModeBulk').click();
      assert.equal(await org.page.locator('#addModeBulk').getAttribute('aria-selected'), 'true', 'bulk entry is an alternative mode');
      await org.page.locator('#addModeOne').click();
      await org.page.locator('#regSetToggle').click();
      await org.page.locator('#regSetBody').waitFor();
      await org.page.locator('.choice', {hasText: 'Google Sheet'}).click();
      await org.page.fill('#regSheet', url(SHEET_OK));
      await org.page.locator('#regCheck').click();
      await org.page.locator('.diag-list li').first().waitFor({timeout: T});
      await spacing(org.page, `Registration settings @ ${vp}`);
      await axe(org.page, `Registration settings with test results @ ${vp}`);
      await shot(org.page, `${vp}-registration-settings`);
      await org.page.locator('#regLoad').scrollIntoViewIfNeeded();
      await spacing(org.page, `Players @ ${vp}`);
      await org.page.locator('#regLoad').click();
      await org.page.locator('.reg-body .reg-meta').waitFor({timeout: T});
      await org.page.locator('.reg-body .reg-row').first().waitFor({timeout: T});
      const rankType = await org.page.locator('.reg-row .reg-level-text').first().evaluate(el => {
        const primary = el.querySelector('span:first-child'), secondary = el.querySelector('span.muted');
        return {primary: parseFloat(getComputedStyle(primary).fontSize), secondary: parseFloat(getComputedStyle(secondary).fontSize)};
      });
      assert.ok(rankType.primary >= 14 && rankType.secondary <= 12 && rankType.primary > rankType.secondary,
        'playing level is visually more prominent than suggestion confidence');

      // Same shield geometry for every rank, in a 40×40 square.
      if (vp === 'desktop') {
        const shields = await org.page.evaluate(async () => {
          const {levelShield} = await import('/app/view_players.mjs');
          const host = document.createElement('div');
          host.className = 'reg-level';
          document.body.append(host);
          const result = [1, 2, 3, 4, 5].map(n => {
            const tile = levelShield(n);
            host.append(tile);
            const box = tile.getBoundingClientRect(), svg = tile.querySelector('svg'), style = getComputedStyle(tile);
            return {n, w:box.width, h:box.height, viewBox:svg.getAttribute('viewBox'),
              face:style.getPropertyValue('--rank-face').trim(),
              chevrons:svg.querySelectorAll('.rank-chevron').length,
              stars:svg.querySelectorAll('.rank-star').length,
              starPath:svg.querySelector('.rank-star')?.getAttribute('d') || '',
              chevronPaths:[...svg.querySelectorAll('.rank-chevron')].map(x => x.getAttribute('d')),
              hidden:tile.getAttribute('aria-hidden')};
          });
          host.remove();
          return result;
        });
        assert.ok(shields.every(x => x.w === 32 && x.h === 32 && x.viewBox === '0 0 40 40'), 'all five compact icons have equal 32px square dimensions');
        assert.equal(new Set(shields.map(x => x.face)).size, 5, 'five distinct level colors');
        assert.deepEqual(shields.map(x => x.chevrons), [1, 2, 3, 4, 0], 'ranks 1–4 contain corresponding chevrons');
        assert.deepEqual(shields.map(x => x.stars), [0, 0, 0, 0, 1], 'only Level 5 contains a star');
        assert.ok(shields[4].starPath.includes('L29 16.5 L23.7 20.7'), 'Level 5 star uses the smaller, slightly raised five-point silhouette');
        assert.ok(shields.every(x => x.hidden === 'true'), 'icon meaning is duplicated as text for assistive technology');
        assert.ok(shields.slice(0, 4).every(x => x.chevronPaths.every(d => d.startsWith('M14 ') && d.includes(' L26 '))),
          'every chevron stays well inside the inner shield boundary');
        assert.ok(shields[4].starPath.startsWith('M20 10.5 '), 'the raised star tip remains inset from the shield border');
        const seen = await org.page.locator('.reg-row .reg-level').first().evaluate(e => ({
          level:e.querySelector('.rank-badge')?.dataset.level,
          label:e.querySelector('.reg-level-text')?.innerText || ''
        }));
        if (seen.level !== 'unset') assert.ok(seen.label.includes('Level ' + seen.level), 'level text names the rank independently of shape and color');
        assert.equal(await org.page.locator('.reg-row .reg-state', {hasText: 'Not checked in'}).count(), 0,
          'ordinary unchecked registrants do not repeat a status pill');
      }
      await org.page.locator('.reg-row .reg-pick input:enabled').first().check();   // opens the bulk-selection panel
      await org.page.locator('.bulk-bar').waitFor({state: 'visible', timeout: T});
      const regGaps = await org.page.evaluate(() => {
        const kids = [...document.querySelectorAll('.reg-body>*')].filter(e => !e.hidden && e.getBoundingClientRect().height > 0 && !e.classList.contains('reg-list'));
        const gaps = kids.slice(1).map((e, i) => ({a: kids[i].className, b: e.className, gap: e.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom}));
        const head = document.querySelector('.reg-card>.card-head'), first = head.querySelector(':scope>div'), actions = head.querySelector(':scope>.row');
        const f = first.getBoundingClientRect(), a = actions.getBoundingClientRect();
        const cardGap = head.nextElementSibling.getBoundingClientRect().top - head.getBoundingClientRect().bottom;
        // title copy and action buttons: side by side with a real horizontal gap, or stacked with a real vertical gap
        const side = a.top < f.bottom - 1, between = side ? a.left - f.right : a.top - f.bottom;
        return {gaps, between, side, cardGap, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};
      });
      assert.ok(regGaps.gaps.length >= 3, `meta, tools, count and bulk panel are all present (${regGaps.gaps.map(g => g.b).join(' | ')})`);
      for (const g of regGaps.gaps) assert.ok(g.gap >= 12, `Registrations: ${g.a} -> ${g.b} separated by ${g.gap}px @ ${vp}`);
      assert.ok(regGaps.gaps.find(g => /reg-tools/.test(g.a) === false && /reg-tools/.test(g.b)).gap >= 16, 'badges to search/filter controls: at least one field gap');
      assert.ok(regGaps.between >= 16, `Registrations title copy to actions: ${regGaps.between}px (${regGaps.side ? 'side by side' : 'stacked'}) @ ${vp}`);
      assert.ok(regGaps.cardGap >= 20 && regGaps.cardGap <= 40, `header to content: ${regGaps.cardGap}px (not cramped, not excessive) @ ${vp}`);
      assert.ok(regGaps.overflow <= 0, 'no horizontal page overflow');
      await spacing(org.page, `Registrations loaded @ ${vp}`);
      await shot(org.page, `${vp}-registrations-loaded`);
      await shot(org.page, `${vp}-players`);
      await goTab(org.page, 'Doubles Finale');
      await org.page.locator('button', {hasText: 'Suggest balanced partners'}).waitFor({timeout: T});
      await spacing(org.page, `Doubles Finale @ ${vp}`);
      await shot(org.page, `${vp}-doubles-form`);
      const btn = await org.page.locator('button', {hasText: 'Suggest balanced partners'}).boundingBox();
      const sel = await org.page.locator('#dbB').boundingBox();
      assert.ok(btn.y - (sel.y + sel.height) >= 12 || Math.abs(btn.y - sel.y) < sel.height, 'the doubles buttons are clear of the partner dropdowns');
      await goTab(org.page, 'Staff');
      await org.page.locator('#stEmail').waitFor();
      await spacing(org.page, `Staff @ ${vp}`);
      const role = await org.page.locator('#stRole').boundingBox(), grant = await org.page.locator('button', {hasText: 'Grant access'}).boundingBox();
      assert.ok(grant.y - (role.y + role.height) >= 14, `"Grant access" is clear of the Role dropdown (${grant.y - (role.y + role.height)}px)`);
      await shot(org.page, `${vp}-staff`);
      await goTab(org.page, 'Match Desk');
      await org.page.locator('h2', {hasText: /Recent results/}).waitFor({timeout: T});
      await spacing(org.page, `Match Desk @ ${vp}`);
      // dialogs
      await org.page.locator('.queue-card button', {hasText: 'Record result'}).first().click().catch(() => {});
      if (await org.page.locator('dialog[open]').count()) { await spacing(org.page, `score dialog @ ${vp}`); await org.page.keyboard.press('Escape'); }
      await org.page.locator('button', {hasText: 'Correct…'}).first().click();
      await org.page.locator('dialog[open]').waitFor();
      await spacing(org.page, `correction dialog @ ${vp}`);
      await shot(org.page, `${vp}-correction-dialog`);
      await org.page.keyboard.press('Escape');
      for (const tab of ['Results & Export', 'Championship', 'Consolation']) {
        await goTab(org.page, tab);
        await org.page.waitForTimeout(300);
        await spacing(org.page, `${tab} @ ${vp}`);
        if (tab === 'Consolation') {
          const levels = await org.page.locator('[aria-labelledby="consTitle"] .cons-level').evaluateAll(els => els.map(el => ({
            level: el.querySelector('.rank-badge')?.dataset.level,
            accessible: el.getAttribute('aria-label'),
            numericChip: !!el.querySelector('.rating-chip')
          })));
          assert.equal(levels.length, 5, 'all five fictional consolation entrants have level shields');
          assert.ok(levels.every(x => x.level && x.accessible === 'Level ' + x.level && !x.numericChip),
            'Consolation uses level shields with accessible numeric labels instead of old rating chips');
          assert.equal(await org.page.locator('[aria-labelledby="consTitle"] th', {hasText: 'Level'}).count(), 1,
            'Consolation table heading is Level');
        }
      }
      const spec = await w.device('spec-' + vp, opts);
      await spec.open(SPECT + '/');
      await spec.page.locator('#evName', {hasText: 'Synthetic'}).waitFor({timeout: T});
      await spec.page.locator('nav.tabs button', {hasText: 'Results'}).click();
      await spec.page.waitForTimeout(300);
      await spacing(spec.page, `spectator results @ ${vp}`);
    }
    assert.deepEqual([...new Set(found)], [], 'spacing problems');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('PASSWORD: the eye icon is INSIDE the field at the right, keyboard-reachable, labelled, and the field keeps its autocomplete behaviour', {timeout: 300000}, async () => {
  const w = await createBrowserWorld();
  try {
    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      const d = await w.device('pw-' + vp, opts);
      const page = await d.open(STAFF + '/app/staff.html');
      await page.waitForSelector('#signIn:not([disabled])');
      const geo = () => page.evaluate(() => {
        const i = document.getElementById('password').getBoundingClientRect(), b = document.getElementById('togglePassword').getBoundingClientRect();
        return {inside: b.left >= i.left && b.right <= i.right + 0.5 && b.top >= i.top - 0.5 && b.bottom <= i.bottom + 0.5, rightGap: i.right - b.right, w: b.width, h: b.height, inputH: i.height,
          svg: !!document.querySelector('#togglePassword svg.eye-icon'), text: document.getElementById('togglePassword').textContent.trim(),
          type: document.getElementById('password').type, label: document.getElementById('togglePassword').getAttribute('aria-label'), pressed: document.getElementById('togglePassword').getAttribute('aria-pressed'),
          ac: document.getElementById('password').autocomplete, outside: [...document.querySelectorAll('#loginForm button')].filter(x => x.id !== 'togglePassword' && /show|hide/i.test(x.textContent)).length};
      });
      const g1 = await geo();
      assert.ok(g1.inside, `the toggle is inside the password field @ ${vp}`);
      assert.ok(g1.rightGap >= 0 && g1.rightGap <= 6, `and at its right edge (gap ${g1.rightGap}) @ ${vp}`);
      assert.ok(g1.svg && g1.text === '' && g1.outside === 0, 'an icon, with no separate Show/Hide button');
      assert.ok(g1.w >= 40 && g1.h >= 44, `a comfortable tap target (${g1.w}x${g1.h})`);
      assert.deepEqual([g1.type, g1.label, g1.pressed, g1.ac], ['password', 'Show password', 'false', 'current-password']);
      await page.fill('#password', 'not-a-real-password');
      await page.locator('#togglePassword').click();
      const g2 = await geo();
      assert.deepEqual([g2.type, g2.label, g2.pressed, g2.ac], ['text', 'Hide password', 'true', 'current-password'], 'the label and state describe the new action; autocomplete is unchanged');
      assert.equal(await page.inputValue('#password'), 'not-a-real-password', 'toggling keeps what was typed');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'togglePassword', 'focus stays on the toggle (no surprise jump, no on-screen keyboard on phones)');
      await page.focus('#password'); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'togglePassword', 'reachable by keyboard right after the field');
      await page.keyboard.press('Space');
      assert.equal((await geo()).type, 'password', 'Space toggles back');
      await page.keyboard.press('Enter');
      assert.equal((await geo()).type, 'text', 'Enter toggles too, and does not submit the form');
      await page.locator('#togglePassword').focus();
      const outline = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('togglePassword')); return {w: parseFloat(s.outlineWidth), st: s.outlineStyle}; });
      assert.ok(outline.w >= 2 && outline.st !== 'none', 'a visible focus indicator');
      await axe(page, `sign-in with the in-field toggle @ ${vp}`);
      await shot(page, `${vp}-signin-password`);
    }
  } finally { await w.close(); }
});

test('SCORE TILES: equal squares, tabular numerals, green winner / red loser per game, first-named player first; Bo1, Bo3, historical Bo5, 11 and 21, deuce; no rewriting', {timeout: 600000}, async () => {
  const w = await createBrowserWorld();
  try {
    const {snap} = await stageTournament(w, {doubles: true});
    const names = new Map(snap.players.map(p => [p.id, p.name]));
    const stored = await w.fake.local.admin(`select m.game_scores, m.player_1_id, m.player_2_id, m.winner_id, m.best_of, m.points_to_win, m.is_championship_final from fftt_private.matches m where m.event_id = $1 and m.status = 'complete'`, [w.eventId]);
    const finalRow = stored.find(r => r.is_championship_final);
    assert.equal(finalRow.best_of, null, 'the historical final stays unstamped (never rewritten)');
    assert.equal(finalRow.game_scores.split(', ').length, 3, 'and was played as a Best of 5 (three games to win)');
    assert.ok(stored.some(r => r.best_of === 1 && r.points_to_win === 21) && stored.some(r => r.best_of === 3 && r.points_to_win === 11), 'Bo1/21 and Bo3/11 results exist');
    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      const org = await w.device('tiles-' + vp, opts);
      await org.signIn('org');
      await org.page.locator('#evName').waitFor({timeout: T});
      await goTab(org.page, 'Match Desk');
      await org.page.locator('h2', {hasText: /Recent results/}).waitFor({timeout: T});
      const tiles = await org.page.evaluate(() => [...document.querySelectorAll('.scores-cell .score-tile')].map(t => { const r = t.getBoundingClientRect(), cs = getComputedStyle(t); return {w: r.width, h: r.height, cls: t.className, text: t.textContent, ff: cs.fontVariantNumeric, radius: parseFloat(cs.borderTopLeftRadius), bg: cs.backgroundColor, color: cs.color}; }));
      assert.ok(tiles.length >= 8, 'recent results render tiles');
      assert.ok(tiles.every(t => Math.abs(t.w - t.h) < 0.5), 'every tile is square');
      assert.ok(tiles.every(t => Math.abs(t.w - 26) < 0.5), `standard tiles are 26px squares (${tiles[0].w})`);
      assert.ok(tiles.every(t => Math.abs(t.w - tiles[0].w) < 0.5 && Math.abs(t.h - tiles[0].h) < 0.5), `identical width and height for every tile (${tiles[0].w}px) incl. double digits @ ${vp}`);
      assert.ok(tiles.some(t => t.text.length === 2) && tiles.some(t => t.text.length === 1), 'single and double digits both present');
      assert.ok(tiles.every(t => t.ff.includes('tabular-nums') && t.radius >= 5 && t.radius <= 9), 'tabular numerals and a consistent modest radius');
      const winBg = new Set(tiles.filter(t => t.cls.includes('win')).map(t => t.bg)), loseBg = new Set(tiles.filter(t => t.cls.includes('lose')).map(t => t.bg));
      assert.equal(winBg.size, 1); assert.equal(loseBg.size, 1);
      const [wr, wg, wb] = [...winBg][0].match(/\d+/g).map(Number), [lr, lg, lb] = [...loseBg][0].match(/\d+/g).map(Number);
      assert.ok(wg > wr && wg > wb && wr > 200, `subtle pastel GREEN for the winning score (${[...winBg][0]})`);
      assert.ok(lr > lg && lr > lb && lr > 235 && lg > 200, `subtle pastel RED for the losing score (${[...loseBg][0]})`);
      // every game: the larger score is green, the smaller red; the pair reads first-named player first, matching the stored text
      const rows = await org.page.evaluate(() => [...document.querySelectorAll('#recentTitle ~ .scroll-x tbody tr, section[aria-labelledby=recentTitle] tbody tr')].map(tr => ({
        match: tr.querySelector('td[data-label=Match]').textContent, winner: tr.querySelector('td[data-label=Winner]').textContent,
        games: [...tr.querySelectorAll('.score-game')].map(g => [...g.querySelectorAll('.score-tile')].map(t => ({n: Number(t.textContent), win: t.classList.contains('win'), lose: t.classList.contains('lose')}))),
        sr: [...tr.querySelectorAll('.score-game .sr-only')].map(x => x.textContent), caption: tr.querySelector('.score-caption')?.textContent, group: tr.querySelector('.score-tiles')?.getAttribute('aria-label')})));
      assert.ok(rows.length >= 8);
      for (const r of rows) {
        const [n1, n2] = r.match.split(' v ');
        assert.equal(r.caption, undefined, 'no redundant player-name caption: the row already names the matchup');
        assert.equal(r.group, `Game scores, ${n1} first, then ${n2}`, 'the tiles still identify both players accessibly, in reading order');
        for (const [i, g] of r.games.entries()) {
          assert.equal(g.length, 2);
          assert.ok(g[0].n !== g[1].n && (g[0].n > g[1].n ? g[0].win && g[1].lose : g[1].win && g[0].lose), `game ${i + 1} of ${r.match}: higher score green, lower red`);
          assert.match(r.sr[i], new RegExp(`^Game ${i + 1}: ${n1} ${g[0].n}, ${n2} ${g[1].n}\\. (${n1}|${n2}) won the game\\.$`), 'a sentence for screen readers, not colour alone');
        }
        // the text the tiles show equals the recorded text for that match, in recorded (player 1 first) order
        const rec = stored.find(s => names.get(s.player_1_id) === n1 && names.get(s.player_2_id) === n2);
        assert.ok(rec, `found the stored match for ${r.match}`);
        assert.equal(r.games.map(g => `${g[0].n}-${g[1].n}`).join(', '), rec.game_scores, 'tiles are the recorded scores, player order preserved');
        // and the winner of the MATCH is the one who won more games
        const w1 = r.games.filter(g => g[0].win).length, w2 = r.games.length - w1;
        assert.equal(r.winner, `${w1 > w2 ? n1 : n2} won`);
      }
      assert.ok(rows.some(r => r.games.length === 1 && r.games[0][0].n + r.games[0][1].n >= 40), 'a Best-of-1 game to 21 (incl. deuce where played)');
      assert.ok(rows.some(r => r.games.length === 3 && r.match), 'a three-game result (Best of 3, and the historical Best-of-5 final won 3-0)');
      await axe(org.page, `Match Desk with score tiles @ ${vp}`);
      await shot(org.page, `${vp}-recent-results-tiles`);
      // Doubles: Team A first; Team B won (8-11, 11-9, 10-12 -> deuce games)
      await goTab(org.page, 'Doubles Finale');
      await org.page.locator('#doublesResult').waitFor({timeout: T});
      const d = await org.page.evaluate(() => ({games: [...document.querySelectorAll('#doublesResult .score-game')].map(g => [...g.querySelectorAll('.score-tile')].map(t => [t.textContent, t.className])), cap: document.querySelector('#doublesResult .score-caption').textContent,
        dims: [...document.querySelectorAll('#doublesResult .score-tile')].map(t => { const r = t.getBoundingClientRect(); return [r.width, r.height]; })}));
      assert.equal(d.cap, 'Team A · Team B');
      assert.deepEqual(d.games.map(g => g.map(t => t[0]).join('-')), ['8-11', '11-9', '10-12']);
      assert.deepEqual(d.games.map(g => g.map(t => /win/.test(t[1]) ? 'W' : 'L').join('')), ['LW', 'WL', 'LW'], 'deuce games colour by who won the game');
      assert.ok(d.dims.every(([a, b]) => Math.abs(a - b) < 0.5 && Math.abs(a - tiles[0].w) < 0.5), 'doubles tiles match the Match Desk tiles');
      await axe(org.page, `Doubles result tiles @ ${vp}`);
      await shot(org.page, `${vp}-doubles-result`);
      await spacing(org.page, `Doubles result @ ${vp}`);
      // spectator results and bracket use the same component
      const spec = await w.device('spec-tiles-' + vp, opts);
      await spec.open(SPECT + '/');
      await spec.page.locator('#evName', {hasText: 'Synthetic'}).waitFor({timeout: T});
      await spec.page.locator('nav.tabs button', {hasText: 'Results'}).click();
      await spec.page.locator('.scores-cell .score-tile').first().waitFor({timeout: T});
      const sdims = await spec.page.evaluate(() => [...document.querySelectorAll('.score-tile')].map(t => t.getBoundingClientRect().width));
      assert.ok(sdims.every(x => Math.abs(x - sdims[0]) < 0.5), 'spectator tiles are equal too');
      await axe(spec.page, `spectator results tiles @ ${vp}`);
      await shot(spec.page, `${vp}-spectator-results`);
      await spec.page.locator('nav.tabs button', {hasText: 'Bracket'}).click();
      await spec.page.locator('.match-foot .score-tile').first().waitFor({timeout: T});
      const cdims = await spec.page.evaluate(() => [...document.querySelectorAll('.match-foot .score-tile')].map(t => { const r = t.getBoundingClientRect(); return [r.width, r.height]; }));
      assert.ok(cdims.every(([a, b]) => Math.abs(a - b) < 0.5 && Math.abs(a - cdims[0][0]) < 0.5), 'bracket cards use equal compact squares');
      const rules = await spec.page.evaluate(() => [...document.querySelectorAll('.bracket .match-foot .score-game+.score-game')].map(g => {
        const line = getComputedStyle(g, '::before'), style = getComputedStyle(g);
        return {height: parseFloat(line.height), width: parseFloat(line.width), content: line.content,
          left: parseFloat(style.marginLeft), right: parseFloat(style.paddingLeft),
          gap: parseFloat(getComputedStyle(g.parentElement).columnGap)};
      }));
      assert.ok(rules.length > 0 && rules.every(x => x.height === 14 && x.width === 1 && x.content !== 'none'),
        'championship and consolation game separators are shorter than their score squares');
      assert.ok(rules.every(x => x.left === x.right && x.left === 10 && x.gap === 0),
        'each divider has an equal 10px gap on both sides, with no inherited column gap');
      const ov = await spec.page.evaluate(() => [...document.querySelectorAll('.match')].filter(m => m.scrollWidth > m.clientWidth + 1).length);
      assert.equal(ov, 0, 'tiles never overflow a bracket card');
    }
    const after = await w.fake.local.admin(`select game_scores, player_1_id, winner_id, best_of from fftt_private.matches where event_id = $1 and status = 'complete' order by match_code`, [w.eventId]);
    assert.deepEqual(after.map(r => r.game_scores).sort(), stored.map(r => r.game_scores).sort(), 'display only: viewing never changes a recorded result');
    assert.equal(after.filter(r => r.best_of === null).length, 1, 'and the historical (unstamped) final is still unstamped');
  } finally { await w.close(); }
});

test('OVERVIEW: "How each match is scored" is the LAST section and spans the full content width, with balanced labels and dropdowns', {timeout: 400000}, async () => {
  const w = await createBrowserWorld();
  try {
    await stageTournament(w);
    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      const org = await w.device('ov-' + vp, opts);
      await org.signIn('org');
      await org.page.locator('#fmtTitle').waitFor({timeout: T});
      const g = await org.page.evaluate(() => {
        const page = document.querySelector('.overview-page'), sec = document.querySelector('.overview-formats'), card = document.querySelector('.formats-card');
        const kids = [...page.children].filter(x => x.getBoundingClientRect().height > 0);
        const rows = [...document.querySelectorAll('.format-row')].map(r => { const rr = r.getBoundingClientRect(); const sels = [...r.querySelectorAll('select')].map(s => s.getBoundingClientRect()); return {x: rr.x, y: rr.y, w: rr.width, sel: sels.map(s => [s.width, s.height]), labelW: r.querySelector('.format-name').getBoundingClientRect().width}; });
        const pr = page.getBoundingClientRect(), cr = card.getBoundingClientRect();
        return {isLast: kids[kids.length - 1] === sec, pageW: pr.width, cardW: cr.width, leftGap: cr.left - pr.left, rows, inLeftColumn: !!card.closest('.overview-main'), setupBottom: document.querySelector('.overview-settings').getBoundingClientRect().bottom, cardTop: cr.top,
          historyBottom: document.querySelector('.overview-history').getBoundingClientRect().bottom, cols: new Set(rows.map(r => Math.round(r.x))).size, overflow: document.documentElement.scrollWidth > window.innerWidth + 1};
      });
      assert.ok(g.isLast, `the formats section is the last section @ ${vp}`);
      assert.equal(g.inLeftColumn, false, 'it is no longer a card confined to the left column');
      assert.ok(g.cardW >= g.pageW - 1 && g.leftGap <= 1, `full width of the page (${g.cardW} of ${g.pageW}) @ ${vp}`);
      assert.ok(g.cardTop >= g.historyBottom - 1 && g.cardTop >= g.setupBottom, 'it sits below the event setup and the event list');
      assert.equal(g.rows.length, 5, 'all five format categories');
      if (vp === 'desktop') {
        assert.ok(g.cols >= 2, `the wide layout is used: ${g.cols} columns of format tiles`);
        assert.ok(g.rows.every(r => r.w < g.cardW * 0.62), 'no single stretched row');
      }
      assert.ok(g.rows.every(r => r.sel.length === 2 && Math.abs(r.sel[0][0] - r.sel[1][0]) < 1 && r.sel[0][1] >= 40), 'each format has two equal, comfortable dropdowns');
      assert.ok(g.rows.every(r => r.sel[0][0] >= 170), `dropdowns are wide enough to show "Games to 11" in full (${g.rows[0].sel[0][0]}px) @ ${vp}`);
      assert.equal(g.overflow, false);
      // everything preserved: locks, historical note, options, save + reset
      assert.equal(await org.page.locator('#fmt-champ-bo option[value="5"]').count(), 0);
      assert.ok(await org.page.locator('.format-row.is-locked').count() >= 2, 'locks remain (played categories)');
      assert.ok(await org.page.locator('.formats-card .notice', {hasText: 'Historical matches keep their original format'}).count() === 1, 'the historical-format explanation remains');
      assert.ok(await org.page.locator('button', {hasText: 'Save match formats'}).count() === 1 && await org.page.locator('button', {hasText: 'Use the recommended formats'}).count() === 1);
      await axe(org.page, `Overview @ ${vp}`);
      await shot(org.page, `${vp}-overview`);
    }
  } finally { await w.close(); }
});

test('NOTIFICATIONS: compact, consistently positioned, non-obstructive, announced; failures are explained once, inline', {timeout: 400000}, async () => {
  const w = await createBrowserWorld({registration: null});
  try {
    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      const org = await w.device('toast-' + vp, opts);
      await org.signIn('org');
      await org.page.locator('#evName').waitFor({timeout: T});
      await org.page.locator('button', {hasText: 'Save event setup'}).click();
      await toast(org.page, /Event saved/);
      const box = await org.page.evaluate(() => { const t = document.querySelector('#toasts .toast'), r = t.getBoundingClientRect(), c = document.getElementById('toasts'); return {top: r.top, right: window.innerWidth - r.right, left: r.left, w: r.width, h: r.height, bottom: r.bottom, fixed: getComputedStyle(c).position, role: t.getAttribute('role'), live: c.getAttribute('aria-live'), close: !!t.querySelector('button[aria-label="Dismiss notification"]'), vw: window.innerWidth, vh: window.innerHeight}; });
      assert.equal(box.fixed, 'fixed'); assert.equal(box.live, 'polite'); assert.equal(box.role, 'status'); assert.ok(box.close);
      assert.ok(box.top <= 120 && box.h <= 64, `compact (${box.h}px tall) and at the top (${box.top}px) @ ${vp}`);
      const covers = await org.page.evaluate(() => { const t = document.querySelector('#toasts .toast').getBoundingClientRect(); return [...document.querySelectorAll('#statusline .pill')].filter(p => { const r = p.getBoundingClientRect(); return r.width && !(r.right < t.left || r.left > t.right || r.bottom < t.top || r.top > t.bottom); }).length; });
      if (vp !== 'phone') assert.equal(covers, 0, `the notification never covers the status pills @ ${vp}`);
      assert.ok(box.w <= Math.max(361, box.vw - 23) && box.right >= 8 && box.left >= 8, `bounded width, inside the viewport (${box.w}px, right ${box.right}, left ${box.left}) @ ${vp}`);
      assert.ok(box.bottom < box.vh * 0.2, 'never near the bottom action bars');
      if (vp === 'phone') assert.ok(box.w >= box.vw - 28, 'a full-width strip on a phone');
      await axe(org.page, `a visible notification @ ${vp}`);
      await shot(org.page, `${vp}-toast-success`);
      // an error that needs action is shown ONCE, inline; a transient failure uses an alert-role toast that is dismissible
      await goTab(org.page, 'Players');
      await org.page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
      await org.page.locator('#regLoad').click();
      await org.page.locator('#regError').waitFor({timeout: T});
      await org.page.waitForTimeout(400);
      assert.equal(await org.page.locator('#toasts .toast').count(), 0, 'no second, redundant toast for the same registration error');
      const err = await org.page.evaluate(() => { const e = document.getElementById('regError'), r = e.getBoundingClientRect(); return {role: e.getAttribute('role'), h: r.height, w: r.width, text: e.textContent, bg: getComputedStyle(e).backgroundColor}; });
      assert.equal(err.role, 'alert');
      assert.match(err.text, /^Not configured\. No registration source is set up for this event yet\./);
      await shot(org.page, `${vp}-registration-error-inline`);
      // dedupe + cap + dismiss
      await org.page.evaluate(async () => { const {toast} = await import('/app/dom.mjs'); for (let i = 0; i < 6; i++) toast('Same message', 'bad'); toast('Different one', 'warn'); toast('Third', ''); toast('Fourth', ''); });
      assert.ok(await org.page.locator('#toasts .toast').count() <= 3, 'at most three at once');
      assert.equal(await org.page.locator('#toasts .toast', {hasText: 'Same message'}).count() <= 1, true, 'identical messages merge');
      const first = org.page.locator('#toasts .toast').first();
      await first.locator('button').click();
      assert.ok(await org.page.locator('#toasts .toast').count() <= 2, 'dismissible');
      assert.equal(await org.page.locator('#toasts .toast.bad').first().evaluate(t => t.getAttribute('role')).catch(() => 'alert'), 'alert');
      await shot(org.page, `${vp}-toast-stack`);
    }
  } finally { await w.close(); }
});

test('REGISTRATION SETTINGS (event-specific Google Sheet, fake Google): recognize, test, map, save, status wording, wrong sheet, changed columns, no leaks', {timeout: 600000}, async () => {
  const w = await createBrowserWorld({google: google()});
  try {
    const org = await w.device('settings', VIEWPORTS.desktop);
    await org.signIn('org');
    await org.page.locator('#evName').waitFor({timeout: T});
    await goTab(org.page, 'Players');
    const page = org.page;
    // 1. fictional demo data is the honest default state on this synthetic event, and loads
    await page.locator('#regSourceLine', {hasText: 'Fictional demo data'}).waitFor({timeout: T});
    await page.locator('#regLoad').click();
    await page.locator('.reg-row').first().waitFor({timeout: T});
    assert.match(await page.locator('.reg-meta').innerText(), /Fictional demo data/);
    // 2. open settings: read-only statement, the account to share with, nothing else
    await page.locator('#regSetToggle').click();
    assert.match(await page.locator('.reg-settings').first().innerText(), /Google Sheets is read-only/);
    assert.deepEqual(await page.locator('.choice-card strong').allInnerTexts(), ['Google Sheet', 'Fictional demo data'], 'live registration is the primary choice, demo is visibly secondary');
    assert.equal(await page.locator('#regSourceLine').count(), 0, 'expanded form does not repeat the current-source summary');
    await page.locator('.choice', {hasText: 'Google Sheet'}).click();
    assert.equal((await page.locator('.account-email').innerText()).trim(), FAKE_SA);
    assert.ok(await page.locator('#regEnable').isDisabled(), 'enabling is not offered on a synthetic site');
    assert.match(await page.locator('#regEnableRow').innerText(), /synthetic staging site/);
    // 3. only Google Sheets addresses are accepted: nothing is contacted for anything else
    const before = {reqs: w.requests.length, g: w.google.calls.length};
    await page.fill('#regSheet', 'https://evil.example/spreadsheets/d/' + SHEET_OK);
    await page.locator('#regCheck').click();
    await page.locator('#regSetMsg', {hasText: 'does not look like a Google Sheets link'}).waitFor();
    assert.deepEqual([w.requests.length, w.google.calls.length], [before.reqs, before.g], 'refused in the browser; nothing was sent anywhere');
    // 4. a sheet that is NOT shared with the connection account: specific, with the account to share it with
    await page.fill('#regSheet', url(SHEET_PRIVATE));
    await page.locator('#regCheck').click();
    await page.locator('#regSetMsg', {hasText: 'not shared with the connection account'}).waitFor({timeout: T});
    // 5. the real sheet shape: worksheets listed, tests run, FFTT headings recognized automatically
    await page.fill('#regSheet', url(SHEET_OK));
    await page.locator('#regCheck').click();
    await page.locator('.diag', {hasText: 'Ready to read'}).waitFor({timeout: T});
    assert.deepEqual(await page.locator('#regTab option').allInnerTexts(), [TAB, 'Notes']);
    assert.equal(await page.locator('.reg-share-help').count(), 0, 'sharing instructions disappear after verified access');
    assert.match(await page.locator('.sub-block').first().innerText(), /Column mapping/);
    const mappingSummary = page.locator('.reg-mapping-disclosure summary');
    const beforeMappingToggle = await mappingSummary.evaluate(e => {
      const mark = getComputedStyle(e, '::after');
      const status = e.querySelector('.pill').getBoundingClientRect();
      const header = e.getBoundingClientRect();
      return {open: e.parentElement.open, mark: mark.content,
        unboxed: parseFloat(mark.borderTopWidth) === 0 && mark.backgroundColor === 'rgba(0, 0, 0, 0)',
        rightGroup: header.right - status.right < 70};
    });
    assert.ok(beforeMappingToggle.unboxed && beforeMappingToggle.rightGroup,
      'plain unboxed plus/minus is grouped with recognition status at the right edge');
    assert.match(beforeMappingToggle.mark, beforeMappingToggle.open ? /−/ : /\+/, 'disclosure marks its current state');
    await mappingSummary.click();
    const afterMappingToggle = await mappingSummary.evaluate(e => ({
      open: e.parentElement.open, mark: getComputedStyle(e, '::after').content
    }));
    assert.notEqual(afterMappingToggle.open, beforeMappingToggle.open, 'summary toggles the native disclosure');
    assert.match(afterMappingToggle.mark, afterMappingToggle.open ? /−/ : /\+/, 'plus changes to minus on expansion');
    if (!afterMappingToggle.open) await mappingSummary.click();
    assert.deepEqual(await page.locator('.diag-list li').evaluateAll(els => els.map(e => e.className)), Array(6).fill('diag-pass'));
    assert.match(await page.locator('.diag').innerText(), /21 responses \(a count only; no answers were read\)/);
    assert.match(await page.locator('#map-rallies option:checked').innerText(), /^Detected: /);
    assert.match(await page.locator('.map-row', {has: page.locator('#map-name')}).innerText(), /Recognized/);
    assert.equal(await page.locator('#map-firstName').count(), 0, 'unused first name hidden when Full Name is present');
    assert.equal(await page.locator('#map-lastName').count(), 0, 'unused last name hidden when Full Name is present');
    assert.equal(await page.locator('#map-selfLevel').count(), 0, 'unprovided self-reported level hidden');
    // 6. explicit mapping choice + "not in my form"
    await idle(page);
    await page.selectOption('#map-description', '__none__');
    await page.locator('.map-row', {has: page.locator('#map-description')}).locator('.pill', {hasText: 'Not used'}).waitFor({timeout: T});
    await idle(page);
    await page.selectOption('#map-spin', {label: await page.locator('#map-spin option').nth(2).innerText()});
    await page.locator('.map-row', {has: page.locator('#map-spin')}).locator('.pill', {hasText: 'Chosen by you'}).waitFor({timeout: T}).catch(async e => { console.log('CONSOLE', w.consoleErrors.slice(-14).join('\n')); console.log('DEBUG', await page.locator('.map-row', {has: page.locator('#map-spin')}).evaluate(e => e.querySelector('select').value + ' | ' + e.querySelector('.map-state').textContent + ' | disabled=' + e.querySelector('select').disabled), await page.locator('#regSetMsg').innerText().catch(() => 'no msg'), await page.locator('.diag').innerText().catch(() => 'no diag')); throw e; });
    await idle(page);
    await page.selectOption('#map-spin', '');
    await idle(page);
    // 7. save: stored for THIS event; reading a live sheet is not allowed on this synthetic site, said plainly
    await page.locator('#regSave').click();
    await toast(page, /Registration source saved/);
    assert.match(await page.locator('.reg-settings .card-head').innerText(), /Not available on this site/);
    assert.match(await page.locator('#regEnableRow').innerText(), /synthetic staging site/);
    assert.equal(await page.locator('#regSheet').inputValue(), url(SHEET_OK));
    const saved = await w.fake.local.admin('select kind, spreadsheet_id, worksheet, column_map, enabled, status from fftt_private.registration_sources where event_id = $1', [w.eventId]);
    assert.deepEqual(saved.map(r => [r.kind, r.spreadsheet_id, r.worksheet, r.column_map, r.enabled]), [['google-sheets', SHEET_OK, TAB, {description: '(none)'}, false]]);
    assert.ok(['ready', 'needs-attention', 'untested'].includes(saved[0].status));
    await page.locator('#regCheck').click();
    await page.locator('.diag', {hasText: 'Ready to read'}).waitFor({timeout: T});
    assert.equal(await page.locator('.reg-unsaved').count(), 0, 'checking an unchanged saved sheet is not an unsaved edit');
    // 8. loading from a saved-but-off live source: ONE plain inline explanation in the shared vocabulary
    await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
    await page.locator('#regLoad').click();
    await page.locator('#regError').waitFor({timeout: T});
    await page.waitForTimeout(300);
    assert.match(await page.locator('#regError').innerText(), /Connection off\. The Google Sheet saved for this event is switched off/);
    assert.equal(await page.locator('#toasts .toast').count(), 0);
    // 9. a future form with different columns and NO assessment questions: no level is invented
    await page.fill('#regSheet', url(SHEET_NEW));
    await page.locator('#regCheck').click();
    await page.locator('.diag', {hasText: 'Found “Future form”'}).waitFor({timeout: T});
    if (!(await page.locator('.reg-mapping-disclosure').evaluate(e => e.open)))
      await page.locator('.reg-mapping-disclosure summary').click();
    assert.notEqual(await page.locator('#map-description option:checked').innerText(), 'Not in my form', 'another sheet starts with its own (automatic) mapping');
    assert.match(await page.locator('.diag').innerText(), /No playing-assessment columns were recognized, so levels will need your review/);
    assert.match(await page.locator('.map-row', {has: page.locator('#map-name')}).innerText(), /Recognized/);
    assert.match(await page.locator('.map-row', {has: page.locator('#map-rallies')}).innerText(), /Not found · you review levels/);
    // 10. switch back to the fictional demo data and load it; the status reads Fictional demo data again
    await page.locator('.choice', {hasText: 'Fictional demo data'}).click();
    await page.locator('#regSave').click();
    await toast(page, /Registration source saved/);
    await page.locator('#regLoad').click();
    await page.locator('.reg-row').first().waitFor({timeout: T});
    assert.match(await page.locator('.reg-meta').innerText(), /Fictional demo data/);
    await shot(page, 'desktop-settings-fixture');
    // 11. remove the source (confirmation), and nothing private ever reached the page
    await page.locator('#regRemove').click();
    await page.locator('dialog[open] button', {hasText: 'Remove'}).click();
    await toast(page, /Registration source removed/);
    assert.equal((await w.fake.local.admin('select count(*)::int n from fftt_private.registration_sources'))[0].n, 0);
    const html = await page.content();
    assert.ok(!/example\.invalid|555-01|734-555|PRIVATE KEY|ya29/.test(html), 'no contact detail or credential anywhere in the page');
    assert.ok(w.google.calls.every(c => c.method === 'GET' || c.path === '/token'), 'Google was only ever read');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('REGISTRATION STATES are worded distinctly: fictional, connected, not configured, unauthorized, temporarily unavailable', async () => {
  const {registrationState, STATE_TEXT} = await import('../../app/view_registration.mjs');
  const fixturePayload = {source: 'synthetic-fixture'}, sheetPayload = {source: 'google-sheets'}, csvPayload = {source: 'csv-import'};
  const labels = {
    fictional: registrationState({payload: fixturePayload}), connected: registrationState({payload: sheetPayload}), csv: registrationState({payload: csvPayload}),
    notConfigured: registrationState({code: 'not-configured'}),
    unauthorized: [registrationState({code: 'forbidden'}), registrationState({code: 'access-rejected'}), registrationState({code: 'source-unauthorized'}), registrationState({code: 'source-auth'})],
    unavailable: ['source-unavailable', 'source-busy', 'network', 'rate-limited', 'malformed', 'source-not-found', 'source-worksheet', 'source-columns'].map(code => registrationState({code})),
    off: registrationState({code: 'source-disabled'}), notHere: registrationState({code: 'not-allowed-here'}),
  };
  assert.equal(STATE_TEXT[labels.fictional].label, 'Fictional demo data');
  assert.equal(STATE_TEXT[labels.connected].label, 'Connected Google Sheet');
  assert.equal(STATE_TEXT[labels.notConfigured].label, 'Not configured');
  assert.ok(labels.unauthorized.every(x => STATE_TEXT[x].label === 'Unauthorized'));
  assert.ok(labels.unavailable.every(x => STATE_TEXT[x].label === 'Temporarily unavailable'));
  assert.equal(new Set([labels.fictional, labels.connected, labels.notConfigured, labels.unauthorized[0], labels.unavailable[0], labels.off, labels.notHere]).size, 7, 'seven distinct states');
  // before anything is loaded: derived from the saved source and the deployment
  const caps = {fixtureAvailable: true};
  assert.equal(registrationState({source: {configured: false, eventSynthetic: true}, capabilities: caps}), 'fictional');
  assert.equal(registrationState({source: {configured: false, eventSynthetic: false}, capabilities: caps}), 'not-configured', 'a real event never defaults to the fictional data');
  assert.equal(registrationState({source: {configured: true, kind: 'google-sheets', enabled: true, eventSynthetic: false}}), 'connected');
  assert.equal(registrationState({source: {configured: true, kind: 'google-sheets', enabled: false, eventSynthetic: true}}), 'not-allowed-here');
  assert.equal(registrationState({source: {configured: true, kind: 'google-sheets', enabled: false, eventSynthetic: false}}), 'disabled');
  for (const k of Object.keys(STATE_TEXT)) assert.ok(STATE_TEXT[k].label && STATE_TEXT[k].detail, k);
});
