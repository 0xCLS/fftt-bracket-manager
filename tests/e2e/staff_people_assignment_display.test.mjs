/** Regression: the People directory must show the server's actual grants.
 *  An unassigned person is "No events" + "Select role" (never the current event + Scorekeeper), and Save stays disabled until
 *  an explicit valid change is made. Fictional accounts and a local PGlite database only; no hosted system is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld} from './browser_world.mjs';

const T = 20000;
const SECOND = 'Second synthetic event';

test('People directory: unassigned, pending, unverified, assigned and revoked staff display actual server state', {timeout: 240000}, async () => {
  const w = await createBrowserWorld();
  try {
    const [other] = await w.fake.local.admin(
      "insert into fftt_private.events(event_name,event_date,created_by) values ($1,'2099-01-02',$2) returning id", [SECOND, w.ids.org]);
    await w.fake.local.admin("insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer')", [other.id, w.ids.org]);
    // b is assigned to BOTH events, so revoking is observable per event.
    await w.fake.local.admin("insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'scorekeeper')", [other.id, w.ids.b]);
    // Active grants only: revocation is a soft `active=false`, so history is preserved.
    const grants = async () => (await w.fake.local.admin(
      'select event_id, user_id, role from fftt_private.event_staff where active order by event_id, user_id')).map(r => `${r.event_id}|${r.user_id}|${r.role}`);
    const before = await grants();

    const UNASSIGNED = 'unassigned-person@fftt-staging.invalid', PENDING = 'pending-invite@fftt-staging.invalid', UNVERIFIED = 'unverified-person@fftt-staging.invalid';
    const people = [
      {email: w.accounts.a[0], name: 'Assigned Scorekeeper A', verified: true, provisioned: true},
      {email: w.accounts.b[0], name: 'Assigned Scorekeeper B', verified: true, provisioned: true},
      {email: UNASSIGNED, name: 'Verified Unassigned', verified: true, provisioned: true},
      {email: PENDING, name: 'Invitation Pending', verified: false, provisioned: true},
      {email: UNVERIFIED, name: 'Identity Unverified', verified: false, provisioned: false},
    ];

    // Mobile first: the desktop pass ends by revoking B's grants in the local fictional database.
    for (const width of [390, 1440]) {
      const d = await w.device('people-' + width, {viewport: {width, height: 900}});
      await d.context.route('**/api/staff-directory', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({people})}));
      await d.signIn('org', {keep: true, event: w.eventId});
      const p = d.page;
      const openStaff = async () => {
        await p.locator('nav.tabs button[data-tab="staff"]').click();
        await p.locator('.people-row').first().waitFor({timeout: T});
      };
      const row = email => p.locator(`.people-row[data-person="${email}"]`);
      const state = async email => row(email).evaluate(el => ({
        summary: el.querySelector('summary').innerText.trim(),
        checked: [...el.querySelectorAll('.people-event-menu input:checked')].length,
        role: el.querySelector('select').value,
        roleText: el.querySelector('select').selectedOptions[0]?.textContent,
        saveDisabled: el.querySelector('.people-action-cell .primary').disabled,
        removeDisabled: el.querySelector('.people-remove').disabled,
      }));
      const toggle = async (email, eventName) => {
        const r = row(email);
        if (!(await r.locator('.people-event-menu').isVisible())) await r.locator('summary').click();
        await r.locator('.people-event-option', {hasText: eventName}).locator('strong').click();
      };
      await openStaff();
      // Assignment disclosures are mutually exclusive and close on role focus,
      // outside interaction, Escape and navigation, without changing grants.
      const aMenu = row(w.accounts.a[0]).locator('.people-event-dropdown');
      const bMenu = row(w.accounts.b[0]).locator('.people-event-dropdown');
      await bMenu.locator('summary').click();
      assert.equal(await bMenu.evaluate(el => el.open), true);
      await aMenu.locator('summary').click();
      assert.equal(await bMenu.evaluate(el => el.open), false);
      assert.equal(await aMenu.evaluate(el => el.open), true);
      await row(w.accounts.a[0]).locator('select').focus();
      assert.equal(await aMenu.evaluate(el => el.open), false, 'role control closes assignment');
      await aMenu.locator('summary').click();
      await p.getByRole('searchbox', {name: 'Search staff members'}).click();
      assert.equal(await aMenu.evaluate(el => el.open), false, 'outside click closes assignment');
      await aMenu.locator('summary').click();
      await p.keyboard.press('Escape');
      assert.equal(await aMenu.evaluate(el => el.open), false, 'Escape closes assignment');
      await aMenu.locator('summary').click();
      await p.locator('nav.tabs button[data-tab="overview"]').click();
      await openStaff();
      assert.equal(await p.locator('.people-event-dropdown[open]').count(), 0, 'tab change clears menus');
      assert.deepEqual(await grants(), before, 'menu interactions do not change grants');

      // 1-3. Unassigned, pending and unverified people: no events, no checked boxes, placeholder role, Save disabled.
      for (const email of [UNASSIGNED, PENDING, UNVERIFIED]) {
        const s = await state(email);
        assert.equal(s.summary, 'No events', `${email}: no events @ ${width}`);
        assert.equal(s.checked, 0, `${email}: no checked boxes @ ${width}`);
        assert.equal(s.role, '', `${email}: no role chosen @ ${width}`);
        assert.equal(s.roleText, 'Select role', `${email}: placeholder, not Scorekeeper @ ${width}`);
        assert.equal(s.saveDisabled, true, `${email}: Save disabled @ ${width}`);
        assert.equal(s.removeDisabled, false, 'the X removal button remains available');
      }

      // 4. Assigned people display the server's real events and roles.
      const a = await state(w.accounts.a[0]);
      assert.match(a.summary, /Synthetic Rehearsal Games/);
      assert.doesNotMatch(a.summary, new RegExp(SECOND));
      assert.deepEqual([a.checked, a.role, a.saveDisabled], [1, 'scorekeeper', true], 'A: one event, real role, nothing to save');
      const b = await state(w.accounts.b[0]);
      assert.match(b.summary, /Synthetic Rehearsal Games/);
      assert.match(b.summary, new RegExp(SECOND));
      assert.deepEqual([b.checked, b.role, b.saveDisabled], [2, 'scorekeeper', true]);

      // Save-state for the verified unassigned person: an event alone, or a role alone, is not a valid change.
      await toggle(UNASSIGNED, SECOND);
      assert.equal((await state(UNASSIGNED)).summary, SECOND);
      assert.equal((await state(UNASSIGNED)).saveDisabled, true, 'event without an explicit role: Save disabled');
      await toggle(UNASSIGNED, SECOND);
      assert.equal((await state(UNASSIGNED)).summary, 'No events');
      await row(UNASSIGNED).locator('select').selectOption('bracket_manager');
      assert.equal((await state(UNASSIGNED)).saveDisabled, true, 'role without an event: Save disabled');
      await toggle(UNASSIGNED, SECOND);
      assert.equal((await state(UNASSIGNED)).saveDisabled, false, 'explicit event + explicit role: Save enabled');
      await toggle(UNASSIGNED, SECOND);
      assert.equal((await state(UNASSIGNED)).saveDisabled, true, 'undoing the change disables Save again');

      // Pending / unverified people can never be saved, even after an explicit change.
      for (const email of [PENDING, UNVERIFIED]) {
        await row(email).locator('select').selectOption('scorekeeper');
        await toggle(email, SECOND);
        assert.equal((await state(email)).saveDisabled, true, `${email}: Save stays disabled until verified`);
      }

      // Assigned person: changing only the role is a valid change; reverting disables Save.
      await row(w.accounts.a[0]).locator('select').selectOption('bracket_manager');
      assert.equal((await state(w.accounts.a[0])).saveDisabled, false);
      await row(w.accounts.a[0]).locator('select').selectOption('scorekeeper');
      assert.equal((await state(w.accounts.a[0])).saveDisabled, true);

      // Refresh discards unsaved choices and reloads server truth.
      await p.getByRole('button', {name: 'Refresh', exact: true}).click();
      await p.locator('.people-row').first().waitFor({timeout: T});
      for (const email of [UNASSIGNED, PENDING, UNVERIFIED]) assert.equal((await state(email)).roleText, 'Select role', 'Refresh restores the placeholder');
      // Event switching must not change who looks assigned.
      await p.locator('#eventSelect').selectOption(other.id);
      await p.locator('nav.tabs button[aria-current="page"][data-tab="overview"]').waitFor({timeout: T});
      await openStaff();
      for (const email of [UNASSIGNED, PENDING, UNVERIFIED]) {
        const s = await state(email);
        assert.deepEqual([s.summary, s.checked, s.roleText], ['No events', 0, 'Select role'], `${email} after switching events @ ${width}`);
      }
      assert.equal((await state(w.accounts.a[0])).checked, 1, 'A still has only the real event after switching');
      await p.locator('#eventSelect').selectOption(w.eventId);
      await p.locator('nav.tabs button[aria-current="page"][data-tab="overview"]').waitFor({timeout: T});
      await p.waitForFunction(id => document.querySelector('#eventSelect')?.value === id, w.eventId, {timeout: T});
      await openStaff();

      // Mobile layout: no horizontal overflow, controls inside the viewport, Save clear of the role select.
      const geo = await row(UNASSIGNED).evaluate(el => {
        const r = n => el.querySelector(n).getBoundingClientRect();
        return {sum: r('summary').toJSON(), role: r('select').toJSON(), save: r('.people-action-cell .primary').toJSON(), x: r('.people-remove').toJSON(),
          overflow: document.documentElement.scrollWidth - innerWidth, vw: innerWidth};
      });
      assert.ok(geo.overflow <= 1, `no page overflow @ ${width}`);
      for (const k of ['sum', 'role', 'save', 'x']) assert.ok(geo[k].left >= 0 && geo[k].right <= geo.vw + 1, `${k} inside viewport @ ${width}`);
      assert.ok(geo.role.right <= geo.save.left + 2 || geo.save.top >= geo.role.bottom + 4, `Save clear of Role @ ${width}`);

      if (width === 1440) {
        // 5. Unchecking one assigned event and saving revokes only that event; the other stays.
        await toggle(w.accounts.b[0], SECOND);
        assert.equal((await state(w.accounts.b[0])).saveDisabled, false);
        await row(w.accounts.b[0]).locator('.people-action-cell .primary').click();
        const dlg = p.locator('dialog[open]', {hasText: 'Save staff assignments?'});
        await dlg.waitFor();
        assert.match(await dlg.innerText(), new RegExp('Remove access: ' + SECOND));
        assert.doesNotMatch(await dlg.innerText(), /Synthetic Rehearsal Games/, 'only the unchecked event is revoked');
        await dlg.locator('button', {hasText: 'Save changes'}).click();
        await p.locator('.toast, [role="status"], [aria-live]', {hasText: /Event access updated/}).first().waitFor({timeout: T});
        const after = await grants();
        assert.deepEqual(before.filter(g => !after.includes(g)), [`${other.id}|${w.ids.b}|scorekeeper`], 'exactly one grant removed');
        assert.deepEqual(after.filter(g => !before.includes(g)), [], 'no grant was added');
        await p.locator('.people-row').first().waitFor({timeout: T});
        const b2 = await state(w.accounts.b[0]);
        assert.deepEqual([b2.checked, b2.role], [1, 'scorekeeper'], 'server truth reloaded: one event remains');
        assert.doesNotMatch(b2.summary, new RegExp(SECOND));

        // 6. Fully revoked: after the server removes the last grant the person looks unassigned, not Scorekeeper.
        await toggle(w.accounts.b[0], 'Synthetic Rehearsal Games');
        await row(w.accounts.b[0]).locator('.people-action-cell .primary').click();
        await p.locator('dialog[open] button', {hasText: 'Save changes'}).click();
        for (let i = 0; i < 100 && (await grants()).some(g => g.includes(w.ids.b)); i++) await p.waitForTimeout(100);
        await p.waitForFunction(() => !document.querySelector('dialog[open]'), null, {timeout: T});
        await p.waitForTimeout(1000);  // the directory reload and repaint that follow the write
        const b3 = await state(w.accounts.b[0]);
        assert.deepEqual([b3.summary, b3.checked, b3.roleText, b3.saveDisabled], ['No events', 0, 'Select role', true], 'revoked person');
        assert.deepEqual((await grants()).filter(g => g.includes(w.ids.b)), [], 'B has no grant left');
        assert.ok((await grants()).some(g => g.includes(w.ids.a)), 'A is untouched');
      }
      await d.context.close();
    }
    // Nothing was granted to anyone else, and no hosted system was involved (fictional PGlite only).
    const finalGrants = await grants();
    assert.deepEqual(before.filter(g => !finalGrants.includes(g)).every(g => g.includes(w.ids.b)), true, 'only B (the revoke test) lost access');
    assert.deepEqual(finalGrants.filter(g => !before.includes(g)), [], 'no new grant anywhere');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('assignment labels, explicit saves and failure recovery use server truth on desktop and mobile', {timeout: 240000}, async () => {
  for (const width of [390, 1440]) {
    const w = await createBrowserWorld();
    try {
      const [other] = await w.fake.local.admin("insert into fftt_private.events(event_name,event_date,created_by) values ($1,'2099-01-02',$2) returning id", [SECOND, w.ids.org]);
      await w.fake.local.admin("insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer')", [other.id, w.ids.org]);
      const email='fictional-new@fftt-staging.invalid';
      const userId=await w.fake.addAccount(email,'fictional-password-123');
      const people=[{email,name:'New Volunteer',verified:true,provisioned:true},
        {email:w.accounts.a[0],name:'Assigned Scorekeeper A',verified:true,provisioned:true}];
      const deviceName='assignment-'+width;
      const d=await w.device(deviceName,{viewport:{width,height:900},mobile:width===390});
      let directoryOffline=false;
      await d.context.route('**/api/staff-directory', route=>route.fulfill({status:directoryOffline?503:200,contentType:'application/json',body:JSON.stringify(directoryOffline?{}:{people})}));
      await d.signIn('org',{keep:true,event:w.eventId});
      const p=d.page; await p.locator('nav.tabs button[data-tab="staff"]').click();
      const person=address=>p.locator('.people-row').filter({has:p.getByText(address,{exact:true})});
      await person(email).waitFor({timeout:T});
      const assignments=async id=>(await w.fake.local.admin('select event_id,role from fftt_private.event_staff where user_id=$1 and active order by event_id',[id])).map(x=>`${x.event_id}:${x.role}`);
      const toggle=async (address,eventName)=>{
        const row=person(address), menu=row.locator('.people-event-dropdown');
        if (!await menu.evaluate(el=>el.open)) await menu.locator('summary').click();
        await menu.locator('.people-event-option',{hasText:eventName}).locator('strong').click();
      };
      const save=address=>person(address).getByRole('button',{name:'Save',exact:true});
      const confirm=()=>p.getByRole('dialog',{name:'Save staff assignments?'});
      const clearToasts=async()=>{const box=p.locator('#toasts');if(await box.count())await box.evaluate(el=>el.replaceChildren());};
      const submit=async (address,phrase)=>{
        await clearToasts();
        await save(address).click(); const dlg=confirm(); await dlg.waitFor();
        assert.match(await dlg.innerText(),phrase);
        await dlg.getByRole('button',{name:'Save changes'}).click();
        await p.getByText('Event access updated.',{exact:true}).last().waitFor({timeout:T});
        await p.waitForFunction(() => !document.querySelector('dialog[open]'),null,{timeout:T});
      };
      // Label click selects visibly and survives closing, but no role means no grant.
      await toggle(email,'Synthetic Rehearsal Games');
      assert.equal(await person(email).locator('input:checked').count(),1, 'one event-name click checks immediately');
      assert.match(await person(email).locator('summary').innerText(),/Synthetic Rehearsal Games/);
      const option=person(email).locator('.people-event-option',{hasText:'Synthetic Rehearsal Games'});
      await option.locator('input').click();
      assert.equal(await option.locator('input').isChecked(),false, 'one checkbox click unchecks immediately');
      assert.match(await person(email).locator('summary').innerText(),/No events/);
      await option.click({position:{x:4,y:4}});
      assert.equal(await option.locator('input').isChecked(),true, 'one row click checks immediately');
      assert.match(await person(email).locator('summary').innerText(),/Synthetic Rehearsal Games/);
      assert.equal(await save(email).isDisabled(),true, 'a role is still required before granting access');
      await p.getByRole('searchbox',{name:'Search staff members'}).click();
      assert.equal(await person(email).locator('details').evaluate(el=>el.open),false);
      assert.match(await person(email).locator('summary').innerText(),/Synthetic Rehearsal Games/);
      assert.equal(await save(email).isDisabled(),true);
      await person(email).locator('select').selectOption('scorekeeper');
      assert.equal(await save(email).isEnabled(),true);
      await save(email).click(); await confirm().getByRole('button',{name:'Cancel'}).click();
      assert.deepEqual(await assignments(userId),[], 'cancel grants nothing');
      await submit(email,/Grant Scorekeeper access: Synthetic Rehearsal Games/);
      assert.deepEqual(await assignments(userId),[`${w.eventId}:scorekeeper`]);
      await p.getByRole('button',{name:'Refresh',exact:true}).click();
      const addStaff=p.getByRole('button',{name:'+ Add Staff'});
      for(let i=0;i<100 && !await addStaff.isEnabled();i++) await p.waitForTimeout(100);
      assert.equal(await addStaff.isEnabled(),true, 'directory refresh completed');
      await person(email).locator('summary').waitFor({timeout:T});
      assert.match(await person(email).locator('summary').innerText(),/Synthetic Rehearsal Games/);
      assert.equal(await save(email).isDisabled(),true);
      // Add another event, remove one, then remove the final event with the existing role.
      await toggle(email,SECOND); await submit(email,/Grant Scorekeeper access: Second synthetic event/);
      assert.equal((await assignments(userId)).length,2);
      await toggle(email,SECOND); await submit(email,/Remove access: Second synthetic event/);
      assert.deepEqual(await assignments(userId),[`${w.eventId}:scorekeeper`]);
      await toggle(email,'Synthetic Rehearsal Games'); await submit(email,/Remove access: Synthetic Rehearsal Games/);
      assert.deepEqual(await assignments(userId),[]);
      assert.match(await person(email).locator('summary').innerText(),/No events/);
      // An already assigned member can add and remove a second event without disturbing the original grant.
      await toggle(w.accounts.a[0],SECOND); await submit(w.accounts.a[0],/Grant Scorekeeper access: Second synthetic event/);
      assert.equal((await assignments(w.ids.a)).length,2);
      await toggle(w.accounts.a[0],SECOND); await submit(w.accounts.a[0],/Remove access: Second synthetic event/);
      assert.deepEqual(await assignments(w.ids.a),[`${w.eventId}:scorekeeper`]);
      // A failed request does not leave a stale draft displayed; the server was reloaded.
      await person(email).locator('select').selectOption('scorekeeper'); await toggle(email,SECOND);
      w.fake.failNext(deviceName,'/rest/v1/rpc/fftt_set_staff_v3',503);
      await clearToasts(); await save(email).click(); await confirm().getByRole('button',{name:'Save changes'}).click();
      await p.getByText(/change was not fully confirmed/i).last().waitFor({timeout:T});
      assert.deepEqual(await assignments(userId),[]);
      assert.match(await person(email).locator('summary').innerText(),/No events/);
      assert.equal(await save(email).isDisabled(),true);
      // A lost response can still have applied the grant: reload must display what actually happened.
      await person(email).locator('select').selectOption('scorekeeper'); await toggle(email,SECOND);
      w.fake.loseNextReply(deviceName,'/rest/v1/rpc/fftt_set_staff_v3');
      await clearToasts(); await save(email).click(); await confirm().getByRole('button',{name:'Save changes'}).click();
      await p.getByText(/change was not fully confirmed/i).last().waitFor({timeout:T});
      assert.deepEqual(await assignments(userId),[`${other.id}:scorekeeper`]);
      assert.match(await person(email).locator('summary').innerText(),/Second synthetic event/);
      assert.equal(await save(email).isDisabled(),true);
      // If the follow-up directory read fails, do not claim it was reloaded or permit another edit.
      await toggle(email,'Synthetic Rehearsal Games');
      w.fake.failNext(deviceName,'/rest/v1/rpc/fftt_set_staff_v3',503); directoryOffline=true;
      await clearToasts(); await save(email).click(); await confirm().getByRole('button',{name:'Save changes'}).click();
      await p.getByText(/staff directory could not be refreshed/i).last().waitFor({timeout:T});
      assert.equal(await save(email).isDisabled(),true, 'unverified directory is read-only');
      assert.deepEqual(await assignments(userId),[`${other.id}:scorekeeper`]);
      assert.deepEqual(await assignments(w.ids.a),[`${w.eventId}:scorekeeper`], 'other staff grants unchanged');
      await assert.rejects(w.fake.local.rpc(w.ids.a,'fftt_set_staff_v3',{p_event_id:other.id,p_email:email,p_action:'grant',p_role:'organizer'}));
      await person(email).locator('summary').click();
      await p.locator('#signOut').click();
      await p.locator('#signin:not([hidden])').waitFor({timeout:T});
      assert.equal(await p.locator('.people-row:visible').count(),0, 'sign-out hides private staff data even with a menu open');
      assert.deepEqual(w.pageErrors,[]);
    } finally { await w.close(); }
  }
});
