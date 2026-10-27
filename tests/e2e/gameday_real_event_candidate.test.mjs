/** Offline real-event candidate proof using FICTIONAL users and a new disposable PGlite instance.
 * These tests never contact Supabase, Google, Cloudflare or real registrations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createLocalDb, SQL_FILES} from './localdb.mjs';

test('real-event SQL: isolated creation, role denial, Google source, scoring and anonymous privacy', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fftt-real-candidate-'));
  let db;
  try {
    const out = path.join(tmp, 'sql');
    const result = spawnSync('python3', ['tools/release/build_real_event_candidate.py', '--candidate', '--out', out],
      {encoding: 'utf8', cwd: path.resolve(''), timeout: 30000});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const paths = SQL_FILES.map((source, i) => path.join(out, String(i + 1).padStart(2, '0') + '_' + path.basename(source)));
    for (const file of paths) assert.ok(fs.existsSync(file), 'file generated: ' + file);
    db = await createLocalDb({sqlFiles: paths});

    const org = await db.addUser('organizer@fftt-production-test.invalid', {platformOrganizer: true});
    const scorer = await db.addUser('scorer@fftt-production-test.invalid');
    const outsider = await db.addUser('outsider@fftt-production-test.invalid');
    const ev = await db.rpc(org, 'fftt_create_event_v3',
      {p_name: 'Fictional Real-Mode Test', p_date: '2026-11-22', p_table_count: 2});
    const E = ev.event_id;
    assert.ok(E);
    const flags = await db.admin('select synthetic_only from fftt_private.events where id=$1', [E]);
    assert.equal(flags[0].synthetic_only, false, 'real-only event default');
    await assert.rejects(db.admin('update fftt_private.events set synthetic_only=true where id=$1', [E]),
      e => e.code === '23514', 'production DB must reject synthetic events');
    await assert.rejects(db.rpc(outsider, 'fftt_organizer_snapshot_v3', {p_event_id: E}),
      'outsiders cannot read the private roster');

    const sheet = await db.rpc(org, 'fftt_set_registration_source_v5', {p_event_id: E,
      p_source: {kind: 'google-sheets', spreadsheet_id: 'EXAMPLE_NONREAL_SPREADSHEET_ID_12345',
        spreadsheet_title: 'Synthetic metadata for test', worksheet: 'Form Responses 1',
        column_map: {}, enabled: true}});
    assert.equal(sheet.status, 'saved', 'only real-mode events can enable Google sources');
    const src = await db.rpc(org, 'fftt_registration_source_v5', {p_event_id: E});
    assert.equal(src.event_synthetic, false);
    assert.equal(src.enabled, true);
    await assert.rejects(db.rpc(org, 'fftt_set_registration_source_v5',
      {p_event_id: E, p_source: {kind: 'fixture', enabled: true}}),
      'production mode rejects synthetic fixture registration');
    await assert.rejects(db.rpc(outsider, 'fftt_registration_source_v5', {p_event_id: E}),
      'outsiders cannot read source settings');

    await db.rpc(org, 'fftt_set_staff_v3',
      {p_event_id: E, p_email: 'scorer@fftt-production-test.invalid', p_action: 'grant', p_role: 'scorekeeper'});
    const players = [
      {name: 'Fictional Alpha', rating: 2, rating_status: 'provisional'},
      {name: 'Fictional Bravo', rating: 3, rating_status: 'provisional'},
    ];
    await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: players});
    const snap = await db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
    assert.equal(snap.players.length, 2);
    for (const p of snap.players) {
      await db.rpc(org, 'fftt_set_checkin_v3', {p_event_id: E, p_player_id: p.id, p_checked_in: true});
    }
    await db.rpc(org, 'fftt_build_championship_v3',
      {p_event_id: E, p_slots: snap.players.map(p => p.id), p_expected_generation: 0, p_confirm: false});
    const desk = await db.rpc(scorer, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true});
    assert.equal(desk.length, 1);
    const m = desk[0];
    const accepted = await db.rpc(scorer, 'fftt_submit_match_result_v2', {
      p_event_id: E, p_match_id: m.match_id, p_bracket_generation: m.bracket_generation,
      p_expected_match_version: m.match_version, p_submission_id: crypto.randomUUID(),
      p_winner_id: m.player_1_id, p_game_scores: '11-5, 11-7', p_table_number: 1,
    });
    assert.equal(accepted.status, 'accepted');
    await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
    const pub = await db.publicTournaments();
    assert.equal(pub.length, 1);
    const visible = JSON.stringify(pub);
    assert.ok(!visible.includes(E), 'private event UUID must not publish');
    for (const p of snap.players) assert.ok(!visible.includes(p.id), 'private player UUID must not publish');
    assert.ok(!visible.includes('EXAMPLE_NONREAL_SPREADSHEET_ID_12345'), 'sheet ID must not publish');
    assert.ok(!visible.includes('rating'), 'ratings must not publish');
  } finally {
    if (db) await db.db.close();
    fs.rmSync(tmp, {force: true, recursive: true});
  }
});
