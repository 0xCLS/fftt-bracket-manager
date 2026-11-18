/** Fictional anonymous Spectator acceptance against intercepted origins. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {fixture} from '../fixtures/tv-fixture.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const types={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.webp':'image/webp'};
test('Spectator displays public matches, brackets and scores at desktop and phone widths', {timeout:60000}, async () => {
  const browser=await chromium.launch(process.env.FFTT_CHROME_CHANNEL==='none'?{}:{channel:process.env.FFTT_CHROME_CHANNEL || 'chrome'});
  try {
    for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
      const context=await browser.newContext({viewport}); const page=await context.newPage(); const requests=[];
      await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
        if(u.hostname==='copmkalfkkrkzheohwuc.supabase.co'){requests.push(req);return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(fixture())});}
        if(u.hostname==='spectator-fixture.invalid' && /^\/(app|contracts)\//.test(u.pathname)) {const f=path.join(root,u.pathname); if(fs.existsSync(f)&&fs.statSync(f).isFile()) return route.fulfill({status:200,contentType:types[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});}
        return route.abort();});
      await page.goto('https://spectator-fixture.invalid/app/spectator.html'); await page.locator('#live',{hasText:'Live'}).waitFor();
      assert.equal(await page.locator('.board-match').count(),6);
      const metaAlignment = await page.evaluate(() => {
        const meta = document.querySelector('.spectator-now-meta');
        const left = meta?.querySelector('span:not(.spectator-now-format)');
        const format = meta?.querySelector('.spectator-now-format');
        if (!left || !format) return null;
        const l = left.getBoundingClientRect(), f = format.getBoundingClientRect();
        return {
          verticalCenterDelta: Math.abs((l.top + l.bottom) / 2 - (f.top + f.bottom) / 2),
          marginTop: getComputedStyle(format).marginTop,
          fontSizeMatch: getComputedStyle(format).fontSize === getComputedStyle(left).fontSize
        };
      });
      assert.ok(metaAlignment, 'now/next format metadata is visible');
      assert.ok(metaAlignment.verticalCenterDelta <= 1, 'Best of format is vertically centered with bracket/round metadata');
      assert.equal(metaAlignment.marginTop, '0px');
      assert.equal(metaAlignment.fontSizeMatch, true, 'match metadata uses a consistent font size');
      await page.getByRole('button',{name:'Bracket',exact:true}).click(); assert.equal(await page.locator('.bracket').count(),2);
      await page.getByRole('button',{name:'Results',exact:true}).click();
      assert.ok(await page.locator('.score-game').count()>0);
      // Real Chromium rendering checks for the Spectator-only visual refinement.
      const visual = await page.evaluate(() => {
        const list = document.querySelector('.spectator-results-list');
        const card = list?.querySelector('.spectator-result');
        const wrapper = card?.querySelector('.spectator-result-scorebox.scores-cell');
        const tiles = wrapper?.querySelectorAll('.score-tile') || [];
        const check = card?.querySelector('.spectator-result-winner-mark');
        const filled = card?.querySelector('.spectator-win-dot.earned');
        const unearned = card?.querySelector('.spectator-win-dot:not(.earned)');
        const columns = list ? getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
        const title = document.querySelector('.spectator-results-title');
        const checkStyle = check ? getComputedStyle(check) : null;
        const emptyStyle = unearned ? getComputedStyle(unearned) : null;
        return {
          columns,
          titleAlignment: title ? getComputedStyle(title).textAlign : '',
          cards: list?.querySelectorAll('.spectator-result').length || 0,
          tiles: tiles.length,
          checkWidth: check?.getBoundingClientRect().width || 0,
          checkHeight: check?.getBoundingClientRect().height || 0,
          checkBorder: checkStyle?.borderTopStyle || '',
          checkGlyph: check ? getComputedStyle(check, '::after').content : 'none',
          fillWidth: filled?.getBoundingClientRect().width || 0,
          fillHeight: filled?.getBoundingClientRect().height || 0,
          fillColor: filled ? getComputedStyle(filled).backgroundColor : '',
          emptyWidth: unearned?.getBoundingClientRect().width || 0,
          emptyBorder: emptyStyle?.borderTopStyle || '',
          emptyBackground: emptyStyle?.backgroundColor || '',
        };
      });
      assert.equal(visual.titleAlignment, 'center', 'Completed matches heading is centered');
      const topPolish = await page.evaluate(() => {
        const active = document.querySelector('#tabs button[aria-current="page"]');
        const title = document.querySelector('.spectator-results-title');
        return {
          activeTabShadow: active ? getComputedStyle(active).boxShadow : '',
          activeTabBackground: active ? getComputedStyle(active).backgroundColor : '',
          titleFontPx: title ? parseFloat(getComputedStyle(title).fontSize) : 0
        };
      });
      assert.equal(topPolish.activeTabShadow, 'none', 'selected Spectator tab has no bottom accent line');
      assert.notEqual(topPolish.activeTabBackground, 'rgba(0, 0, 0, 0)', 'selected Spectator tab retains subtle active fill');
      assert.ok(topPolish.titleFontPx >= 20 && topPolish.titleFontPx <= 24,
        'Completed matches heading uses a modestly larger font');
      assert.ok(visual.cards >= 1 && visual.tiles >= 2, 'compact Results cards retain recorded score tiles');
      assert.equal(visual.columns, viewport.width > 850 ? 2 : 1, 'Results cards use two desktop columns, one mobile column');
      assert.equal(visual.checkWidth, 16, 'winner has the smaller outlined 16px check');
      assert.equal(visual.checkHeight, 16);
      assert.equal(visual.checkBorder, 'solid');
      assert.notEqual(visual.checkGlyph, 'none', 'small check is drawn inside the outline');
      assert.equal(visual.fillWidth, viewport.width > 700 ? 21 : 18, 'earned game bar is compact');
      assert.equal(visual.fillHeight, viewport.width > 700 ? 7 : 6);
      assert.equal(visual.emptyWidth, visual.fillWidth);
      assert.equal(visual.fillColor, 'rgb(66, 184, 167)', 'earned bar uses approved teal');
      assert.equal(visual.emptyBorder, 'none', 'unearned bar has no visible border');
      assert.equal(visual.emptyBackground, 'rgb(230, 234, 238)', 'unearned bar uses a light gray solid fill');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.ok(requests.length && requests.every(r=>r.method()==='GET' && !r.headers().authorization && !r.headers().cookie));
      await context.close();
    }
  } finally {await browser.close();}
});
