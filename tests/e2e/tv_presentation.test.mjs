/** Anonymous TV presentation against fictional allowlisted data; no live server or tournament data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {fixture, largeFixture} from '../fixtures/tv-fixture.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const host = 'https://tv-fixture.invalid';
const project = 'https://copmkalfkkrkzheohwuc.supabase.co';
const types = {'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.webp':'image/webp'};
async function world(data = fixture(), viewport = {width:1920,height:1080}) {
  const channel = process.env.FFTT_CHROME_CHANNEL || 'chrome';
  const browser = await chromium.launch(channel === 'none' ? {} : {channel});
  const context = await browser.newContext({viewport});
  const page = await context.newPage();
  const requests = []; let mode = 'ok';
  await page.clock.install({time: new Date('2026-11-07T12:00:00Z')});
  await context.route('**/*', async route => {
    const req=route.request(), url=new URL(req.url()); requests.push({url:req.url(), method:req.method(), headers:req.headers()});
    if (url.origin === project) {
      if (mode === 'offline') return route.abort('internetdisconnected');
      const body = mode === 'invalid' ? [{...data[0], email:'private@example.invalid'}] : data;
      return route.fulfill({status:200, headers:{'access-control-allow-origin':'*'}, contentType:'application/json', body:JSON.stringify(body)});
    }
    // Axe is served only inside this fictional same-origin harness, honoring TV CSP.
    if (url.origin === host && url.pathname === '/app/__test_axe.min.js') {
      return route.fulfill({status:200,contentType:'text/javascript',
        body:fs.readFileSync(path.join(root,'tests/e2e/node_modules/axe-core/axe.min.js'))});
    }
    if (url.origin === host && /^\/(app|contracts)\//.test(url.pathname)) {
      const file=path.join(root,url.pathname); if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({status:200,contentType:types[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
    }
    return route.abort();
  });
  await page.goto(`${host}/app/tv.html`);
  await page.locator('#live.current').waitFor();
  return {browser,context,page,requests,setMode: x => {mode=x;}, async close(){await browser.close();}};
}
const label = page => page.locator('#screenLabel').innerText();
const text = page => page.locator('main').innerText();
async function fits(page) {
  return page.evaluate(() => [...document.querySelectorAll('main, main *')].filter(el => {
    const r=el.getBoundingClientRect(), main=document.querySelector('main').getBoundingClientRect();
    return r.width && r.height && (r.left < main.left - 2 || r.right > main.right + 2 || r.top < main.top - 2 || r.bottom > main.bottom + 2 || (['hidden','clip'].includes(getComputedStyle(el).overflow) && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)));
  }).map(el => `${el.className}: ${el.textContent.slice(0,60)}`));
}
test('TV modes, scores, controls, rotation and read-only public requests', {timeout:60000}, async () => {
  const w=await world(); const {page}=w;
  try {
    assert.equal(await page.locator('#demoBadge').isHidden(),true);
    assert.equal(await page.locator('.table-card.active').count(),2);
    assert.match(await page.locator('.table-card.active').first().innerText(), /Best of 3 · to 11/);
    assert.equal(await page.locator('.next-card').count(),4);
    assert.match(await text(page), /Alexandria Montgomery-Fitzgerald/);
    assert.equal(await page.locator('.score-pending').count(),2);
    assert.deepEqual(await page.locator('.score-pending').allInnerTexts(), ['Game scores pending', 'Game scores pending']);
    assert.doesNotMatch(await page.locator('.table-grid').innerText(),/11[–-]7|1\s*[–:]\s*1/);
    assert.deepEqual(await fits(page), []);
    await page.keyboard.press('ArrowRight'); assert.equal(await label(page),'COMPLETED RESULTS');
    assert.match(await text(page),/2–1/); assert.match(await text(page),/G1 11–7.*G2 8–11.*G3 11–9/);
    await page.keyboard.press('3'); assert.equal(await label(page),'CHAMPIONSHIP BRACKET'); assert.equal(await page.locator('.bracket-vs').count(),0,'undecided final has no VS'); assert.ok(await page.locator('.bracket-connectors path').count() > 0); assert.ok(await page.locator('.bracket-state', {hasText:'COMPLETED'}).count() > 0); assert.equal(await page.locator('.bracket-state', {hasText:'FINAL'}).count(),0);
    await page.keyboard.press('4'); assert.equal(await label(page),'CONSOLATION BRACKET'); assert.equal(await page.locator('.single-match .bracket-match').count(),1); assert.equal(await page.locator('.bracket-vs').count(),1,'known finalists are separated by VS');
    assert.ok((await page.locator('.single-match .bracket-match').boundingBox()).height >= 300, 'single-match bracket uses a readable featured-card layout');
    await page.keyboard.press('ArrowLeft'); assert.equal(await label(page),'CHAMPIONSHIP BRACKET');
    await page.keyboard.press('Space'); await page.clock.fastForward(35000); assert.equal(await label(page),'CHAMPIONSHIP BRACKET');
    await page.keyboard.press('1'); await page.keyboard.press('Space'); await page.clock.fastForward(30000); assert.equal(await label(page),'COMPLETED RESULTS');
    const publicRequests=w.requests.filter(r=>r.url.startsWith(project)); assert.ok(publicRequests.length);
    assert.ok(publicRequests.every(r=>r.method==='GET' && !r.headers.authorization && !r.headers.cookie && new URL(r.url).pathname==='/rest/v1/fftt_public_tournament_v1'));
  } finally {await w.close();}
});
test('empty tables and missing modes, invalid response, stale and expired data recover', {timeout:60000}, async () => {
  const f=fixture(); f[0].brackets=[]; const w=await world(f); const {page}=w;
  try {
    assert.equal(await page.locator('.empty-table').count(),2);
    await page.keyboard.press('2'); assert.equal(await label(page),'MATCH CENTER');
    await page.keyboard.press('3'); assert.equal(await label(page),'MATCH CENTER');
    w.setMode('offline'); await page.clock.fastForward(21000); assert.match(await page.locator('#live').innerText(),/OUT OF DATE/);
    await page.clock.fastForward(101000); assert.equal(await page.locator('#live').innerText(),'NO CURRENT DATA'); assert.match(await text(page),/standing by/);
    w.setMode('ok'); await page.evaluate(()=>window.dispatchEvent(new Event('online'))); await page.clock.fastForward(1000); await page.locator('#live.current').waitFor();
    w.setMode('invalid'); await page.evaluate(()=>window.dispatchEvent(new Event('online'))); await new Promise(resolve => setTimeout(resolve, 300)); await page.clock.fastForward(1000); assert.equal(await page.locator('#live').innerText(),'NO CURRENT DATA'); assert.doesNotMatch(await page.locator('body').innerText(),/private@example/);
  } finally {await w.close();}
});
test('large bracket advances through bounded round windows', {timeout:60000}, async () => {
  const f=largeFixture(); f[0].brackets[1].matches = f[0].brackets[0].matches.map(m => ({...m, match_id: `cons-${m.match_id}`, bracket:'consolation'}));
  const w=await world(f); const {page}=w;
  try {
    await page.keyboard.press('3'); assert.match(await text(page),/BRACKET SEGMENT 1 \/ 9/);
    assert.ok(await page.locator('.bracket-round').count()<=3); assert.ok(await page.locator('.bracket-round').first().locator('.bracket-match').count()<=4);
    await page.clock.fastForward(18000); assert.match(await text(page),/BRACKET SEGMENT 2 \/ 9/);
    for (let i=0; i<7; i++) { await page.clock.fastForward(18000); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await new Promise(resolve => setTimeout(resolve, 100)); } assert.match(await text(page),/BRACKET SEGMENT 9 \/ 9/);
    await page.keyboard.press('4'); assert.equal(await page.locator('.single-match').count(),0); assert.match(await text(page),/BRACKET SEGMENT 1 \/ 9/); assert.ok(await page.locator('.bracket-connectors path').count() > 0);
    if (process.env.TV_SCREENSHOTS) {
      fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:path.join(process.env.TV_SCREENSHOTS,'large-multi-segment-bracket-1920.png')});
    }
  } finally {await w.close();}
});
test('all four presentations fit both landscape viewports and can produce evidence', {timeout:60000}, async () => {
  for (const size of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]) {
    const w=await world(fixture(),size); const {page}=w;
    try {
      for (const [key,slug] of [['1','match-center'],['2','completed-results'],['3','championship'],['4','consolation']]) {
        await page.keyboard.press(key); assert.deepEqual(await fits(page), [], `${slug} ${size.width}`);
        if (process.env.TV_SCREENSHOTS) {fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:path.join(process.env.TV_SCREENSHOTS,`${slug}-${size.width}.png`)});}
      }
    } finally {await w.close();}
  }
});

test('a sparse undecided final becomes a focused bracket feature, not two fabricated competitors', {timeout:60000}, async () => {
  const data = fixture(), original = data[0].brackets[1].matches[0];
  data[0].brackets[1].matches = Array.from({length:4}, (_, round) => ({
    ...original,
    match_id: `pending-consolation-${round}`,
    round, slot:0,
    player_1_name:round === 3 ? null : 'Jamie Lee',
    player_2_name:round === 3 ? null : 'Casey Ross',
  }));
  const w = await world(data), {page} = w;
  try {
    await page.keyboard.press('4');
    await page.clock.fastForward(18000);
    assert.equal(await page.locator('.bracket-round').count(), 1);
    assert.equal(await page.locator('.bracket-match').count(), 1);
    assert.match(await page.locator('.bracket-pending-pair').innerText(), /Finalists to be determined/);
    assert.doesNotMatch(await page.locator('.bracket-match').innerText(), /Jamie Lee|Casey Ross/);
    assert.equal(await page.locator('.bracket-vs').count(), 0);
    assert.deepEqual(await fits(page), []);
    if (process.env.TV_SCREENSHOTS) {
      fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:path.join(process.env.TV_SCREENSHOTS,'featured-undecided-final-1920.png')});
    }
  } finally { await w.close(); }
});

test('final verified Bo3 2–1 and 2–0 display exactly three dots per player', {timeout:60000}, async () => {
  const w=await world(fixture(),{width:1600,height:900}), {page}=w;
  try {
    assert.equal(await page.locator('.table-card .game-win-dots').count(),0,'no unverified active progress');
    assert.deepEqual(await page.locator('.score-pending').allInnerTexts(),['Game scores pending','Game scores pending']);
    await page.keyboard.press('2');
    const three=page.locator('.result-card').filter({hasText:'Taylor Smith'});
    assert.equal(await three.count(),1);
    const players=three.locator('.result-player');
    assert.equal(await players.nth(0).locator('.win-dot.earned').count(),2);
    assert.equal(await players.nth(1).locator('.win-dot.earned').count(),1);
    assert.equal(await players.nth(0).locator('.win-dot').count(),3);
    assert.equal(await players.nth(1).locator('.win-dot').count(),3);
    const two=page.locator('.result-card').filter({hasText:'Winner 1'}).locator('.result-player');
    assert.equal(await two.nth(0).locator('.win-dot.earned').count(),2);
    assert.equal(await two.nth(1).locator('.win-dot.earned').count(),0);
    assert.equal(await two.nth(1).locator('.win-dot').count(),3);
    await page.keyboard.press('3');
    const bracket=page.locator('.bracket-match').filter({hasText:'Taylor Smith'});
    assert.equal(await bracket.locator('.game-win-dots').count(),2);
    assert.deepEqual(await fits(page),[]);
  } finally {await w.close();}
});
test('Bo1, malformed final and active score states never render fabricated dots', {timeout:60000}, async () => {
  const alt=fixture();
  const one=alt[0].brackets[0].matches.find(m=>m.match_id==='result-1');
  one.best_of=1; one.points_to_win=21; one.game_scores='21-15';
  const invalid=alt[0].brackets[0].matches.find(m=>m.match_id==='result-2');
  invalid.game_scores='11-7';
  const w=await world(alt), page=w.page;
  try {
    assert.equal(await page.locator('.table-card .game-win-dots').count(),0);
    await page.keyboard.press('2');
    const bestOne=page.locator('.result-card').filter({hasText:'Winner 2'});
    assert.equal(await bestOne.count(),1);
    assert.equal(await bestOne.locator('.game-win-dots').count(),0);
    const malformed=page.locator('.result-card').filter({hasText:'Winner 3'});
    assert.equal(await malformed.locator('.game-win-dots').count(),0);
    assert.match(await malformed.locator('.result-tally').innerText(),/—/);
  } finally {await w.close();}
});
test('720p TV screens avoid serious WCAG A/AA violations and clipped elements', {timeout:90000}, async () => {
  const w=await world(fixture(),{width:1280,height:720}), {page}=w;
  try {
    await page.addScriptTag({url:`${host}/app/__test_axe.min.js`});
    for (const key of ['1','2','3','4']) {
      await page.keyboard.press(key);
      const report=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
      const severe=report.violations.filter(v=>['critical','serious'].includes(v.impact));
      assert.deepEqual(severe.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[], 'no serious WCAG violations');
      assert.deepEqual(await fits(page),[], 'no clipped or overflowed content');
    }
  } finally {await w.close();}
});

test('fictional showcase is clearly identified on both public views', {timeout:60000}, async () => {
  const f=fixture(); f[0].event_id='9c25613c-6543-4d6c-84cf-97ba49017509';
  const w=await world(f,{width:1280,height:720}); const {page}=w;
  try {
    assert.match(await page.locator('#demoBadge').innerText(),/FICTIONAL TOURNAMENT/);
    assert.equal(await page.locator('#live').innerText(),'DEMO DATA');
    const headerFit=await page.evaluate(()=>{const h=document.querySelector('.tv-header').getBoundingClientRect(), e=document.querySelector('.eyebrow').getBoundingClientRect(), b=document.querySelector('#demoBadge').getBoundingClientRect(), d=document.querySelector('#evDate').getBoundingClientRect();
      return {eyebrowTop:e.top, badgeInside:b.top>=h.top && b.bottom<=h.bottom && b.right<=innerWidth, sameLineAsDate:Math.abs((b.top+b.bottom)/2-(d.top+d.bottom)/2)<8, headerHeight:h.height};});
    assert.ok(headerFit.eyebrowTop >= 11, `eyebrow keeps a safe top margin with the demo label (${headerFit.eyebrowTop}px)`);
    assert.equal(headerFit.badgeInside,true); assert.equal(headerFit.sameLineAsDate,true,'demo label shares the date line');
    if (process.env.TV_SCREENSHOTS) {fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:path.join(process.env.TV_SCREENSHOTS,'supplementary-demo-showcase-1280.png')});}
    assert.match(await page.locator('main').innerText(),/Sample Matches/);
    assert.doesNotMatch(await page.locator('.table-grid').innerText(),/NOW PLAYING/);
    assert.deepEqual(await fits(page), []);
    await page.keyboard.press('3'); assert.match(await page.locator('main').innerText(),/SAMPLE MATCH/);
    assert.equal(await page.locator('#demoBadge').isVisible(),true);
    await page.goto(`${host}/app/spectator.html?e=${f[0].event_id}`);
    await page.locator('#live', {hasText:'Demo data'}).waitFor();
    assert.match(await page.locator('#demoBadge').innerText(),/Players and results are invented/);
    assert.match(await page.locator('main').innerText(),/Sample matches/);
  } finally {await w.close();}
});

test('real event wins by default and explicit showcase selection updates both public views', {timeout:60000}, async () => {
  const f=fixture(), demo=structuredClone(f[0]);
  demo.event_id='9c25613c-6543-4d6c-84cf-97ba49017509'; demo.event_name='Fictional Demo'; demo.updated_at='2029-01-01T00:00:00Z';
  f[0].event_name='Real Event'; f[0].status='complete'; f.push(demo);
  const w=await world(f,{width:1280,height:720}); const {page}=w;
  try {
    assert.equal(await page.locator('#evName').innerText(),'Real Event');
    assert.equal(await page.locator('#demoBadge').isHidden(),true);
    await page.goto(`${host}/app/tv.html?e=${demo.event_id}`); await page.locator('#live',{hasText:'DEMO DATA'}).waitFor();
    assert.equal(await page.locator('#evName').innerText(),'Fictional Demo');
    const bounds = await page.evaluate(() => {const h=document.querySelector('.tv-header').getBoundingClientRect(), b=document.querySelector('#demoBadge').getBoundingClientRect(); return b.top>=h.top && b.bottom<=h.bottom && b.right<=innerWidth;});
    assert.equal(bounds,true,'demo label remains within the TV header');
    await page.goto(`${host}/app/spectator.html`); await page.locator('#live',{hasText:'Live'}).waitFor();
    assert.equal(await page.locator('#evName').innerText(),'Real Event');
    await page.locator('#evPick').selectOption(demo.event_id);
    assert.equal(await page.locator('#live').innerText(),'Demo data'); assert.equal(await page.locator('#demoBadge').isVisible(),true);
    await page.locator('#evPick').selectOption(f[0].event_id);
    assert.equal(await page.locator('#live').innerText(),'Live'); assert.equal(await page.locator('#demoBadge').isHidden(),true);
    await page.goto(`${host}/app/tv.html?e=missing`); await page.locator('#live',{hasText:'NO CURRENT DATA'}).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(),/Fictional Demo|Real Event/);
  } finally {await w.close();}
});

test('720p keeps secondary text at 11px or larger and a few results fill the screen', {timeout:60000}, async () => {
  const w=await world(fixture(),{width:1280,height:720}), {page}=w;
  try {
    for (const key of ['1','2','3','4']) {
      await page.keyboard.press(key);
      const smallest=await page.evaluate(()=>{let min=99, who=''; const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n;
        while(n=walk.nextNode()){ if(!n.textContent.trim()) continue; const el=n.parentElement, cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') continue; const px=parseFloat(cs.fontSize); if(px<min){min=px; who=`${el.className}: ${n.textContent.trim().slice(0,30)}`;} }
        return {min,who}; });
      assert.ok(smallest.min >= 10.95, `mode ${key}: smallest text ${smallest.min}px (${smallest.who})`);
    }
    await page.keyboard.press('2');
    assert.equal(await page.locator('.results-grid').getAttribute('data-rows'),'2');
    const fill=await page.evaluate(()=>{const m=document.querySelector('main').getBoundingClientRect(), g=[...document.querySelectorAll('.result-card')].map(c=>c.getBoundingClientRect().bottom); return (Math.max(...g)-m.top)/m.height;});
    assert.ok(fill > 0.9, `four results use the available height (${fill.toFixed(2)})`);
  } finally {await w.close();}
});
