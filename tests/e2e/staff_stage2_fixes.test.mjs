import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld,STAFF} from './browser_world.mjs';

const T=20000;
test('Staff directory responsive controls, recovery, and session-scoped navigation', {timeout:180000}, async()=>{
 const w=await createBrowserWorld();
 try{
  await w.fake.local.admin('update fftt_private.events set event_name=$1 where id=$2',['Synthetic rehearsal with a deliberately long event name '.repeat(2),w.eventId]);
  const [other]=await w.fake.local.admin("insert into fftt_private.events(event_name,event_date,created_by) values ('Second synthetic event','2099-01-02',$1) returning id",[w.ids.org]);
  await w.fake.local.admin("insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer')",[other.id,w.ids.org]);
  for(const width of [320,390,820,1440]){
   const d=await w.device('staff-'+width,{viewport:{width,height:900}});
   let failSnapshot=false;
   await d.context.route('**/api/staff-directory',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({people:[]})}));
   await d.context.route('**/rest/v1/rpc/fftt_organizer_snapshot_v3',route=>failSnapshot?route.fulfill({status:503,contentType:'application/json',body:'{}'}):route.fallback());
   await d.signIn('org',{keep:true,event:w.eventId});
   const p=d.page;
   await p.locator('nav.tabs button[data-tab="staff"]').click();
   await p.locator('.people-row').first().waitFor({timeout:T});
   await p.locator('.people-mode-switch button').first().waitFor();
   assert.equal(await p.locator('.people-mode-switch button[aria-pressed="true"]').innerText(),'People');
   const controls=await p.locator('.people-controls').evaluate(el=>{const box=el.querySelector('.people-mode-switch').getBoundingClientRect(),add=el.querySelector(':scope > .primary').getBoundingClientRect(),buttons=[...el.querySelectorAll('.people-mode-switch button')].map(b=>b.getBoundingClientRect());return {box:box.toJSON(),add:add.toJSON(),buttons:buttons.map(b=>b.toJSON()),overflow:document.documentElement.scrollWidth-innerWidth};});
   assert.ok(controls.box.height<=controls.add.height);assert.ok(Math.abs(controls.box.top-controls.add.top)<1);assert.ok(Math.abs(controls.buttons[0].width-controls.buttons[1].width)<1);assert.ok(controls.buttons.every(b=>b.top>=controls.box.top&&b.bottom<=controls.box.bottom));assert.ok(controls.overflow<=1);
   await p.addScriptTag({url:'/__test__/axe.min.js'});
   const row=p.locator('.people-row').filter({hasText:w.accounts.a[0]}).first();
   await row.locator('.people-remove').click();
   const dialog=p.getByRole('dialog',{name:'Remove staff member'});await dialog.waitFor();
   assert.equal(await dialog.locator('.people-remove-email strong').textContent(),w.accounts.a[0]);
   assert.match(await dialog.innerText(),/directory entry will be archived/);
   assert.match(await dialog.innerText(),/Synthetic rehearsal with a deliberately long event name/);
   assert.match(await dialog.innerText(),/Scorekeeper/);
   const dialogViolations=await p.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>v.id));
   assert.deepEqual(dialogViolations,[]);
   await dialog.getByRole('button',{name:'Cancel'}).click();

   await p.locator('.people-mode-switch button').nth(1).click();
   assert.equal(await p.locator('.people-mode-switch button[aria-pressed="true"]').innerText(),'By event');
   const g=await p.locator('.people-row').first().evaluate(row=>{
    const a=row.querySelector('summary'),b=row.querySelector('select'),ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(),ca=getComputedStyle(a),cb=getComputedStyle(b);
    return {am:ca.margin,bm:cb.margin,ac:getComputedStyle(a.parentElement).margin,rc:getComputedStyle(b.parentElement).margin,ar:a.parentElement.parentElement.getBoundingClientRect().toJSON(),br:b.parentElement.getBoundingClientRect().toJSON(),ah:ra.height,bh:rb.height,at:ra.top,bt:rb.top,ai:ca.backgroundImage,bi:cb.backgroundImage,ap:ca.backgroundPosition,bp:cb.backgroundPosition,overflow:document.documentElement.scrollWidth-innerWidth};
   });
   assert.equal(g.ah,g.bh);assert.equal(g.ai,g.bi);assert.equal(g.ap,g.bp);assert.ok(g.overflow<=1);if(width>820)assert.ok(Math.abs(g.at-g.bt)<1,JSON.stringify({width,...g}));
   await p.reload(); await p.locator('.people-directory-card').waitFor({timeout:T});
   assert.equal(await p.locator('nav.tabs button[aria-current="page"]').getAttribute('data-tab'),'staff');
   await p.locator('.people-row').first().waitFor({timeout:T});
   await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
   await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
   await p.locator('.people-row').first().waitFor({timeout:T});
   assert.equal(await p.getByText(/Staff access could not be verified/).count(),0);
   failSnapshot=true;await p.getByRole('button',{name:'Refresh',exact:true}).click();
   await p.getByText(/Staff access could not be verified/).waitFor({timeout:T});
   assert.ok(await p.locator('.people-row').count()>0);assert.equal(await p.getByText('No staff members match your search.').count(),0);
   assert.equal(await p.getByRole('button',{name:'+ Add Staff'}).isDisabled(),true);
   failSnapshot=false;await p.getByRole('button',{name:'Refresh',exact:true}).click();
   await p.getByText(/Staff access could not be verified/).waitFor({state:'detached',timeout:T});
   await p.addScriptTag({url:'/__test__/axe.min.js'});
   const violations=await p.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>v.id));
   assert.deepEqual(violations,[]);
   await p.locator('#eventSelect').selectOption(other.id);
   await p.locator('nav.tabs button[aria-current="page"][data-tab="overview"]').waitFor({timeout:T});
   await p.reload();await p.locator('#app:not([hidden])').waitFor({timeout:T});
   assert.equal(await p.locator('nav.tabs button[aria-current="page"]').getAttribute('data-tab'),'overview');
   await d.context.close();
  }
  assert.deepEqual(w.pageErrors,[]);
 }finally{await w.close();}
});
