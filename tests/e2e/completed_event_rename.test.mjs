/** Completed-event rename: real SQL in a disposable hosted-equivalent PGlite database. Fictional data only; no hosted writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHostedEquivalentDb} from './hosted_equivalent.mjs';
import {roster, buildChampionship, playAllPlayable} from './helpers.mjs';

const PROPOSAL = fs.readFileSync(new URL('../../supabase/proposals/FFTT3_COMPLETED_EVENT_RENAME_20261109_DO_NOT_APPLY.sql', import.meta.url), 'utf8');
const ROLLBACK = fs.readFileSync(new URL('../../supabase/proposals/FFTT3_COMPLETED_EVENT_RENAME_ROLLBACK_20261109_DO_NOT_APPLY.sql', import.meta.url), 'utf8');
const FN = 'fftt_rename_completed_event_v1';
const NAME = 'FICTIONAL COMPLETED EVENT';
const denied = p => assert.rejects(p, e => e.code === '42501' || /forbidden|permission denied|not authenticated|jwt/i.test(e.message));
const conflict = (p, d) => assert.rejects(p, e => /conflict/.test(e.message) && e.detail === d, `expected conflict/${d}`);
const invalid = p => assert.rejects(p, e => /validation/.test(e.message) && e.detail === 'event-name');

async function world({install = true} = {}) {
  const db = await createHostedEquivalentDb({corrections: true});
  if (install) await db.db.exec(PROPOSAL);
  const u = n => db.addUser(`${n}@fftt-rename.invalid`, {platformOrganizer: n === 'org'});
  const ids = {org: await u('org'), bm: await u('bm'), scorer: await u('scorer'), outsider: await u('outsider'), otherOrg: await u('otherorg')};
  const mk = async name => (await db.rpc(ids.org, 'fftt_create_event_v3', {p_name: name, p_date: '2026-11-22', p_table_count: 2})).event_id;
  const E = await mk(NAME), D = await mk('FICTIONAL UNTOUCHED NEIGHBOR');
  const grant = (who, role) => db.rpc(ids.org, 'fftt_set_staff_v3', {p_event_id: E, p_email: `${who}@fftt-rename.invalid`, p_action: 'grant', p_role: role});
  await grant('bm', 'bracket_manager'); await grant('scorer', 'scorekeeper');
  await db.rpc(ids.org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(4)});
  const snap = () => db.rpc(ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  for (const p of (await snap()).players) await db.rpc(ids.org, 'fftt_set_checkin_v3', {p_event_id: E, p_player_id: p.id, p_checked_in: true});
  const ctx = {db, E, org: ids.org, skA: ids.scorer, skB: ids.scorer, snap};
  await buildChampionship(ctx);
  await playAllPlayable(ctx, {only: 'championship'});
  const rename = (who, name, {expected = NAME, event = E} = {}) => db.rpc(ids[who], FN, {p_event_id: event, p_expected_name: expected, p_name: name});
  const complete = () => db.rpc(ids.org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'complete'});
  // Everything that must survive a rename, fingerprinted straight from the tables.
  const history = async event => JSON.stringify(await db.admin(`select
      (select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'')) from fftt_private.players x where event_id=$1) players,
      (select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'')) from fftt_private.matches x where event_id=$1) matches,
      (select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'')) from fftt_private.brackets x where event_id=$1) brackets,
      (select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'')) from fftt_private.result_submissions x where event_id=$1) submissions,
      (select count(*)::int from fftt_private.audit_events where event_id=$1) audits`, [event]));
  const eventRow = event => db.admin('select event_name, event_date::text d, table_count, lifecycle, public_visible, bracket_generation, revision from fftt_private.events where id=$1', [event]).then(r => r[0]);
  return {db, ids, E, D, rename, complete, history, eventRow, snap};
}

test('Organizer renames ONLY the name of a completed event; everything else is preserved and audited', {timeout: 300000}, async () => {
  const w = await world();
  try {
    await w.complete();
    const before = await w.eventRow(w.E), historyBefore = await w.history(w.E), neighbor = await w.history(w.D), neighborRow = await w.eventRow(w.D);
    assert.equal(before.lifecycle, 'complete');
    const t0 = Date.now() - 5000;
    const res = await w.rename('org', '  FICTIONAL RENAMED EVENT  ');
    assert.equal(res.status, 'renamed');
    const after = await w.eventRow(w.E);
    assert.equal(after.event_name, 'FICTIONAL RENAMED EVENT', 'name is trimmed');
    assert.equal(after.lifecycle, 'complete', 'the event stays Completed');
    for (const k of ['d', 'table_count', 'public_visible', 'bracket_generation']) assert.equal(after[k], before[k], `${k} unchanged`);
    assert.equal(Number(after.revision), Number(before.revision) + 1, 'revision advances by exactly one');
    assert.equal(res.event_revision, Number(after.revision));
    // players, brackets, scores, standings, results are byte-identical; only the audit log grows, by one row.
    const h1 = JSON.parse(await w.history(w.E)), h0 = JSON.parse(historyBefore);
    for (const k of ['players', 'matches', 'brackets', 'submissions']) assert.deepEqual(h1[0][k], h0[0][k], `${k} preserved`);
    assert.equal(h1[0].audits, h0[0].audits + 1);
    // audit: old name, new name, actor, timestamp
    const [a] = await w.db.admin(`select operation, actor_id, created_at, before_state, after_state, event_revision from fftt_private.audit_events
      where event_id=$1 and after_state->>'completed_rename'='true'`, [w.E]);
    assert.equal(a.operation, 'event_updated');
    assert.equal(a.actor_id, w.ids.org);
    assert.equal(a.before_state.name, NAME);
    assert.equal(a.after_state.name, 'FICTIONAL RENAMED EVENT');
    assert.equal(a.after_state.date, a.before_state.date); assert.equal(a.after_state.tables, a.before_state.tables);
    assert.ok(new Date(a.created_at).getTime() >= t0 && new Date(a.created_at).getTime() <= Date.now() + 5000, 'timestamp recorded');
    assert.equal(Number(a.event_revision), res.event_revision);
    // the organizer-visible snapshot and audit log carry the new name with scores intact
    const snap = await w.snap();
    assert.equal(snap.event.name ?? snap.event.event_name, 'FICTIONAL RENAMED EVENT');
    assert.ok(snap.matches.some(m => m.status === 'complete'));
    // another event is untouched
    assert.equal(await w.history(w.D), neighbor);
    assert.deepEqual(await w.eventRow(w.D), neighborRow);
  } finally { await w.db.db.close(); }
});

test('stale name, no-op rename and name validation', {timeout: 300000}, async () => {
  const w = await world();
  try {
    await w.complete();
    const rev = (await w.eventRow(w.E)).revision;
    // unchanged (even with surrounding spaces): no bump, no audit
    const auditsBefore = JSON.parse(await w.history(w.E))[0].audits;
    assert.equal((await w.rename('org', `  ${NAME} `)).status, 'unchanged');
    assert.equal((await w.eventRow(w.E)).revision, rev);
    assert.equal(JSON.parse(await w.history(w.E))[0].audits, auditsBefore);
    // someone else renamed it first: the caller's expected name no longer matches
    await conflict(w.rename('org', 'FICTIONAL NEW', {expected: 'FICTIONAL OLD NAME SEEN EARLIER'}), 'name-changed');
    // validation
    await invalid(w.rename('org', ''));
    await invalid(w.rename('org', '    '));
    await invalid(w.rename('org', 'x'.repeat(121)));
    await invalid(w.rename('org', 'bad\u0007name'));
    await invalid(w.rename('org', 'tab\tname'));
    await invalid(w.rename('org', 'new\nline'));
    await invalid(w.rename('org', 'ok', {expected: ''}));
    assert.equal((await w.rename('org', 'x'.repeat(120))).status, 'renamed', '120 characters is allowed');
    assert.equal((await w.eventRow(w.E)).revision, Number(rev) + 1, 'rejected attempts changed nothing');
    // sequential stale writer: the second caller still holds the old name
    await conflict(w.rename('org', 'FICTIONAL SECOND WRITER', {expected: NAME}), 'name-changed');
  } finally { await w.db.db.close(); }
});

test('authorization is enforced server-side: only the event Organizer; anon, Scorer, Bracket Manager, outsider and another event are refused', {timeout: 300000}, async () => {
  const w = await world();
  try {
    await w.complete();
    const before = await w.eventRow(w.E), h = await w.history(w.E);
    await denied(w.db.rpc(null, FN, {p_event_id: w.E, p_expected_name: NAME, p_name: 'ANON RENAME'}));
    for (const who of ['scorer', 'bm', 'outsider']) await denied(w.rename(who, `${who} rename`));
    // a person who organizes a DIFFERENT event may not rename this one
    await w.db.rpc(w.ids.org, 'fftt_set_staff_v3', {p_event_id: w.D, p_email: 'otherorg@fftt-rename.invalid', p_action: 'grant', p_role: 'organizer'});
    await denied(w.rename('otherOrg', 'cross event rename'));
    assert.deepEqual(await w.eventRow(w.E), before);
    assert.equal(await w.history(w.E), h);
    // direct table access is not available to the API roles
    await assert.rejects(w.db.rpc(w.ids.org, 'fftt_private.rename_completed_event_v1', {}), () => true);
    const grants = await w.db.admin(`select
      has_function_privilege('anon','public.${FN}(uuid,text,text)','execute') anon_public,
      has_function_privilege('authenticated','public.${FN}(uuid,text,text)','execute') auth_public,
      has_function_privilege('anon','fftt_private.rename_completed_event_v1(uuid,text,text)','execute') anon_private`);
    assert.deepEqual(grants[0], {anon_public: false, auth_public: true, anon_private: false});
  } finally { await w.db.db.close(); }
});

test('lifecycle rules: draft, active and archived events are refused here; completed events cannot be edited by the ordinary path', {timeout: 300000}, async () => {
  const w = await world();
  try {
    // active (bracket built and playing)
    await w.db.rpc(w.ids.org, 'fftt_set_lifecycle_v3', {p_event_id: w.E, p_lifecycle: 'active'});
    await conflict(w.rename('org', 'ACTIVE RENAME'), 'lifecycle');
    // draft event
    await conflict(w.rename('org', 'DRAFT RENAME', {expected: 'FICTIONAL UNTOUCHED NEIGHBOR', event: w.D}), 'lifecycle');
    // completed: allowed; the ordinary update path still refuses it (date/tables/lifecycle are NOT broadened)
    await w.complete();
    assert.equal((await w.rename('org', 'COMPLETED RENAME')).status, 'renamed');
    await conflict(w.db.rpc(w.ids.org, 'fftt_update_event_v3', {p_event_id: w.E, p_name: 'SNEAKY', p_date: '2026-12-01', p_table_count: 5}), 'lifecycle');
    const row = await w.eventRow(w.E);
    assert.deepEqual([row.d, row.table_count, row.lifecycle, row.event_name], ['2026-11-22', 2, 'complete', 'COMPLETED RENAME']);
    // archived must be restored first
    await w.db.rpc(w.ids.org, 'fftt_set_lifecycle_v3', {p_event_id: w.E, p_lifecycle: 'archived'});
    await conflict(w.rename('org', 'ARCHIVED RENAME', {expected: 'COMPLETED RENAME'}), 'lifecycle');
    assert.equal((await w.eventRow(w.E)).event_name, 'COMPLETED RENAME');
  } finally { await w.db.db.close(); }
});

test('guarded install: replay is refused, hosted helper drift is refused, rollback removes only the new functions', {timeout: 300000}, async () => {
  const w = await world();
  try {
    // replay fails closed and leaves the first install intact
    await assert.rejects(w.db.db.exec(PROPOSAL), /already installed/);
    await w.db.db.exec('rollback');   // the failed script left its transaction open, as psql would
    await w.complete();
    assert.equal((await w.rename('org', 'AFTER FAILED REPLAY')).status, 'renamed');
    // rollback drops exactly the two new functions; event data and the rename audit stay
    const fnCount = async () => (await w.db.admin(`select count(*)::int n from pg_proc where proname in ('rename_completed_event_v1','fftt_rename_completed_event_v1')`))[0].n;
    assert.equal(await fnCount(), 2);
    await w.db.db.exec(ROLLBACK);
    assert.equal(await fnCount(), 0);
    assert.equal((await w.eventRow(w.E)).event_name, 'AFTER FAILED REPLAY');
    await assert.rejects(w.rename('org', 'AFTER ROLLBACK', {expected: 'AFTER FAILED REPLAY'}), () => true);
    // a hosted (real-mode) database whose helper differs from the reviewed fingerprint refuses the install
    await w.db.db.exec(`create or replace function fftt_private.v3_bump(p_event_id uuid) returns bigint language plpgsql volatile security definer set search_path = ''
      as $f$ declare v_rev bigint; begin update fftt_private.events set revision = revision + 2, updated_at = now() where id = p_event_id returning revision into v_rev; return v_rev; end; $f$;`);
    await assert.rejects(w.db.db.exec(PROPOSAL), /helper fingerprints differ/);
    await w.db.db.exec('rollback');
    assert.equal(await fnCount(), 0, 'nothing was installed');
  } finally { await w.db.db.close(); }
});
