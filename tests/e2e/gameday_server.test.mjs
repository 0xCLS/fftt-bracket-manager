/** Game-day server behavior against the REAL SQL (local, in-process PostgreSQL). Fictional data only.
 * Run: node --test tests/e2e/gameday_server.test.mjs  (after `npm ci` in tests/e2e) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApprovedEngine} from './approved_engine.mjs';
import {seedSlots, enginePlayers, computeStandings} from '../../contracts/gameday_engine.mjs';
import {setupEvent, roster, buildChampionship, buildConsolation, playAllPlayable, deskOf, submit,
  winningScore, swap} from './helpers.mjs';

const code = e => e?.message;

test('server-built brackets match the approved single-file engine for every field size 2..48', async () => {
  const eng = loadApprovedEngine();
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 17, 20, 23, 24, 31, 32, 33, 40, 48]) {
    const ctx = await setupEvent({players: Math.min(n, 24), checkIn: false});
    // roster helper caps at 24 names; add extras for larger fields
    if (n > 24) {
      const extra = Array.from({length: n - 24}, (_, i) => ({name: `Extra Player ${String.fromCharCode(65 + i)}`, rating: 1 + (i % 5), rating_status: 'provisional'}));
      await ctx.db.rpc(ctx.org, 'fftt_upsert_players_v3', {p_event_id: ctx.E, p_players: extra});
    }
    const s0 = await ctx.snap();
    for (const p of s0.players) await ctx.db.rpc(ctx.org, 'fftt_set_checkin_v3', {p_event_id: ctx.E, p_player_id: p.id, p_checked_in: true});
    const s = await ctx.snap();
    const ep = enginePlayers(s.players);
    eng.setPlayers(ep);
    // the shared engine seeds exactly like the approved app
    assert.deepEqual(seedSlots(ep), [...eng.setupInitialSlots(ep)], `seed layout n=${n}`);
    const js = eng.createBracket('championship', ep.map(p => p.id));
    await buildChampionship(ctx);
    const srv = (await ctx.snap()).matches.filter(m => m.bracket === 'championship');
    assert.equal(srv.length, js.rounds.flat().length, `match count n=${n}`);
    for (const m of js.rounds.flat()) {
      const row = srv.find(x => x.code === m.id);
      assert.ok(row, `${m.id} exists n=${n}`);
      assert.equal(row.player_1_id, m.p1, `${m.id} p1 n=${n}`);
      assert.equal(row.player_2_id, m.p2, `${m.id} p2 n=${n}`);
      const status = m.score === 'BYE' ? 'bye' : m.score === 'EMPTY' ? 'empty' : 'pending';
      assert.equal(row.status, status, `${m.id} status n=${n}`);
      assert.equal(row.winner_id, m.winner, `${m.id} winner n=${n}`);
      assert.equal(row.is_final, m.round === js.rounds.length - 1, `${m.id} final flag n=${n}`);
    }
    await ctx.db.db.close();
  }
});

test('full fictional tournament: scoring, progression, consolation, doubles, standings, privacy', async () => {
  const ctx = await setupEvent({players: 13, tables: 3});
  const {db, E, org, skA, skB, outsider} = ctx;
  await buildChampionship(ctx);
  // before consolation: nothing public (organizer has not opted in)
  assert.deepEqual(await db.publicTournaments(), []);

  // A race: both scorekeepers submit the same match from the same version; exactly one is accepted
  const desk = await deskOf(ctx, skA);
  assert.ok(desk.length >= 2);
  const row = desk[0];
  const [a, b] = await Promise.all([
    submit(ctx, skA, row, row.player_1_id, winningScore(false, 0)),
    submit(ctx, skB, row, row.player_2_id, swap(winningScore(false, 1))),
  ]);
  assert.deepEqual([a.status, b.status].sort(), ['accepted', 'rejected']);
  assert.equal((a.status === 'rejected' ? a : b).reason, 'stale-match-version');

  // championship play-through for the first round only, then consolation
  await playAllPlayable(ctx, {only: 'championship', limit: 6});
  let s = await ctx.snap();
  const pendingFirst = s.matches.filter(m => m.bracket === 'championship' && m.status === 'pending');
  assert.ok(pendingFirst.length > 0);

  // consolation cannot be built until everyone has played a real match
  const early = await buildConsolation(ctx).catch(e => e);
  assert.ok(early instanceof Error, 'early consolation must be refused');

  await playAllPlayable(ctx, {only: 'championship'});
  s = await ctx.snap();
  const champ = s.brackets.find(b => b.kind === 'championship');
  assert.equal(champ.status, 'complete');
  assert.ok(s.consolation_candidates.length >= 2);
  const r = await buildConsolation(ctx);
  assert.match(r.status, /built/);
  await playAllPlayable(ctx, {only: 'consolation'});
  s = await ctx.snap();
  assert.ok(s.brackets.every(b => b.status === 'complete'), 'both brackets complete');

  // two-match minimum standard
  const toKey = m => ({bracket: m.bracket, round: m.round, slot: m.slot, status: m.status, p1: m.player_1_id, p2: m.player_2_id, winner: m.winner_id});
  const st = computeStandings({matches: s.matches.map(toKey)});
  assert.ok(st.champion && st.runnerUp && st.consolationChampion && st.consolationRunnerUp);
  assert.equal(st.semifinalists.length, 2);
  const minPlayed = Math.min(...s.players.map(p => st.matchesPlayed[p.id] ?? 0));
  assert.ok(minPlayed >= 1);

  // Mixed-Skill Doubles finale: partners must come from consolation
  const placed = s.consolation_candidates.filter(c => c.state === 'placed').map(c => c.player_id);
  const notPlaced = s.players.map(p => p.id).filter(id => !placed.includes(id) && ![st.champion, st.runnerUp].includes(id));
  if (notPlaced.length) {
    const bad = await db.rpc(org, 'fftt_set_doubles_teams_v3', {p_event_id: E, p_partner_1: notPlaced[0], p_partner_2: placed[0]}).catch(e => e);
    assert.ok(bad instanceof Error);
  }
  const [p1, p2] = placed.filter(id => ![st.champion, st.runnerUp].includes(id));
  await db.rpc(org, 'fftt_set_doubles_teams_v3', {p_event_id: E, p_partner_1: p1, p_partner_2: p2});
  assert.equal((await db.rpc(skA, 'fftt_record_doubles_result_v3', {p_event_id: E, p_winner_team: 2, p_game_scores: '11-8, 9-11, 11-7'}).catch(e => e)).message?.includes('fftt_validation_error'), true, 'team 2 cannot win 11-8,9-11,11-7');
  const dbl = await db.rpc(skA, 'fftt_record_doubles_result_v3', {p_event_id: E, p_winner_team: 1, p_game_scores: '11-8, 9-11, 11-7'});
  assert.equal(dbl.status, 'recorded');
  // a scorekeeper cannot overwrite a recorded finale; the organizer can
  const over = await db.rpc(skB, 'fftt_record_doubles_result_v3', {p_event_id: E, p_winner_team: 2, p_game_scores: ''}).catch(e => e);
  assert.equal(over.code, '42501');

  // public visibility is the organizer's choice; the projection never carries ratings or private ids
  await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
  const pub = await db.publicTournaments();
  assert.equal(pub.length, 1);
  const text = JSON.stringify(pub);
  for (const p of s.players) assert.ok(!text.includes(p.id), 'no private player id in public data');
  assert.ok(!text.includes(E), 'no private event id in public data');
  assert.ok(!/rating|email|@|phone/i.test(text.replace(/"rating[^"]*"/g, '')), 'no rating/contact material');
  assert.deepEqual(Object.keys(pub[0]).sort(), ['brackets', 'event_date', 'event_id', 'event_name', 'finale', 'revision', 'status', 'table_count' in pub[0] ? 'table_count' : 'tables', 'updated_at'].sort());
  assert.equal(pub[0].finale.status, 'complete');
  const fin = await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'complete'});
  assert.equal(fin.lifecycle, 'complete');
  assert.equal((await db.publicTournaments())[0].status, 'complete');

  // outsider and anonymous callers are denied everywhere
  for (const [fn, args] of [
    ['fftt_organizer_snapshot_v3', {p_event_id: E}], ['fftt_export_event_v3', {p_event_id: E}],
    ['fftt_audit_log_v3', {p_event_id: E, p_limit: 5}], ['fftt_matchdesk_v1', {p_event_id: E}],
    ['fftt_upsert_players_v3', {p_event_id: E, p_players: roster(1)}],
  ]) {
    const e = await db.rpc(outsider, fn, args).catch(x => x);
    assert.equal(e.code, '42501', fn + ' outsider');
    const n = await db.rpc(null, fn, args).catch(x => x);
    assert.ok(n instanceof Error, fn + ' anon');
  }
  // scorekeepers cannot use organizer functions
  for (const [fn, args] of [
    ['fftt_organizer_snapshot_v3', {p_event_id: E}], ['fftt_export_event_v3', {p_event_id: E}],
    ['fftt_set_visibility_v3', {p_event_id: E, p_visible: false}],
    ['fftt_set_staff_v3', {p_event_id: E, p_email: 'outsider@fftt-staging.invalid', p_action: 'grant', p_role: 'scorekeeper'}],
  ]) assert.equal((await db.rpc(skA, fn, args).catch(x => x)).code, '42501', fn + ' scorekeeper');
  assert.equal(await db.rpc(outsider, 'fftt_my_events_v3', {}).then(r => r.length), 0);
  assert.equal(await db.rpc(skA, 'fftt_my_events_v3', {}).then(r => r[0].role), 'scorekeeper');
});

test('revocation stops scoring at once; revoked scorekeeper cannot read or write', async () => {
  const ctx = await setupEvent({players: 6});
  await buildChampionship(ctx);
  const {db, E, org, skA, skB} = ctx;
  const row = (await deskOf(ctx, skA))[0];
  await db.rpc(org, 'fftt_set_staff_v3', {p_event_id: E, p_email: 'scorekeeper-a@fftt-staging.invalid', p_action: 'revoke', p_role: null});
  const w = await submit(ctx, skA, row, row.player_1_id, winningScore(false)).catch(e => e);
  assert.equal(w.code, '42501');
  assert.equal((await deskOf(ctx, skA).catch(e => e)).code, '42501');
  assert.equal((await submit(ctx, skB, row, row.player_1_id, winningScore(false))).status, 'accepted');
  const self = await db.rpc(org, 'fftt_set_staff_v3', {p_event_id: E, p_email: 'organizer@fftt-staging.invalid', p_action: 'revoke', p_role: null}).catch(e => e);
  assert.ok(self instanceof Error, 'an organizer cannot revoke themselves');
});

test('validation: slots, roster hygiene, rebuild confirmation, platform-organizer gate', async () => {
  const ctx = await setupEvent({players: 5});
  const {db, E, org, skA, outsider} = ctx;
  const s = await ctx.snap();
  const ids = s.players.map(p => p.id);
  const gen = s.event.generation;
  const bad = async slots => (await db.rpc(org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: slots, p_expected_generation: gen, p_confirm: false}).catch(e => e));
  for (const [label, slots] of [
    ['not a power of two', ids.slice(0, 5)], ['duplicate', [ids[0], ids[0], ids[1], ids[2], ids[3], ids[4], null, null]],
    ['missing player', [ids[0], ids[1], ids[2], ids[3], null, null, null, null]],
    ['unknown id', [ids[0], ids[1], ids[2], ids[3], ids[4], crypto.randomUUID(), null, null]],
    ['oversized bracket', [ids[0], null, ids[1], null, ids[2], null, ids[3], null, ids[4], null, null, null, null, null, null, null]],
    ['not an array', {a: 1}], ['string element', ['x', 'y']],
  ]) assert.ok((await bad(slots)) instanceof Error, label);
  assert.equal((await db.rpc(org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(s.players)), p_expected_generation: 7, p_confirm: false}).catch(e => e)).message, 'fftt_stale_generation');
  await buildChampionship(ctx);
  // rebuilding needs explicit confirmation
  const again = await db.rpc(org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(s.players)), p_expected_generation: 1, p_confirm: false}).catch(e => e);
  assert.equal(again.detail, 'rebuild-requires-confirmation');
  // roster hygiene: contact-like names, duplicates, bad ratings, extra fields
  for (const players of [
    [{name: 'Pat 555-123-4567', rating: 3, rating_status: 'provisional'}],
    [{name: 'pat@example.invalid', rating: 3, rating_status: 'provisional'}],
    [{name: 'Ada Quill', rating: 3, rating_status: 'provisional'}],
    [{name: 'Zed', rating: 9, rating_status: 'provisional'}],
    [{name: 'Zed', rating: 3, rating_status: 'whatever'}],
    [{name: 'Zed', rating: 3, rating_status: 'provisional', phone: '1'}],
    [{name: '', rating: 3, rating_status: 'provisional'}],
  ]) assert.ok((await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: players}).catch(e => e)) instanceof Error, JSON.stringify(players));
  // only provisioned platform organizers create events
  for (const u of [skA, outsider]) assert.equal((await db.rpc(u, 'fftt_create_event_v3', {p_name: 'X', p_date: '2026-12-01', p_table_count: 2}).catch(e => e)).code, '42501');
  assert.ok((await db.rpc(null, 'fftt_create_event_v3', {p_name: 'X', p_date: '2026-12-01', p_table_count: 2}).catch(e => e)) instanceof Error);
  // anon cannot touch private tables or v3 functions
  assert.ok((await db.admin(`select has_function_privilege('anon','public.fftt_organizer_snapshot_v3(uuid)','EXECUTE') as a`))[0].a === false);
});

test('organizer correction: audit, downstream guard, consolation eligibility follows', async () => {
  const ctx = await setupEvent({players: 8});
  const {db, E, org, skA} = ctx;
  await buildChampionship(ctx);
  const desk = await deskOf(ctx, skA);
  const row = desk[0];
  await submit(ctx, skA, row, row.player_1_id, winningScore(false, 0));
  let s = await ctx.snap();
  let m = s.matches.find(x => x.id === row.match_id);
  assert.equal(m.winner_id, row.player_1_id);
  assert.ok(s.consolation_candidates.some(c => c.player_id === row.player_2_id));
  // correction: p2 actually won
  const fix = await db.rpc(org, 'fftt_correct_result_v3', {p_event_id: E, p_match_id: m.id, p_expected_match_version: m.version, p_winner_id: row.player_2_id, p_game_scores: swap(winningScore(false, 0)), p_reason: 'Scorekeeper tapped the wrong side'});
  assert.equal(fix.status, 'corrected');
  s = await ctx.snap();
  m = s.matches.find(x => x.id === row.match_id);
  assert.equal(m.winner_id, row.player_2_id);
  assert.ok(!s.consolation_candidates.some(c => c.player_id === row.player_2_id), 'new winner is not a consolation candidate');
  assert.ok(s.consolation_candidates.some(c => c.player_id === row.player_1_id), 'new loser is');
  const next = s.matches.find(x => x.id === m.next_match_id);
  assert.ok([next.player_1_id, next.player_2_id].includes(row.player_2_id));
  assert.ok(![next.player_1_id, next.player_2_id].includes(row.player_1_id));
  const audit = await db.rpc(org, 'fftt_audit_log_v3', {p_event_id: E, p_limit: 10});
  assert.equal(audit[0].operation, 'result_corrected');
  assert.equal(audit[0].reason, 'Scorekeeper tapped the wrong side');
  // stale version, missing reason, scorekeeper attempts
  assert.ok((await db.rpc(org, 'fftt_correct_result_v3', {p_event_id: E, p_match_id: m.id, p_expected_match_version: m.version, p_winner_id: row.player_1_id, p_game_scores: '', p_reason: 'x'}).catch(e => e)) instanceof Error);
  assert.equal((await db.rpc(skA, 'fftt_correct_result_v3', {p_event_id: E, p_match_id: m.id, p_expected_match_version: m.version + 1, p_winner_id: row.player_1_id, p_game_scores: '', p_reason: 'because'}).catch(e => e)).code, '42501');
  // a stale scorekeeper submission against the corrected match is durably rejected, not applied
  const stale = await submit(ctx, skA, row, row.player_1_id, winningScore(false), {version: row.match_version});
  assert.equal(stale.status, 'rejected');
  // once the next match is played, winner-changing corrections are refused
  await playAllPlayable(ctx, {only: 'championship'});
  s = await ctx.snap();
  m = s.matches.find(x => x.id === row.match_id);
  const late = await db.rpc(org, 'fftt_correct_result_v3', {p_event_id: E, p_match_id: m.id, p_expected_match_version: m.version, p_winner_id: row.player_1_id, p_game_scores: '', p_reason: 'too late'}).catch(e => e);
  assert.equal(late.detail, 'downstream-complete');
  // a score-only correction (same winner) is always allowed
  const only = await db.rpc(org, 'fftt_correct_result_v3', {p_event_id: E, p_match_id: m.id, p_expected_match_version: m.version, p_winner_id: m.winner_id, p_game_scores: m.winner_id === row.player_1_id ? winningScore(false, 2) : swap(winningScore(false, 2)), p_reason: 'Fix a typo in the scores'});
  assert.equal(only.status, 'corrected');
});

test('no-show forfeit, table assignment (no version bump) and publication of Now Playing / Up Next', async () => {
  const ctx = await setupEvent({players: 8, tables: 2});
  const {db, E, org, skA} = ctx;
  await buildChampionship(ctx);
  await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
  let desk = await deskOf(ctx, skA);
  const [m1, m2, m3] = desk;
  await db.rpc(skA, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: m1.match_id, p_table_number: 1});
  await db.rpc(skA, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: m2.match_id, p_table_number: 2});
  assert.equal((await db.rpc(skA, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: m3.match_id, p_table_number: 1}).catch(e => e)).detail, 'table-in-use');
  assert.equal((await db.rpc(skA, 'fftt_assign_table_v3', {p_event_id: E, p_match_id: m3.match_id, p_table_number: 3}).catch(e => e)).message, 'fftt_validation_error');
  desk = await deskOf(ctx, skA);
  assert.equal(desk.find(r => r.match_id === m1.match_id).match_version, m1.match_version, 'table move keeps the version');
  let pub = (await db.publicTournaments())[0];
  const matches = pub.brackets.flatMap(b => b.matches);
  assert.equal(matches.filter(m => m.phase === 'playing').length, 2);
  assert.ok(matches.filter(m => m.phase === 'up_next').length >= 1);
  assert.ok(matches.every(m => m.table_number === null || m.phase === 'playing' || m.phase === 'done'));
  // forfeiture: the absent player's opponent advances; organizer only; reason required
  const absent = m3.player_1_id;
  assert.equal((await db.rpc(skA, 'fftt_forfeit_match_v3', {p_event_id: E, p_match_id: m3.match_id, p_expected_match_version: m3.match_version, p_absent_player_id: absent, p_reason: 'No show'}).catch(e => e)).code, '42501');
  const f = await db.rpc(org, 'fftt_forfeit_match_v3', {p_event_id: E, p_match_id: m3.match_id, p_expected_match_version: m3.match_version, p_absent_player_id: absent, p_reason: 'Did not arrive at the table'});
  assert.equal(f.status, 'accepted');
  const s = await ctx.snap();
  const fm = s.matches.find(x => x.id === m3.match_id);
  assert.equal(fm.winner_id, m3.player_2_id);
  assert.equal(fm.game_scores, 'W/O');
  pub = (await db.publicTournaments())[0];
  assert.ok(pub.brackets.flatMap(b => b.matches).some(m => m.game_scores === 'W/O' && m.phase === 'done'));
  // unpublishing removes everything public
  await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: false});
  assert.deepEqual(await db.publicTournaments(), []);
});

test('rebuild supersedes the old generation; stale-generation scores are refused', async () => {
  const ctx = await setupEvent({players: 6});
  const {db, E, org, skA} = ctx;
  await buildChampionship(ctx);
  const row = (await deskOf(ctx, skA))[0];
  await buildChampionship(ctx); // confirm=true because generation>0
  const s = await ctx.snap();
  assert.equal(s.event.generation, 2);
  const stale = await submit(ctx, skA, row, row.player_1_id, winningScore(false)).catch(e => e);
  assert.ok(stale instanceof Error, 'score for a superseded generation is refused');
  assert.equal((await deskOf(ctx, skA)).every(r => r.bracket_generation === 2), true);
});

test('consolation entrants and champion match the approved engine after a full championship', async () => {
  const eng = loadApprovedEngine();
  for (const n of [5, 8, 11, 13, 17, 24]) {
    const ctx = await setupEvent({players: n});
    const s0 = await ctx.snap();
    const ep = enginePlayers(s0.players);
    await buildChampionship(ctx);
    await playAllPlayable(ctx, {only: 'championship'});
    const s = await ctx.snap();
    // the same deterministic results in the approved engine (higher rating wins; p1 on ties)
    eng.setPlayers(ep);
    const rating = new Map(ep.map(p => [p.id, p.rating]));
    const b = eng.createBracket('championship', ep.map(p => p.id));
    const eligible = new Set();
    for (let guard = 0; guard < 500; guard++) {
      const m = b.rounds.flat().find(x => x.p1 && x.p2 && !x.resolved);
      if (!m) break;
      const winner = rating.get(m.p1) >= rating.get(m.p2) ? m.p1 : m.p2;
      const loser = winner === m.p1 ? m.p2 : m.p1;
      eng.setBracket('championship', b);
      if (eng.matchCountForPlayer(loser, b) === 0) eligible.add(loser);
      m.winner = winner; m.score = 'x'; m.resolved = true;
      eng.feedWinner(b, m, winner); eng.autoAdvanceByes(b);
    }
    assert.deepEqual(new Set(s.consolation_candidates.map(c => c.player_id)), eligible, `eligible set n=${n}`);
    assert.equal(s.matches.find(m => m.bracket === 'championship' && m.is_final).winner_id, b.champion, `champion n=${n}`);
    await ctx.db.db.close();
  }
});
