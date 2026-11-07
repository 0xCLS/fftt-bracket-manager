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
      await page.getByRole('button',{name:'Bracket',exact:true}).click(); assert.equal(await page.locator('.bracket').count(),2);
      await page.getByRole('button',{name:'Results',exact:true}).click(); assert.ok(await page.locator('.score-game').count()>0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.ok(requests.length && requests.every(r=>r.method()==='GET' && !r.headers().authorization && !r.headers().cookie));
      await context.close();
    }
  } finally {await browser.close();}
});
