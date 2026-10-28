/** Registration and check-in in real Chrome, with the adapter running behind the staff origin over the real SQL.
 * Fictional registrants only (the synthetic fixture). Browser-SIMULATED contexts, not physical devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld} from './browser_world.mjs';
import {SYNTHETIC_FORM_CSV} from '../../server/registration/synthetic_fixture.mjs';

const T = 20000;
const goTab = (page, name) => page.locator('nav.tabs button', {hasText: new RegExp('^' + name + '$')}).click();
const toast = (page, re, timeout = T) => page.locator('#toasts .toast', {hasText: re}).waitFor({timeout});
const row = (page, name) => page.locator('.reg-row', {has: page.locator('.reg-name', {hasText: new RegExp('^' + name + '$')})});

test('registration workflow: load, search, one-click and bulk check-in, merge duplicates, walk-in, confirm levels; no contact data anywhere', {timeout: 400000}, async () => {
  const w = await createBrowserWorld();
  try {
    const org = await w.device('org');
    await org.signIn('org');
    await org.page.locator('#evName').waitFor({timeout: T});
    await goTab(org.page, 'Players');
    await org.page.locator('#regLoad').click();
    await org.page.locator('.reg-row').first().waitFor({timeout: T});
    assert.match(await org.page.locator('.reg-meta').innerText(), /Fictional demo data/);
    // the Players screen asks what the deployment can do once (capabilities), and loading is the second, deliberate request
    assert.equal(w.requests.filter(r => r.path === '/api/registrations' && r.auth).length, 2);

    // search
    await org.page.fill('#regSearch', 'ben');
    await org.page.locator('.reg-count', {hasText: 'Showing 1 of 20'}).waitFor();
    await org.page.fill('#regSearch', '');

    // the suggested level and its reasons come from the approved form's exact answers (provisional, until confirmed)
    assert.equal(await org.page.locator('.reg-name', {hasText: /^Ben Marlowe$/}).count(), 1, 'registration list preserves the full sanitized name from the form');
    assert.match(await row(org.page, 'Hal Wintersby').innerText(), /Level 3 · Intermediate\s+Suggested/);
    await row(org.page, 'Hal Wintersby').locator('button', {hasText: 'Edit'}).click();
    const why = await org.page.locator('.reg-basis').innerText();
    assert.match(why, /Chose the Intermediate profile/);
    assert.match(why, /Sustains rallies consistently and controls placement/);
    await row(org.page, 'Hal Wintersby').locator('button', {hasText: 'Done'}).click();
    assert.match(await row(org.page, 'Eli Brandtley').innerText(), /Level 1 · Beginner/);

    // one-click check-in creates the roster player (rating suggested, unconfirmed) and checks them in
    await row(org.page, 'Ben Marlowe').locator('button', {hasText: 'Check in'}).click();
    await toast(org.page, /Ben Marlowe checked in/);
    await org.page.locator('.mini-kpi', {hasText: 'Checked in'}).locator('strong', {hasText: '1'}).waitFor({timeout: T});
    await org.page.locator('.chip', {hasText: /^Everyone/}).click();
    assert.match(await row(org.page, 'Ben Marlowe').innerText(), /Checked in/);
    await org.page.locator('.chip', {hasText: /^Not checked in/}).click();
    let players = await w.fake.local.admin('select display_name, rating, rating_confirmed, source, checked_in from fftt_private.players where event_id = $1', [w.eventId]);
    assert.deepEqual(players, [{display_name: 'Ben Marlowe', rating: 2, rating_confirmed: false, source: 'registration', checked_in: true}]);
    assert.equal(await row(org.page, 'Ben Marlowe').count(), 0, 'checked-in people leave the default "Not checked in" view');

    // an edited name and level are what get checked in (and count as confirmed)
    await row(org.page, 'Cy Fennelwick').locator('button', {hasText: 'Edit'}).click();
    await org.page.locator('.reg-edit input').fill('Cy Fennel');
    await org.page.locator('.reg-edit select').selectOption('4');
    await row(org.page, 'Cy Fennel').locator('button', {hasText: 'Check in'}).waitFor();
    await row(org.page, 'Cy Fennel').locator('button', {hasText: 'Check in'}).click();
    await toast(org.page, /Cy Fennel checked in/);
    players = await w.fake.local.admin("select rating, rating_confirmed from fftt_private.players where display_name = 'Cy Fennel'");
    assert.deepEqual(players, [{rating: 4, rating_confirmed: true}]);

    // bulk: tick two rows, check in both at once; rows in an unresolved duplicate group cannot be ticked
    assert.equal(await row(org.page, 'Ada Quillfeather').first().locator('input[type=checkbox]').isDisabled(), true);
    await row(org.page, 'Dee Larkspur').locator('input[type=checkbox]').check();
    await row(org.page, 'Eli Brandtley').locator('input[type=checkbox]').check();
    await org.page.locator('.bulk-bar', {hasText: '2 selected'}).waitFor();
    await org.page.locator('.bulk-bar button', {hasText: 'Check in 2 selected'}).click();
    await toast(org.page, /2 players checked in/);
    await org.page.locator('.mini-kpi', {hasText: 'Checked in'}).locator('strong', {hasText: '4'}).waitFor({timeout: T});

    // duplicates: the Ada group is merged into ONE player; the Jo/Joe group is declared different people
    const dups = org.page.locator('#dups');
    await dups.locator('h2', {hasText: 'Possible duplicates (2)'}).waitFor();
    const adaGroup = dups.locator('.dup-group', {hasText: 'Same e-mail'});
    await adaGroup.locator('button', {hasText: 'Same person'}).click();
    await toast(org.page, /Ada Quillfeather checked in \(3 registrations merged\)/);
    const adaRows = await w.fake.local.admin(`select p.display_name, count(l.ref)::int as refs from fftt_private.players p join fftt_private.registration_links l on l.player_id = p.id where p.display_name = 'Ada Quillfeather' group by 1`);
    assert.deepEqual(adaRows, [{display_name: 'Ada Quillfeather', refs: 3}]);
    await org.page.locator('#dups h2', {hasText: 'Possible duplicates (1)'}).waitFor({timeout: T});
    await org.page.locator('#dups button', {hasText: 'Different people'}).click();
    await toast(org.page, /different people/);
    await org.page.locator('#dups').waitFor({state: 'detached', timeout: T});
    assert.equal(await row(org.page, 'Jo Marchettis').locator('input[type=checkbox]').isDisabled(), false, 'dismissed duplicates can be checked in normally');

    // a name that contained a phone number is cleaned, flagged and still safe to check in
    assert.match(await org.page.locator('.reg-row', {hasText: 'Lia'}).first().innerText(), /removed from the name/);

    // Unified add-player workspace: one name/level form has distinct actions.
    assert.equal(await org.page.locator('.add-players-card').count(), 1);
    assert.deepEqual(await org.page.locator('.add-mode-switch button').allInnerTexts(), ['One player', 'Paste a list']);
    await org.page.fill('#wName', 'Nina Orchard');
    await org.page.locator('.walk-form .seg label', {hasText: /^2$/}).click();
    await org.page.locator('.walk-form button', {hasText: 'Add to roster'}).click();
    await toast(org.page, /Nina Orchard added to the roster/);
    const addedOnly = await w.fake.local.admin("select rating, source, checked_in from fftt_private.players where display_name='Nina Orchard'");
    assert.deepEqual(addedOnly, [{rating: 2, source: 'manual', checked_in: false}], 'Add to roster never checks the player in');
    await org.page.fill('#wName', 'Walt Winters');
    await org.page.locator('.walk-form .seg label', {hasText: /^4$/}).click();
    await org.page.locator('.walk-form button', {hasText: 'Add & check in'}).click();
    await toast(org.page, /Walt Winters checked in/);
    const walk = await w.fake.local.admin("select rating, rating_confirmed, source, checked_in from fftt_private.players where display_name = 'Walt Winters'");
    assert.deepEqual(walk, [{rating: 4, rating_confirmed: true, source: 'walk_in', checked_in: true}]);
    await org.page.fill('#wName', 'ben marlowe');   // case-insensitive duplicate of the full name already on the roster
    await org.page.locator('.walk-form button', {hasText: 'Add & check in'}).click();
    await org.page.locator('#wMsg', {hasText: 'already on the roster'}).waitFor();

    // roster: suggested levels are visible and can be confirmed in one step
    const roster = org.page.locator('section', {has: org.page.locator('h2', {hasText: /^Roster/})});
    await roster.locator('.pill', {hasText: 'Suggested'}).first().waitFor();
    await roster.locator('button', {hasText: /Confirm \d+ suggested levels?/}).click();
    await org.page.locator('dialog[open] button', {hasText: 'Confirm levels'}).click();
    await toast(org.page, /Levels confirmed/);
    await roster.locator('.pill', {hasText: 'Suggested'}).waitFor({state: 'detached', timeout: T});
    assert.equal((await w.fake.local.admin('select count(*)::int as n from fftt_private.players where not rating_confirmed'))[0].n, 0);

    // PRIVACY: nothing on the page, in the DB schema, in the public view or in the audit log carries contact data
    const page = await org.page.locator('body').innerText();
    assert.ok(!/example\.invalid/i.test(page) && !/\b734[-. ]?555/.test(page), 'no full e-mail or phone on screen');
    assert.match(page, /[a-z]•••@[a-z]•••\.invalid/);
    await w.fake.local.rpc(w.ids.org, 'fftt_set_visibility_v3', {p_event_id: w.eventId, p_visible: true});
    assert.ok(!/@|REGREF|registration/i.test(JSON.stringify(await w.fake.local.publicTournaments())));
    const audit = JSON.stringify(await w.fake.local.rpc(w.ids.org, 'fftt_audit_log_v3', {p_event_id: w.eventId, p_limit: 200}));
    assert.ok(!/example\.invalid|Ben Marlowe|Ada Quillfeather/.test(audit));
    assert.deepEqual(w.pageErrors, []);
    assert.deepEqual(w.consoleErrors.filter(e => !/net::ERR|Failed to load resource/.test(e)), []);
  } finally { await w.close(); }
});

test('input survives background refreshes: search text, selections, edits, walk-in name, open sections', {timeout: 240000}, async () => {
  const w = await createBrowserWorld();
  try {
    const org = await w.device('org');
    await org.signIn('org');
    await org.page.locator('#evName').waitFor({timeout: T});
    await goTab(org.page, 'Players');
    await org.page.locator('#regLoad').click();
    await org.page.locator('.reg-row').first().waitFor({timeout: T});
    await org.page.fill('#regSearch', 'Pia');
    await row(org.page, 'Pia Dunmoor').locator('input[type=checkbox]').check();
    await org.page.fill('#wName', 'Half typed na');
    await org.page.locator('#addModeBulk').click(); // switches the shared Add players workspace to bulk
    await org.page.fill('#pBulk', 'Unsaved Pasted, 3, provisional');
    // something else changes on the server: every device's pane is rebuilt on its next poll
    await w.fake.local.rpc(w.ids.org, 'fftt_upsert_players_v3', {p_event_id: w.eventId, p_players: [{name: 'Remote R.', rating: 2, rating_status: 'provisional'}]});
    await org.page.locator('h2', {hasText: /Roster · 0 of 1/}).waitFor({timeout: 30000});
    assert.equal(await org.page.inputValue('#regSearch'), 'Pia');
    assert.equal(await row(org.page, 'Pia Dunmoor').locator('input[type=checkbox]').isChecked(), true, 'the ticked row stays ticked');
    assert.equal(await org.page.inputValue('#wName'), 'Half typed na');
    assert.equal(await org.page.inputValue('#pBulk'), 'Unsaved Pasted, 3, provisional');
    assert.equal(await org.page.locator('#addModeBulk').getAttribute('aria-selected'), 'true', 'bulk mode persists across refresh');
    await org.page.locator('#addModeOne').click();
    // typing in the unified name field is not interrupted: focus and caret stay where they were across a rebuild
    await org.page.focus('#wName'); await org.page.keyboard.press('End'); await org.page.keyboard.type(' me');
    await w.fake.local.rpc(w.ids.org, 'fftt_upsert_players_v3', {p_event_id: w.eventId, p_players: [{name: 'Remote S.', rating: 2, rating_status: 'provisional'}]});
    await org.page.locator('h2', {hasText: /Roster · 0 of 2/}).waitFor({timeout: 40000});
    assert.equal(await org.page.inputValue('#wName'), 'Half typed na me');
    assert.equal(await org.page.evaluate(() => document.activeElement?.id), 'wName', 'focus stays in the field');
    await org.page.locator('#addModeBulk').click();
    assert.equal(await org.page.inputValue('#pBulk'), 'Unsaved Pasted, 3, provisional', 'unsaved bulk text persists between modes');
  } finally { await w.close(); }
});

test('without a connected sheet: a clear message, the private CSV fallback works in the browser only, and nothing is uploaded', {timeout: 240000}, async () => {
  const w = await createBrowserWorld({registration: null});
  try {
    const org = await w.device('org');
    await org.signIn('org');
    await org.page.locator('#evName').waitFor({timeout: T});
    await goTab(org.page, 'Players');
    await org.page.locator('#regLoad').click();
    // ONE persistent, plain explanation (no duplicate toast): the state, then what to do
    await org.page.locator('#regError', {hasText: 'Not configured'}).waitFor({timeout: T});
    assert.match(await org.page.locator('#regError').innerText(), /Choose one in Registration settings, import a private CSV, or add walk-ins by hand/);
    assert.equal(await org.page.locator('#toasts .toast').count(), 0, 'the failure is explained once, inline, not also as a toast');
    const before = w.requests.length;
    await org.page.locator('#regFile').setInputFiles({name: 'form-responses.csv', mimeType: 'text/csv', buffer: Buffer.from(SYNTHETIC_FORM_CSV)});
    await org.page.locator('.reg-row').first().waitFor({timeout: T});
    assert.match(await org.page.locator('.reg-meta').innerText(), /Private CSV · this browser only/);
    assert.equal(w.requests.length, before, 'reading the file sent nothing anywhere');
    await row(org.page, 'Pia Dunmoor').locator('button', {hasText: 'Check in'}).click();
    await toast(org.page, /Pia Dunmoor checked in/);
    // re-importing the same file knows who is already checked in (stable references per event)
    await org.page.locator('#regFile').setInputFiles({name: 'form-responses.csv', mimeType: 'text/csv', buffer: Buffer.from(SYNTHETIC_FORM_CSV)});
    await org.page.locator('.reg-meta').waitFor();
    await org.page.locator('.chip', {hasText: /^Checked in \(1\)$/}).waitFor({timeout: T});
    // clearing forgets the list
    await org.page.locator('button', {hasText: 'Clear list'}).click();
    await org.page.locator('.reg-row').first().waitFor({state: 'detached'});
    // contradictory fictional registrants (exact approved answers): flagged for organizer review, still provisional
    const header = SYNTHETIC_FORM_CSV.split('\n')[0];
    const P = {beg: 'Beginner — New or fairly new to table tennis; still developing reliable serves, returns, and control',
      adv: 'Advanced / Competitive — Club, league, or tournament-level ability, or comparable demonstrated play'};
    const RALLY = {top: 'I can sustain strong rallies consistently, including under pressure', weak: 'I am still learning and have difficulty sustaining rallies'};
    const q = t => '"' + t.replaceAll('"', '""') + '"';
    const extra = [header,
      ['2026/11/09 10:00:00', 'Quinn Brightwater', 'quinn.b@example.invalid', '734-555-0120', 'Adult', 'No', 'Several times a week', 'Yes, quite a bit', RALLY.top, 'Yes, confidently', 'Yes, confidently', P.beg],
      ['2026/11/09 10:05:00', 'Rory Ashgrove', 'rory.a@example.invalid', '734-555-0121', 'Adult', 'No', 'Never', 'No', RALLY.weak, 'No', 'No', P.adv]]
      .map((x, i) => i === 0 ? x : x.map(q).join(',')).join('\n');
    await org.page.locator('#regFile').setInputFiles({name: 'contradictions.csv', mimeType: 'text/csv', buffer: Buffer.from(extra)});
    await org.page.locator('.reg-row').first().waitFor({timeout: T});
    const quinn = org.page.locator('.reg-row', {has: org.page.locator('.reg-name', {hasText: /^Quinn Brightwater$/})});
    const rory = org.page.locator('.reg-row', {has: org.page.locator('.reg-name', {hasText: /^Rory Ashgrove$/})});
    assert.match(await quinn.innerText(), /Level 4 · Strong Intermediate/);
    assert.match(await quinn.innerText(), /Organizer review: the answers disagree with the chosen profile/);
    assert.match(await rory.innerText(), /Level 2 · Recreational/);
    assert.match(await rory.innerText(), /Organizer review/);
    await org.page.locator('.chip', {hasText: /^Needs a look \(2\)$/}).click();
    assert.equal(await org.page.locator('.reg-row').count(), 2);
    await quinn.locator('button', {hasText: 'Edit'}).click();
    assert.match(await org.page.locator('.reg-basis').innerText(), /Organizer review: other answers point 3 levels higher than the chosen profile/);
    await quinn.locator('button', {hasText: 'Done'}).click();
    await quinn.locator('button', {hasText: 'Check in'}).click();
    await toast(org.page, /Quinn Brightwater checked in/);
    const stored = await w.fake.local.admin("select rating, rating_confirmed from fftt_private.players where display_name = 'Quinn Brightwater'");
    assert.deepEqual(stored, [{rating: 4, rating_confirmed: false}], 'the suggestion is stored as provisional until the organizer confirms it');
    // an unreadable file is refused plainly
    await org.page.locator('#regFile').setInputFiles({name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('Timestamp,Email\n2026/11/01,a@b.invalid\n')});
    await org.page.locator('.reg-row').first().waitFor({state: 'detached'});
    // a scorekeeper never gets the registration screen at all
    const a = await w.device('a', {viewport: {width: 390, height: 844}, mobile: true});
    await a.signIn('a');
    await a.page.locator('#statusline').waitFor();
    assert.equal(await a.page.locator('nav.tabs button').count(), 1);
  } finally { await w.close(); }
});
