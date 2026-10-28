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
      const gaps = await org.page.evaluate(() => ['regSheet','regTab'].map(id => {
        const input=document.getElementById(id);
        const label=document.querySelector('label[for="'+id+'"]');
        return input.getBoundingClientRect().top-label.getBoundingClientRect().bottom;
      }));
      assert.ok(gaps.every(x=>x>=2 && x<=14),'field labels are 2–14px from controls: '+gaps);
      await org.page.locator('#regLoad').click();
      await org.page.locator('.reg-row').first().waitFor({timeout:20000});
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
      assert.ok(shields[4].star.startsWith('M20 12 '),'star stays inset from shield border');
    }
    assert.deepEqual(w.pageErrors, [], 'no JavaScript exceptions');
  } finally { await w.close(); }
});
