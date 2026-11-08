/** Mixed-Skill Doubles game-by-game scoring: real SQL in a disposable PGlite database layered like the hosted project.
 * Fictional data only. Every denial is a direct RPC call (the database, not a hidden button, is the authority). */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createHostedEquivalentDb} from './hosted_equivalent.mjs';
import {roster, playAllPlayable} from './helpers.mjs';

const detail = (p, d) => assert.rejects(p, e => e.detail === d || new RegExp(d, 'i').test(e.message + ' ' + (e.detail ?? '')));
const denied = p => assert.rejects(p, e => e.code === '42501' || /forbidden|permission denied|not authenticated|jwt/i.test(e.message));

async function world() {
  const db = await createHostedEquivalentDb({corrections: true});
  const u = n => db.addUser(`${n}@fftt-doubles.invalid`, {platformOrganizer: n === 'org'});
  const ids = {org: await u('org'), bm: await u('bm'), scorer: await u('scorer'), outsider: await u('outsider'), otherScorer: await u('otherscorer')};
  const E = (await db.rpc(ids.org, 'fftt_create_event_v3', {p_name: 'FICTIONAL DOUBLES', p_date: '2026-11-22', p_table_count: 2})).event_id;
  const O = (await db.rpc(ids.org, 'fftt_create_event_v3', {p_name: 'FICTIONAL OTHER', p_date: '2026-11-29', p_table_count: 2})).event_id;
  const grant = (who, ev, role) => db.rpc(ids.org, 'fftt_set_staff_v3', {p_event_id: ev, p_email: `${who}@fftt-doubles.invalid`, p_action: 'grant', p_role: role});
  await grant('bm', E, 'bracket_manager'); await grant('scorer', E, 'scorekeeper'); await grant('otherscorer', O, 'scorekeeper');
  await db.rpc(ids.org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(8)});
  await db.rpc(ids.org, 'fftt_upsert_players_v3', {p_event_id: O, p_players: roster(4)});
  const snap = () => db.rpc(ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  for (const p of (await snap()).players) await db.rpc(ids.org, 'fftt_set_checkin_v3', {p_event_id: E, p_player_id: p.id, p_checked_in: true});
  const ctx = {db, E, org: ids.org, skA: ids.scorer, skB: ids.scorer, snap};
  const {buildChampionship} = await import('./helpers.mjs');
  await buildChampionship(ctx);
  await playAllPlayable(ctx, {only: 'championship'});
  await db.admin('update fftt_private.events set doubles_best_of=3, doubles_points=11 where id=$1', [E]);
  await db.rpc(ids.org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
  const s = await snap();
  const taken = new Set(s.matches.filter(m => m.is_final).flatMap(m => [m.player_1_id, m.player_2_id]));
  const partners = s.players.map(p => p.id).filter(id => !taken.has(id));
  const desk = who => db.rpc(ids[who], 'fftt_doubles_desk_v1', {p_event_id: E});
  const save = (who, d, index, a, b, reason = null, id = crypto.randomUUID(), over = {}) => db.rpc(ids[who], 'fftt_save_doubles_game_v1', {
    p_event_id: E, p_expected_team_key: d.team_key, p_expected_progress_version: d.revision, p_expected_best_of: d.best_of,
    p_expected_points_to_win: d.points_to_win, p_submission_id: id, p_game_index: index, p_team_1_score: a, p_team_2_score: b, p_reason: reason, ...over});
  const audits = op => db.admin('select * from fftt_private.audit_events where event_id=$1 and operation=$2 order by created_at, id', [E, op]);
  const finale = async () => (await db.publicTournaments()).find(r => r.event_name === 'FICTIONAL DOUBLES').finale;
  const otherFp = async () => JSON.stringify(await db.admin(`select (select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,'')) from fftt_private.events x where id=$1) e,
    (select count(*)::int from fftt_private.audit_events where event_id=$1) a, (select count(*)::int from fftt_private.doubles_finale where event_id=$1) d`, [O]));
  return {db, ids, E, O, partners, desk, save, audits, finale, otherFp};
}

test('desk read: no teams yet; partners are chosen only by organizer/bracket manager; scorer sees names only', {timeout: 240000}, async () => {
  const w = await world();
  try {
    assert.equal((await w.desk('scorer')).status, 'no-teams');
    // Scorekeepers must not select or change partners (database check on the direct call).
    await denied(w.db.rpc(w.ids.scorer, 'fftt_set_doubles_teams_v3', {p_event_id: w.E, p_partner_1: w.partners[0], p_partner_2: w.partners[1]}));
    await denied(w.db.rpc(w.ids.outsider, 'fftt_doubles_desk_v1', {p_event_id: w.E}));
    await denied(w.db.rpc(w.ids.otherScorer, 'fftt_doubles_desk_v1', {p_event_id: w.E}));
    await denied(w.db.rpc(null, 'fftt_doubles_desk_v1', {p_event_id: w.E}));
    await w.db.rpc(w.ids.bm, 'fftt_set_doubles_teams_v3', {p_event_id: w.E, p_partner_1: w.partners[0], p_partner_2: w.partners[1]});
    const d = await w.desk('scorer');
    assert.equal(d.status, 'ready'); assert.equal(d.best_of, 3); assert.equal(d.points_to_win, 11); assert.deepEqual(d.games, []); assert.equal(d.revision, 0);
    assert.equal(d.teams.length, 2); assert.ok(d.teams.flat().every(n => typeof n === 'string' && n.length > 2));
    assert.ok(!/rating|email|player_id|"id"/i.test(JSON.stringify(d)), 'no ratings, contacts or identifiers are exposed to the scorer');
    // Even after teams exist, the scorer still cannot change them.
    await denied(w.db.rpc(w.ids.scorer, 'fftt_set_doubles_teams_v3', {p_event_id: w.E, p_partner_1: w.partners[2], p_partner_2: w.partners[3]}));
    assert.equal((await w.desk('org')).team_key, d.team_key, 'the teams did not change');
  } finally { await w.db.db.close(); }
});

test('games saved and corrected by scorekeeper, bracket manager and organizer; reason optional; audit; public view unchanged', {timeout: 300000}, async () => {
  const w = await world();
  try {
    await w.db.rpc(w.ids.bm, 'fftt_set_doubles_teams_v3', {p_event_id: w.E, p_partner_1: w.partners[0], p_partner_2: w.partners[1]});
    const before = await w.otherFp();
    const publicBefore = JSON.stringify(await w.finale());
    assert.equal(JSON.parse(publicBefore).status, 'pending');
    let d = await w.desk('scorer');
    assert.equal((await w.save('scorer', d, 1, 11, 7)).status, 'accepted');
    assert.equal(JSON.stringify(await w.finale()), publicBefore, 'a saved game is not published: Spectator/TV see the finale unchanged');
    for (const [i, who] of ['scorer', 'bm', 'org'].entries()) {
      d = await w.desk(who);
      assert.equal(d.games.length, 1, `${who} sees the saved game`);
      const r1 = await w.save(who, d, 1, 11, 9 - i);
      assert.equal(r1.status, 'accepted', `${who} corrects a saved doubles game with no reason`);
    }
    const log = await w.audits('doubles_game_corrected');
    assert.equal(log.length, 3);
    assert.deepEqual(log.map(a => a.actor_id), [w.ids.scorer, w.ids.bm, w.ids.org]);
    assert.deepEqual(log[0].before_state.score, [11, 7]); assert.deepEqual(log[0].after_state.score, [11, 9]);
    assert.deepEqual(log[1].before_state.score, [11, 9]); assert.deepEqual(log[1].after_state.score, [11, 8]);
    assert.deepEqual(log[2].before_state.score, [11, 8]); assert.deepEqual(log[2].after_state.score, [11, 7]);
    for (const a of log) { assert.equal(a.reason, null); assert.ok(a.created_at); assert.equal(a.event_id, w.E); assert.equal(a.match_id, null); }
    d = await w.desk('scorer');
    const withReason = await w.save('scorer', d, 1, 11, 5, 'Read the wrong paper tally');
    assert.equal(withReason.status, 'accepted');
    assert.equal((await w.audits('doubles_game_corrected')).at(-1).reason, 'Read the wrong paper tally');
    // New games may not carry a correction reason; an over-long one is refused.
    d = await w.desk('scorer');
    await detail(w.save('scorer', d, 2, 11, 3, 'not a correction'), 'reason');
    await detail(w.save('scorer', d, 1, 11, 3, 'x'.repeat(501)), 'reason');
    // Format validation (won by 2, not decided early, in order)
    await detail(w.save('scorer', d, 2, 11, 10), 'scores-game');
    await detail(w.save('scorer', d, 3, 11, 3), 'game-order');
    assert.equal(JSON.stringify(await w.finale()), publicBefore, 'the public finale is still unchanged');
    assert.equal(await w.otherFp(), before, 'the other event is untouched');
  } finally { await w.db.db.close(); }
});

test('forbidden direct calls, stale and idempotent doubles saves', {timeout: 300000}, async () => {
  const w = await world();
  try {
    await w.db.rpc(w.ids.bm, 'fftt_set_doubles_teams_v3', {p_event_id: w.E, p_partner_1: w.partners[0], p_partner_2: w.partners[1]});
    const d0 = await w.desk('scorer');
    for (const who of ['outsider', 'otherScorer']) await denied(w.save(who, d0, 1, 11, 7));
    await denied(w.db.rpc(null, 'fftt_save_doubles_game_v1', {p_event_id: w.E, p_expected_team_key: d0.team_key, p_expected_progress_version: 0, p_expected_best_of: 3,
      p_expected_points_to_win: 11, p_submission_id: crypto.randomUUID(), p_game_index: 1, p_team_1_score: 11, p_team_2_score: 0}));
    assert.deepEqual((await w.desk('scorer')).games, []);
    const id = crypto.randomUUID();
    const first = await w.save('scorer', d0, 1, 11, 7, null, id);
    assert.equal(first.status, 'accepted'); assert.equal(first.match_id, w.E);
    assert.deepEqual(await w.save('scorer', d0, 1, 11, 7, null, id), first, 'the same submission replays its receipt');
    assert.equal((await w.audits('doubles_game_saved')).length, 1, 'a replay writes no second audit row');
    await assert.rejects(w.save('scorer', d0, 1, 11, 2, null, id), /submission-id-reused|conflict/i);
    const receipt = await w.db.rpc(w.ids.scorer, 'fftt_game_progress_decision_v1', {p_event_id: w.E, p_submission_id: id});
    assert.deepEqual(receipt, first, 'the standard receipt reader returns the doubles receipt');
    // A stale writer (old revision) is rejected with a receipt and cannot overwrite the newer value.
    const stale = await w.save('bm', d0, 1, 11, 3);
    assert.equal(stale.status, 'rejected'); assert.equal(stale.reason, 'stale-progress');
    assert.deepEqual((await w.desk('scorer')).games, [[11, 7]]);
    // Wrong team key (e.g. the finalists/partners changed) and wrong format are stale too.
    const d1 = await w.desk('scorer');
    assert.equal((await w.save('scorer', d1, 2, 11, 4, null, crypto.randomUUID(), {p_expected_team_key: 'x'.repeat(32)})).status, 'rejected');
    assert.equal((await w.save('scorer', d1, 2, 11, 4, null, crypto.randomUUID(), {p_expected_best_of: 1})).status, 'rejected');
    assert.deepEqual((await w.desk('scorer')).games, [[11, 7]]);
    // Changing the partners invalidates previously saved games: they cannot be revived for the new teams.
    await w.db.rpc(w.ids.bm, 'fftt_set_doubles_teams_v3', {p_event_id: w.E, p_partner_1: w.partners[2], p_partner_2: w.partners[3]});
    const d2 = await w.desk('scorer');
    assert.deepEqual(d2.games, [], 'games saved for the old teams are not shown for the new teams');
    assert.notEqual(d2.team_key, d1.team_key); assert.ok(d2.revision >= d1.revision, 'revisions never rewind');
    assert.equal((await w.save('scorer', d1, 2, 11, 4)).status, 'rejected', 'a write prepared for the old teams cannot land');
    assert.equal((await w.save('scorer', d2, 1, 11, 6)).status, 'accepted');
    assert.deepEqual((await w.desk('scorer')).games, [[11, 6]]);
  } finally { await w.db.db.close(); }
});

test('finalization follows saved games; finalized results: scorer denied, bracket manager and organizer may correct, reason optional', {timeout: 300000}, async () => {
  const w = await world();
  try {
    await w.db.rpc(w.ids.bm, 'fftt_set_doubles_teams_v3', {p_event_id: w.E, p_partner_1: w.partners[0], p_partner_2: w.partners[1]});
    const before = await w.otherFp();
    let d = await w.desk('scorer');
    await w.save('scorer', d, 1, 11, 7); d = await w.desk('scorer'); await w.save('scorer', d, 2, 9, 11); d = await w.desk('scorer');
    const record = (who, team, scores) => w.db.rpc(w.ids[who], 'fftt_record_doubles_result_v3', {p_event_id: w.E, p_winner_team: team, p_game_scores: scores});
    // Undecided saved games cannot be finalized; a different score than the saved games is refused.
    await detail(record('scorer', 1, '11-7, 9-11'), 'scores');   // not a decided match: score validation refuses it first
    await w.save('scorer', d, 3, 11, 5); d = await w.desk('scorer');
    await detail(record('scorer', 1, '11-7, 9-11, 11-4'), 'game-progress-mismatch');
    await denied(record('outsider', 1, '11-7, 9-11, 11-5'));
    assert.equal((await record('scorer', 1, '11-7, 9-11, 11-5')).status, 'recorded');
    const pub = await w.finale();
    assert.equal(pub.status, 'complete'); assert.equal(pub.winner_team, 1); assert.equal(pub.game_scores, '11-7, 9-11, 11-5');
    assert.ok(!JSON.stringify(pub).includes('progress'), 'the public finale carries no saved-game data');
    // Once finalized the scorer can neither add games, correct games, change the result, nor use the correction RPC.
    d = await w.desk('scorer');
    assert.equal(d.status, 'complete'); assert.equal(d.winner_team, 1);
    await detail(w.save('scorer', d, 3, 11, 2), 'doubles-complete');
    await detail(w.save('scorer', d, 1, 11, 2), 'doubles-complete');
    await denied(record('scorer', 2, '7-11, 11-9, 5-11'));
    const correct = (who, team, scores, extra = {}) => w.db.rpc(w.ids[who], 'fftt_correct_doubles_result_v1', {p_event_id: w.E, p_expected_winner_team: 1,
      p_expected_game_scores: '11-7, 9-11, 11-5', p_winner_team: team, p_game_scores: scores, ...extra});
    await denied(correct('scorer', 1, '11-2, 9-11, 11-5'));
    await denied(correct('outsider', 1, '11-2, 9-11, 11-5'));
    await denied(correct('otherScorer', 1, '11-2, 9-11, 11-5'));
    await denied(w.db.rpc(null, 'fftt_correct_doubles_result_v1', {p_event_id: w.E, p_expected_winner_team: 1, p_expected_game_scores: '11-7, 9-11, 11-5', p_winner_team: 1, p_game_scores: '11-2, 9-11, 11-5'}));
    assert.equal((await w.audits('doubles_result_corrected')).length, 0, 'denied calls wrote nothing');
    // Bracket manager: reason omitted. Organizer: reason supplied. Both audited with before/after.
    assert.equal((await correct('bm', 1, '11-2, 9-11, 11-5')).status, 'corrected');
    assert.equal((await w.finale()).game_scores, '11-2, 9-11, 11-5', 'the public finale follows the correction');
    const second = await w.db.rpc(w.ids.org, 'fftt_correct_doubles_result_v1', {p_event_id: w.E, p_expected_winner_team: 1,
      p_expected_game_scores: '11-2, 9-11, 11-5', p_winner_team: 2, p_game_scores: '7-11, 11-9, 5-11', p_reason: 'Winners were entered backwards'});
    assert.equal(second.status, 'corrected');
    const log = await w.audits('doubles_result_corrected');
    assert.equal(log.length, 2);
    assert.equal(log[0].actor_id, w.ids.bm); assert.equal(log[0].reason, null);
    assert.deepEqual(log[0].before_state, {winner_team: 1, game_scores: '11-7, 9-11, 11-5'}); assert.equal(log[0].after_state.game_scores, '11-2, 9-11, 11-5');
    assert.equal(log[1].actor_id, w.ids.org); assert.equal(log[1].reason, 'Winners were entered backwards');
    assert.equal(log[1].before_state.winner_team, 1); assert.equal(log[1].after_state.winner_team, 2);
    assert.ok(log.every(a => a.created_at && a.event_id === w.E));
    assert.equal((await w.finale()).winner_team, 2);
    // Stale expectation, bad input and the legacy direct RPC for a finalized result.
    await detail(correct('bm', 1, '11-1, 9-11, 11-5'), 'result-changed');
    await detail(w.db.rpc(w.ids.bm, 'fftt_correct_doubles_result_v1', {p_event_id: w.E, p_expected_winner_team: 2, p_expected_game_scores: '7-11, 11-9, 5-11', p_winner_team: 2, p_game_scores: '7-11, 11-9, 5-11', p_reason: 'x'.repeat(301)}), 'reason');
    assert.equal((await record('bm', 1, '11-7, 9-11, 11-5')).status, 'recorded', 'a bracket manager may now also change a finalized result through the original RPC');
    assert.equal(await w.otherFp(), before, 'the other event is untouched');
  } finally { await w.db.db.close(); }
});
