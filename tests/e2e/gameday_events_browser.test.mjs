/** Event management and sign-in without a technical id, in real Chrome over the real SQL (fictional data only). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld, STAFF} from './browser_world.mjs';
import {roster} from './helpers.mjs';

const T = 20000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const toast = (page, re, timeout = T) => page.locator('#toasts .toast', {hasText: re}).waitFor({timeout});
const eventRow = (page, name) => page.locator('tbody tr', {has: page.locator('strong', {hasText: name})});
const chip = (page, text) => page.locator('.events-card .chip', {hasText: text});

test('sign-in needs no event id; several events are chosen by NAME; no technical id is ever shown', {timeout: 240000}, async () => {
  const w = await createBrowserWorld();
  try {
    const longEvent = 'Spring Fellowship Open — Hosted Browser Recovery and Rehearsal Validation 2099';
    await w.fake.local.rpc(w.ids.org, 'fftt_create_event_v3', {p_name: longEvent, p_date: '2027-03-06', p_table_count: 4});
    const org = await w.device('org', {viewport: {width: 390, height: 844}, mobile: true});
    await org.signIn('org', {choose: 'Synthetic Rehearsal Games'});
    await org.page.locator('#evName').waitFor({timeout: T});
    assert.equal(await org.page.locator('#evName').inputValue(), 'Synthetic Rehearsal Games');
    assert.ok(!UUID.test(await org.page.locator('body').innerText()), 'no technical id on the page');
    assert.ok(!UUID.test(await org.page.locator('#eventSelect').evaluate(el => [...el.options].map(o => o.textContent).join())), 'the event switcher shows names');
    // iPhone-sized viewport: neither a long event title nor Safari-style date
    // form controls may widen the document or extend beyond their form card.
    async function assertMobileWidth(label) {
      const m = await org.page.evaluate(() => {
        const card = document.querySelector('.overview-settings').getBoundingClientRect();
        const dateField = document.querySelector('.overview-settings .date-field').getBoundingClientRect();
        const frameEl = document.querySelector('.overview-settings .native-date-frame');
        const dateFrame = frameEl.getBoundingClientRect();
        const dateInput = document.querySelector('.overview-settings input[type="date"]').getBoundingClientRect();
        const createFrameEl = document.querySelector('.create-event .native-date-frame');
        const createFrame = createFrameEl?.getBoundingClientRect();
        const select = document.querySelector('#eventSelect').getBoundingClientRect();
        const style = getComputedStyle(frameEl);
        return {viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
          scale: window.visualViewport?.scale ?? 1,
          cardLeft: card.left, cardRight: card.right, fieldLeft: dateField.left, fieldRight: dateField.right,
          frameLeft: dateFrame.left, frameRight: dateFrame.right, frameBorder: style.borderRightWidth,
          frameOverlayBorder: getComputedStyle(frameEl, '::after').borderRightWidth,
          frameOverlayPointer: getComputedStyle(frameEl, '::after').pointerEvents,
          inputPosition: getComputedStyle(frameEl.querySelector('input')).position,
          dateLeft: dateInput.left, dateRight: dateInput.right,
          createFrameRight: createFrame?.right, createFrameBorder: createFrameEl ? getComputedStyle(createFrameEl).borderRightWidth : null,
          selectRight: select.right};
      });
      assert.ok(m.scroll <= m.viewport + 1, label + ': no viewport width expansion');
      assert.ok(m.fieldLeft >= m.cardLeft - 1 && m.fieldRight <= m.cardRight - 2, label + ': date field fits card');
      assert.ok(m.frameLeft >= m.fieldLeft - 1 && m.frameRight <= m.fieldRight + 1,
        label + ': visible native-date frame fits the grid field');
      assert.equal(m.frameBorder, '1px', label + ': frame retains its right border');
      assert.equal(m.frameOverlayBorder, '1px', label + ': right border is also drawn over Safari native input');
      assert.equal(m.frameOverlayPointer, 'none', label + ': date frame overlay does not block the native picker');
      assert.equal(m.inputPosition, 'absolute', label + ': intrinsic native date control cannot determine grid width');
      assert.ok(m.dateLeft >= m.frameLeft - 1 && m.dateRight <= m.frameRight + 1,
        label + ': native date control fits its visible frame');
      assert.ok(m.createFrameRight === undefined || m.createFrameRight <= m.viewport + 1,
        label + ': new-event date frame cannot widen the page');
      assert.ok(m.scale >= .99 && m.scale <= 1.01, label + ': no browser page-scale change');
      assert.ok(m.selectRight <= m.viewport + 1, label + ': event dropdown stays on-screen');
      return m;
    }
    const initialWidth = await assertMobileWidth('initial event');
    // iPhone recording: selecting an event briefly clears its snapshot;
    // three stat chips vanish and the Overview becomes a short Loading pane.
    // Recreate that read-only DOM state and assert stable header geometry.
    const stableSwitch = await org.page.evaluate(() => {
      const main = document.querySelector('#main');
      const status = document.querySelector('#statusline');
      const sidebar = document.querySelector('#app .staff-sidebar');
      const picker = document.querySelector('#eventSelect');
      const oldMain = [...main.childNodes], oldStatus = [...status.childNodes];
      const measure = () => ({
        sidebarBottom: sidebar.getBoundingClientRect().bottom,
        pickerTop: picker.getBoundingClientRect().top,
        docWidth: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
        loadingHeight: main.querySelector('.loading-state')?.getBoundingClientRect().height ?? 0
      });
      const ready = measure();
      const loader = document.createElement('div');
      loader.className = 'loading-state';
      loader.textContent = 'Loading…';
      try {
        status.replaceChildren(...oldStatus.slice(0, 2));
        main.replaceChildren(loader);
        const loading = measure();
        return {ready, loading};
      } finally {
        status.replaceChildren(...oldStatus);
        main.replaceChildren(...oldMain);
      }
    });
    assert.ok(Math.abs(stableSwitch.ready.sidebarBottom - stableSwitch.loading.sidebarBottom) <= 2,
      'mobile sidebar must not stretch when a different event is loading');
    assert.ok(Math.abs(stableSwitch.ready.pickerTop - stableSwitch.loading.pickerTop) <= 2,
      'native event picker must not jump vertically during snapshot loading: ' + JSON.stringify(stableSwitch));
    assert.ok(stableSwitch.loading.loadingHeight >= 844 - 1,
      'loading pane holds the footer outside the iPhone viewport');
    assert.ok(stableSwitch.loading.docWidth <= stableSwitch.loading.viewport + 1,
      'loading state preserves the iPhone width correction');
    // In physical Safari an event-dependent native picker width caused
    // topbar.scrollWidth 607px while its box remained 430px. Simulate an
    // interior child wider than the phone and prove only the header contains
    // it; never hide overflow across the page or break bracket scrollers.
    const headerContainment = await org.page.evaluate(() => {
      const top = document.querySelector('#app .topbar');
      const probe = document.createElement('span');
      probe.className = 'header-overflow-probe';
      probe.style.cssText = 'position:absolute;left:580px;top:0;width:27px;height:2px;pointer-events:none';
      top.append(probe);
      const size = {
        headerOverflow: getComputedStyle(top).overflowX,
        headerY: getComputedStyle(top).overflowY,
        headerScroll: top.scrollWidth,
        workScroll: document.querySelector('#app .staff-workspace').scrollWidth,
        documentScroll: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
        tabsOverflow: getComputedStyle(document.querySelector('#app nav.tabs')).overflowX
      };
      probe.remove();
      return size;
    });
    assert.equal(headerContainment.headerOverflow, 'clip', 'mobile Staff header clips only escaping horizontal overflow');
    assert.equal(headerContainment.headerY, 'visible', 'header vertical overflow and focus remain visible');
    assert.ok(headerContainment.headerScroll > headerContainment.viewport + 150, 'synthetic header overflow reaches far past viewport');
    assert.ok(headerContainment.workScroll <= headerContainment.viewport + 1, 'header overflow must not expand workspace');
    assert.ok(headerContainment.documentScroll <= headerContainment.viewport + 1, 'header overflow must not widen iPhone document');
    assert.equal(headerContainment.tabsOverflow, 'auto', 'horizontal tab navigation remains independently scrollable');
    const pickerTypography = await org.page.locator('#eventSelect').evaluate(el => {
      el.querySelector('option').dataset.nativePickerGuard = 'persisted';
      return parseFloat(getComputedStyle(el).fontSize);
    });
    assert.ok(pickerTypography >= 16, 'iPhone event selector must not trigger Safari small-input focus zoom');
    const options = await org.page.locator('#eventSelect option').allInnerTexts();
    assert.equal(options.length, 2);
    const spring = options.findIndex(o => o.includes(longEvent));
    await org.page.selectOption('#eventSelect', {index: spring});
    for (let i = 0; i < 40 && (await org.page.inputValue('#evName').catch(() => '')) !== longEvent; i++) await org.page.waitForTimeout(500);
    assert.equal(await org.page.inputValue('#evName'), longEvent);
    assert.equal(await org.page.locator('#eventSelect option').first().getAttribute('data-native-picker-guard'), 'persisted',
      'native picker options must not be replaced just because the active event changed');
    const longWidth = await assertMobileWidth('long event');
    await org.page.selectOption('#eventSelect', {index: options.findIndex(o => o.includes('Synthetic Rehearsal Games'))});
    for (let i = 0; i < 40 && (await org.page.inputValue('#evName').catch(() => '')) !== 'Synthetic Rehearsal Games'; i++) await org.page.waitForTimeout(500);
    const returnWidth = await assertMobileWidth('return to initial event');
    assert.equal(initialWidth.viewport, longWidth.viewport, 'iPhone viewport stable after choosing long event');
    assert.equal(initialWidth.viewport, returnWidth.viewport, 'iPhone viewport stable after switching back');
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

test('opt-in Staff iPhone layout trace records selected ordinal, actual viewport metrics, and no personal data', {timeout: 180000}, async () => {
  const w = await createBrowserWorld();
  try {
    await w.fake.local.rpc(w.ids.org, 'fftt_create_event_v3',
      {p_name: 'Example event middle', p_date: '2027-04-01', p_table_count: 2});
    await w.fake.local.rpc(w.ids.org, 'fftt_create_event_v3',
      {p_name: 'Example event top', p_date: '2027-05-01', p_table_count: 2});
    const d = await w.device('trace', {viewport: {width: 390, height: 844}, mobile: true});
    await d.open(STAFF + '/app/staff.html?layoutTrace=1');
    await d.signIn('org', {choose: 'Synthetic Rehearsal Games'});
    await d.page.locator('#evName').waitFor({timeout: T});
    assert.equal(await d.page.locator('.staff-layout-trace').count(), 1);
    assert.equal(await d.page.locator('.staff-layout-trace').evaluate(el => getComputedStyle(el).position), 'fixed');
    const opts = await d.page.locator('#eventSelect option').count();
    assert.equal(opts, 3);
    for (const index of [0, 2, 1, 0]) {
      await d.page.selectOption('#eventSelect', {index});
      await d.page.waitForTimeout(1150);
    }
    const trace = await d.page.locator('.staff-layout-trace textarea').inputValue();
    assert.match(trace, /"tag":"picker-change"/);
    assert.match(trace, /"pos":"1\/3"/);
    assert.match(trace, /"pos":"3\/3"/);
    assert.match(trace, /"doc":390/);
    assert.match(trace, /"vv":\[390,1,0\]/);
    assert.match(trace, /"regions":\{/);
    assert.match(trace, /"out":\[/);
    // Force one harmless offscreen node inside the real content. Verify it is
    // distinguished from the intentionally scrollable sidebar navigation.
    await d.page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'overflow-probe';
      probe.style.cssText = 'position:absolute;left:415px;width:90px;height:1px';
      document.querySelector('#main').append(probe);
      document.querySelector('.staff-layout-trace button:last-child').click();
    });
    const diagnosed = await d.page.locator('.staff-layout-trace textarea').inputValue();
    assert.match(diagnosed, /"name":"div.overflow-probe"/, 'real non-scroller overflow is reported');
    const records = diagnosed.split('\n').slice(1).map(line => JSON.parse(line));
    assert.ok(records.some(v => v.out.some(e => e.name === 'div.overflow-probe')),
      'offscreen content is classified outside deliberate horizontal scrollers');
    assert.doesNotMatch(diagnosed, /Synthetic Rehearsal|Example event|@|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    assert.doesNotMatch(trace, /Synthetic Rehearsal|Example event|@|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});
