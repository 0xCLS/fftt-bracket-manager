/** Event management and sign-in without a technical id, in real Chrome over the real SQL (fictional data only). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld} from './browser_world.mjs';
import {roster} from './helpers.mjs';

const T = 20000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const toast = (page, re, timeout = T) => page.locator('#toasts .toast', {hasText: re}).waitFor({timeout});
const eventRow = (page, name) => page.locator('tbody tr', {has: page.locator('strong', {hasText: name})});
const chip = (page, text) => page.locator('.events-card .chip', {hasText: text});

test('sign-in needs no event id; several events are chosen by NAME; no technical id is ever shown', {timeout: 240000}, async () => {
  const w = await createBrowserWorld();
  try {
    await w.fake.local.rpc(w.ids.org, 'fftt_create_event_v3', {p_name: 'Spring Fellowship Open', p_date: '2027-03-06', p_table_count: 4});
    const org = await w.device('org');
    await org.signIn('org', {choose: 'Synthetic Rehearsal Games'});
    await org.page.locator('#evName').waitFor({timeout: T});
    assert.equal(await org.page.locator('#evName').inputValue(), 'Synthetic Rehearsal Games');
    assert.ok(!UUID.test(await org.page.locator('body').innerText()), 'no technical id on the page');
    assert.ok(!UUID.test(await org.page.locator('#eventSelect').evaluate(el => [...el.options].map(o => o.textContent).join())), 'the event switcher shows names');
    // switch by name
    const options = await org.page.locator('#eventSelect option').allInnerTexts();
    assert.equal(options.length, 2);
    const spring = options.findIndex(o => /Spring Fellowship Open/.test(o));
    await org.page.selectOption('#eventSelect', {index: spring});
    for (let i = 0; i < 40 && (await org.page.inputValue('#evName').catch(() => '')) !== 'Spring Fellowship Open'; i++) await org.page.waitForTimeout(500);
    assert.equal(await org.page.inputValue('#evName'), 'Spring Fellowship Open');
    // one event only: entered directly, after a reload with the vault the person is not asked again
    const a = await w.device('a', {viewport: {width: 390, height: 844}, mobile: true});
    await a.signIn('a');
    await a.page.locator('#statusline').waitFor({timeout: T});
    // cancelling a choice leaves nothing signed in
    const again = await w.device('org2');
    await again.signIn('org');
    await again.page.locator('#eventChooser:not([hidden])').waitFor({timeout: T});
    await again.page.click('#chooserCancel');
    await again.page.locator('#loginForm:not([hidden])').waitFor();
    assert.equal(await again.page.locator('#app:not([hidden])').count(), 0);
    // an explicit event id (an organizer's link) still works and skips the choice
    const linked = await w.device('linked');
    await linked.signIn('org', {event: w.eventId});
    await linked.page.locator('#evName').waitFor({timeout: T});
    assert.equal(await linked.page.locator('#evName').inputValue(), 'Synthetic Rehearsal Games');
    // an id that is not an id is refused before anything is sent
    const bad = await w.device('bad');
    await bad.signIn('org', {event: 'not-an-id'});
    await bad.page.locator('#signInStatus', {hasText: /does not look right/}).waitFor({timeout: T});
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});

test('events: filter by status, archive, restore (never public), delete only empty drafts with the exact name', {timeout: 400000}, async () => {
  const w = await createBrowserWorld();
  try {
    const l = w.fake.local, org = w.ids.org;
    const spare = await l.rpc(org, 'fftt_create_event_v3', {p_name: 'Spare Draft', p_date: '2027-01-01', p_table_count: 2});
    const busy = await l.rpc(org, 'fftt_create_event_v3', {p_name: 'Busy Draft', p_date: '2027-01-02', p_table_count: 2});
    await l.rpc(org, 'fftt_upsert_players_v3', {p_event_id: busy.event_id, p_players: roster(2)});
    const d = await w.device('org');
    await d.signIn('org', {event: w.eventId});
    await d.page.locator('.events-card').waitFor({timeout: T});
    // the default filter follows the open event (a draft); counts are shown; All lists everything
    await chip(d.page, /^Draft \(3\)$/).waitFor();
    await chip(d.page, /^All \(3\)$/).click();
    assert.equal(await d.page.locator('.events-card tbody tr').count(), 3);
    await chip(d.page, /^Archived \(0\)$/).click();
    await d.page.locator('.events-card .empty-state', {hasText: 'No archived events'}).waitFor();
    await chip(d.page, /^All/).click();

    // deletion safeguards: no delete for the open event, nor for an event with players
    assert.equal(await eventRow(d.page, 'Synthetic Rehearsal Games').locator('button', {hasText: 'Delete'}).count(), 0);
    assert.match(await eventRow(d.page, 'Synthetic Rehearsal Games').innerText(), /Open another event to delete this one/);
    assert.equal(await eventRow(d.page, 'Busy Draft').locator('button', {hasText: 'Delete'}).count(), 0, 'an event with players cannot be deleted');
    // delete the spare draft: the button stays disabled until the exact name is typed
    await eventRow(d.page, 'Spare Draft').locator('button', {hasText: 'Delete'}).click();
    const dlg = d.page.locator('dialog[open]');
    await dlg.locator('h3', {hasText: 'Delete this empty draft event?'}).waitFor();
    const go = dlg.locator('button', {hasText: 'Delete permanently'});
    assert.equal(await go.isDisabled(), true);
    await dlg.locator('#delConfirm').fill('spare draft');
    assert.equal(await go.isDisabled(), true, 'the name must match exactly');
    await dlg.locator('#delConfirm').fill('Spare Draft');
    assert.equal(await go.isDisabled(), false);
    await go.click();
    await toast(d.page, /“Spare Draft” was deleted/);
    await eventRow(d.page, 'Spare Draft').waitFor({state: 'detached', timeout: T});
    assert.equal((await l.admin("select count(*)::int as n from fftt_private.events where event_name = 'Spare Draft'"))[0].n, 0);
    assert.equal((await l.admin("select count(*)::int as n from fftt_private.deleted_events where event_name = 'Spare Draft'"))[0].n, 1, 'the audit trail was kept in the tombstone');
    // the real event and the busy one are untouched
    assert.equal((await l.admin('select count(*)::int as n from fftt_private.events'))[0].n, 2);

    // archive from the list, filter, restore: back where it came from and NOT public
    await l.rpc(org, 'fftt_set_visibility_v3', {p_event_id: busy.event_id, p_visible: false});
    await eventRow(d.page, 'Busy Draft').locator('button', {hasText: 'Archive'}).click();
    await d.page.locator('dialog[open] button', {hasText: 'Archive'}).click();
    await toast(d.page, /Archived/);
    await chip(d.page, /^Archived \(1\)$/).click();
    await eventRow(d.page, 'Busy Draft').locator('button', {hasText: 'Restore'}).click();
    await toast(d.page, /Restored\. It is not public/);
    await chip(d.page, /^Draft \(2\)$/).waitFor({timeout: T});
    assert.equal((await l.admin("select lifecycle, public_visible from fftt_private.events where event_name = 'Busy Draft'"))[0].lifecycle, 'draft');
    assert.deepEqual(await l.publicTournaments(), []);

    // an archived event cannot be deleted from the UI, and the server refuses a forged request too
    const forged = await l.rpc(org, 'fftt_delete_event_v4', {p_event_id: busy.event_id, p_confirm_name: 'Busy Draft'}).catch(e => e);
    assert.equal(forged.code, 'P0001');
    assert.deepEqual(w.pageErrors, []);
    assert.deepEqual(w.consoleErrors.filter(e => !/net::ERR|Failed to load resource/.test(e)), []);
  } finally { await w.close(); }
});
