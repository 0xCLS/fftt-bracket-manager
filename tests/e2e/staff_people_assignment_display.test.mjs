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
        await r.locator('.people-event-option', {hasText: eventName}).locator('input').click();
      };
      await openStaff();

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
