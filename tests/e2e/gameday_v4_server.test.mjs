/** V4 server behavior against the REAL SQL (local, in-process PostgreSQL): match formats (Bo1/Bo3, 11/21 points,
 * historical Bo5), registration/check-in, rating confirmation, archive/restore and guarded deletion.
 * Fictional data only. Run: node --test tests/e2e/gameday_v4_server.test.mjs (after `npm ci` in tests/e2e) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEvent, roster, buildChampionship, buildConsolation, playAllPlayable, deskOf, submit, scoreFor, swap} from './helpers.mjs';

const fails = async (p, code, text) => {
  const e = await p.then(() => null, x => x);
  assert.ok(e, 'expected a failure' + (text ? ': ' + text : ''));
  if (code) assert.equal(e.code, code, text);
  return e;
};
const formatsOf = ctx => ctx.snap().then(s => s.event.formats);
const refOf = i => 'REGREF' + String(i).padStart(14, '0') + 'xyz';   // 23 characters, opaque test refs

test('defaults: championship Bo3/11, finals Bo3/11, consolation Bo1/21, doubles Bo3/11; matches are stamped when built', async () => {
  const ctx = await setupEvent({players: 12});
  assert.deepEqual(await formatsOf(ctx), {
    champ: {best_of: 3, points: 11}, champ_final: {best_of: 3, points: 11},
    cons: {best_of: 1, points: 21}, cons_final: {best_of: 1, points: 21}, doubles: {best_of: 3, points: 11}});
  await buildChampionship(ctx);
  const s = await ctx.snap();
  const real = s.matches.filter(m => m.status === 'pending');
  assert.ok(real.length > 0);
  for (const m of s.matches) {
    assert.deepEqual([m.best_of, m.points, m.format_legacy], [3, 11, false], `${m.code} championship stamp`);
  }
  await playAllPlayable(ctx, {only: 'championship'});
  await buildConsolation(ctx);
  const c = (await ctx.snap()).matches.filter(m => m.bracket === 'consolation' && m.status !== 'bye' && m.status !== 'empty');
  assert.ok(c.length > 0);
  for (const m of c) assert.deepEqual([m.best_of, m.points], [1, 21], `${m.code} consolation stamp`);
  // the match desk reports the format so a scorekeeper's screen can ask for the right number of games
  const desk = await deskOf(ctx, ctx.skA);
  assert.ok(desk.every(r => r.best_of === 1 && r.points_to_win === 21));
  const brief = await ctx.db.rpc(ctx.skA, 'fftt_event_brief_v3', {p_event_id: ctx.E});
  assert.equal(brief.event_id, ctx.E);
});

test('score rules: Bo1/Bo3, 11 and 21 points, win by two, exactly two after deuce; Best of 5 cannot be configured', async () => {
  const ctx = await setupEvent({players: 12});
  const {db, E, org} = ctx;
  await buildChampionship(ctx);
  await playAllPlayable(ctx, {only: 'championship'});
  await buildConsolation(ctx);
  let desk = await deskOf(ctx, ctx.skA);
  const bo1 = desk[0];
  assert.equal(bo1.best_of, 1); assert.equal(bo1.points_to_win, 21);
  const bad = async (scores, why) => {
    const e = await fails(submit(ctx, ctx.skA, bo1, bo1.player_1_id, scores), '22023', why);
    assert.equal(e.message, 'fftt_validation_error');
    return e;
  };
  assert.equal((await bad('11-5', 'a game to 11 is not a game to 21')).detail, 'scores-game');
  assert.equal((await bad('21-20', 'one-point margin')).detail, 'scores-game');
  assert.equal((await bad('23-20', 'deuce must be exactly two')).detail, 'scores-game');
  assert.equal((await bad('20-22', 'wrong winner')).detail, 'scores-winner');
  assert.equal((await bad('21-15, 21-10', 'two games in a Bo1')).detail, 'scores-count');
  assert.equal((await bad('21-15, ', 'an empty second game is a second game')).detail, 'scores-count');
  assert.equal((await bad('2115', 'format')).detail, 'scores-format');
  assert.equal((await bad('121-119', 'three digits')).detail, 'scores-range');
  // a correct deuce game to 21 is accepted: 22-20 and the stored text is normalized
  const ok = await submit(ctx, ctx.skA, bo1, bo1.player_1_id, '22–20');
  assert.equal(ok.status, 'accepted');
  const done = (await ctx.snap()).matches.find(m => m.id === bo1.match_id);
  assert.equal(done.game_scores, '22-20');

  // Best of 3 to 21 on consolation (event level, before the next match is played): accepts 2 or 3 games
  await db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {}}).then(() => assert.fail('empty'), e => assert.equal(e.message, 'fftt_validation_error'));
  for (const bad5 of [{champ: {best_of: 5, points: 11}}, {cons: {best_of: 2, points: 21}}, {cons: {best_of: 3, points: 15}},
    {cons: {best_of: 3}}, {cons: {points: 21}}, {cons: 'x'}, {nonsense: {best_of: 1, points: 11}}, {cons: {best_of: '3', points: 21}}, {cons: {best_of: 3, points: 21, extra: 1}}]) {
    await fails(db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: bad5}), '22023', JSON.stringify(bad5));
  }
  // consolation already has a result -> that category is locked, but the final is a separate category (not played yet)
  const lock = await fails(db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {cons: {best_of: 3, points: 21}}}), 'P0001');
  assert.equal(lock.detail, 'format-locked');
});

test('event-level formats: apply to pending matches, lock per category once a result exists, doubles included', async () => {
  const ctx = await setupEvent({players: 8});
  const {db, E, org, skA} = ctx;
  // before any bracket: stored and used at build time
  const r = await db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {champ: {best_of: 1, points: 21}, champ_final: {best_of: 3, points: 21}}});
  assert.equal(r.status, 'updated'); assert.equal(r.changed, 2);
  assert.equal((await db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {champ: {best_of: 1, points: 21}}})).status, 'unchanged');
  await buildChampionship(ctx);
  let s = await ctx.snap();
  const final = s.matches.find(m => m.is_final);
  assert.deepEqual([final.best_of, final.points], [3, 21]);
  assert.ok(s.matches.filter(m => !m.is_final).every(m => m.best_of === 1 && m.points === 21));
  // change the whole regular category while nothing is played: pending matches are re-stamped
  await db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {champ: {best_of: 3, points: 11}}});
  s = await ctx.snap();
  assert.ok(s.matches.filter(m => !m.is_final).every(m => m.best_of === 3 && m.points === 11));
  assert.deepEqual([s.matches.find(m => m.is_final).best_of, s.matches.find(m => m.is_final).points], [3, 21], 'the final category was untouched');
  // play one opening match: the regular category locks, the final category stays open until the final is played
  const row = (await deskOf(ctx, skA))[0];
  await submit(ctx, skA, row, row.player_1_id, scoreFor(3, 11));
  await fails(db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {champ: {best_of: 1, points: 11}}}), 'P0001');
  assert.equal((await db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {champ_final: {best_of: 1, points: 11}}})).status, 'updated');
  // a scorekeeper can never change formats
  await fails(db.rpc(skA, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {cons: {best_of: 3, points: 21}}}), '42501');
  await fails(db.rpc(ctx.outsider, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {cons: {best_of: 3, points: 21}}}), '42501');
  assert.ok((await db.rpc(org, 'fftt_audit_log_v3', {p_event_id: E, p_limit: 50})).some(a => a.operation === 'format_changed'));
  // doubles: configurable until a doubles result exists
  assert.equal((await db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {doubles: {best_of: 1, points: 21}}})).status, 'updated');
});

test('per-match override: organizer only, only before a result, never bumps the match version, server rejects stale-format scores', async () => {
  const ctx = await setupEvent({players: 8});
  const {db, E, org, skA, skB} = ctx;
  await buildChampionship(ctx);
  const [one, two] = await deskOf(ctx, skA);
  await fails(db.rpc(skA, 'fftt_set_match_format_v4', {p_event_id: E, p_match_id: one.match_id, p_best_of: 1, p_points: 21}), '42501');
  for (const [bo, pts] of [[5, 11], [2, 11], [3, 15], [null, 11]]) {
    await fails(db.rpc(org, 'fftt_set_match_format_v4', {p_event_id: E, p_match_id: one.match_id, p_best_of: bo, p_points: pts}), '22023', `${bo}/${pts}`);
  }
  const set = await db.rpc(org, 'fftt_set_match_format_v4', {p_event_id: E, p_match_id: one.match_id, p_best_of: 1, p_points: 21});
  assert.equal(set.status, 'updated');
  assert.equal((await db.rpc(org, 'fftt_set_match_format_v4', {p_event_id: E, p_match_id: one.match_id, p_best_of: 1, p_points: 21})).status, 'unchanged');
  const after = (await deskOf(ctx, skA)).find(r => r.match_id === one.match_id);
  assert.equal(after.match_version, one.match_version, 'a format change must not invalidate a scorer\'s version');
  assert.deepEqual([after.best_of, after.points_to_win], [1, 21]);
  // a scorekeeper who prepared a Bo3-to-11 score before the override is refused by the server, with a precise reason
  const stale = await fails(submit(ctx, skB, one, one.player_1_id, scoreFor(3, 11)), '22023');
  assert.equal(stale.detail, 'scores-count');
  assert.equal((await deskOf(ctx, skA)).find(r => r.match_id === one.match_id).match_version, one.match_version, 'a refused score changes nothing');
  assert.equal((await submit(ctx, skB, one, one.player_1_id, scoreFor(1, 21))).status, 'accepted');
  // after a result the format of that match is locked
  const locked = await fails(db.rpc(org, 'fftt_set_match_format_v4', {p_event_id: E, p_match_id: one.match_id, p_best_of: 3, p_points: 11}), 'P0001');
  assert.equal(locked.detail, 'format-locked');
  // other matches are unaffected
  assert.deepEqual([two.best_of, two.points_to_win], [3, 11]);
  // a bye can not be given a format
  const bye = (await ctx.snap()).matches.find(m => m.status === 'bye');
  if (bye) await fails(db.rpc(org, 'fftt_set_match_format_v4', {p_event_id: E, p_match_id: bye.id, p_best_of: 1, p_points: 21}), 'P0001');
  // a correction is validated under the match's own format
  const m = (await ctx.snap()).matches.find(x => x.id === one.match_id);
  await fails(db.rpc(org, 'fftt_correct_result_v3', {p_event_id: E, p_match_id: m.id, p_expected_match_version: m.version, p_winner_id: one.player_1_id, p_game_scores: scoreFor(3, 11), p_reason: 'wrong format on purpose'}), '22023');
  const fix = await db.rpc(org, 'fftt_correct_result_v3', {p_event_id: E, p_match_id: m.id, p_expected_match_version: m.version, p_winner_id: one.player_2_id, p_game_scores: swap(scoreFor(1, 21, 1)), p_reason: 'Scorekeeper tapped the wrong side'});
  assert.equal(fix.status, 'corrected');
});

test('historical Best of 5 compatibility: pre-V4 matches resolve from the legacy rule and are never rewritten', async () => {
  const ctx = await setupEvent({players: 8});
  const {db, E, org, skA} = ctx;
  await buildChampionship(ctx);
  // Emulate rows that existed before V4: no stamp on any match.
  await ctx.db.admin('update fftt_private.matches set best_of = null, points_to_win = null where event_id = $1', [E]);
  let s = await ctx.snap();
  const legacyFinal = s.matches.find(m => m.is_final);
  assert.deepEqual([legacyFinal.best_of, legacyFinal.points, legacyFinal.format_legacy], [5, 11, true], 'the historical final is Best of 5');
  assert.ok(s.matches.filter(m => !m.is_final).every(m => m.best_of === 3 && m.points === 11 && m.format_legacy));
  // the desk shows the legacy format too
  const first = (await deskOf(ctx, skA))[0];
  assert.deepEqual([first.best_of, first.points_to_win], [3, 11]);
  // play every match EXCEPT the final; the final needs a Best-of-5 score and refuses a Best-of-3 score
  const regular = s.matches.filter(m => !m.is_final && m.status === 'pending').length;
  assert.equal(await playAllPlayable(ctx, {only: 'championship', limit: regular}), regular);
  s = await ctx.snap();
  const finalNow = s.matches.find(m => m.is_final);
  assert.equal(finalNow.status, 'pending', 'the historical final is still to be played');
  const finalRow = (await deskOf(ctx, skA)).find(r => r.match_id === finalNow.id);
  assert.deepEqual([finalRow.best_of, finalRow.points_to_win], [5, 11]);
  assert.equal((await fails(submit(ctx, skA, finalRow, finalRow.player_1_id, scoreFor(3, 11)), '22023')).detail, 'scores-count');
  assert.equal((await submit(ctx, skA, finalRow, finalRow.player_1_id, scoreFor(5, 11, 1))).status, 'accepted');
  s = await ctx.snap();
  // completed historical matches were never stamped by the engine
  const stamped = await ctx.db.admin('select count(*)::int as n from fftt_private.matches where event_id = $1 and best_of is not null', [E]);
  assert.equal(stamped[0].n, 0, 'no historical match was rewritten');
  const final = s.matches.find(m => m.is_final);
  assert.equal(final.status, 'complete');
  assert.equal(final.game_scores.split(',').length >= 3, true, 'a Best-of-5 final result is retained as played');
  assert.equal(final.format_legacy, true);
  // a historical result is still correctable, under Best of 5
  const fix = await db.rpc(org, 'fftt_correct_result_v3', {p_event_id: E, p_match_id: final.id, p_expected_match_version: final.version,
    p_winner_id: final.winner_id, p_game_scores: final.winner_id === final.player_1_id ? scoreFor(5, 11, 0) : swap(scoreFor(5, 11, 0)), p_reason: 'Typo in game scores'});
  assert.equal(fix.status, 'corrected');
  // the event-level change is locked for the final category (a result exists) and does not touch history
  await fails(db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {champ_final: {best_of: 1, points: 21}}}), 'P0001');
  // public projection shows what was actually played
  await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
  const pub = (await db.publicTournaments())[0];
  const pf = pub.brackets.find(b => b.name === 'championship').matches.find(m => m.status === 'complete' && m.round === Math.max(...pub.brackets[0].matches.map(x => x.round)));
  assert.equal(pf.best_of, 5); assert.equal(pf.points_to_win, 11);
});

test('doubles finale uses the event format; a legacy-format event still records Bo3 to 11', async () => {
  const ctx = await setupEvent({players: 10});
  const {db, E, org} = ctx;
  await db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {doubles: {best_of: 1, points: 21}}});
  await buildChampionship(ctx);
  await playAllPlayable(ctx, {only: 'championship'});
  await buildConsolation(ctx);
  await playAllPlayable(ctx, {only: 'consolation'});
  const s = await ctx.snap();
  const placed = s.consolation_candidates.filter(c => c.state === 'placed').map(c => c.player_id);
  const fin = s.matches.find(m => m.is_final);
  const [p1, p2] = placed.filter(id => ![fin.player_1_id, fin.player_2_id].includes(id));
  await db.rpc(org, 'fftt_set_doubles_teams_v3', {p_event_id: E, p_partner_1: p1, p_partner_2: p2});
  await fails(db.rpc(org, 'fftt_record_doubles_result_v3', {p_event_id: E, p_winner_team: 1, p_game_scores: '11-8, 9-11, 11-7'}), '22023');
  assert.equal((await db.rpc(org, 'fftt_record_doubles_result_v3', {p_event_id: E, p_winner_team: 1, p_game_scores: '21-17'})).status, 'recorded');
  await fails(db.rpc(org, 'fftt_set_formats_v4', {p_event_id: E, p_formats: {doubles: {best_of: 3, points: 11}}}), 'P0001');
  await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
  const pub = (await db.publicTournaments())[0];
  assert.deepEqual([pub.finale.best_of, pub.finale.points_to_win, pub.finale.game_scores], [1, 21, '21-17']);
});

test('registration: one-click and bulk check-in, idempotency, reconciliation, walk-ins, rating confirmation, privacy', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {db, E, org, skA, outsider} = ctx;
  const reg = (i, name, rating = 3, extra = {}) => ({ref: refOf(i), name, rating, rating_status: 'provisional', source: 'registration', ...extra});
  // one-click: creates the roster player AND checks them in, rating unconfirmed
  const one = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(1, 'Ada Q.', 4)]});
  assert.deepEqual([one.status, one.created, one.linked, one.changed], ['saved', 1, 0, 1]);
  let s = await ctx.snap();
  let ada = s.players.find(p => p.name === 'Ada Q.');
  assert.deepEqual([ada.checked_in, ada.rating, ada.rating_confirmed, ada.source, ada.registration_refs], [true, 4, false, 'registration', [refOf(1)]]);
  // repeating the same call is harmless
  const again = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(1, 'Ada Q.', 4)]});
  assert.equal(again.status, 'unchanged'); assert.equal(again.existing, 1);
  assert.equal((await ctx.snap()).players.length, 1);
  // bulk
  const bulk = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(2, 'Ben M.', 2), reg(3, 'Cy F.', 3), reg(4, 'Dee L.', 5)]});
  assert.deepEqual([bulk.created, bulk.changed], [3, 3]);
  // undo a check-in (the registrant stays on the roster, unchecked)
  const undo = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(3, 'Cy F.', 3)], p_check_in: false});
  assert.equal(undo.created, 0); assert.equal(undo.changed, 1);
  s = await ctx.snap();
  assert.equal(s.players.find(p => p.name === 'Cy F.').checked_in, false);
  // reconciliation: a manually typed roster player is LINKED to the registrant instead of creating a duplicate
  await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: [{name: 'Eli B', rating: 3, rating_status: 'provisional'}]});
  const manual = (await ctx.snap()).players.find(p => p.name === 'Eli B');
  assert.equal(manual.source, 'manual'); assert.equal(manual.rating_confirmed, true);
  const dupe = await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(5, 'eli b', 3)]}), 'P0001');
  assert.equal(dupe.detail, 'duplicate-name');
  const link = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(5, 'Eli Brandt', 4, {link_player_id: manual.id})]});
  assert.deepEqual([link.created, link.linked, link.changed], [0, 1, 1]);
  s = await ctx.snap();
  const linked = s.players.find(p => p.id === manual.id);
  assert.deepEqual([linked.name, linked.rating, linked.registration_refs, linked.source, linked.checked_in], ['Eli B', 3, [refOf(5)], 'registration', true], 'the roster entry keeps its name and rating');
  assert.equal(s.players.length, 5);
  // duplicate submissions of the SAME person: a second ref is linked to the same player (merge), nothing is created
  const merged = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(6, 'Eli Brandt', 4, {same_as_ref: refOf(5)})]});
  assert.deepEqual([merged.created, merged.linked, merged.changed], [0, 1, 0]);
  assert.deepEqual((await ctx.snap()).players.find(p => p.id === manual.id).registration_refs, [refOf(5), refOf(6)]);
  assert.equal((await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(7, 'Nobody', 3, {same_as_ref: refOf(77)})]}), '22023')).message, 'fftt_not_found');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(7, 'Nobody', 3, {same_as_ref: refOf(7)})]}), '22023');
  // the merged ref is now recognised as already checked in
  assert.equal((await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(6, 'Eli Brandt', 4)]})).status, 'unchanged');
  // removing the roster player frees every ref again: the registrant is simply "not checked in" once more
  await db.rpc(org, 'fftt_remove_player_v3', {p_event_id: E, p_player_id: manual.id});
  assert.equal((await ctx.snap()).players.some(p => p.registration_refs.includes(refOf(5))), false);
  const reborn = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(5, 'Eli Brandt', 4)]});
  assert.equal(reborn.created, 1);
  // walk-in: no ref; rating is the organizer's own and counts as confirmed
  const walk = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [{name: 'Walter W.', rating: 2, source: 'walk_in'}]});
  assert.equal(walk.created, 1);
  const w = (await ctx.snap()).players.find(p => p.name === 'Walter W.');
  assert.deepEqual([w.source, w.rating_confirmed, w.registration_refs, w.checked_in], ['walk_in', true, [], true]);
  // atomic: one invalid entry means NOTHING is created
  const before = (await ctx.snap()).players.length;
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(7, 'Gus P.'), reg(8, 'Bad Name 734-555-0100')]}), '22023');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(7, 'Gus P.'), reg(9, 'Hal W.', 9)]}), '22023');
  assert.equal((await ctx.snap()).players.length, before);
  // contact details and unknown fields are refused; names cannot carry an e-mail
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(7, 'gus@example.org')]}), '22023');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [{...reg(7, 'Gus P.'), email: 'gus@example.org'}]}), '22023');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [{...reg(7, 'Gus P.'), phone: '7345550100'}]}), '22023');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [{...reg(7, 'Gus P.'), ref: 'short'}]}), '22023');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [{name: 'No Ref', rating: 3, source: 'registration'}]}), '22023');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [{ref: refOf(11), name: 'Has Ref', rating: 3, source: 'walk_in'}]}), '22023');
  // organizer only
  await fails(db.rpc(skA, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(7, 'Gus P.')]}), '42501');
  await fails(db.rpc(outsider, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(7, 'Gus P.')]}), '42501');
  await fails(db.rpc(null, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(7, 'Gus P.')]}));
  await fails(db.rpc(skA, 'fftt_confirm_ratings_v4', {p_event_id: E, p_items: [{id: ada.id, rating: 4}]}), '42501');
  // confirmation
  const conf = await db.rpc(org, 'fftt_confirm_ratings_v4', {p_event_id: E, p_items: [{id: ada.id, rating: 3}]});
  assert.deepEqual([conf.status, conf.changed], ['saved', 1]);
  ada = (await ctx.snap()).players.find(p => p.id === ada.id);
  assert.deepEqual([ada.rating, ada.rating_confirmed], [3, true]);
  assert.equal((await db.rpc(org, 'fftt_confirm_ratings_v4', {p_event_id: E, p_items: [{id: ada.id, rating: 3}]})).status, 'unchanged');
  await fails(db.rpc(org, 'fftt_confirm_ratings_v4', {p_event_id: E, p_items: [{id: ada.id, rating: 3, name: 'x'}]}), '22023');
  // nobody can un-check-in a player once they are in a bracket
  const all = (await ctx.snap()).players;
  await db.rpc(org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  await buildChampionship(ctx);
  const inB = all.find(p => p.name === 'Ben M.');
  const stuck = await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [reg(2, 'Ben M.', 2)], p_check_in: false}), 'P0001');
  assert.equal(stuck.detail, 'player-in-bracket');
  // audit rows exist and hold no names, contacts or refs
  const audit = JSON.stringify(await db.rpc(org, 'fftt_audit_log_v3', {p_event_id: E, p_limit: 200}));
  assert.ok(audit.includes('registration_checkin') && audit.includes('rating_confirmed'));
  assert.ok(!/REGREF|Ada Q|@/.test(audit), 'the audit log carries counts only');
  // privacy: refs and provenance never reach the public projection
  await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
  const pub = JSON.stringify(await db.publicTournaments());
  assert.ok(!/REGREF|registration|source|walk_in|rating|@/i.test(pub.replace(/"rating[^"]*"/g, '')), 'no registration data is public');
  // the private backup carries the opaque refs (organizer only), never contact data
  const backup = JSON.stringify(await db.rpc(org, 'fftt_export_event_v3', {p_event_id: E}));
  assert.ok(backup.includes(refOf(1)));
  assert.ok(!/@(?!fftt-staging)/.test(backup));
  // table has no column for contact details at all
  const cols = await ctx.db.admin(`select column_name from information_schema.columns where table_schema='fftt_private' and table_name='players'`);
  assert.ok(!cols.some(c => /mail|phone|contact|tel/i.test(c.column_name)));
});

test('registration needs a bracket-free draft/active event and respects the roster cap', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {db, E, org} = ctx;
  const many = Array.from({length: 64}, (_, i) => ({ref: refOf(100 + i), name: `Player ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, rating: 3, source: 'registration'}));
  const r = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: many});
  assert.equal(r.created, 64);
  const e = await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [{ref: refOf(999), name: 'One More', rating: 3, source: 'registration'}]}), 'P0001');
  assert.equal(e.detail, 'roster-full');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: []}), '22023');
  await fails(db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: E, p_registrants: [...many, ...many]}), '22023');
  await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'archived'}).catch(() => {});
});

test('archive remembers its origin and restore returns the event exactly there; restore never re-publishes', async () => {
  const ctx = await setupEvent({players: 6});
  const {db, E, org, skA} = ctx;
  const list = async () => (await db.rpc(org, 'fftt_my_events_v4', {})).find(x => x.event_id === E);
  assert.equal((await list()).lifecycle, 'draft');
  // draft -> archived -> draft
  await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'archived'});
  assert.equal((await list()).lifecycle, 'archived');
  let r = await db.rpc(org, 'fftt_restore_event_v4', {p_event_id: E});
  assert.deepEqual([r.status, r.lifecycle], ['restored', 'draft']);
  // an archived event cannot be restored by a scorekeeper, and a non-archived one cannot be "restored"
  await fails(db.rpc(skA, 'fftt_restore_event_v4', {p_event_id: E}), '42501');
  await fails(db.rpc(org, 'fftt_restore_event_v4', {p_event_id: E}), 'P0001');
  // active (with a public view) -> archived hides it -> restored to active, still NOT public
  await buildChampionship(ctx);
  await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: E, p_visible: true});
  assert.equal((await db.publicTournaments()).length, 1);
  await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'archived'});
  assert.equal((await db.publicTournaments()).length, 0);
  r = await db.rpc(org, 'fftt_restore_event_v4', {p_event_id: E});
  assert.equal(r.lifecycle, 'active');
  assert.equal((await db.publicTournaments()).length, 0, 'restoring does not publish');
  assert.equal((await ctx.snap()).event.public_visible, false);
  // scoring works again after the restore
  const row = (await deskOf(ctx, skA))[0];
  assert.equal((await submit(ctx, skA, row, row.player_1_id, scoreFor(row.best_of, row.points_to_win))).status, 'accepted');
  // completed -> archived -> completed
  await playAllPlayable(ctx, {only: 'championship'});
  await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'complete'});
  await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'archived'});
  assert.equal((await db.rpc(org, 'fftt_restore_event_v4', {p_event_id: E})).lifecycle, 'complete');
  // an event archived BEFORE V4 has no recorded origin: restore derives it from the facts
  await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'archived'});
  await ctx.db.admin('update fftt_private.events set archived_from = null where id = $1', [E]);
  assert.equal((await db.rpc(org, 'fftt_restore_event_v4', {p_event_id: E})).lifecycle, 'complete');
  assert.ok((await db.rpc(org, 'fftt_audit_log_v3', {p_event_id: E, p_limit: 200})).some(a => a.operation === 'event_restored'));
});

test('permanent deletion: only an empty draft, only by a platform organizer, with the exact name; history is never lost', async () => {
  const ctx = await setupEvent({players: 0, checkIn: false});
  const {db, E, org, skA, outsider} = ctx;
  const second = await db.rpc(org, 'fftt_create_event_v3', {p_name: 'Spare Draft', p_date: '2026-12-01', p_table_count: 2});
  const events = async () => db.rpc(org, 'fftt_my_events_v4', {});
  let list = await events();
  assert.equal(list.length, 2);
  assert.ok(list.every(e => e.deletable === true && e.players === 0 && e.tables >= 1), 'two empty drafts are deletable');
  // a scorekeeper does not even learn about deletability
  const skView = (await db.rpc(skA, 'fftt_my_events_v4', {}))[0];
  assert.deepEqual([skView.deletable, skView.players], [false, null]);
  // confirmation and authorization
  await fails(db.rpc(org, 'fftt_delete_event_v4', {p_event_id: second.event_id, p_confirm_name: 'spare draft'}), '22023');
  await fails(db.rpc(org, 'fftt_delete_event_v4', {p_event_id: second.event_id, p_confirm_name: null}), '22023');
  await fails(db.rpc(skA, 'fftt_delete_event_v4', {p_event_id: E, p_confirm_name: 'Synthetic Rehearsal Games'}), '42501');
  await fails(db.rpc(outsider, 'fftt_delete_event_v4', {p_event_id: second.event_id, p_confirm_name: 'Spare Draft'}), '42501');
  await fails(db.rpc(null, 'fftt_delete_event_v4', {p_event_id: second.event_id, p_confirm_name: 'Spare Draft'}));
  // a co-organizer who is not a platform organizer can not delete
  await db.addUser('coorganizer@fftt-staging.invalid');
  await db.rpc(org, 'fftt_set_staff_v3', {p_event_id: second.event_id, p_email: 'coorganizer@fftt-staging.invalid', p_action: 'grant', p_role: 'organizer'});
  const co = db.users.get('coorganizer@fftt-staging.invalid');
  assert.equal((await db.rpc(co, 'fftt_my_events_v4', {}))[0].deletable, false);
  await fails(db.rpc(co, 'fftt_delete_event_v4', {p_event_id: second.event_id, p_confirm_name: 'Spare Draft'}), '42501');
  // an event with a player, a bracket, a result, or any lifecycle other than draft is NOT deletable
  await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(4)});
  assert.equal((await events()).find(e => e.event_id === E).deletable, false);
  const heavy = await fails(db.rpc(org, 'fftt_delete_event_v4', {p_event_id: E, p_confirm_name: 'Synthetic Rehearsal Games'}), 'P0001');
  assert.equal(heavy.detail, 'not-deletable');
  await db.rpc(org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
  await buildChampionship(ctx);
  assert.equal((await fails(db.rpc(org, 'fftt_delete_event_v4', {p_event_id: E, p_confirm_name: 'Synthetic Rehearsal Games'}), 'P0001')).detail, 'lifecycle');
  const row = (await deskOf(ctx, skA))[0];
  await submit(ctx, skA, row, row.player_1_id, scoreFor(row.best_of, row.points_to_win));
  await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: E, p_lifecycle: 'archived'});
  await fails(db.rpc(org, 'fftt_delete_event_v4', {p_event_id: E, p_confirm_name: 'Synthetic Rehearsal Games'}), 'P0001');
  // players removed again -> an empty draft that once had players is still eligible only if nothing else exists
  const solo = await db.rpc(org, 'fftt_create_event_v3', {p_name: 'Once Had Players', p_date: '2026-12-02', p_table_count: 1});
  await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: solo.event_id, p_players: [{name: 'Temp T', rating: 3, rating_status: 'provisional'}]});
  await fails(db.rpc(org, 'fftt_delete_event_v4', {p_event_id: solo.event_id, p_confirm_name: 'Once Had Players'}), 'P0001');
  const tmp = (await db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: solo.event_id})).players[0];
  await db.rpc(org, 'fftt_remove_player_v3', {p_event_id: solo.event_id, p_player_id: tmp.id});
  // success: exact name; the tombstone keeps the audit trail; the other events are untouched
  const auditBefore = (await ctx.db.admin('select count(*)::int as n from fftt_private.audit_events where event_id = $1', [solo.event_id]))[0].n;
  assert.ok(auditBefore >= 3);
  const del = await db.rpc(org, 'fftt_delete_event_v4', {p_event_id: solo.event_id, p_confirm_name: '  Once Had Players '});
  assert.equal(del.status, 'deleted');
  list = await events();
  assert.ok(!list.some(e => e.event_id === solo.event_id));
  assert.ok(list.some(e => e.event_id === E) && list.some(e => e.event_id === second.event_id), 'other events survive');
  const tomb = await ctx.db.admin('select * from fftt_private.deleted_events where event_id = $1', [solo.event_id]);
  assert.equal(tomb.length, 1);
  assert.equal(tomb[0].event_name, 'Once Had Players');
  assert.equal(tomb[0].audit.length, auditBefore, 'every audit row was preserved in the tombstone');
  assert.equal((await ctx.db.admin('select count(*)::int as n from fftt_private.audit_events where event_id = $1', [solo.event_id]))[0].n, 0);
  assert.equal((await ctx.db.admin('select count(*)::int as n from fftt_private.event_staff where event_id = $1', [solo.event_id]))[0].n, 0);
  // the whole record of the real event is still there
  assert.ok((await ctx.db.admin('select count(*)::int as n from fftt_private.matches where event_id = $1', [E]))[0].n > 0);
  assert.ok((await ctx.db.admin('select count(*)::int as n from fftt_private.audit_events where event_id = $1', [E]))[0].n > 0);
  // deleted twice -> not found for everyone
  await fails(db.rpc(org, 'fftt_delete_event_v4', {p_event_id: solo.event_id, p_confirm_name: 'Once Had Players'}), '42501');
});

test('the audit trail stays append-only: the deletion marker alone cannot erase history', async () => {
  const ctx = await setupEvent({players: 3, checkIn: false});
  const {E} = ctx;
  const n = async () => (await ctx.db.admin('select count(*)::int as n from fftt_private.audit_events where event_id = $1', [E]))[0].n;
  const before = await n();
  assert.ok(before > 0);
  // even a privileged session cannot delete or alter audit rows directly...
  await fails(ctx.db.db.query('delete from fftt_private.audit_events where event_id = $1', [E]));
  await fails(ctx.db.db.query("update fftt_private.audit_events set reason = 'x' where event_id = $1", [E]));
  // ...and setting the deletion marker without a tombstone does not open the door either
  await ctx.db.db.exec(`select set_config('fftt.deleting_event', '${E}', false)`);
  await fails(ctx.db.db.query('delete from fftt_private.audit_events where event_id = $1', [E]));
  await fails(ctx.db.db.query('delete from fftt_private.events where id = $1', [E]));
  await ctx.db.db.exec(`select set_config('fftt.deleting_event', '', false)`);
  assert.equal(await n(), before);
  // the tombstone table itself is append-only too
  await ctx.db.db.query(`insert into fftt_private.deleted_events(event_id, public_id, event_name, event_date, deleted_by, audit, staff)
    values (gen_random_uuid(), gen_random_uuid(), 'x', '2026-12-01', $1, '[]', '[]')`, [ctx.org]);
  await fails(ctx.db.db.query('delete from fftt_private.deleted_events'));
  await fails(ctx.db.db.query("update fftt_private.deleted_events set event_name = 'y'"));
});

test('API roles can reach only the intended V4 entry points', async () => {
  const ctx = await setupEvent({players: 2});
  const {db, E, outsider} = ctx;
  for (const [fn, args] of [
    ['fftt_set_formats_v4', {p_event_id: E, p_formats: {cons: {best_of: 3, points: 21}}}],
    ['fftt_set_match_format_v4', {p_event_id: E, p_match_id: E, p_best_of: 1, p_points: 21}],
    ['fftt_confirm_ratings_v4', {p_event_id: E, p_items: []}],
    ['fftt_restore_event_v4', {p_event_id: E}], ['fftt_delete_event_v4', {p_event_id: E, p_confirm_name: 'x'}],
  ]) {
    await fails(db.rpc(null, fn, args), null, fn + ' anonymous');
    await fails(db.rpc(outsider, fn, args), '42501', fn + ' outsider');
  }
  assert.deepEqual(await db.rpc(outsider, 'fftt_my_events_v4', {}), []);
  await fails(db.rpc(null, 'fftt_my_events_v4', {}));
  await fails(db.rpc(null, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true}));
  await fails(db.rpc(outsider, 'fftt_matchdesk_v2', {p_event_id: E}, {rows: true}), '42501');
  // private helpers are not callable through the API at all
  for (const fn of ['v4_match_format', 'v4_normalize_scores', 'v4_event_deletable', 'v4_match_category']) {
    const acl = await ctx.db.admin(`select has_function_privilege('authenticated', p.oid, 'execute') as a, has_function_privilege('anon', p.oid, 'execute') as b
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'fftt_private' and p.proname = $1`, [fn]);
    assert.deepEqual(acl.map(r => [r.a, r.b]), [[false, false]], fn);
  }
  const anonView = await ctx.db.publicTournaments();
  assert.deepEqual(anonView, []);
});
