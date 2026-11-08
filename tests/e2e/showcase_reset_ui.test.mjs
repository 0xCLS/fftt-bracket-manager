import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld} from './browser_world.mjs';

test('reset control is restricted to showcase and requires explicit typed confirmation', {timeout:45000}, async()=>{
 const w=await createBrowserWorld();
 try{
  const id='e6bd40cf-4107-43ea-8c87-057dc38ef31b';
  await w.fake.local.admin("insert into fftt_private.events(id,public_id,event_name,event_date,table_count,created_by) values($1,'9c25613c-6543-4d6c-84cf-97ba49017509','Fictional showcase','2026-11-07',2,$2)",[id,w.ids.org]);
  await w.fake.local.admin("insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer')",[id,w.ids.org]);
  const org=await w.device('org'); await org.signIn('org',{event:w.eventId}); await org.page.locator('#evName').waitFor();
  assert.equal(await org.page.getByRole('button',{name:'Reset Showcase',exact:true}).count(),0);
  await org.page.locator('#eventSelect').selectOption(id);
  const control=org.page.getByRole('button',{name:'Reset Showcase',exact:true}); await control.waitFor(); await control.click();
  const dlg=org.page.locator('dialog[open]'), confirm=dlg.getByRole('button',{name:'Confirm reset'});
  assert.equal(await confirm.isDisabled(),true); await dlg.locator('#showcaseResetConfirm').fill('RESET'); assert.equal(await confirm.isDisabled(),true);
  await dlg.locator('#showcaseResetConfirm').fill('RESET SHOWCASE'); assert.equal(await confirm.isEnabled(),true);
  await dlg.getByRole('button',{name:'Cancel'}).click();
  assert.equal(w.requests.filter(r=>r.path.endsWith('/rpc/fftt_reset_showcase_v1')).length,0);
  let sent=0;
  await org.page.route('**/rest/v1/rpc/fftt_reset_showcase_v1',async route=>{
   sent++; const body=route.request().postDataJSON();
   await new Promise(resolve=>setTimeout(resolve,250));
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({status:'reset',revision:123,request_id:body.p_request_id})});
  });
  await control.click(); const confirmDialog=org.page.locator('dialog[open]');
  await confirmDialog.locator('#showcaseResetConfirm').fill('RESET SHOWCASE');
  await confirmDialog.getByRole('button',{name:'Confirm reset'}).click();
  await org.page.locator('#toasts .toast',{hasText:'Showcase reset confirmed.'}).waitFor();
  assert.equal(sent,1);

 } finally {await w.close();}
});
