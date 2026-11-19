/** Fictional anonymous Spectator acceptance against intercepted origins. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {fixture} from '../fixtures/tv-fixture.mjs';
import {completedFixture} from './public_presentation_fixtures.mjs';
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

const specHost='https://spectator-fixture.invalid', specProject='https://copmkalfkkrkzheohwuc.supabase.co';
async function specWorld(data, viewport) {
  const browser=await chromium.launch(process.env.FFTT_CHROME_CHANNEL==='none'?{}:{channel:process.env.FFTT_CHROME_CHANNEL || 'chrome'});
  const context=await browser.newContext({viewport}), page=await context.newPage(), requests=[];
  await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
    if(u.origin===specProject){requests.push(req);return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(data)});}
    if(u.origin===specHost && u.pathname==='/app/__test_axe.min.js') return route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(path.join(root,'tests/e2e/node_modules/axe-core/axe.min.js'))});
    if(u.origin===specHost && /^\/(app|contracts)\//.test(u.pathname)){const f=path.join(root,u.pathname); if(fs.existsSync(f)&&fs.statSync(f).isFile()) return route.fulfill({status:200,contentType:types[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});}
    return route.abort();});
  await page.goto(`${specHost}/app/spectator.html`); await page.locator('#live',{hasText:'Live'}).waitFor();
  return {browser,page,requests};
}
const shoot = async (page, locator, name) => { if (process.env.TV_SCREENSHOTS) { fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true}); await (locator||page).screenshot({path:path.join(process.env.TV_SCREENSHOTS,name)}); } };
const noHorizontalScroll = page => page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

test('Spectator winners summary: three balanced desktop columns, stacked mobile, grouped Doubles teams', {timeout:90000}, async () => {
  for (const [width,height,columns] of [[1440,900,3],[1024,768,3],[768,1024,3],[390,844,1],[320,700,1]]) {
    const w=await specWorld(completedFixture(),{width,height}), {page}=w;
    try {
      await page.getByRole('button',{name:'Results',exact:true}).click();
      const banner=page.locator('.spectator-winners-banner');
      assert.equal(await banner.count(),1);
      assert.equal(await banner.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(247, 233, 155)','existing pale-yellow palette retained');
      assert.deepEqual(await page.locator('.spectator-award-heading').allInnerTexts(),['Championship','Consolation','Mixed-Skill Doubles']);
      const labels=await page.locator('.spectator-award-column').evaluateAll(cs=>cs.map(c=>[...c.querySelectorAll('.spectator-award-role')].map(r=>r.textContent)));
      assert.deepEqual(labels,[['Champion','Runner-up'],['Champion','Runner-up'],['Winners','Runners-up']]);
      const layout=await page.evaluate(()=>{const cs=[...document.querySelectorAll('.spectator-award-column')].map(c=>c.getBoundingClientRect()); return {tops:cs.map(c=>Math.round(c.top)), lefts:cs.map(c=>Math.round(c.left)), widths:cs.map(c=>Math.round(c.width)), gridColumns:getComputedStyle(document.querySelector('.spectator-winners-grid')).gridTemplateColumns.split(' ').length};});
      assert.equal(layout.gridColumns,columns,`${width}px column count`);
      if (columns===3) { assert.ok(layout.tops.every(t=>Math.abs(t-layout.tops[0])<=1),'columns share one top edge'); assert.ok(Math.max(...layout.widths)-Math.min(...layout.widths)<=2,'balanced widths: '+layout.widths); }
      else { assert.ok(layout.tops[0]<layout.tops[1] && layout.tops[1]<layout.tops[2],'categories stack vertically'); assert.ok(layout.lefts.every(l=>l===layout.lefts[0])); }
      // Medals: trophy for Championship first place, custom metallic discs elsewhere, one fixed medal column per category.
      assert.equal(await page.locator('.spectator-award-column.championship .spectator-award-trophy').count(),1);
      assert.equal(await page.locator('.spectator-award-column.championship .spectator-award-disc.silver').count(),1);
      assert.equal(await page.locator('.spectator-award-column.consolation .spectator-award-disc.gold').count(),1);
      assert.equal(await page.locator('.spectator-award-column.doubles .spectator-award-disc.gold').count(),2);
      assert.equal(await page.locator('.spectator-award-column.doubles .spectator-award-disc.silver').count(),2);
      const medalX=await page.evaluate(()=>[...document.querySelectorAll('.spectator-award-column')].map(c=>{const base=c.getBoundingClientRect().left+parseFloat(getComputedStyle(c).paddingLeft); return [...c.querySelectorAll('.spectator-award-member > :first-child')].map(m=>{const r=m.getBoundingClientRect(); return Math.round((r.left+r.right)/2-base);});}));
      assert.ok(medalX.every(col=>col.every(x=>Math.abs(x-col[0])<=1)),'medals align in one column per category: '+JSON.stringify(medalX));
      assert.ok(Math.max(...medalX.flat())-Math.min(...medalX.flat())<=1,'the medal column is identical in every category: '+JSON.stringify(medalX));
      // Each Doubles team stays together: two players in one list under one label.
      const teams=await page.locator('.spectator-award-column.doubles .spectator-award-group').evaluateAll(gs=>gs.map(g=>({role:g.querySelector('.spectator-award-role').textContent,names:[...g.querySelectorAll('.spectator-award-person')].map(n=>n.textContent)})));
      assert.deepEqual(teams,[{role:'Winners',names:['Taylor Smith','Jamie Lee']},{role:'Runners-up',names:['Morgan James','Riley Quinn']}]);
      assert.equal(await noHorizontalScroll(page),true,`no horizontal scroll at ${width}px`);
      await shoot(page,banner,`awards-summary-${width}.png`);
    } finally {await w.browser.close();}
  }
});

test('Spectator winners summary handles long names, partial results, accessibility and privacy', {timeout:90000}, async () => {
  const w=await specWorld(completedFixture({long:true}),{width:320,height:700}), {page}=w;
  try {
    await page.getByRole('button',{name:'Results',exact:true}).click();
    const clipped=await page.evaluate(()=>[...document.querySelectorAll('.spectator-winners-banner *')].filter(e=>{const r=e.getBoundingClientRect(), b=document.querySelector('.spectator-winners-banner').getBoundingClientRect(); return r.width && (r.right>b.right+1||r.left<b.left-1);}).map(e=>e.className));
    assert.deepEqual(clipped,[],'long names wrap inside the panel at 320px');
    assert.equal(await noHorizontalScroll(page),true);
    await page.addScriptTag({url:`${specHost}/app/__test_axe.min.js`});
    const report=await page.evaluate(async()=>window.axe.run(document.querySelector('.spectator-winners-banner'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
    assert.deepEqual(report.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})),[],'winners summary has no WCAG A/AA violations (including contrast)');
    assert.deepEqual(await page.locator('.spectator-winners-banner h2, .spectator-winners-banner h3').evaluateAll(hs=>hs.map(h=>h.textContent)),['Tournament winners','Championship','Consolation','Mixed-Skill Doubles']);
    assert.doesNotMatch(await page.locator('.spectator-winners-banner').innerText(),/rating|level\s*\d|@|email|phone/i);
    assert.ok(w.requests.length && w.requests.every(r=>r.method()==='GET' && !r.headers().authorization && !r.headers().cookie));
    await shoot(page,page.locator('.spectator-winners-banner'),'awards-summary-long-names-320.png');
  } finally {await w.browser.close();}
  // No Doubles finale: two categories fill the row rather than leaving an empty third column.
  const two=await specWorld(completedFixture({doubles:null}),{width:1440,height:900});
  try {
    await two.page.getByRole('button',{name:'Results',exact:true}).click();
    assert.deepEqual(await two.page.locator('.spectator-award-heading').allInnerTexts(),['Championship','Consolation']);
    assert.equal(await two.page.locator('.spectator-winners-grid').evaluate(g=>getComputedStyle(g).gridTemplateColumns.split(' ').length),2);
  } finally {await two.browser.close();}
  // The Bracket tab stays on the Spectator website.
  const keep=await specWorld(completedFixture(),{width:1440,height:900});
  try { assert.equal(await keep.page.getByRole('button',{name:'Bracket',exact:true}).count(),1); await keep.page.getByRole('button',{name:'Bracket',exact:true}).click(); assert.equal(await keep.page.locator('.bracket').count(),2); }
  finally {await keep.browser.close();}
});

test('Mixed-Skill Doubles finale card: stacked teams, subtle format note until the official result', {timeout:90000}, async () => {
  for (const [width,height] of [[1440,900],[390,844],[320,700]]) {
    const before=await specWorld(completedFixture({doubles:'pending'}),{width,height});
    try {
      const card=before.page.locator('.spectator-finale');
      assert.equal(await card.count(),1);
      const note=card.locator('.spectator-finale-format');
      assert.equal(await note.innerText(),'Single game to 21');
      const rows=await before.page.evaluate(()=>{const h=document.querySelector('.spectator-finale h2').getBoundingClientRect(), n=document.querySelector('.spectator-finale-format').getBoundingClientRect(), m=parseFloat(getComputedStyle(document.querySelector('.spectator-finale h2')).fontSize), f=parseFloat(getComputedStyle(document.querySelector('.spectator-finale-format')).fontSize); return {nearHeading:n.top-h.bottom<24 && n.top>=h.top-4, smaller:f<m, muted:getComputedStyle(document.querySelector('.spectator-finale-format')).color};});
      assert.equal(rows.nearHeading,true,'format note sits with the heading'); assert.equal(rows.smaller,true,'format note is subtle');
      assert.equal(await card.locator('.spectator-award-disc, .spectator-award-trophy').count(),0,'no medals before the result');
      assert.match(await card.innerText(),/Coming up after the championship final/);
      const teams=await card.locator('.spectator-finale-team').evaluateAll(ts=>ts.map(t=>({label:t.querySelector('b').textContent,names:[...t.querySelectorAll('.spectator-finale-name')].map(n=>n.textContent),xs:[...t.querySelectorAll('.spectator-finale-name')].map(n=>Math.round(n.getBoundingClientRect().left)),ys:[...t.querySelectorAll('.spectator-finale-name')].map(n=>Math.round(n.getBoundingClientRect().top))})));
      assert.deepEqual(teams.map(t=>[t.label,t.names]),[['Team A',['Taylor Smith','Jamie Lee']],['Team B',['Morgan James','Riley Quinn']]]);
      assert.ok(teams.every(t=>t.xs[0]===t.xs[1] && t.ys[0]<t.ys[1]),'each team stacks its partners consistently');
      assert.equal(await noHorizontalScroll(before.page),true,`no horizontal scroll at ${width}px (before)`);
      await shoot(before.page,card,`doubles-card-before-${width}.png`);
    } finally {await before.browser.close();}
    const after=await specWorld(completedFixture(),{width,height});
    try {
      const card=after.page.locator('.spectator-finale');
      assert.equal(await card.locator('.spectator-finale-format').count(),0,'format label hidden after official completion');
      assert.doesNotMatch(await card.innerText(),/Single game|Best of/);
      assert.match(await card.innerText(),/Winners: Taylor Smith \+ Jamie Lee/);
      assert.equal(await card.locator('.score-tile').count(),2,'official score retained');
      assert.equal(await card.locator('.spectator-award-disc.gold').count(),2);
      assert.equal(await card.locator('.spectator-award-disc.silver').count(),2);
      assert.equal(await card.locator('.spectator-finale-team.is-winner').count(),1,'winning team identified');
      assert.equal(await noHorizontalScroll(after.page),true,`no horizontal scroll at ${width}px (after)`);
      await shoot(after.page,card,`doubles-card-after-${width}.png`);
    } finally {await after.browser.close();}
  }
  // Long names remain grouped and inside the card at 320px.
  const long=await specWorld(completedFixture({long:true,doubles:'pending'}),{width:320,height:700});
  try {
    const out=await long.page.evaluate(()=>{const c=document.querySelector('.spectator-finale').getBoundingClientRect(); return [...document.querySelectorAll('.spectator-finale *')].filter(e=>{const r=e.getBoundingClientRect(); return r.width&&(r.right>c.right+1||r.left<c.left-1);}).length;});
    assert.equal(out,0);
  } finally {await long.browser.close();}
});

test('Doubles finale polish: fill-only panels with clear gaps, original trophy and flat discs, accessible labels', {timeout:120000}, async () => {
  for (const [width,height] of [[1440,900],[768,1024],[390,844],[320,700]]) {
    const w=await specWorld(completedFixture({long:width<=390}),{width,height}), {page}=w;
    try {
      const m=await page.evaluate(() => {
        const box = e => { const r=e.getBoundingClientRect(); return {t:r.top,b:r.bottom,l:r.left,r:r.right,h:r.height}; };
        const teams=[...document.querySelectorAll('.spectator-finale-team')], notice=document.querySelector('.spectator-finale > .notice');
        const bw = e => ['Top','Right','Bottom','Left'].map(s=>parseFloat(getComputedStyle(e)['border'+s+'Width']));
        const tb=teams.map(box), nb=box(notice);
        return {teamBorders:teams.map(bw), noticeBorder:bw(notice), radii:teams.concat([notice]).map(e=>parseFloat(getComputedStyle(e).borderTopLeftRadius)),
          bgs:teams.map(e=>getComputedStyle(e).backgroundColor), noticeBg:getComputedStyle(notice).backgroundColor,
          sideBySide:Math.abs(tb[0].t-tb[1].t)<2, heightDelta:Math.abs(tb[0].h-tb[1].h), colGap: tb[0].t===tb[1].t ? tb[1].l-tb[0].r : null,
          rowGap:nb.t-Math.max(...tb.map(x=>x.b)), padding:teams.map(e=>[getComputedStyle(e).paddingTop,getComputedStyle(e).paddingLeft]),
          memberRows:[...document.querySelectorAll('.spectator-finale-member')].map(r=>{const n=r.querySelector('.spectator-finale-name').getBoundingClientRect(), d=r.querySelector('.spectator-award-disc').getBoundingClientRect(); return {centerDelta:Math.abs((n.top+n.bottom)/2-(d.top+d.bottom)/2)<=14, right:d.right, rowRight:r.getBoundingClientRect().right};}),
          overflow:document.documentElement.scrollWidth-innerWidth};
      });
      assert.ok(m.teamBorders.every(b=>b.every(x=>x===0)),'no border on either team panel (including the winner): '+JSON.stringify(m.teamBorders));
      assert.deepEqual(m.noticeBorder,[0,0,0,0],'no border on the result panel');
      assert.ok(m.radii.every(r=>r>=8),'rounded corners kept');
      assert.deepEqual(m.bgs,['rgb(209, 239, 245)','rgb(233, 215, 243)'],'existing pastel blue and purple fills'); assert.notEqual(m.noticeBg,'rgba(0, 0, 0, 0)');
      assert.ok(m.rowGap>=10,`clear gap between team panels and result panel (${m.rowGap}px)`);
      if (width>=768) { assert.equal(m.sideBySide,true,'two-column desktop/tablet'); assert.ok(m.colGap>=10,'gap between team panels'); assert.ok(m.heightDelta<=1,'balanced panel heights'); }
      else assert.equal(m.sideBySide,false,'stacked on mobile');
      assert.ok(m.padding.every(p=>parseFloat(p[0])>=14 && parseFloat(p[1])>=14),'consistent internal padding');
      assert.ok(m.memberRows.every(r=>r.centerDelta && Math.abs(r.right-r.rowRight)<=1),'award icons align at the right edge of each player row');
      assert.equal(m.overflow,0,`no horizontal overflow at ${width}px`);
    } finally {await w.browser.close();}
  }
  // Before the result: panels remain borderless and the green panel is absent.
  const before=await specWorld(completedFixture({doubles:'pending'}),{width:1440,height:900});
  try {
    assert.equal(await before.page.locator('.spectator-finale > .notice').count(),0);
    assert.deepEqual(await before.page.locator('.spectator-finale-team').evaluateAll(t=>t.map(e=>getComputedStyle(e).borderTopWidth)),['0px','0px']);
  } finally {await before.browser.close();}
  // Flat award icons, same family everywhere, with accessible labels.
  const w=await specWorld(completedFixture(),{width:1440,height:900}), {page}=w;
  try {
    await page.getByRole('button',{name:'Results',exact:true}).click();
    const icons=await page.evaluate(() => {
      const cs=e=>getComputedStyle(e), trophy=document.querySelector('.spectator-award-trophy');
      return {
        trophyIsSvg:!!trophy.querySelector('svg'), trophyText:trophy.textContent.trim(),
        trophyLabel:trophy.getAttribute('aria-label'), trophyRole:trophy.getAttribute('role'),
        discs:[...document.querySelectorAll('.spectator-award-disc')].map(d=>({cls:d.className,label:d.getAttribute('aria-label'),text:d.textContent,bgImage:cs(d).backgroundImage,shadow:cs(d).boxShadow,radius:cs(d).borderTopLeftRadius,w:d.getBoundingClientRect().width,h:d.getBoundingClientRect().height,bg:cs(d).backgroundColor})),
      };
    });
    assert.equal(icons.trophyIsSvg,false,'original trophy is not a vector'); assert.equal(icons.trophyText,'🏆','original trophy emoji restored');
    assert.equal(icons.trophyLabel,'Champion, first place'); assert.equal(icons.trophyRole,'img');
    assert.ok(icons.discs.length>=6);
    for (const d of icons.discs) {
      assert.equal(d.bgImage,'none','flat disc: no gradient'); assert.equal(d.shadow,'none','flat disc: no shadow or inset highlight');
      assert.equal(d.radius,'50%'); assert.equal(d.w,22); assert.equal(d.h,22);
      assert.ok(d.cls.includes('gold') ? d.bg==='rgb(241, 191, 46)' && d.label==='Gold medal, first place' && d.text==='1' : d.bg==='rgb(205, 212, 220)' && d.label==='Silver medal, runner-up' && d.text==='2');
    }
    // The same icon family appears in the winners summary, the finale, completed results and the bracket.
    await page.getByRole('button',{name:'Now & next',exact:true}).click();
    assert.equal(await page.locator('.spectator-finale .spectator-award-disc').count(),4);
    assert.equal(await page.locator('.spectator-finale .spectator-award-disc[aria-label]').count(),4);
    await page.getByRole('button',{name:'Bracket',exact:true}).click();
    assert.ok(await page.locator('.spectator-bracket .spectator-award-trophy').count()>=1,'bracket champion uses the original trophy');
    assert.ok(await page.locator('.spectator-bracket .spectator-award-disc').count()>=1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('button',{name:'Results',exact:true}).click();
    assert.ok(await page.locator('.spectator-result .spectator-award-trophy').count()>=1,'completed-match results use the original trophy');
    await page.addScriptTag({url:`${specHost}/app/__test_axe.min.js`});
    for (const sel of ['.spectator-winners-banner','.spectator-results-list']) {
      const report=await page.evaluate(async s=>window.axe.run(document.querySelector(s),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}),sel);
      assert.deepEqual(report.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],`no WCAG A/AA violations in ${sel}`);
    }
    await page.getByRole('button',{name:'Now & next',exact:true}).click();
    const finale=await page.evaluate(async()=>window.axe.run(document.querySelector('.spectator-finale'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
    assert.deepEqual(finale.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],'finale card has no WCAG A/AA violations');
    assert.ok(w.requests.length && w.requests.every(r=>r.method()==='GET' && !r.headers().authorization && !r.headers().cookie));
    assert.doesNotMatch(await page.locator('body').innerText(),/rating|level\s*\d|@/i,'privacy: no ratings or contact data');
  } finally {await w.browser.close();}
});
