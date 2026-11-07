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
  const browser = await chromium.launch({channel:process.env.FFTT_CHROME_CHANNEL || 'chrome'});
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
    assert.equal(await page.locator('.table-card.active').count(),2);
    assert.equal(await page.locator('.next-card').count(),4);
    assert.match(await text(page), /Alexandria Montgomery-Fitzgerald/);
    assert.equal(await page.locator('.score-pending').count(),2);
    assert.deepEqual(await page.locator('.score-pending').allInnerTexts(), ['Game scores pending', 'Game scores pending']);
    assert.doesNotMatch(await page.locator('.table-grid').innerText(),/11[–-]7|1\s*[–:]\s*1/);
    assert.deepEqual(await fits(page), []);
    await page.keyboard.press('ArrowRight'); assert.equal(await label(page),'COMPLETED RESULTS');
    assert.match(await text(page),/2–1/); assert.match(await text(page),/G1 11–7.*G2 8–11.*G3 11–9/);
    await page.keyboard.press('3'); assert.equal(await label(page),'CHAMPIONSHIP BRACKET'); assert.ok(await page.locator('.bracket-connectors path').count() > 0); assert.ok(await page.locator('.bracket-state', {hasText:'COMPLETED'}).count() > 0); assert.equal(await page.locator('.bracket-state', {hasText:'FINAL'}).count(),0);
    await page.keyboard.press('4'); assert.equal(await label(page),'CONSOLATION BRACKET'); assert.equal(await page.locator('.single-match .bracket-match').count(),1);
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
  } finally {await w.close();}
});
test('all four presentations fit both landscape viewports and can produce evidence', {timeout:60000}, async () => {
  for (const size of [{width:1920,height:1080},{width:1280,height:720}]) {
    const w=await world(fixture(),size); const {page}=w;
    try {
      for (const [key,slug] of [['1','match-center'],['2','completed-results'],['3','championship'],['4','consolation']]) {
        await page.keyboard.press(key); assert.deepEqual(await fits(page), [], `${slug} ${size.width}`);
        if (process.env.TV_SCREENSHOTS) {fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:path.join(process.env.TV_SCREENSHOTS,`${slug}-${size.width}.png`)});}
      }
    } finally {await w.close();}
  }
});


test('TV displays only completed verified games, 1–0 or 1–1 progress, stale state and awaiting official match', {timeout:60000}, async()=>{
  const f=fixture(), live=f[0].brackets[0].matches;
  live[0].game_progress={games:[[11,7]],version:1,epoch:0,updated_at:'2026-11-07T12:00:00Z'};
  live[1].game_progress={games:[[11,7],[9,11]],version:2,epoch:0,updated_at:'2026-11-07T12:00:00Z'};
  const w=await world(f),{page}=w;
  try{
    assert.deepEqual(await page.locator('.table-card .live-game-progress strong').allInnerTexts(),['1–0','1–1']);
    assert.match(await page.locator('.table-card').first().innerText(),/G1 11–7/);
    assert.match(await page.locator('.table-card').nth(1).innerText(),/GAME 3 NEXT/);
    assert.equal(w.requests.filter(x=>x.method==='POST' && x.url.startsWith(project)).length,0);
    w.setMode('offline');
    await page.clock.fastForward(21000);
    assert.match(await page.locator('.table-card .tiny-label').first().innerText(),/OUT OF DATE/);
    assert.match(await page.locator('#live').innerText(),/OUT OF DATE/);
    await page.clock.fastForward(101000);
    assert.equal(await page.locator('#live').innerText(),'NO CURRENT DATA');
    assert.doesNotMatch(await text(page),/CONFIRMED GAMES WON/);
  }finally{await w.close();}
});
