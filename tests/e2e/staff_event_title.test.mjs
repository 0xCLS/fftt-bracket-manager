import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld} from './browser_world.mjs';

const T = 20000;
const LONG = 'B2e Synthetic Hosted Rehearsal with a deliberately very long event name for responsive layout checks';
const OTHER = 'Second Synthetic Event That This Person Must Never See';

const probe = p => p.evaluate(() => {
  const t = document.querySelector('#eventTitle'), n = document.querySelector('#eventTitleName');
  const r = t.getBoundingClientRect();
  return {hidden: t.hidden, text: n.textContent, titleAttr: n.title, switchHidden: document.querySelector('#eventSwitch').hidden,
    overflowX: document.documentElement.scrollWidth - innerWidth, right: Math.round(r.right), left: Math.round(r.left), width: innerWidth,
    height: Math.round(r.height), clipped: n.scrollWidth > n.clientWidth + 1, body: document.body.innerText};
});

test('single-event staff see the authorized event name; multi-event staff keep the selector', {timeout: 240000}, async () => {
  const w = await createBrowserWorld();
  try {
    await w.fake.local.admin('update fftt_private.events set event_name=$1 where id=$2', [LONG, w.eventId]);
    const [other] = await w.fake.local.admin("insert into fftt_private.events(event_name,event_date,created_by) values ($1,'2099-01-02',$2) returning id", [OTHER, w.ids.org]);

    // Scorekeeper with one event, at phone / tablet / desktop widths: name shown, never clipped, no switcher, no other event exposed.
    for (const width of [390, 820, 1440]) {
      const d = await w.device('sk-' + width, {viewport: {width, height: 900}});
      await d.signIn('a', {keep: true});
      const p = d.page;
      await p.locator('#eventTitle:not([hidden])').waitFor({timeout: T});
      let g = await probe(p);
      assert.equal(g.text, LONG);
      assert.equal(g.titleAttr, LONG);
      assert.equal(g.switchHidden, true);
      assert.ok(g.overflowX <= 1, `horizontal overflow at ${width}: ${g.overflowX}`);
      assert.ok(g.left >= 0 && g.right <= g.width, `title outside viewport at ${width}`);
      assert.equal(g.clipped, false, `title clipped at ${width}`);
      assert.ok(g.height > 0);
      assert.ok(!g.body.includes(OTHER), 'an unassigned event name must never be rendered');
      await p.reload();
      await p.locator('#eventTitle:not([hidden])').waitFor({timeout: T});
      g = await probe(p);
      assert.equal(g.text, LONG, 'the name survives refresh and session restoration');
      await d.context.close();
    }

    // A second assignment brings back the selector and removes the title; revoking it restores the title after refresh.
    await w.fake.local.admin("insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'scorekeeper')", [other.id, w.ids.a]);
    const multi = await w.device('multi', {viewport: {width: 1440, height: 900}});
    await multi.signIn('a', {keep: true, choose: LONG.slice(0, 20)});
    await multi.page.locator('#eventSwitch:not([hidden])').waitFor({timeout: T});
    let g = await probe(multi.page);
    assert.equal(g.hidden, true); assert.equal(g.switchHidden, false);
    await multi.page.locator('#eventSelect').selectOption(other.id);
    await multi.page.locator('.statusline .pill.good').waitFor({timeout: T});
    await multi.page.waitForTimeout(2500);   // let the switch finish before switching again
    g = await probe(multi.page);
    assert.equal(g.hidden, true, 'the title stays hidden while the selector is available after switching events');
    await multi.page.locator('#eventSelect').selectOption(w.eventId);
    await multi.page.waitForFunction(id => document.querySelector('#eventSelect').value === id, w.eventId);
    await multi.page.waitForTimeout(2500);   // the switch must be committed before the other grant is revoked
    await w.fake.local.admin('update fftt_private.event_staff set active=false, revoked_at=now() where event_id=$1 and user_id=$2', [other.id, w.ids.a]);
    await multi.page.reload();
    await multi.page.locator('#app:not([hidden])').waitFor({timeout: T});
    await multi.page.locator('#eventTitle:not([hidden])').waitFor({timeout: T});
    g = await probe(multi.page);
    assert.equal(g.text, LONG); assert.equal(g.switchHidden, true); assert.ok(!g.body.includes(OTHER), 'a revoked event is no longer exposed');
    await multi.context.close();

    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});
