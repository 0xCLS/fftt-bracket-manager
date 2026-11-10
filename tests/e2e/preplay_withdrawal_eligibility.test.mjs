/** Server verdict for pre-play withdrawal: real SQL in a disposable (upgraded, real-mode) PGlite database. Fictional data only.
 * The verdict must agree with the real withdraw_preplay_v7 in every state, including saved games in superseded generations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLocalDb} from './localdb.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';
import {deskOf, submit, scoreFor} from './helpers.mjs';

const read = f => fs.readFileSync(new URL(`../../supabase/proposals/${f}`, import.meta.url), 'utf8');
const ROLE = read('FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql'), DELEGATION = read('FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql');
const WITHDRAW = read('FFTT3_REHEARSAL_WALKOVER_WITHDRAWAL_20261109_DO_NOT_APPLY.sql');
const PROPOSAL = read('FFTT3_PREPLAY_WITHDRAWAL_ELIGIBILITY_20261110_DO_NOT_APPLY.sql');
const ROLLBACK = read('FFTT3_PREPLAY_WITHDRAWAL_ELIGIBILITY_ROLLBACK_20261110_DO_NOT_APPLY.sql');
const FN = 'fftt_preplay_withdrawal_eligibility_v1';
const forbidden = p => assert.rejects(p, e => e.code === '42501' || /forbidden|permission denied/i.test(e.message));
const refused = (p, detail) => assert.rejects(p, e => e.code === 'P0001' && e.detail === detail, `expected refusal ${detail}`);

async function world({players = 6} = {}) {
  const db = await createLocalDb({upgraded: true});
  await db.db.exec(ROLE); await db.db.exec(DELEGATION); await db.db.exec(WITHDRAW); await db.db.exec(PROPOSAL);
  const mail = n => `${n}@preplay-fiction.invalid`;
  const ids = {};
  for (const n of ['org', 'bm', 'scorer', 'outsider', 'otherorg']) ids[n] = await db.addUser(mail(n), {platformOrganizer: n === 'org'});
  const E = (await db.rpc(ids.org, 'fftt_create_event_v3', {p_name: 'Fictional eligibility', p_date: '2026-11-08', p_table_count: 2})).event_id;
  const D = (await db.rpc(ids.org, 'fftt_create_event_v3', {p_name: 'Fictional other', p_date: '2026-11-22', p_table_count: 2})).event_id;
  const grant = (ev, n, role) => db.rpc(ids.org, 'fftt_set_staff_v3', {p_event_id: ev, p_email: mail(n), p_action: 'grant', p_role: role});
  await grant(E, 'bm', 'bracket_manager'); await grant(E, 'scorer', 'scorekeeper'); await grant(D, 'otherorg', 'organizer');
  await db.rpc(ids.org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: ['Ada Quill', 'Ben Marlow', 'Cy Fennel', 'Dee Larkin', 'Eli Brandt', 'Fay Holloway', 'Gus Pemberton', 'Hal Winters']
    .slice(0, players).map((name, i) => ({name, rating: 1 + (i % 5), rating_status: 'provisional'}))});
  const snap = () => db.rpc(ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  const ctx = {db, E, org: ids.org, skA: ids.scorer, skB: ids.scorer, snap};
  const checkInAll = async () => { for (const p of (await snap()).players) await db.rpc(ids.org, 'fftt_set_checkin_v3', {p_event_id: E, p_player_id: p.id, p_checked_in: true}); };
  const build = async (confirm = false) => { const s = await snap(); return db.rpc(ids.org, 'fftt_build_championship_v3', {p_event_id: E,
    p_slots: seedSlots(enginePlayers(s.players.filter(p => p.checked_in))), p_expected_generation: s.event.generation, p_confirm: confirm}); };
  const elig = (who, ev = E) => db.rpc(who === null ? null : ids[who], FN, {p_event_id: ev});
  const withdraw = async who => { const s = await snap(); const leaving = s.players.find(p => p.checked_in).id;
    return db.rpc(ids[who ?? 'org'], 'fftt_withdraw_preplay_v7', {p_event_id: E, p_player_id: leaving, p_expected_generation: s.event.generation,
      p_slots: seedSlots(enginePlayers(s.players.filter(p => p.checked_in && p.id !== leaving))), p_reason: 'Left before play'}); };
  const saveGame = async row => {
    await db.rpc(ids.org, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: row.match_id, p_table_number: 1});
    const pr = await db.rpc(ids.scorer, 'fftt_game_progress_v1', {p_event_id: E, p_match_id: row.match_id});
    return db.rpc(ids.scorer, 'fftt_save_completed_game_v1', {p_event_id: E, p_match_id: row.match_id, p_generation: pr.generation,
      p_expected_match_version: pr.match_version, p_expected_epoch: pr.epoch, p_expected_progress_version: pr.revision, p_expected_best_of: pr.best_of,
      p_expected_points_to_win: pr.points_to_win, p_submission_id: crypto.randomUUID(), p_game_index: 1, p_player_1_score: 11, p_player_2_score: 5, p_reason: null});
  };
  const fingerprint = () => db.admin(`select (select count(*)::int from fftt_private.audit_events) a, (select revision from fftt_private.events where id=$1) r,
    (select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'')) from fftt_private.matches x where event_id=$1) m,
    (select count(*)::int from fftt_private.match_game_progress where event_id=$1) g`, [E]).then(r => JSON.stringify(r[0]));
  return {db, ids, E, D, ctx, snap, checkInAll, build, elig, withdraw, saveGame, fingerprint};
}

test('Organizer and Bracket Manager get an eligible verdict that matches the live bracket; read-only', {timeout: 240000}, async () => {
  const w = await world();
  try {
    await w.checkInAll();
    assert.deepEqual(await w.elig('org'), {event_id: w.E, eligible: false, reason: 'lifecycle', generation: 0, revision: (await w.snap()).event.revision},
      'no bracket yet (draft): never eligible');
    await w.build();
    const s = await w.snap();
    assert.equal(s.event.lifecycle, 'active');
    const before = await w.fingerprint();
    for (const who of ['org', 'bm']) {
      const v = await w.elig(who);
      assert.deepEqual(v, {event_id: w.E, eligible: true, reason: null, generation: s.event.generation, revision: s.event.revision});
    }
    assert.equal(await w.fingerprint(), before, 'asking is read-only: no audit row, no revision bump, no data change');
  } finally { await w.db.db.close(); }
});

test('only the Organizer or Bracket Manager OF THIS EVENT may ask: Scorer, outsider, anonymous and another event\'s organizer are refused', {timeout: 240000}, async () => {
  const w = await world();
  try {
    await w.checkInAll(); await w.build();
    for (const who of ['scorer', 'outsider', 'otherorg']) await forbidden(w.elig(who));
    await forbidden(w.elig(null));
    await assert.rejects(w.elig('org', '00000000-0000-4000-8000-000000000000'), () => true);
    // the other event's organizer is fine on THEIR event (draft there => ineligible 'lifecycle'), proving it is event-scoped
    assert.equal((await w.elig('otherorg', w.D)).reason, 'lifecycle');
  } finally { await w.db.db.close(); }
});

test('a saved game blocks it, even with zero completed matches; the verdict agrees with the real withdrawal', {timeout: 240000}, async () => {
  const w = await world();
  try {
    await w.checkInAll(); await w.build();
    const row = (await deskOf(w.ctx, w.ids.scorer))[0];
    const eligibleBefore = await w.elig('org');
    assert.equal(eligibleBefore.eligible, true);
    assert.equal((await w.saveGame(row)).status, 'accepted');
    const s = await w.snap();
    assert.equal(s.matches.filter(m => m.status === 'complete').length, 0, 'no completed match: the old "zero completed matches" guess would have said yes');
    for (const who of ['org', 'bm']) {
      const v = await w.elig(who);
      assert.equal(v.eligible, false); assert.equal(v.reason, 'saved-games-exist');
      assert.ok(v.revision > eligibleBefore.revision, 'the verdict is revision-bound: a stale one is distinguishable');
    }
    await refused(w.withdraw('org'), 'preplay-results-exist');
    await refused(w.withdraw('bm'), 'preplay-results-exist');
  } finally { await w.db.db.close(); }
});

test('a completed result (played or walkover) blocks it and the verdict agrees with the real withdrawal', {timeout: 240000}, async () => {
  const w = await world();
  try {
    await w.checkInAll(); await w.build();
    const [row, other] = await deskOf(w.ctx, w.ids.scorer);
    assert.equal((await submit(w.ctx, w.ids.scorer, row, row.player_1_id, scoreFor(3, 11))).status, 'accepted');
    let v = await w.elig('org'); assert.deepEqual([v.eligible, v.reason], [false, 'results-exist']);
    await refused(w.withdraw('org'), 'preplay-results-exist');
    // a walkover is a completed match too
    assert.equal((await w.db.rpc(w.ids.org, 'fftt_forfeit_match_v3', {p_event_id: w.E, p_match_id: other.match_id, p_expected_match_version: other.match_version,
      p_absent_player_id: other.player_2_id, p_reason: 'Fictional no-show'})).status, 'accepted');
    v = await w.elig('bm'); assert.deepEqual([v.eligible, v.reason], [false, 'results-exist']);
  } finally { await w.db.db.close(); }
});

test('a saved game in a SUPERSEDED bracket generation still blocks it (event-wide, like the withdrawal)', {timeout: 240000}, async () => {
  const w = await world();
  try {
    await w.checkInAll(); await w.build();
    const row = (await deskOf(w.ctx, w.ids.scorer))[0];
    assert.equal((await w.saveGame(row)).status, 'accepted');
    // Organizer rebuild: a NEW generation becomes current while the saved game belongs to generation 1.
    await w.build(true);
    const s = await w.snap();
    assert.ok(s.event.generation >= 2, 'a later generation is current');
    const stillThere = await w.db.admin(`select count(*)::int n from fftt_private.match_game_progress where event_id=$1`, [w.E]);
    assert.equal(stillThere[0].n, 1, 'the saved game of the earlier generation is still recorded');
    const v = await w.elig('org');
    assert.deepEqual([v.eligible, v.reason], [false, 'saved-games-exist']);
    assert.equal(v.generation, s.event.generation);
  } finally { await w.db.db.close(); }
});

test('other event-level blockers: not active, no active Championship, too few checked-in players; reasons are stable codes', {timeout: 240000}, async () => {
  const w = await world();
  try {
    await w.checkInAll(); await w.build();
    // too few checked-in players (needs 3 so that 2 remain)
    const ids = (await w.snap()).players.map(p => p.id);
    await w.db.admin(`update fftt_private.players set checked_in=false where event_id=$1 and id <> all($2::uuid[])`, [w.E, ids.slice(0, 2)]);
    assert.deepEqual([(await w.elig('org')).eligible, (await w.elig('org')).reason], [false, 'not-enough-players']);
    await w.db.admin(`update fftt_private.players set checked_in=true where event_id=$1 and id = $2`, [w.E, ids[2]]);
    assert.equal((await w.elig('org')).eligible, true);
    // no active Championship
    await w.db.admin(`update fftt_private.brackets set status='complete' where event_id=$1 and kind='championship'`, [w.E]);
    assert.equal((await w.elig('org')).reason, 'no-active-championship');
    await w.db.admin(`update fftt_private.brackets set status='active' where event_id=$1 and kind='championship'`, [w.E]);
    // lifecycle: complete and archived are never eligible
    for (const l of ['complete', 'archived']) {
      await w.db.admin(`update fftt_private.events set lifecycle=$2 where id=$1`, [w.E, l]);
      assert.equal((await w.elig('org')).reason, 'lifecycle');
    }
  } finally { await w.db.db.close(); }
});

test('guarded install: replay refused, hosted helper drift refused, rollback removes only the two new functions', {timeout: 240000}, async () => {
  const w = await world();
  try {
    await assert.rejects(w.db.db.exec(PROPOSAL), /already installed/);
    await w.db.db.exec('rollback');
    const count = async () => (await w.db.admin(`select count(*)::int n from pg_proc where proname in ('preplay_withdrawal_eligibility_v1','fftt_preplay_withdrawal_eligibility_v1')`))[0].n;
    assert.equal(await count(), 2);
    await w.db.db.exec(ROLLBACK);
    assert.equal(await count(), 0);
    await assert.rejects(w.elig('org'), () => true, 'without the function the call fails (the client then fails closed)');
    await w.db.db.exec(`create or replace function fftt_private.v3_err(p_kind text, p_detail text default null) returns void language plpgsql immutable set search_path = '' as $f$ begin raise exception 'drift'; end; $f$;`);
    await assert.rejects(w.db.db.exec(PROPOSAL), /helper fingerprints differ/);
    await w.db.db.exec('rollback');
    assert.equal(await count(), 0, 'nothing installed on drift');
  } finally { await w.db.db.close(); }
});
