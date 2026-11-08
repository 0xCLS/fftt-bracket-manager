/** Staff correction permissions: real SQL in a disposable PGlite database layered like the hosted project.
 * Fictional data only; never connects to Supabase. Authorization is asserted at the database/RPC layer,
 * not through the UI: every denial below is a direct API call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createHostedEquivalentDb, CORRECTIONS} from './hosted_equivalent.mjs';
import {roster, buildChampionship, deskOf} from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION = fs.readFileSync(path.join(ROOT, CORRECTIONS), 'utf8');
const detail = (p, d) => assert.rejects(p, e => e.detail === d || new RegExp(d, 'i').test(e.message + ' ' + (e.detail ?? '')));
const denied = p => assert.rejects(p, e => e.code === '42501' || /forbidden|permission denied|not authenticated|jwt/i.test(e.message));
const FUNCS = ['fftt_private.game_progress_save_v1(uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text)',
  'fftt_private.correct_result_v3(uuid,uuid,bigint,uuid,text,text)', 'public.fftt_correct_result_v3(uuid,uuid,bigint,uuid,text,text)',
  'fftt_private.record_doubles_result_v3(uuid,integer,text)'];

async function world() {
  const db = await createHostedEquivalentDb();
  const acls = async () => (await Promise.all(FUNCS.map(f => db.admin(`select proacl::text a from pg_proc where oid='${f}'::regprocedure`)))).map(r => r[0].a);
  const aclsBefore = await acls();
  await db.db.exec(MIGRATION);
  assert.deepEqual(await acls(), aclsBefore, 'the migration changes no function privilege');
  const u = n => db.addUser(`${n}@fftt-corrections.invalid`, {platformOrganizer: n === 'org'});
  const ids = {org: await u('org'), bm: await u('bm'), scorer: await u('scorer'), outsider: await u('outsider'), otherScorer: await u('otherscorer')};
  const E = (await db.rpc(ids.org, 'fftt_create_event_v3', {p_name: 'FICTIONAL CORRECTIONS', p_date: '2026-11-22', p_table_count: 4})).event_id;
  const O = (await db.rpc(ids.org, 'fftt_create_event_v3', {p_name: 'FICTIONAL OTHER EVENT', p_date: '2026-11-29', p_table_count: 2})).event_id;
  const grant = (who, ev, role) => db.rpc(ids.org, 'fftt_set_staff_v3', {p_event_id: ev, p_email: `${who}@fftt-corrections.invalid`, p_action: 'grant', p_role: role});
  await grant('bm', E, 'bracket_manager'); await grant('scorer', E, 'scorekeeper'); await grant('otherscorer', O, 'scorekeeper');
  await db.rpc(ids.org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(8)});
  const ctx = {db, E, org: ids.org, snap: () => db.rpc(ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
  for (const p of (await ctx.snap()).players) await db.rpc(ids.org, 'fftt_set_checkin_v3', {p_event_id: E, p_player_id: p.id, p_checked_in: true});
  await buildChampionship(ctx);
  // other event: a little data so isolation can be proven
  await db.rpc(ids.org, 'fftt_upsert_players_v3', {p_event_id: O, p_players: roster(4)});
  const rows = (await deskOf(ctx, ids.scorer)).filter(r => r.player_1_id && r.player_2_id);
  assert.ok(rows.length >= 4, 'four playable fictional matches');
  let table = 0;
  const open = async row => { await db.rpc(ids.org, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: row.match_id, p_table_number: ++table}); return row; };
  const shot = (who, row) => db.rpc(ids[who], 'fftt_game_progress_v1', {p_event_id: E, p_match_id: row.match_id});
  const save = (who, row, s, index, a, b, reason = null, id = crypto.randomUUID()) => db.rpc(ids[who], 'fftt_save_completed_game_v1', {
    p_event_id: E, p_match_id: row.match_id, p_generation: s.generation, p_expected_match_version: s.match_version,
    p_expected_epoch: s.epoch, p_expected_progress_version: s.revision, p_expected_best_of: s.best_of,
    p_expected_points_to_win: s.points_to_win, p_submission_id: id, p_game_index: index,
    p_player_1_score: a, p_player_2_score: b, p_reason: reason});
  const audits = (op, row) => db.admin('select * from fftt_private.audit_events where event_id=$1 and operation=$2 and match_id=$3 order by created_at, id', [E, op, row.match_id]);
  const otherFp = async () => JSON.stringify([
    await db.admin('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,\'\')) m from fftt_private.events x where id=$1', [O]),
    await db.admin('select count(*)::int n from fftt_private.audit_events where event_id=$1', [O]),
    await db.admin('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,\'\')) m from fftt_private.players x where event_id=$1', [O])]);
  return {db, ids, E, O, rows, open, shot, save, audits, otherFp, ctx};
}

const finalize = async (w, who, row, winnerKey = 'player_1_id', scores = '11-7, 11-8') => {
  const s = await w.shot(who, row);
  return w.db.rpc(w.ids[who], 'fftt_submit_match_result_v2', {p_event_id: w.E, p_match_id: row.match_id,
    p_bracket_generation: row.bracket_generation, p_expected_match_version: s.match_version, p_submission_id: crypto.randomUUID(),
    p_winner_id: row[winnerKey], p_game_scores: scores, p_table_number: row.table_number ?? 1});
};

test('saved-game corrections: scorekeeper, bracket manager and organizer, reason optional, audit before/after', {timeout: 240000}, async () => {
  const w = await world();
  try {
    const before = await w.otherFp();
    for (const [i, who] of ['scorer', 'bm', 'org'].entries()) {
      const row = await w.open(w.rows[i]);
      const s0 = await w.shot('scorer', row);
      assert.equal((await w.save('scorer', row, s0, 1, 11, 7)).status, 'accepted');
      const s1 = await w.shot(who, row);
      // 1. correction with NO reason (null)
      const r1 = await w.save(who, row, s1, 1, 11, 9);
      assert.equal(r1.status, 'accepted', `${who} may correct a saved game without a reason`);
      // 2. blank reason is the same as none; 3. an optional explanation is accepted and stored
      const r2 = await w.save(who, row, await w.shot(who, row), 1, 11, 6, '   ');
      assert.equal(r2.status, 'accepted');
      const r3 = await w.save(who, row, await w.shot(who, row), 1, 11, 5, 'Scorer misread the paper tally');
      assert.equal(r3.status, 'accepted');
      const log = await w.audits('game_corrected', row);
      assert.equal(log.length, 3);
      for (const a of log) {
        assert.equal(a.actor_id, w.ids[who], 'actor identity recorded');
        assert.equal(a.event_id, w.E); assert.equal(a.match_id, row.match_id); assert.ok(a.created_at, 'timestamp recorded');
      }
      assert.deepEqual(log[0].before_state.score, [11, 7]); assert.deepEqual(log[0].after_state.score, [11, 9]); assert.equal(log[0].reason, null);
      assert.deepEqual(log[1].before_state.score, [11, 9]); assert.deepEqual(log[1].after_state.score, [11, 6]); assert.equal(log[1].reason, null, 'blank reason stored as none');
      assert.deepEqual(log[2].before_state.score, [11, 6]); assert.deepEqual(log[2].after_state.score, [11, 5]); assert.equal(log[2].reason, 'Scorer misread the paper tally');
      assert.equal(log[0].before_state.game, 1);
      assert.ok(log[2].event_revision > log[0].event_revision, 'revisions advance on every correction');
      assert.deepEqual((await w.shot(who, row)).games, [[11, 5]], 'only the corrected value remains current');
    }
    // a normal new game still must not carry a correction reason, and the length cap holds
    const row = await w.open(w.rows[3]);
    const s = await w.shot('scorer', row);
    await detail(w.save('scorer', row, s, 1, 11, 4, 'Not a correction'), 'reason');
    assert.equal((await w.save('scorer', row, s, 1, 11, 4, '   ')).status, 'accepted', 'blank reason on a new game is ignored');
    await detail(w.save('scorer', row, await w.shot('scorer', row), 1, 11, 3, 'x'.repeat(501)), 'reason');
    assert.equal(await w.otherFp(), before, 'the other event is untouched');
  } finally { await w.db.db.close(); }
});

test('forbidden direct API calls: outsiders, staff of another event and anonymous callers', {timeout: 240000}, async () => {
  const w = await world();
  try {
    const row = await w.open(w.rows[0]);
    const s = await w.shot('scorer', row);
    await w.save('scorer', row, s, 1, 11, 7);
    const cur = await w.shot('scorer', row);
    for (const who of ['outsider', 'otherScorer']) {
      await denied(w.save(who, row, cur, 1, 11, 9));
      await denied(w.save(who, row, cur, 2, 11, 9));
    }
    await denied(w.db.rpc(null, 'fftt_save_completed_game_v1', {p_event_id: w.E, p_match_id: row.match_id, p_generation: 1, p_expected_match_version: 0,
      p_expected_epoch: 0, p_expected_progress_version: 0, p_expected_best_of: 3, p_expected_points_to_win: 11, p_submission_id: crypto.randomUUID(),
      p_game_index: 1, p_player_1_score: 11, p_player_2_score: 0, p_reason: null}));
    assert.deepEqual((await w.shot('scorer', row)).games, [[11, 7]], 'forbidden calls changed nothing');
    assert.equal((await w.audits('game_corrected', row)).length, 0);
  } finally { await w.db.db.close(); }
});

test('finalized results: scorekeeper denied; bracket manager and organizer may correct, reason optional', {timeout: 240000}, async () => {
  const w = await world();
  try {
    const before = await w.otherFp();
    const call = (who, row, version, winner, scores, extra = {reason: undefined}) => w.db.rpc(w.ids[who], 'fftt_correct_result_v3', {
      p_event_id: w.E, p_match_id: row.match_id, p_expected_match_version: version, p_winner_id: winner, p_game_scores: scores,
      ...(extra.reason === undefined ? {} : {p_reason: extra.reason})});
    const finals = [];
    for (const i of [0, 1, 2]) {
      const row = await w.open(w.rows[i]);
      const s = await w.shot('scorer', row);
      await w.save('scorer', row, s, 1, 11, 7); await w.save('scorer', row, await w.shot('scorer', row), 2, 11, 8);
      assert.equal((await finalize(w, 'scorer', row)).status, 'accepted');
      const m = (await w.db.admin('select match_version v, winner_id from fftt_private.matches where id=$1', [row.match_id]))[0];
      finals.push({row, version: Number(m.v), winner: m.winner_id});
    }
    const [a, b, c] = finals;
    // Scorekeeper: refused by the database, on the finalized result AND on any saved-game correction path.
    await denied(call('scorer', a.row, a.version, a.winner, '11-5, 11-6', {reason: null}));
    await denied(call('scorer', a.row, a.version, a.winner, '11-5, 11-6', {reason: 'I really want this changed please'}));
    await assert.rejects(w.save('scorer', a.row, await w.shot('scorer', a.row), 1, 11, 5), /conflict|playable/i);
    for (const who of ['outsider', 'otherScorer']) await denied(call(who, a.row, a.version, a.winner, '11-5, 11-6', {reason: null}));
    await denied(w.db.rpc(null, 'fftt_correct_result_v3', {p_event_id: w.E, p_match_id: a.row.match_id, p_expected_match_version: a.version, p_winner_id: a.winner, p_game_scores: '11-5, 11-6', p_reason: null}));
    assert.equal((await w.db.admin('select count(*)::int n from fftt_private.audit_events where event_id=$1 and operation=$2', [w.E, 'result_corrected']))[0].n, 0, 'denied calls wrote nothing');
    const unchanged = (await w.db.admin('select game_scores from fftt_private.matches where id=$1', [a.row.match_id]))[0].game_scores;

    // Bracket manager: explicit null reason.
    const r1 = await call('bm', a.row, a.version, a.winner, '11-5, 11-6', {reason: null});
    assert.equal(r1.status, 'corrected');
    // Organizer: the reason argument omitted entirely (direct API caller).
    const r2 = await call('org', b.row, b.version, b.winner, '11-4, 11-3');
    assert.equal(r2.status, 'corrected');
    // Organizer with an optional explanation, and winner change that moves the next-round slot.
    const loser = c.row.player_1_id === c.winner ? c.row.player_2_id : c.row.player_1_id;
    const r3 = await call('org', c.row, c.version, loser, (loser === c.row.player_1_id ? '11-8, 11-7' : '8-11, 7-11'), {reason: 'Winner was entered backwards'});
    assert.equal(r3.status, 'corrected');

    const log = await w.audits('result_corrected', a.row);
    assert.equal(log.length, 1);
    assert.equal(log[0].actor_id, w.ids.bm); assert.equal(log[0].reason, null); assert.ok(log[0].created_at);
    assert.equal(log[0].before_state.game_scores, unchanged); assert.equal(log[0].after_state.game_scores, '11-5, 11-6');
    assert.equal(log[0].before_state.winner_id, a.winner); assert.equal(log[0].after_state.winner_id, a.winner);
    const logB = (await w.audits('result_corrected', b.row))[0];
    assert.equal(logB.actor_id, w.ids.org); assert.equal(logB.reason, null); assert.equal(logB.after_state.game_scores, '11-4, 11-3');
    const logC = (await w.audits('result_corrected', c.row))[0];
    assert.equal(logC.reason, 'Winner was entered backwards'); assert.equal(logC.before_state.winner_id, c.winner); assert.equal(logC.after_state.winner_id, loser);
    const next = (await w.db.admin('select n.player_1_id p1, n.player_2_id p2 from fftt_private.matches m join fftt_private.matches n on n.id=m.next_match_id where m.id=$1', [c.row.match_id]))[0];
    assert.ok([next.p1, next.p2].includes(loser) && ![next.p1, next.p2].includes(c.winner), 'bracket advancement follows the corrected winner');

    // Stale: replaying with the old match_version is rejected and writes nothing more.
    await assert.rejects(call('bm', a.row, a.version, a.winner, '11-2, 11-1', {reason: null}), /conflict|version/i);
    assert.equal((await w.audits('result_corrected', a.row)).length, 1);
    // Control characters stay refused; an over-long optional reason stays refused.
    const cur = Number((await w.db.admin('select match_version v from fftt_private.matches where id=$1', [a.row.match_id]))[0].v);
    await detail(call('bm', a.row, cur, a.winner, '11-5, 11-6', {reason: 'bad\u0007char'}), 'reason');
    await detail(call('bm', a.row, cur, a.winner, '11-5, 11-6', {reason: 'x'.repeat(301)}), 'reason');
    assert.equal(await w.otherFp(), before, 'the other event is untouched');
  } finally { await w.db.db.close(); }
});

test('idempotency and stale saved-game corrections', {timeout: 240000}, async () => {
  const w = await world();
  try {
    const row = await w.open(w.rows[0]);
    const s0 = await w.shot('scorer', row);
    await w.save('scorer', row, s0, 1, 11, 7);
    const s1 = await w.shot('scorer', row);
    const id = crypto.randomUUID();
    const first = await w.save('scorer', row, s1, 1, 11, 9, null, id);
    assert.equal(first.status, 'accepted');
    assert.deepEqual(await w.save('scorer', row, s1, 1, 11, 9, null, id), first, 'the same submission replays its receipt');
    assert.equal((await w.audits('game_corrected', row)).length, 1, 'a replay does not write a second audit row');
    await assert.rejects(w.save('scorer', row, s1, 1, 11, 4, null, id), /submission-id-reused|conflict/i);
    // A stale writer (old progress revision) is rejected with a receipt and cannot revive the older value.
    const stale = await w.save('bm', row, s1, 1, 11, 3);
    assert.equal(stale.status, 'rejected'); assert.equal(stale.reason, 'stale-progress');
    assert.deepEqual((await w.shot('scorer', row)).games, [[11, 9]]);
    assert.equal((await w.audits('game_corrected', row)).length, 1);
  } finally { await w.db.db.close(); }
});

test('migration shape: one overload, unchanged privileges, fail-closed on drift, not re-appliable', {timeout: 240000}, async () => {
  const w = await world();
  try {
    assert.equal((await w.db.admin("select count(*)::int n from pg_proc where proname='fftt_correct_result_v3' and pronamespace='public'::regnamespace"))[0].n, 1);
    assert.equal((await w.db.admin("select has_function_privilege('anon','public.fftt_correct_result_v3(uuid,uuid,bigint,uuid,text,text)','execute') a, has_function_privilege('authenticated','public.fftt_correct_result_v3(uuid,uuid,bigint,uuid,text,text)','execute') b"))[0].a, false);
    // already applied: the exact-fingerprint guard refuses a second application, and the failed transaction changes nothing
    await assert.rejects(w.db.db.exec(MIGRATION), /differ from the reviewed versions/);
    await w.db.db.exec('rollback');
    // a drifted target (someone edited a function) is also refused
    const fresh = await createHostedEquivalentDb();
    try {
      await fresh.db.exec("create or replace function fftt_private.correct_result_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint, p_winner_id uuid, p_game_scores text, p_reason text) returns jsonb language sql as $$ select '{}'::jsonb $$;");
      await assert.rejects(fresh.db.exec(MIGRATION), /differ from the reviewed versions/);
      await fresh.db.exec('rollback');
    } finally { await fresh.db.close(); }
  } finally { await w.db.db.close(); }
});
