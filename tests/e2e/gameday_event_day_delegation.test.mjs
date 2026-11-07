/** FFTT3 delegated event-day authority: real SQL in disposable PGlite, no external systems.
 * Tests allow/deny boundaries for Bracket Manager, Scorekeeper and an outsider,
 * and verifies that the sourced rollback restores Organizer-only restrictions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createLocalDb} from './localdb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sql = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const roleSql = 'supabase/proposals/FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql';
const delegateSql = 'supabase/proposals/FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql';
const rollbackSql = 'supabase/proposals/FFTT3_EVENT_DAY_DELEGATION_20261105_ROLLBACK_DO_NOT_APPLY.sql';
const forbidden = async promise => assert.rejects(promise,
  e => e.code === '42501' && e.message === 'forbidden', 'the database must reject an unauthorized call');

test('Bracket Manager can run a complete fictional event day but cannot become Organizer; rollback restores denial', {timeout: 180000}, async () => {
  const db = await createLocalDb({upgraded: true});
  try {
    await db.db.exec(sql(roleSql));
    await db.db.exec(sql(delegateSql));
    const org = await db.addUser('organizer@fftt-delegation.invalid', {platformOrganizer: true});
    const manager = await db.addUser('manager@fftt-delegation.invalid');
    const scorer = await db.addUser('scorer@fftt-delegation.invalid');
    const outsider = await db.addUser('outsider@fftt-delegation.invalid');

    const E = (await db.rpc(org, 'fftt_create_event_v3',
      {p_name: 'FICTIONAL EVENT DAY', p_date: '2026-11-08', p_table_count: 2})).event_id;
    const other = (await db.rpc(org, 'fftt_create_event_v3',
      {p_name: 'FICTIONAL NOVEMBER 22', p_date: '2026-11-22', p_table_count: 2})).event_id;
    await db.rpc(org, 'fftt_set_staff_v3',
      {p_event_id: E, p_email: 'manager@fftt-delegation.invalid', p_action: 'grant', p_role: 'bracket_manager'});
    await db.rpc(org, 'fftt_set_staff_v3',
      {p_event_id: E, p_email: 'scorer@fftt-delegation.invalid', p_action: 'grant', p_role: 'scorekeeper'});
    await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: [
      {name: 'Fictional Alpha Player', rating: 3, rating_status: 'provisional'},
      {name: 'Fictional Bravo Player', rating: 2, rating_status: 'provisional'},
      {name: 'Fictional Delta Player', rating: 4, rating_status: 'provisional'}
    ]});
    const untouched = JSON.stringify(await db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: other}));

    let snap = await db.rpc(manager, 'fftt_bracket_manager_snapshot_v1', {p_event_id: E});
    assert.equal(snap.staff.length, 0);
    assert.ok(snap.players.every(p => p.registration_refs.length === 0));
    assert.ok(!JSON.stringify(snap).includes('@fftt-delegation.invalid'));

    await forbidden(db.rpc(manager, 'fftt_organizer_snapshot_v3', {p_event_id: E}));
    await forbidden(db.rpc(manager, 'fftt_bracket_manager_snapshot_v1', {p_event_id: other}));
    await forbidden(db.rpc(manager, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true}));
    await forbidden(db.rpc(manager, 'fftt_set_staff_v3',
      {p_event_id: E, p_email: 'outsider@fftt-delegation.invalid', p_action: 'grant', p_role: 'organizer'}));
    await forbidden(db.rpc(scorer, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'complete'}));
    await forbidden(db.rpc(scorer, 'fftt_event_day_walkin_v1',
      {p_event_id: E, p_name: 'Fictional Unauthorized Player', p_rating: 2}));
    await forbidden(db.rpc(outsider, 'fftt_event_day_walkin_v1',
      {p_event_id: E, p_name: 'Fictional Outsider Player', p_rating: 2}));

    for (const p of snap.players) {
      await db.rpc(manager, 'fftt_set_checkin_v3',
        {p_event_id: E, p_player_id: p.id, p_checked_in: true});
    }
    const walkin = await db.rpc(manager, 'fftt_event_day_walkin_v1',
      {p_event_id: E, p_name: 'Fictional Charlie Walkin', p_rating: 1});
    assert.equal(walkin.status, 'saved');
    snap = await db.rpc(manager, 'fftt_bracket_manager_snapshot_v1', {p_event_id: E});
    assert.equal(snap.players.length, 4);
    assert.ok(snap.players.every(p => p.checked_in));

    const ids = snap.players.map(p => p.id);
    await db.rpc(manager, 'fftt_build_championship_v3', {
      p_event_id: E, p_slots: ids, p_expected_generation: 0, p_confirm: false
    });
    await assert.rejects(db.rpc(manager, 'fftt_event_day_walkin_v1',
      {p_event_id: E, p_name: 'Fictional Late Arrival', p_rating: 2}),
    e => e.code === 'P0001' && e.message === 'fftt_conflict');
    await assert.rejects(db.rpc(manager, 'fftt_set_checkin_v3',
      {p_event_id: E, p_player_id: ids[0], p_checked_in: false}),
    e => e.code === 'P0001' && e.message === 'fftt_conflict');
    await assert.rejects(db.rpc(manager, 'fftt_set_lifecycle_v3',
      {p_event_id: E, p_lifecycle: 'complete'}),
    e => e.code === 'P0001' && e.message === 'fftt_conflict');

    const ready = async () => db.rpc(scorer, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true});
    let first = (await ready())[0];
    assert.ok(first, 'a match is ready');
    await db.rpc(manager, 'fftt_set_match_format_v4', {
      p_event_id: E, p_match_id: first.match_id, p_best_of: 1, p_points: 21
    });
    await db.rpc(manager, 'fftt_forfeit_match_v3', {
      p_event_id: E, p_match_id: first.match_id, p_expected_match_version: first.match_version,
      p_absent_player_id: first.player_2_id, p_reason: 'Did not arrive at table'
    });
    snap = await db.rpc(manager, 'fftt_bracket_manager_snapshot_v1', {p_event_id: E});
    const completed = snap.matches.find(m => m.id === first.match_id);
    assert.equal(completed.game_scores, 'W/O');
    await db.rpc(manager, 'fftt_correct_result_v3', {
      p_event_id: E, p_match_id: completed.id, p_expected_match_version: completed.version,
      p_winner_id: completed.winner_id, p_game_scores: '21-0', p_reason: 'Checked signed scorecard'
    });
    let guard = 0;
    while (true) {
      const rows = await ready();
      if (!rows.length) break;
      const m = rows[0];
      const scores = Array.from({length: Math.floor((m.best_of + 1) / 2)},
        () => String(m.points_to_win) + '-0').join(',');
      const accepted = await db.rpc(scorer, 'fftt_submit_match_result_v2', {
        p_event_id: E, p_match_id: m.match_id, p_bracket_generation: m.bracket_generation,
        p_expected_match_version: m.match_version, p_submission_id: randomUUID(),
        p_winner_id: m.player_1_id, p_game_scores: scores, p_table_number: 1
      });
      assert.equal(accepted.status, 'accepted');
      if (++guard > 20) throw new Error('unexpected score loop');
    }
    const status = await db.rpc(manager, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'complete'});
    assert.equal(status.lifecycle, 'complete');
    const audit = await db.rpc(org, 'fftt_audit_log_v3', {p_event_id: E, p_limit: 100});
    for (const operation of ['registration_checkin','match_forfeited','result_corrected','format_changed','lifecycle_changed'])
      assert.ok(audit.some(x => x.operation === operation), 'audit entry ' + operation);
    assert.equal(JSON.stringify(await db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: other})), untouched,
      'delegated rehearsal leaves the Nov 22 event byte-identical');

    // A rollback must not silently retain any delegated RPC or broadened privileges.
    await db.db.exec(sql(rollbackSql));
    await forbidden(db.rpc(manager, 'fftt_set_checkin_v3',
      {p_event_id: E, p_player_id: ids[0], p_checked_in: true}));
    await forbidden(db.rpc(manager, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'archived'}));
    await forbidden(db.rpc(manager, 'fftt_set_match_format_v4',
      {p_event_id: E, p_match_id: first.match_id, p_best_of: 1, p_points: 11}));
    await assert.rejects(db.rpc(manager, 'fftt_event_day_walkin_v1',
      {p_event_id: E, p_name: 'Fictional Rejected Walkin', p_rating: 2}),
    e => e.code === '42883', 'new walk-in RPC is removed by rollback');
    assert.equal((await db.rpc(manager, 'fftt_bracket_manager_snapshot_v1', {p_event_id: E})).event.lifecycle,
      'complete', 'original manager read access is preserved');
  } finally {
    await db.db.close();
  }
});
