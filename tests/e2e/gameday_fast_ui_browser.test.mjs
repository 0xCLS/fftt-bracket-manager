/** Focused, offline UI gate for ordinary presentation iterations.
 * Real Chromium + fictional PGlite, with all requests intercepted. NEVER hosted.
 * Full tournaments, auth, scoring, DB and publication gates run in full CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld} from './browser_world.mjs';
import {SYNTHETIC_FORM_CSV} from '../../server/registration/synthetic_fixture.mjs';
import {parseCsv} from '../../contracts/registration_model.mjs';

const SHEET = 'SYNTHETIC_FAST_UI_SHEET_0123456789abcdef';
const TAB = 'Form responses 1';
const google = () => ({
  mode: 'diagnostic',
  sheets: {[SHEET]: {title: 'Fictional visual fixture', tabs: {[TAB]: parseCsv(SYNTHETIC_FORM_CSV)}, shared: true}},
});

test('fast Players UI: safe fictional Google headings, responsive Overview layout, 32px inset rank shields, label spacing', {timeout: 150000}, async () => {
  const w = await createBrowserWorld({google: google()});
  try {
    for (const [name, viewport] of [['phone', {width: 390, height: 844}], ['desktop', {width: 1440, height: 900}]]) {
      const org = await w.device('fast-' + name, {viewport, mobile: name === 'phone'});
      await org.signIn('org');
      await org.page.locator('#evName').waitFor();
      await org.page.locator('nav.tabs button', {hasText: /^Players$/}).click();
      await org.page.locator('#addTitle').waitFor();
      assert.equal(await org.page.locator('.players-snapshot .mini-kpi').count(), 4, 'all four status tiles shown');
      assert.equal(await org.page.locator('.add-players-card').count(), 1, 'one Add players card');
      assert.equal(await org.page.locator('#addModeOne').getAttribute('aria-selected'), 'true', 'single player is default');
      await org.page.locator('#addModeBulk').click();
      assert.equal(await org.page.locator('#addModeBulk').getAttribute('aria-selected'), 'true');
      await org.page.locator('#addModeOne').click();

      const layout = await org.page.evaluate(() => {
        const b = s => document.querySelector(s).getBoundingClientRect();
        const add = b('.players-add-column'), k = b('.players-snapshot');
        const settings = b('.players-registration-config .reg-settings');
        const registrations = b('.players-page>.reg-card');
        return {add:{x:add.x,right:add.right,bottom:add.bottom},k:{x:k.x,top:k.top,bottom:k.bottom},
          settings:{left:settings.left,right:settings.right,top:settings.top,bottom:settings.bottom},
          registrations:{left:registrations.left,right:registrations.right,top:registrations.top},
          overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth};
      });
      assert.ok(layout.overflow <= 1, 'no page-level horizontal overflow at ' + name);
      assert.ok(Math.abs(layout.settings.left-layout.registrations.left)<2 &&
        Math.abs(layout.settings.right-layout.registrations.right)<2, 'registration settings span list width');
      assert.ok(layout.settings.top >= Math.max(layout.add.bottom,layout.k.bottom)-2, 'settings follow Overview-style cards');
      if (name==='desktop') assert.ok(layout.k.x >= layout.add.right-2, 'KPIs sit beside Add players');
      else assert.ok(layout.k.top >= layout.add.bottom-2, 'KPIs stack on phones');

      await org.page.locator('#regSetToggle').click();
      await org.page.locator('.choice', {hasText:'Google Sheet'}).click();
      await org.page.locator('#regSheet').fill('https://docs.google.com/spreadsheets/d/'+SHEET+'/edit');
      await org.page.locator('#regCheck').click();
      await org.page.locator('.diag-list li').first().waitFor({timeout:20000});
      // A read-only recheck of the same saved spreadsheet must not invent unsaved edits.
      await org.page.locator('#regSave').click();
      await org.page.locator('.reg-unsaved').waitFor({state:'detached',timeout:20000});
      await org.page.locator('#regCheck').click();
      await org.page.locator('#regSetBody[aria-busy="false"]').waitFor({timeout:20000});
      assert.equal(await org.page.locator('.reg-unsaved').count(),0,'same-sheet diagnostic remains clean after save');
      const gaps = await org.page.evaluate(() => ['regSheet','regTab'].map(id => {
        const input=document.getElementById(id);
        const label=document.querySelector('label[for="'+id+'"]');
        return input.getBoundingClientRect().top-label.getBoundingClientRect().bottom;
      }));
      assert.ok(gaps.every(x=>x>=2 && x<=14),'field labels are 2–14px from controls: '+gaps);
      // The configured Google source remains deliberately unreadable in this
      // fictional rehearsal event; inspect the same SVG component without
      // attempting a live registration import.
      const shields = await org.page.evaluate(async () => {
        const {levelShield} = await import('/app/view_players.mjs');
        const host=document.createElement('div');
        document.body.append(host);
        const boxes=[1,2,3,4,5].map(level=>{
          const tile=levelShield(level);
          host.append(tile);
          const svg=tile.querySelector('svg'),box=tile.getBoundingClientRect();
          return {w:box.width,h:box.height,chevrons:svg.querySelectorAll('.rank-chevron').length,
            stars:svg.querySelectorAll('.rank-star').length,
            paths:[...svg.querySelectorAll('.rank-chevron')].map(e=>e.getAttribute('d')),
            star:svg.querySelector('.rank-star')?.getAttribute('d')??''};
        });
        host.remove();
        return boxes;
      });
      assert.ok(shields.every(s=>s.w===32&&s.h===32),'badges have equal 32px square footprints');
      assert.deepEqual(shields.map(s=>s.chevrons),[1,2,3,4,0]);
      assert.deepEqual(shields.map(s=>s.stars),[0,0,0,0,1]);
      assert.ok(shields.slice(0,4).every(s=>s.paths.every(p=>p.startsWith('M14 ')&&p.includes(' L26 '))));
      assert.ok(shields[4].star.startsWith('M20 10.5 '),'star moves up slightly but stays inset from shield border');
    }
    assert.deepEqual(w.pageErrors, [], 'no JavaScript exceptions');
  } finally { await w.close(); }
});

/** The approved Level 5 star, before the 1.5-unit lift (0fa3861): the lifted star must be this exact shape moved straight up. */
const STAR_BEFORE_LIFT = 'M20 12 L22.4 18 L29 18 L23.7 22.2 L25.7 28.6 L20 24.7 L14.3 28.6 L16.3 22.2 L11 18 L17.6 18 Z';
const numbers = d => d.match(/-?\d+(?:\.\d+)?/g).map(Number);

test('Level 5 star sits exactly 1.5 units higher, centred, with the shield, colours, size and other badges untouched', {timeout: 90000}, async () => {
  const w = await createBrowserWorld();
  try {
    const org = await w.device('star');
    await org.signIn('org');
    await org.page.locator('#evName').waitFor();
    const got = await org.page.evaluate(async () => {
      const {levelShield} = await import('/app/view_players.mjs');
      const host = document.createElement('div'); document.body.append(host);
      const out = [1, 2, 3, 4, 5].map(level => {
        const tile = levelShield(level); host.append(tile);
        const svg = tile.querySelector('svg'), star = svg.querySelector('.rank-star');
        const fill = sel => svg.querySelector(sel) && getComputedStyle(svg.querySelector(sel)).fill;
        const bb = star?.getBBox();
        return {level, box: [tile.getBoundingClientRect().width, tile.getBoundingClientRect().height], viewBox: svg.getAttribute('viewBox'),
          edge: svg.querySelector('.rank-edge').getAttribute('d'), face: svg.querySelector('.rank-face').getAttribute('d'),
          chevrons: [...svg.querySelectorAll('.rank-chevron')].map(e => e.getAttribute('d')), star: star?.getAttribute('d') ?? null,
          starBox: bb && {x: bb.x, y: bb.y, w: bb.width, h: bb.height}, fills: {edge: fill('.rank-edge'), face: fill('.rank-face'), star: fill('.rank-star')}};
      });
      host.remove(); return out;
    });
    const five = got[4];
    // 1. only the star moved: same shape (every x and every segment length), every y exactly 1.5 higher
    const was = numbers(STAR_BEFORE_LIFT), now = numbers(five.star);
    assert.equal(now.length, was.length, 'same number of points');
    now.forEach((v, i) => assert.ok(Math.abs(v - (i % 2 === 0 ? was[i] : was[i] - 1.5)) < 1e-9, `coordinate ${i}: ${v}`));
    const near = (a, b) => Math.abs(a - b) < 1e-4;      // getBBox() is single precision
    assert.ok(near(five.starBox.x, 11) && near(five.starBox.w, 18) && near(five.starBox.h, 16.6) && near(five.starBox.y, 10.5),
      'star is the same size (18 × 16.6), centred on x = 20, top inset 5.5 from the face: ' + JSON.stringify(five.starBox));
    assert.ok(five.starBox.y > 5 + 4 && five.starBox.y + five.starBox.h < 35 - 4, 'star stays inside the inner face with clear margin');
    // 2. outer shield, dimensions and colours unchanged
    assert.ok(got.every(g => g.edge === 'M20 1 L39 11.5 V29 L20 39 L1 29 V11.5 Z' && g.face === 'M20 5 L35 13.5 V27 L20 35 L5 27 V13.5 Z'), 'outer shield geometry unchanged at every level');
    assert.ok(got.every(g => g.box[0] === 32 && g.box[1] === 32 && g.viewBox === '0 0 40 40'), '32px badges on the same 40-unit canvas');
    assert.deepEqual(five.fills, {edge: 'rgb(103, 85, 124)', face: 'rgb(137, 114, 160)', star: 'rgb(255, 255, 255)'}, 'purple shield and white star colours unchanged');
    // 3. the other four badges are untouched (chevron rows exactly as before)
    const rows = {1: [19], 2: [16.8, 22], 3: [14.2, 19.2, 24.2], 4: [11.8, 16.8, 21.8, 26.8]};
    for (const g of got.slice(0, 4)) {
      assert.deepEqual(g.chevrons, rows[g.level].map(y => `M14 ${y} L20 ${+(y + 2.2).toFixed(1)} L26 ${y}`), `Level ${g.level} chevrons unchanged`);
      assert.equal(g.star, null);
    }
    assert.deepEqual(five.chevrons, []);
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('registration Edit/Close and level choice: no page jump, focus stays on the control used, unsaved edits survive, other rows are not rebuilt', {timeout: 240000}, async () => {
  const w = await createBrowserWorld();
  try {
    for (const [name, viewport, mobile] of [['phone', {width: 390, height: 844}, true], ['desktop', {width: 1440, height: 900}, false]]) {
      const org = await w.device('edit-' + name, {viewport, mobile});
      await org.signIn('org');
      await org.page.locator('#evName').waitFor();
      await org.page.locator('nav.tabs button', {hasText: /^Players$/}).click();
      await org.page.locator('#regLoad').click();
      await org.page.locator('.reg-row').nth(9).waitFor({timeout: 20000});
      const page = org.page;
      const ref = await page.locator('.reg-row').nth(6).getAttribute('data-ref');
      const rowSel = `.reg-row[data-ref="${ref}"]`;
      const toggle = page.locator(`${rowSel} .reg-actions .ghost`);
      const selectSel = `${rowSel} .reg-edit select`, toggleSel = `${rowSel} .reg-actions .ghost`;
      const state = (ctl = toggleSel) => page.evaluate(([sel, ctl]) => {
        const r = document.querySelector(sel), a = document.activeElement;
        return {y: scrollY, top: r.getBoundingClientRect().top, ctlTop: document.querySelector(ctl)?.getBoundingClientRect().top ?? null, focusId: a.id, focusIsToggle: a === r.querySelector('.reg-actions .ghost'),
          expanded: r.querySelector('.reg-actions .ghost').getAttribute('aria-expanded'), toggleText: r.querySelector('.reg-actions .ghost').textContent,
          untouched: [...document.querySelectorAll('.reg-row')].filter(x => x.dataset.ref !== sel.match(/"(.+)"/)[1]).every(x => x.__kept === true)};
      }, [rowSel, ctl]);
      // "no jump" = the control the person is using does not move on screen (the row's own header may legitimately grow a line)
      const steady = (a, b, what) => { assert.ok(Math.abs(a.ctlTop - b.ctlTop) <= 2, `${what}: control ${a.ctlTop}→${b.ctlTop} (page ${a.y}→${b.y}) (${name})`); };

      // the row being edited sits mid-screen, then low on the screen (the editor opens below the fold)
      for (const where of [0.45, 0.8]) {
        await page.evaluate(([sel, f]) => { const r = document.querySelector(sel); window.scrollBy(0, r.getBoundingClientRect().top - innerHeight * f); }, [rowSel, where]);
        await page.evaluate(() => document.querySelectorAll('.reg-row').forEach(x => { x.__kept = true; }));
        const before = await state();
        // open: keyboard (focus the toggle, press Enter), as a keyboard user would
        await toggle.focus(); const focused = await state();
        await page.keyboard.press('Enter');
        let s = await state();
        assert.equal(s.expanded, 'true'); assert.equal(s.toggleText, 'Close'); assert.ok(s.focusIsToggle, `focus stays on the toggle after opening (${name}, ${where})`);
        steady(focused, s, 'opening the editor');
        assert.ok(Math.abs(focused.y - s.y) <= 2 && Math.abs(focused.top - s.top) <= 2, `opening an editor does not scroll the page: ${focused.y}→${s.y}`);
        assert.ok(s.untouched, 'opening an editor does not rebuild the other rows');
        assert.equal(await page.locator(`${rowSel} .reg-edit`).count(), 1);
        assert.equal(await page.locator('.reg-edit').count(), 1, 'one editor open');
        // choose a level with the keyboard-focused select, after typing a name: both unsaved edits must survive
        await page.locator(`${rowSel} .reg-edit input`).fill('Typed Name');
        await page.locator(`${rowSel} .reg-edit input`).evaluate(el => el.setSelectionRange(3, 3));
        await page.locator(`${rowSel} .reg-edit select`).focus();        // (a keyboard user tabbing here scrolls it into view: measure after that)
        const beforeLevel = await state(selectSel);
        await page.locator(`${rowSel} .reg-edit select`).selectOption('4');
        s = await state(selectSel);
        assert.ok(s.focusId.endsWith('-lv'), `the level select keeps focus after choosing (${name}, ${where}): ${s.focusId}`);
        steady(beforeLevel, s, 'choosing a level');
        assert.ok(s.untouched, 'choosing a level does not rebuild the other rows');
        assert.equal(await page.locator(`${rowSel} .reg-edit select`).inputValue(), '4');
        assert.equal(await page.locator(`${rowSel} .reg-edit input`).inputValue(), 'Typed Name', 'a typed name survives a level choice');
        assert.match(await page.locator(`${rowSel} .reg-level-text`).innerText(), /Level 4.*Your choice/s);
        // the name field keeps its caret when it is the focused control and the row is repainted
        await page.locator(`${rowSel} .reg-edit input`).focus();
        await page.locator(`${rowSel} .reg-edit input`).evaluate(el => el.setSelectionRange(2, 5));
        await page.locator(`${rowSel} .reg-edit select`).evaluate(el => { el.value = '3'; el.dispatchEvent(new Event('change', {bubbles: true})); });
        s = await state();
        assert.ok(s.focusId.endsWith('-lv') || s.focusId.startsWith('rn-'), 'focus remains inside the editor');
        await page.locator(`${rowSel} .reg-edit select`).selectOption('4');
        // an app-wide re-render (reload) while the editor is open keeps the editor, the edits, the focus and the position
        await page.locator(`${rowSel} .reg-edit select`).focus();
        const beforeReload = await state(selectSel);
        await page.evaluate(() => document.getElementById('regLoad').click());
        await page.locator('#regLoad[aria-busy="false"]').waitFor({timeout: 20000});
        await page.waitForTimeout(400);
        s = await state(selectSel);
        steady(beforeReload, s, 're-render with the editor open');
        assert.ok(s.focusId.endsWith('-lv'), 'focus survives a full re-render');
        assert.equal(await page.locator(`${rowSel} .reg-edit input`).inputValue(), 'Typed Name');
        await page.evaluate(() => document.querySelectorAll('.reg-row').forEach(x => { x.__kept = true; }));
        // close with the keyboard (Space on the focused toggle)
        await toggle.focus(); const beforeClose = await state();
        await page.keyboard.press('Space');
        s = await state();
        assert.equal(s.expanded, 'false'); assert.equal(s.toggleText, 'Edit'); assert.ok(s.focusIsToggle, 'focus stays on the toggle after closing');
        steady(beforeClose, s, 'closing the editor');
        assert.ok(s.untouched, 'closing an editor does not rebuild the other rows');
        assert.equal(await page.locator(`${rowSel} .reg-edit`).count(), 0);
        // the preview is kept: reopening shows the same name and level; the row shows the edited name
        await page.keyboard.press('Enter');
        assert.equal(await page.locator(`${rowSel} .reg-edit input`).inputValue(), 'Typed Name', 'unsaved name preserved after Close');
        assert.equal(await page.locator(`${rowSel} .reg-edit select`).inputValue(), '4', 'unsaved level preserved after Close');
        await page.keyboard.press('Enter');
        // reset for the next position
        await page.evaluate(ref => { /* leave the edit in place: it is a preview only */ void ref; }, ref);
        assert.ok(before);
      }
      // nothing was ever written to the sheet or the roster by browsing and editing
      assert.equal((await w.fake.local.admin('select count(*)::int as n from fftt_private.players where event_id = $1', [w.eventId]))[0].n, 0, 'no roster change from editing previews');
      // the check-in workflow still uses the unsaved edit
      await page.locator(`${rowSel} .reg-actions .primary`).click();
      await page.locator('#toasts .toast', {hasText: /Typed Name checked in/}).waitFor({timeout: 20000});
      const stored = await w.fake.local.admin("select display_name, rating, rating_confirmed from fftt_private.players where display_name = 'Typed Name' and event_id = $1", [w.eventId]);
      assert.deepEqual(stored, [{display_name: 'Typed Name', rating: 4, rating_confirmed: true}], 'the edited name and level are what is checked in');
      await w.fake.local.admin('delete from fftt_private.players where event_id = $1', [w.eventId]);
    }
    assert.deepEqual(w.pageErrors, [], 'no JavaScript exceptions');
  } finally { await w.close(); }
});
