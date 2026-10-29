/** V5 (event-specific registration source) against the REAL SQL (local, in-process PostgreSQL): organizer-only, event-scoped
 * access, validation, the synthetic-event rule, status handling, audit, cascade, privileges and "no private data stored".
 * Fictional data only. Run: node --test tests/e2e/gameday_v5_server.test.mjs (after `npm ci` in tests/e2e) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEvent} from './helpers.mjs';
import {parseSourceRecord} from '../../contracts/registration_source.mjs';

const SHEET = 'SYNTHETIC_SHEET_A_0123456789abcdef';
const SHEET2 = 'SYNTHETIC_SHEET_B_0123456789abcdef';
const fails = async (p, code, text) => {
  const e = await p.then(() => null, x => x);
  assert.ok(e, 'expected a failure' + (text ? ': ' + text : ''));
  if (code) assert.equal(e.code, code, text);
  return e;
};
const google = (over = {}) => ({kind: 'google-sheets', spreadsheet_id: SHEET, spreadsheet_title: 'FFTT Sign-ups', worksheet: 'Form responses 1', column_map: {}, enabled: false, ...over});
const get = (ctx, who, event = ctx.E) => ctx.db.rpc(who, 'fftt_registration_source_v5', {p_event_id: event});
const put = (ctx, who, src, event = ctx.E) => ctx.db.rpc(who, 'fftt_set_registration_source_v5', {p_event_id: event, p_source: src});

test('privileges: anonymous can call nothing; authenticated can; helpers and the table are not exposed', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {db} = ctx;
  const rows = await db.admin(`select p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x, n.nspname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname ~ 'registration_(source|check)_v5|v5_mapping_ok'`);
  const byName = n => rows.filter(r => r.proname === n);
  for (const n of ['fftt_registration_source_v5', 'fftt_set_registration_source_v5', 'fftt_clear_registration_source_v5', 'fftt_record_registration_check_v5']) {
    const pub = byName(n).find(r => r.nspname === 'public');
    assert.ok(pub, n + ' exists in public');
    assert.equal(pub.anon_x, false, n + ' is not callable by anon'); assert.equal(pub.auth_x, true, n + ' is callable by authenticated');
  }
  assert.ok(rows.filter(r => r.proname === 'v5_mapping_ok').every(r => !r.anon_x && !r.auth_x), 'the mapping validator is private');
  assert.equal(await db.rpc(null, 'fftt_registration_source_v5', {p_event_id: ctx.E}).then(() => 'ran', e => e.code), '42501', 'anonymous is refused');
  const priv = await db.admin(`select has_table_privilege('anon','fftt_private.registration_sources','select') a, has_table_privilege('authenticated','fftt_private.registration_sources','select') b,
      (select relrowsecurity from pg_class where oid = 'fftt_private.registration_sources'::regclass) rls`);
  assert.deepEqual([priv[0].a, priv[0].b, priv[0].rls], [false, false, true]);
  // NO private data can live in the table: columns are exactly the source description, never a credential, a row or a contact
  const cols = (await db.admin(`select column_name from information_schema.columns where table_schema='fftt_private' and table_name='registration_sources'`)).map(r => r.column_name);
  assert.deepEqual(cols.sort(), ['column_map', 'enabled', 'event_id', 'kind', 'last_checked_at', 'last_error', 'last_ok_at', 'last_response_count', 'spreadsheet_id', 'spreadsheet_title', 'status', 'updated_at', 'updated_by', 'worksheet']);
});

test('ORGANIZER ONLY and EVENT-SCOPED: scorekeepers, outsiders and other events\' organizers cannot read or change a source', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {db, org, skA, outsider} = ctx;
  assert.equal((await put(ctx, org, google())).status, 'saved');
  assert.equal(parseSourceRecord(await get(ctx, org)).spreadsheetId, SHEET);
  for (const [label, who] of [['scorekeeper', skA], ['outsider', outsider]]) {
    await fails(get(ctx, who), '42501', label + ' read');
    await fails(put(ctx, who, google({spreadsheet_id: SHEET2})), '42501', label + ' write');
    await fails(db.rpc(who, 'fftt_clear_registration_source_v5', {p_event_id: ctx.E}), '42501', label + ' clear');
    await fails(db.rpc(who, 'fftt_record_registration_check_v5', {p_event_id: ctx.E, p_status: 'ready', p_error: null, p_count: 1}), '42501', label + ' record');
  }
  // a SECOND event organized by someone else (a platform organizer who is not staff of the first event's grants)
  const other = await db.addUser('other-organizer@fftt-staging.invalid', {platformOrganizer: true});
  const ev2 = await db.rpc(other, 'fftt_create_event_v3', {p_name: 'Second Rehearsal', p_date: '2026-12-02', p_table_count: 2});
  await put(ctx, other, google({spreadsheet_id: SHEET2}), ev2.event_id);
  // the first organizer, substituting the OTHER event's id, gets nothing and changes nothing
  await fails(get(ctx, org, ev2.event_id), '42501', 'cross-event read');
  await fails(put(ctx, org, google(), ev2.event_id), '42501', 'cross-event write');
  await fails(db.rpc(org, 'fftt_clear_registration_source_v5', {p_event_id: ev2.event_id}), '42501', 'cross-event clear');
  assert.equal(parseSourceRecord(await get(ctx, other, ev2.event_id)).spreadsheetId, SHEET2, 'the other event keeps its own sheet');
  assert.equal(parseSourceRecord(await get(ctx, org)).spreadsheetId, SHEET, 'and so does the first');
  // an unknown event id is indistinguishable from a forbidden one
  await fails(get(ctx, org, '99999999-9999-4999-8999-999999999999'), '42501');
  // a revoked organizer loses access immediately
  await db.rpc(ctx.org, 'fftt_set_staff_v3', {p_event_id: ctx.E, p_email: 'scorekeeper-a@fftt-staging.invalid', p_action: 'grant', p_role: 'organizer'});
  assert.equal(parseSourceRecord(await get(ctx, skA)).configured, true, 'a newly granted organizer');
  await db.rpc(ctx.org, 'fftt_set_staff_v3', {p_event_id: ctx.E, p_email: 'scorekeeper-a@fftt-staging.invalid', p_action: 'revoke', p_role: null});
  await fails(get(ctx, skA), '42501', 'revoked');
});

test('validation: only a Google spreadsheet id, a tab name and a known column mapping are accepted', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {org} = ctx;
  const bad = async (src, why) => { const e = await fails(put(ctx, org, src), '22023', why); assert.equal(e.message, 'fftt_validation_error'); return e; };
  await bad({kind: 'excel'}, 'kind');
  await bad({kind: 'google-sheets'}, 'no sheet');
  await bad(google({spreadsheet_id: 'short'}), 'short id');
  await bad(google({spreadsheet_id: 'https://docs.google.com/spreadsheets/d/' + SHEET}), 'a URL is not stored, only the id');
  await bad(google({spreadsheet_id: SHEET + '/../x'}), 'path characters');
  await bad(google({worksheet: ''}), 'empty tab');
  await bad(google({worksheet: 'a\nb'}), 'control char');
  await bad(google({worksheet: 'x'.repeat(101)}), 'long tab');
  await bad(google({spreadsheet_title: 'x'.repeat(201)}), 'long title');
  await bad(google({column_map: {evil: 'x'}}), 'unknown field');
  await bad(google({column_map: {name: ''}}), 'empty header');
  await bad(google({column_map: {name: 'x'.repeat(121)}}), 'long header');
  await bad(google({column_map: {name: 5}}), 'non-string header');
  await bad(google({column_map: []}), 'array mapping');
  await bad(google({secret: 'x'}), 'unexpected key (no credentials can be stored)');
  await bad(google({private_key: '-----BEGIN PRIVATE KEY-----'}), 'a key cannot be smuggled in');
  await bad(null, 'null');
  assert.equal(parseSourceRecord(await get(ctx, org)).configured, false, 'nothing was saved by a refused request');
  assert.equal((await put(ctx, org, google({column_map: {name: 'Participant', rallies: 'Rally question', description: '(none)'}}))).status, 'saved');
  assert.deepEqual(parseSourceRecord(await get(ctx, org)).columnMap, {name: 'Participant', rallies: 'Rally question', description: '(none)'});
});

test('SYNTHETIC RULE: a Google sheet can be saved and tested but never ENABLED on a synthetic event; the fixture is synthetic-only', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {org, db} = ctx;
  const e = await fails(put(ctx, org, google({enabled: true})), 'P0001', 'enabling a live source on a synthetic event');
  assert.equal(e.message, 'fftt_conflict'); assert.equal(e.detail, 'google-not-allowed-synthetic');
  assert.equal((await put(ctx, org, google({enabled: false}))).status, 'saved');
  assert.equal(parseSourceRecord(await get(ctx, org)).enabled, false);
  assert.equal(parseSourceRecord(await get(ctx, org)).eventSynthetic, true);
  assert.equal((await put(ctx, org, {kind: 'fixture'})).status, 'saved');
  const fx = parseSourceRecord(await get(ctx, org));
  assert.deepEqual([fx.kind, fx.spreadsheetId, fx.worksheet, fx.columnMap], ['fixture', null, null, {}]);
  // the synthetic-only constraint of the events table is untouched
  await fails(db.admin(`update fftt_private.events set synthetic_only = false where id = $1`, [ctx.E]), '23514');
});

test('status handling: a test result is stored for the event only, as an enumerated outcome; a changed sheet forgets it; toggling keeps it', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {org, db} = ctx;
  await put(ctx, org, google());
  const rec = (status, error = null, count = null) => db.rpc(org, 'fftt_record_registration_check_v5', {p_event_id: ctx.E, p_status: status, p_error: error, p_count: count});
  assert.equal((await rec('ready', null, 21)).status, 'recorded');
  let r = parseSourceRecord(await get(ctx, org));
  assert.deepEqual([r.status, r.lastError, r.lastResponseCount], ['ready', null, 21]);
  assert.ok(r.lastOkAt && r.lastCheckedAt);
  const okAt = r.lastOkAt;
  await rec('failed', 'unauthorized');
  r = parseSourceRecord(await get(ctx, org));
  assert.deepEqual([r.status, r.lastError, r.lastResponseCount, r.lastOkAt], ['failed', 'unauthorized', 21, okAt], 'a failure keeps the last SUCCESSFUL read');
  await fails(rec('excellent'), '22023'); await fails(rec('ready', 'because'), '22023'); await fails(rec('ready', null, -1), '22023'); await fails(rec('ready', null, 1e6), '22023');
  // an unrelated change keeps the record; a different sheet resets it
  await put(ctx, org, google({enabled: false, spreadsheet_title: 'Renamed'}));
  assert.equal(parseSourceRecord(await get(ctx, org)).status, 'failed');
  await put(ctx, org, google({spreadsheet_id: SHEET2}));
  r = parseSourceRecord(await get(ctx, org));
  assert.deepEqual([r.status, r.lastError, r.lastCheckedAt, r.lastOkAt, r.lastResponseCount], ['untested', null, null, null, null]);
  // recording without a saved source is a harmless no-op
  await db.rpc(org, 'fftt_clear_registration_source_v5', {p_event_id: ctx.E});
  assert.equal((await rec('ready', null, 1)).status, 'no-source');
});

test('audit, revision and lifecycle: changes are audited without the sheet id; finished events are read-only; clearing is idempotent', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {org, db, E} = ctx;
  const before = (await db.admin(`select revision from fftt_private.events where id = $1`, [E]))[0].revision;
  await put(ctx, org, google());
  assert.equal((await db.rpc(org, 'fftt_clear_registration_source_v5', {p_event_id: E})).status, 'cleared');
  assert.equal((await db.rpc(org, 'fftt_clear_registration_source_v5', {p_event_id: E})).status, 'unchanged');
  const audit = await db.admin(`select operation, before_state, after_state from fftt_private.audit_events where event_id = $1 and operation = 'registration_source_changed' order by id`, [E]);
  assert.equal(audit.length, 2);
  assert.ok(!JSON.stringify(audit).includes(SHEET), 'the audit log never holds the spreadsheet id');
  assert.ok((await db.admin(`select revision from fftt_private.events where id = $1`, [E]))[0].revision >= before + 2);
  await put(ctx, org, {kind: 'fixture'});
  await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'archived'});
  await fails(put(ctx, org, google()), 'P0001', 'archived events cannot change their source');
  assert.equal(parseSourceRecord(await get(ctx, org)).kind, 'fixture', 'but it can still be read');
});

test('deleting an empty draft event removes its source (cascade); nothing is left behind', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {org, db} = ctx;
  const ev = await db.rpc(org, 'fftt_create_event_v3', {p_name: 'Disposable Draft', p_date: '2026-12-03', p_table_count: 2});
  await put(ctx, org, google(), ev.event_id);
  assert.equal((await db.rpc(org, 'fftt_delete_event_v4', {p_event_id: ev.event_id, p_confirm_name: 'Disposable Draft'})).status, 'deleted');
  assert.equal((await db.admin(`select count(*)::int n from fftt_private.registration_sources where event_id = $1`, [ev.event_id]))[0].n, 0);
});
