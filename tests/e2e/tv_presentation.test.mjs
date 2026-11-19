/** Anonymous TV presentation against fictional allowlisted data; no live server or tournament data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {fixture} from '../fixtures/tv-fixture.mjs';
import {threeTableFixture} from './tv_presentation_fixtures.mjs';
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
  }).map(el => {
    const r=el.getBoundingClientRect(), m=document.querySelector('main').getBoundingClientRect();
    return JSON.stringify({element:String(el.className),text:el.textContent.slice(0,45),
      bounds:[Math.round(r.left-m.left),Math.round(r.top-m.top),Math.round(r.right-m.right),Math.round(r.bottom-m.bottom)],
      overflow:[el.scrollWidth-el.clientWidth,el.scrollHeight-el.clientHeight],
      cssOverflow:getComputedStyle(el).overflow,
      children:[...el.children].slice(0,4).map(child=>({className:String(child.className),bottom:Math.round(child.getBoundingClientRect().bottom-r.bottom),height:Math.round(child.getBoundingClientRect().height)}))});
  }));
}
test('TV modes, scores, controls, rotation and read-only public requests', {timeout:60000}, async () => {
  const w=await world(); const {page}=w;
  try {
    assert.equal(await page.locator('#demoBadge').isHidden(),true);
    assert.equal(await page.locator('.table-card.active').count(),2);
    assert.match(await page.locator('.table-card.active').first().innerText(), /BEST OF THREE/);
    assert.equal(await page.locator('.next-card:visible').count(),3,'default 1600px view shows three upcoming matches');
    assert.match(await text(page), /Alexandria\s+Montgomery-Fitzgerald/i);
    assert.equal(await page.locator('.score-pending').count(),0,'no unsupported live-score placeholders');
    assert.doesNotMatch(await page.locator('.table-grid').innerText(),/11[–-]7|1\s*[–:]\s*1/);
    assert.deepEqual(await fits(page), []);
    await page.keyboard.press('ArrowRight'); assert.equal(await label(page),'RESULTS');
    assert.match(await text(page),/2\s*-\s*1/); assert.match(await text(page),/G1 11 - 7.*G2 8 - 11.*G3 11 - 9/);
    await page.keyboard.press('ArrowLeft'); assert.equal(await label(page),'MATCH CENTER');
    await page.keyboard.press('Space'); await page.clock.fastForward(35000); assert.equal(await label(page),'MATCH CENTER','paused rotation does not advance');
    await page.keyboard.press('2'); await page.keyboard.press('Space'); await page.clock.fastForward(12000); assert.equal(await label(page),'MATCH CENTER','resumed rotation returns to Match Center after Results');
    const publicRequests=w.requests.filter(r=>r.url.startsWith(project)); assert.ok(publicRequests.length);
    assert.ok(publicRequests.every(r=>r.method==='GET' && !r.headers.authorization && !r.headers.cookie && new URL(r.url).pathname==='/rest/v1/fftt_public_tournament_v1'));
  } finally {await w.close();}
});
test('empty tables and missing modes, invalid response, stale and expired data recover', {timeout:60000}, async () => {
  const f=fixture(); f[0].brackets=[]; const w=await world(f); const {page}=w;
  try {
    assert.equal(await page.locator('.empty-table').count(),2);
    await page.keyboard.press('2'); assert.equal(await label(page),'MATCH CENTER');
    w.setMode('offline'); await page.clock.fastForward(21000); assert.match(await page.locator('#live').innerText(),/OUT OF DATE/);
    await page.clock.fastForward(101000); assert.equal(await page.locator('#live').innerText(),'NO CURRENT DATA'); assert.match(await text(page),/standing by/);
    w.setMode('ok'); await page.evaluate(()=>window.dispatchEvent(new Event('online'))); await page.clock.fastForward(1000); await page.locator('#live.current').waitFor();
    w.setMode('invalid'); await page.evaluate(()=>window.dispatchEvent(new Event('online'))); await new Promise(resolve => setTimeout(resolve, 300)); await page.clock.fastForward(1000); assert.equal(await page.locator('#live').innerText(),'NO CURRENT DATA'); assert.doesNotMatch(await page.locator('body').innerText(),/private@example/);
  } finally {await w.close();}
});
test('both presentations fit both landscape viewports and can produce evidence', {timeout:60000}, async () => {
  for (const size of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]) {
    const w=await world(fixture(),size); const {page}=w;
    try {
      for (const [key,slug] of [['1','match-center'],['2','results']]) {
        await page.keyboard.press(key);
        if (process.env.TV_SCREENSHOTS) {fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:path.join(process.env.TV_SCREENSHOTS,`${slug}-${size.width}.png`)});}
        assert.deepEqual(await fits(page), [], `${slug} ${size.width}`);
      }
    } finally {await w.close();}
  }
});

test('final verified Bo3 2–1 and 2–0 display exactly three dots per player', {timeout:60000}, async () => {
  const w=await world(fixture(),{width:1600,height:900}), {page}=w;
  try {
    assert.equal(await page.locator('.table-card .game-win-dots').count(),0,'no unverified active progress');
    assert.equal(await page.locator('.score-pending').count(),0,'unverified active results stay absent');
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
    assert.deepEqual(await fits(page),[]);
  } finally {await w.close();}
});

test('premium match cards show only server-confirmed active games and dots; stale state is visibly marked', {timeout:60000}, async()=>{
  const f=fixture(), active=f[0].brackets[0].matches;
  active[0].game_progress={games:[[11,7]],version:1,epoch:0,updated_at:'2026-11-07T12:00:00Z'};
  active[1].game_progress={games:[[11,7],[9,11]],version:2,epoch:0,updated_at:'2026-11-07T12:00:00Z'};
  const w=await world(f,{width:1280,height:720}), {page}=w;
  try{
    assert.deepEqual(await page.locator('.broadcast-match .live-game-progress strong').allInnerTexts(),['1–0','1–1']);
    assert.match(await page.locator('.broadcast-match').nth(1).innerText(),/G1 11–7.*G2 9–11/);
    const c=page.locator('.broadcast-match.active');
    assert.equal(await c.nth(0).locator('.match-player').nth(0).locator('.win-dot.earned').count(),1);
    assert.equal(await c.nth(0).locator('.match-player').nth(1).locator('.win-dot.earned').count(),0);
    assert.equal(await c.nth(1).locator('.match-player').nth(0).locator('.win-dot.earned').count(),1);
    assert.equal(await c.nth(1).locator('.match-player').nth(1).locator('.win-dot.earned').count(),1);
    assert.equal(w.requests.filter(x=>x.method==='POST'&&x.url.startsWith(project)).length,0);
    assert.deepEqual(await fits(page),[], 'confirmed progress must fit 720p premium layout');
    await page.setViewportSize({width:1920,height:1080});
    assert.equal(await c.nth(0).locator('.player-name.stacked').count(),2,'new stacked-name layout remains in the active card');
    assert.deepEqual(await fits(page),[], 'confirmed progress must fit 1080p premium layout');
    w.setMode('offline');
    await page.clock.fastForward(21000);
    assert.match(await page.locator('.broadcast-match .progress-kicker').first().innerText(),/OUT OF DATE/);
    await page.clock.fastForward(101000);
    assert.equal(await page.locator('#live').innerText(),'NO CURRENT DATA');
    assert.equal(await page.locator('.broadcast-match .live-game-progress').count(),0,'expired progress hidden');
  }finally{await w.close();}
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
    for (const key of ['1','2']) {
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
    const headerFit=await page.evaluate(()=>{const h=document.querySelector('.tv-header').getBoundingClientRect(), n=document.querySelector('#evName').getBoundingClientRect(), b=document.querySelector('#demoBadge').getBoundingClientRect(), d=document.querySelector('#evDate').getBoundingClientRect();
      return {titleTop:n.top, badgeInside:b.top>=h.top && b.bottom<=h.bottom && b.right<=innerWidth, sameLineAsDate:Math.abs((b.top+b.bottom)/2-(d.top+d.bottom)/2)<8, headerHeight:h.height};});
    assert.ok(headerFit.titleTop >= 0, `event title keeps a safe header margin (${headerFit.titleTop}px)`);
    assert.equal(headerFit.badgeInside,true); assert.equal(headerFit.sameLineAsDate,true,'demo label shares the date line');
    if (process.env.TV_SCREENSHOTS) {fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:path.join(process.env.TV_SCREENSHOTS,'supplementary-demo-showcase-1280.png')});}
    assert.match(await page.locator('main').innerText(),/Sample Matches/);
    assert.doesNotMatch(await page.locator('.table-grid').innerText(),/NOW PLAYING/);
    assert.deepEqual(await fits(page), []);
    assert.match(await page.locator('.table-grid').innerText(),/SAMPLE MATCH/);
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
    assert.equal(await page.locator('#evName').textContent(),'Real Event');
    assert.equal(await page.locator('#demoBadge').isHidden(),true);
    await page.goto(`${host}/app/tv.html?e=${demo.event_id}`); await page.locator('#live',{hasText:'DEMO DATA'}).waitFor();
    assert.equal(await page.locator('#evName').textContent(),'Fictional Demo');
    const bounds = await page.evaluate(() => {const h=document.querySelector('.tv-header').getBoundingClientRect(), b=document.querySelector('#demoBadge').getBoundingClientRect(); return b.top>=h.top && b.bottom<=h.bottom && b.right<=innerWidth;});
    assert.equal(bounds,true,'demo label remains within the TV header');
    await page.goto(`${host}/app/spectator.html`); await page.locator('#live',{hasText:'Live'}).waitFor();
    assert.equal(await page.locator('#evName').textContent(),'Real Event');
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
    for (const key of ['1','2']) {
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


test('approved cinematic hierarchy keeps two balanced match panels, and featured results', {timeout:60000},async()=>{
  const w=await world(fixture(),{width:1280,height:720}); const {page}=w;
  try{
    assert.equal(await page.locator('.broadcast-match').count(),2);
    assert.equal(await page.locator('.broadcast-match .versus').count(),2);
    assert.equal(await page.locator('.broadcast-match .match-meta').count(),2);
    assert.equal(await page.locator('.broadcast-match .score-pending').count(),0);
    assert.match(await page.locator('.queue-banner').innerText(),/UP NEXT/);
    const geometry=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('.broadcast-match')].map(e=>e.getBoundingClientRect());
      return {gap:cards[1].left-cards[0].right,aligned:Math.abs(cards[1].top-cards[0].top)<15,radius:getComputedStyle(document.querySelector('.broadcast-match')).borderTopLeftRadius};
    });
    assert.ok(geometry.gap>=15&&geometry.aligned,'side-by-side match panels retain horizontal breathing room');
    assert.notEqual(geometry.radius,'0px','match panels retain approved rounded contours');
    assert.deepEqual(await fits(page),[]);
    await page.keyboard.press('2');
    assert.equal(await page.locator('.lead-result').count(),1);
    assert.match(await page.locator('.lead-result').innerText(),/Taylor Smith/i);
    assert.match(await page.locator('.lead-result .result-tally').innerText(),/2\s*-\s*1/);
    assert.deepEqual(await fits(page),[]);
  }finally{await w.close();}
});

test('TV transport buttons have non-overlapping hit targets and work by pointer at broadcast widths', {timeout:60000}, async () => {
  for (const viewport of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]) {
    const w=await world(fixture(),viewport), {page}=w;
    try {
      await page.locator('nav.controls').hover();
      const geometry=await page.evaluate(()=>{
        const buttons=[...document.querySelectorAll('nav.controls button')].filter(el=>getComputedStyle(el).display!=='none');
        const hitBoxes=buttons.map(el=>({id:el.id||el.dataset.screen,
          rect:el.getBoundingClientRect().toJSON()}));
        const overlaps=[];
        for (let i=0;i<hitBoxes.length;i++) for (let j=i+1;j<hitBoxes.length;j++) {
          const a=hitBoxes[i],b=hitBoxes[j];
          if (Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left)>0 &&
              Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top)>0)
            overlaps.push(a.id+' / '+b.id);
        }
        return {hitBoxes,overlaps};
      });
      assert.equal(geometry.hitBoxes.length,5,'prev, pause, next and the two screens are accessible on hover');
      assert.deepEqual(geometry.overlaps,[],'non-overlapping TV controls at '+viewport.width+'px');
      await page.locator('#next').click();
      assert.equal(await label(page),'RESULTS');
      await page.locator('#prev').click();
      assert.equal(await label(page),'MATCH CENTER');
      await page.locator('#pause').click();
      assert.equal(await page.locator('#pause').textContent(),'Resume');
      await page.locator('#pause').click();
      assert.equal(await page.locator('#pause').textContent(),'Pause');
    } finally {await w.close();}
  }
});

test('premium Results cards separate both names, score and verified dots at TV sizes', {timeout:60000}, async()=>{
  for(const viewport of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]){
    const w=await world(fixture(),viewport),{page}=w;
    try{
      await page.keyboard.press('2');
      const cards=page.locator('.cinematic-results .result-card:not(.lead-result)');
      assert.equal(await cards.count(),3);
      const geometry=await page.evaluate(()=>[...document.querySelectorAll('.cinematic-results .result-card:not(.lead-result)')].map(card=>{
        const rows=[...card.querySelectorAll('.result-player')].map(el=>el.getBoundingClientRect());
        const score=card.querySelector('.result-score').getBoundingClientRect();
        const names=[...card.querySelectorAll('.result-player-name')].map(el=>el.getBoundingClientRect());
        return {nameRows:rows.length,verticalGap:rows[1].top-rows[0].bottom,
          noNameVsScoreOverlap:names.every(n=>n.right<=score.left+1),
          namesVisible:names.every(n=>n.width>35&&n.height>=15),
          scoreVisible:score.width>=30&&score.height>20};
      }));
      assert.ok(geometry.every(x=>x.nameRows===2&&x.verticalGap>=-1&&x.noNameVsScoreOverlap&&x.namesVisible&&x.scoreVisible),
        'compact result geometry '+viewport.width+': '+JSON.stringify(geometry));
      assert.deepEqual(await fits(page),[],'Results layout at '+viewport.width);
    }finally{await w.close();}
  }
});

test('premium transport stays within the footer and never covers the broadcast content', {timeout:60000},async()=>{
  for(const viewport of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]){
    const w=await world(fixture(),viewport),{page}=w;
    try{
      const geometry=await page.evaluate(()=>{
        const nav=document.querySelector('nav.controls').getBoundingClientRect();
        const footer=document.querySelector('footer').getBoundingClientRect();
        const title=document.querySelector('footer > span:first-child').getBoundingClientRect();
        return {navTop:nav.top,footerTop:footer.top,navLeft:nav.left,titleRight:title.right,
          navRight:nav.right,footerRight:footer.right};
      });
      assert.ok(geometry.navTop>=geometry.footerTop-3,'controls do not float over main content at '+viewport.width+': '+JSON.stringify(geometry));
      assert.ok(geometry.navLeft>=geometry.titleRight-4,'controls do not obscure fellowship footer at '+viewport.width+': '+JSON.stringify(geometry));
      await page.locator('#prev').click();
      await page.locator('#next').click();
      assert.deepEqual(await fits(page),[]);
    }finally{await w.close();}
  }
});


test('side-by-side Match Center uses stacked names and external table numbers at three display sizes', {timeout:60000},async()=>{
  for(const vp of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]){
    const w=await world(fixture(),vp),{page}=w;
    try{
      assert.equal(await page.locator('.table-stage').count(),2);
      assert.equal(await page.locator('.table-stage .table-outside-number').count(),2);
      assert.equal(await page.locator('.table-stage .player-first').count(),4);
      const g=await page.evaluate(()=>{
        const rect=selector=>document.querySelector(selector).getBoundingClientRect();
        const a=rect('.table-stage-1 .table-card'),b=rect('.table-stage-2 .table-card');
        const one=rect('.table-stage-1 .table-outside-label'),two=rect('.table-stage-2 .table-outside-label');
        const names=[...document.querySelectorAll('.table-stage .player-name')];
        return {parallel:Math.abs(a.top-b.top)<15,disjoint:a.right<b.left,
          outsideLeft:one.right<=a.left+2,outsideRight:two.left>=b.right-2,
          compact:a.height<window.innerHeight*.57&&b.height<window.innerHeight*.57,
          labelReadable:names.every(n=>getComputedStyle(n).fontFamily.includes('Arial')),
          stacked:names.every(n=>n.querySelector('.player-first')?.getBoundingClientRect().top <
            n.querySelector('.player-last')?.getBoundingClientRect().top)};
      });
      assert.deepEqual(g,{parallel:true,disjoint:true,outsideLeft:true,outsideRight:true,compact:true,labelReadable:true,stacked:true},'responsive Match Center '+vp.width);
      assert.deepEqual(await fits(page),[],'Match Center visible layout '+vp.width);
    }finally{await w.close();}
  }
});

test('Results uses a spaced hyphen for games and match tallies', {timeout:60000},async()=>{
  const w=await world(fixture(),{width:1600,height:900}),{page}=w;
  try{
    await page.keyboard.press('2');
    const tally=await page.locator('.lead-result .result-tally').innerText();
    assert.match(tally,/2\s+-\s+1/);
    assert.doesNotMatch(tally,/[–—]/);
    assert.match(await page.locator('.lead-result .result-games').innerText(),/G1\s+11 - 7/);
    assert.deepEqual(await fits(page),[]);
  }finally{await w.close();}
});


test('final TV queue and typography polish: circular VS, centered banner, dividers, three-on-deck and footer spacing', {timeout:60000},async()=>{
  for(const size of [{width:1280,height:720,queue:2},{width:1600,height:900,queue:3},{width:1920,height:1080,queue:3}]){
    const w=await world(fixture(),size),{page}=w;
    try{
      assert.equal(await page.locator('.next-card:visible').count(),size.queue,'responsive queue count');
      const g=await page.evaluate(()=>{
        const rect=el=>el.getBoundingClientRect(),style=el=>getComputedStyle(el);
        const rings=[...document.querySelectorAll('.broadcast-match .versus')].map(el=>({
          width:rect(el).width,height:rect(el).height,radius:style(el).borderRadius
        }));
        const banner=document.querySelector('.queue-banner'),title=banner.querySelector('strong'),onDeck=banner.querySelector('small');
        const b=rect(banner),a=rect(title),d=rect(onDeck);
        const v=[...document.querySelectorAll('.next-card')].filter(el=>style(el).display!=='none');
        const strip=rect(document.querySelector('.next-section'));
        const footer=rect(document.querySelector('footer'));
        return {rings,
          titleError:Math.abs((a.left+a.right)/2-(b.left+b.right)/2),
          labelError:Math.abs((d.left+d.right)/2-(b.left+b.right)/2),
          border:parseFloat(style(v[0]).borderRightWidth),
          gapBelow:footer.top-strip.bottom,
          numberOfCards:v.length,
          lastBorder:parseFloat(style(v[v.length-1]).borderRightWidth)};
      });
      assert.ok(g.rings.length===2&&g.rings.every(r=>Math.abs(r.width-r.height)<=1&&r.radius.startsWith('50%')),
        'VS must be circular, not elliptical: '+JSON.stringify(g.rings));
      assert.ok(g.titleError<=3&&g.labelError<=3,'UP NEXT and ON DECK horizontally centered');
      assert.ok(g.border>=1&&g.lastBorder===0,'upcoming matchups have distinct internal separator only');
      assert.ok(g.gapBelow>=11,'queue has footer breathing room: '+JSON.stringify(g));
      assert.deepEqual(await fits(page),[],'queue and rings fit '+size.width);
    } finally {await w.close();}
  }
});

test('Results lower tiles retain generous horizontal padding without overlap', {timeout:60000},async()=>{
  for(const vp of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]){
    const w=await world(fixture(),vp),{page}=w;
    try{
      await page.keyboard.press('2');
      const values=await page.locator('.result-card:not(.lead-result)').evaluateAll(els=>els.map(el=>{
        const s=getComputedStyle(el),r=el.getBoundingClientRect();
        return {left:parseFloat(s.paddingLeft),right:parseFloat(s.paddingRight),width:r.width};
      }));
      assert.ok(values.length===3 && values.every(x=>x.left>=18&&x.right>=18),
        'secondary Results tiles need even edge padding: '+JSON.stringify(values));
      assert.deepEqual(await fits(page),[],'Results at '+vp.width);
    }finally{await w.close();}
  }
});

test('header retains commented brand eyebrow in HTML without displaying it', {timeout:60000},async()=>{
  const w=await world(fixture(),{width:1600,height:900}),{page}=w;
  try{
    assert.equal(await page.locator('header .brand .eyebrow').count(),0);
    const html=await page.evaluate(()=>document.documentElement.outerHTML);
    assert.match(html,/<!-- <div class="eyebrow">FORGING FELLOWSHIP TABLE TENNIS<\/div> -->/);
    assert.match(await page.locator('#evName').textContent(),/Forging Fellowship Games/);
  }finally{await w.close();}
});


test('Up Next text is horizontally centered in each visible matchup card at TV resolutions', {timeout:60000},async()=>{
  for(const viewport of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]){
    const w=await world(fixture(),viewport),{page}=w;
    try{
      const cells=await page.locator('.next-card:visible').evaluateAll(els=>els.map(el=>{
        const e=el.getBoundingClientRect(),meta=el.querySelector('.next-meta')?.getBoundingClientRect(),
          names=el.querySelector('.next-names')?.getBoundingClientRect();
        const st=getComputedStyle(el);
        return {textAlign:st.textAlign,metaDelta:Math.abs((meta.left+meta.right-e.left-e.right)/2),
          namesDelta:Math.abs((names.left+names.right-e.left-e.right)/2),
          justify:getComputedStyle(el.querySelector('.next-names')).justifyContent};
      }));
      assert.ok(cells.length>=2&&cells.every(x=>x.textAlign==='center'&&x.metaDelta<4&&x.namesDelta<4&&x.justify==='center'),
        'each upcoming card has centered matchup content: '+JSON.stringify(cells));
      assert.deepEqual(await fits(page),[],'centered Up Next '+viewport.width);
    } finally {await w.close();}
  }
});

test('Results player labels use readable universal sans and wider edge padding', {timeout:60000},async()=>{
  for(const viewport of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]){
    const w=await world(fixture(),viewport),{page}=w;
    try{
      await page.keyboard.press('2');
      const styles=await page.locator('.result-card:not(.lead-result)').evaluateAll(cards=>cards.map(card=>{
        const cs=getComputedStyle(card),name=card.querySelector('.result-player-name'),
          ns=getComputedStyle(name),rect=name.getBoundingClientRect();
        return {paddingLeft:parseFloat(cs.paddingLeft),paddingRight:parseFloat(cs.paddingRight),
          nameFamily:ns.fontFamily,fontSize:parseFloat(ns.fontSize),lineHeight:parseFloat(ns.lineHeight),
          nameWidth:rect.width};
      }));
      assert.equal(styles.length,3);
      assert.ok(styles.every(x=>x.paddingLeft>=22&&x.paddingRight>=22&&x.nameFamily.includes('Arial')&&
        x.fontSize>=14&&x.lineHeight>x.fontSize&&x.nameWidth>85), 'readable names and balanced padding '+JSON.stringify(styles));
      assert.deepEqual(await fits(page),[],'Results lower strip '+viewport.width);
    }finally{await w.close();}
  }
});


const shot = async (page, name) => { if (process.env.TV_SCREENSHOTS) { fs.mkdirSync(process.env.TV_SCREENSHOTS,{recursive:true}); await page.screenshot({path:path.join(process.env.TV_SCREENSHOTS,name)}); } };
const cardBoxes = page => page.evaluate(() => [...document.querySelectorAll('.table-card')].map(c => {const r=c.getBoundingClientRect(); return {l:r.left,t:r.top,w:r.width,h:r.height,r:r.right,b:r.bottom};}));

test('three configured tables are all shown at once with a correct counter and balanced columns', {timeout:90000}, async () => {
  for (const size of [{width:1280,height:720},{width:1600,height:900},{width:1920,height:1080}]) {
    const w=await world(threeTableFixture(),size), {page}=w;
    try {
      assert.equal(await page.locator('.table-card.active').count(),3,'every table is on screen');
      assert.deepEqual(await page.locator('.table-outside-word').allInnerTexts(),['TABLE ONE','TABLE TWO','TABLE THREE']);
      assert.deepEqual(await page.locator('.table-outside-number').allInnerTexts(),['01','02','03']);
      assert.equal((await page.locator('.status-count').innerText()).replace(/\s+/g,' '),'● THREE TABLES · 3 MATCHES');
      assert.doesNotMatch(await page.locator('.status-count').innerText(),/TWO/);
      const boxes=await cardBoxes(page);
      assert.equal(boxes.length,3);
      assert.ok(boxes.every(b=>Math.abs(b.w-boxes[0].w)<=2 && Math.abs(b.t-boxes[0].t)<=1 && Math.abs(b.b-boxes[0].b)<=1),'three equal, aligned columns');
      assert.ok(boxes[1].l-boxes[0].r>=12 && boxes[2].l-boxes[1].r>=12,'columns have breathing room');
      const unused=await page.evaluate(()=>{const g=document.querySelector('.table-grid').getBoundingClientRect(), s=[...document.querySelectorAll('.table-stage')].map(x=>x.getBoundingClientRect()); return {left:s[0].left-g.left, right:g.right-s[2].right, bottom:g.bottom-Math.max(...s.map(x=>x.bottom))};});
      assert.ok(unused.left<=2 && unused.right<=2 && unused.bottom<=2,'the three tables span the whole stage: '+JSON.stringify(unused));
      const lines=await page.evaluate(()=>[...document.querySelectorAll('.table-card')].map(c=>{const v=c.querySelector('.versus').getBoundingClientRect(); return (v.top+v.bottom)/2;}));
      assert.ok(lines.every(y=>Math.abs(y-lines[0])<=1.5),'VS rows align across all three tables');
      assert.equal(await page.locator('.table-card .versus').count(),3);
      assert.equal(await page.locator('.table-card .player-name.stacked').count(),6,'stacked first/last names on every table');
      assert.equal(await page.locator('.table-card .match-meta').count(),3);
      assert.match(await page.locator('.table-card').nth(0).innerText(),/BEST OF THREE · TO 11/);
      assert.match(await page.locator('.table-card').nth(2).innerText(),/SINGLE GAME · TO 21/);
      assert.deepEqual(await fits(page),[],`three tables ${size.width}`);
      await shot(page,`three-tables-match-center-${size.width}.png`);
    } finally {await w.close();}
  }
});

test('three-table cards keep saved-game indicators, match status and full names', {timeout:60000}, async () => {
  const w=await world(threeTableFixture(),{width:1920,height:1080}), {page}=w;
  try {
    const first=page.locator('.table-card').first();
    assert.deepEqual(await page.locator('.live-game-progress strong').allInnerTexts(),['1–0']);
    assert.match(await first.innerText(),/G1 11–7/);
    assert.equal(await first.locator('.match-player').nth(0).locator('.win-dot.earned').count(),1);
    assert.equal(await first.locator('.match-player').nth(1).locator('.win-dot.earned').count(),0);
    assert.equal(await page.locator('.table-card .live-game-progress').count(),1,'only the table with confirmed games shows progress');
    assert.equal(await page.locator('.table-card .status-label',{hasText:'NOW PLAYING'}).count(),3);
    assert.match(await first.locator('.player-name').first().getAttribute('aria-label'),/Alexandria Montgomery-Fitzgerald/);
    assert.equal(w.requests.filter(x=>x.method==='POST'&&x.url.startsWith(project)).length,0);
    w.setMode('offline'); await page.clock.fastForward(21000);
    assert.match(await page.locator('.progress-kicker').first().innerText(),/OUT OF DATE/);
    await shot(page,'three-tables-stale-progress-1920.png');
  } finally {await w.close();}
});

test('an idle third table stays visible and the counter counts only matches in play', {timeout:60000}, async () => {
  const f=threeTableFixture(); f[0].brackets[0].matches.find(m=>m.match_id==='t3').phase='waiting';
  const w=await world(f,{width:1600,height:900}), {page}=w;
  try {
    assert.equal(await page.locator('.table-card').count(),3);
    assert.equal(await page.locator('.table-card.active').count(),2);
    assert.equal(await page.locator('.empty-table').count(),1);
    assert.match(await page.locator('.table-card').nth(2).innerText(),/TABLE AVAILABLE[\s\S]*Table open/);
    assert.equal((await page.locator('.status-count').innerText()).replace(/\s+/g,' '),'● THREE TABLES · 2 MATCHES');
    assert.deepEqual(await fits(page),[]);
  } finally {await w.close();}
});

test('long names stay inside every three-table card without clipping', {timeout:90000}, async () => {
  for (const size of [{width:1280,height:720},{width:1920,height:1080}]) {
    const w=await world(threeTableFixture({long:true}),size), {page}=w;
    try {
      assert.match(await page.locator('.table-card').nth(2).innerText(),/Featherstonehaugh/i);
      assert.match(await page.locator('.table-card').nth(2).innerText(),/Villalobos/i);
      const inside=await page.evaluate(()=>[...document.querySelectorAll('.table-card')].every(c=>{const r=c.getBoundingClientRect(); return [...c.querySelectorAll('.player-name,.match-meta,.match-round,.versus')].every(e=>{const b=e.getBoundingClientRect(); return b.left>=r.left-1 && b.right<=r.right+1 && b.top>=r.top-1 && b.bottom<=r.bottom+1;});}));
      assert.equal(inside,true,'text and VS badges remain inside their cards');
      assert.deepEqual(await fits(page),[],`long names ${size.width}`);
      await shot(page,`three-tables-long-names-${size.width}.png`);
    } finally {await w.close();}
  }
});

test('two-table events keep the approved side-label layout and an accurate counter', {timeout:60000}, async () => {
  const w=await world(fixture(),{width:1920,height:1080}), {page}=w;
  try {
    assert.equal(await page.locator('.multi-table').count(),0,'two tables never use the three-table mode');
    assert.equal(await page.locator('.table-card').count(),2);
    assert.equal((await page.locator('.status-count').innerText()).replace(/\s+/g,' '),'● TWO TABLES · 2 MATCHES');
    const sides=await page.evaluate(()=>{const s=[...document.querySelectorAll('.table-stage')].map(x=>({label:x.querySelector('.table-outside-label').getBoundingClientRect(),card:x.querySelector('.table-card').getBoundingClientRect()})); return {firstLabelLeftOfCard:s[0].label.right<=s[0].card.left+1, secondLabelRightOfCard:s[1].label.left>=s[1].card.right-1};});
    assert.deepEqual(sides,{firstLabelLeftOfCard:true,secondLabelRightOfCard:true});
    assert.deepEqual(await page.locator('.table-outside-word').allInnerTexts(),['TABLE ONE','TABLE TWO']);
    await shot(page,'two-tables-match-center-1920.png');
  } finally {await w.close();}
});

test('the broadcast has exactly two screens, no numeric prefixes and unchanged manual and automatic controls', {timeout:60000}, async () => {
  const w=await world(threeTableFixture(),{width:1920,height:1080}), {page}=w;
  try {
    assert.deepEqual(await page.locator('[data-screen]').evaluateAll(b=>b.map(x=>x.dataset.screen)),['match','results']);
    assert.deepEqual(await page.locator('.controls button').evaluateAll(b=>b.map(x=>x.textContent.trim())),['←','Pause','→','Match Center','Results']);
    const prefixes=await page.evaluate(()=>[...document.querySelectorAll('.controls button, #screenLabel')].map(e=>getComputedStyle(e,'::before').content+getComputedStyle(e,'::after').content));
    assert.ok(prefixes.every(c=>!/\d/.test(c)),'no numeric prefix is generated on a screen label: '+prefixes.join('|'));
    const chrome=await page.locator('.tv-header, .controls').evaluateAll(es=>es.map(e=>e.textContent).join(' '));
    assert.doesNotMatch(chrome,/\b0?[1-4]\s*\/|\/\s*0?[1-4]\b|CHAMPIONSHIP|CONSOLATION/i,'no bracket screens or numeric prefixes in the header or controls');
    assert.equal(await page.locator('#screenLabel').innerText(),'MATCH CENTER');
    // Removed numbered shortcuts do nothing; 1 and 2 remain the two screens.
    await page.keyboard.press('3'); assert.equal(await label(page),'MATCH CENTER');
    await page.keyboard.press('4'); assert.equal(await label(page),'MATCH CENTER');
    await page.keyboard.press('2'); assert.equal(await label(page),'RESULTS');
    assert.equal(await page.locator('.title-kicker').innerText(),'OFFICIAL FINAL SCORES','Results kicker has no numeric suffix');
    await page.keyboard.press('1'); assert.equal(await label(page),'MATCH CENTER');
    // Manual controls by pointer.
    await page.locator('#next').click(); assert.equal(await label(page),'RESULTS');
    await page.locator('#next').click(); assert.equal(await label(page),'MATCH CENTER','navigation wraps between the two screens');
    await page.locator('#prev').click(); assert.equal(await label(page),'RESULTS');
    await page.locator('[data-screen="match"]').click(); assert.equal(await label(page),'MATCH CENTER');
    // Automatic rotation alternates; pause freezes; resume continues.
    await page.clock.fastForward(30500); assert.equal(await label(page),'RESULTS');
    await page.clock.fastForward(12500); assert.equal(await label(page),'MATCH CENTER');
    await page.locator('#pause').click(); assert.equal(await page.locator('#pause').textContent(),'Resume');
    await page.clock.fastForward(60000); assert.equal(await label(page),'MATCH CENTER','paused');
    await page.locator('#pause').click(); assert.equal(await page.locator('#pause').textContent(),'Pause');
    await page.clock.fastForward(30500); assert.equal(await label(page),'RESULTS');
    assert.deepEqual(await fits(page),[]);
    await shot(page,'rotation-results-1920.png');
  } finally {await w.close();}
});

test('three-table Match Center and Results avoid serious WCAG A/AA violations at 720p', {timeout:90000}, async () => {
  const w=await world(threeTableFixture(),{width:1280,height:720}), {page}=w;
  try {
    await page.addScriptTag({url:`${host}/app/__test_axe.min.js`});
    for (const key of ['1','2']) {
      await page.keyboard.press(key);
      const report=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
      const severe=report.violations.filter(v=>['critical','serious'].includes(v.impact));
      assert.deepEqual(severe.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[], 'no serious WCAG violations');
      assert.deepEqual(await fits(page),[]);
    }
  } finally {await w.close();}
});

test('TV privacy: three-table view renders only public names and results from allowlisted GET requests', {timeout:60000}, async () => {
  const f=threeTableFixture(), w=await world(f,{width:1600,height:900}), {page}=w;
  try {
    const body=await page.locator('body').innerText();
    assert.doesNotMatch(body,/@|rating|level\s*\d|email|phone|token|private/i);
    assert.equal(await page.evaluate(()=>[localStorage.length,sessionStorage.length,document.cookie.length]).then(x=>x.join()),'0,0,0');
    const requests=w.requests.filter(r=>r.url.startsWith(project));
    assert.ok(requests.length && requests.every(r=>r.method==='GET' && !r.headers.authorization && !r.headers.cookie && new URL(r.url).pathname==='/rest/v1/fftt_public_tournament_v1'));
    assert.equal(w.requests.filter(r=>!r.url.startsWith(project)&&new URL(r.url).origin!==host).length,0,'no third-party origin is contacted');
  } finally {await w.close();}
});
