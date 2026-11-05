/** Real Chrome role/UI checks using fictional accounts and disposable PostgreSQL only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBrowserWorld} from './browser_world.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sql=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('manager independently checks in players and sees audited controls; scorers stay Match Desk-only',
  {timeout: 180000}, async ()=>{
  const w=await createBrowserWorld({players:3,real:true});
  try {
    await w.fake.local.db.exec(sql('supabase/proposals/FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql'));
    await w.fake.local.db.exec(sql('supabase/proposals/FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql'));
    w.accounts.manager=['manager@fftt-browser.invalid','FictionalManagerPw89!'];
    w.ids.manager=await w.fake.addAccount(...w.accounts.manager);
    await w.fake.local.rpc(w.ids.org,'fftt_set_staff_v3',{
      p_event_id:w.eventId,p_email:w.accounts.manager[0],p_action:'grant',p_role:'bracket_manager'
    });
    const manager=await w.device('manager');
    await manager.signIn('manager');
    const page=manager.page;
    await page.locator('[data-tab="checkin"]').waitFor({timeout:20000});
    assert.equal(await page.locator('[data-tab="players"]').count(),0);
    assert.equal(await page.locator('[data-tab="staff"]').count(),0);
    assert.equal(await page.locator('[data-tab="results"]').count(),0);
    assert.equal(await page.locator('[data-tab="wrap"]').count(),1);
    await page.locator('[data-tab="checkin"]').click();
    await page.locator('#edName').waitFor();
    for(let i=0;i<3;i++){
      const btn=page.locator('button[aria-label^="Check in"]').first();
      await btn.waitFor({timeout:15000});
      await btn.click();
      await page.locator('#toasts .toast',{hasText:'Player checked in.'}).waitFor({timeout:15000});
    }
    await page.locator('#edName').fill('Fictional Charlie Walkin');
    await page.locator('#edLevel').selectOption('2');
    await page.getByRole('button',{name:'Add & check in'}).click();
    await page.locator('tbody tr',{hasText:'Fictional Charlie Walkin'}).waitFor({timeout:20000});
    await page.locator('[data-tab="championship"]').click();
    await page.getByRole('button',{name:'Build championship bracket'}).click();
    await page.locator('button',{hasText:'No-show…'}).first().waitFor({timeout:20000});
    assert.equal(await page.locator('button',{hasText:'Format…'}).count()>0,true);
    await page.locator('[data-tab="checkin"]').click();
    assert.equal(await page.locator('button',{hasText:'Add & check in'}).isDisabled(),true);
    await page.locator('[data-tab="wrap"]').click();
    assert.equal(await page.getByRole('button',{name:'Mark event complete'}).isDisabled(),true);
    const scorer=await w.device('scorer');
    await scorer.signIn('a');
    await scorer.page.locator('[data-tab="desk"]').waitFor({timeout:20000});
    assert.equal(await scorer.page.locator('[data-tab="checkin"]').count(),0);
    assert.equal(await scorer.page.locator('[data-tab="wrap"]').count(),0);
    assert.equal(await scorer.page.locator('button',{hasText:'No-show…'}).count(),0);
    assert.equal(await scorer.page.locator('button',{hasText:'Format…'}).count(),0);
    assert.deepEqual(w.pageErrors,[],'no browser page errors');
  } finally {await w.close();}
});
