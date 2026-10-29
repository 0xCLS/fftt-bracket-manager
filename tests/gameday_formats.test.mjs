/** Match formats: score rules for Bo1/Bo3 and 11/21 points, labels, categories, API and public parsers. Zero network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGameScores, formatLabel, matchCategory, DEFAULT_FORMATS, ALLOWED_BEST_OF, ALLOWED_POINTS, FORMAT_KEYS, gamesToWin} from '../contracts/gameday_engine.mjs';
import {parseMyEvents} from '../contracts/gameday_api.mjs';
import {projectPublicTournaments} from '../contracts/gameday_public.mjs';

const ok = (raw, best, p1, pts) => normalizeGameScores(raw, best, p1, pts);
const GOOD = ({ok: true});

test('defaults and the allowed choices are exactly the approved ones; Best of 5 is not offered', () => {
  assert.deepEqual(ALLOWED_BEST_OF, [1, 3]); assert.deepEqual(ALLOWED_POINTS, [11, 21]);
  assert.deepEqual(FORMAT_KEYS, ['champ', 'champ_final', 'cons', 'cons_final', 'doubles']);
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_FORMATS)), {champ: {bestOf: 3, points: 11}, champ_final: {bestOf: 3, points: 11},
    cons: {bestOf: 1, points: 21}, cons_final: {bestOf: 1, points: 21}, doubles: {bestOf: 3, points: 11}});
  assert.equal(formatLabel({bestOf: 3, points: 11}), 'Best of 3 · to 11');
  assert.equal(formatLabel({bestOf: 1, points: 21}, {separator: ' '}), 'Best of 1 to 21');
  assert.deepEqual([1, 3, 5].map(gamesToWin), [1, 2, 3]);
  assert.equal(matchCategory('championship', true), 'champ_final'); assert.equal(matchCategory('championship', false), 'champ');
  assert.equal(matchCategory('consolation', true), 'cons_final'); assert.equal(matchCategory('consolation', false), 'cons');
});

test('Best of 1 to 21: one game, win by two, exactly two after 20-20', () => {
  assert.equal(ok('21-15', 1, true, 21).text, '21-15');
  assert.equal(ok('15-21', 1, false, 21).text, '15-21');
  assert.equal(ok('22-20', 1, true, 21).text, '22-20');
  assert.equal(ok('30–28', 1, true, 21).text, '30-28', 'an en dash is accepted and normalized');
  assert.equal(ok('', 1, true, 21).text, '', 'blank = winner only');
  for (const [raw, p1] of [['21-20', true], ['20-21', false], ['23-20', true], ['11-5', true], ['20-10', true], ['21-15, 21-10', true], ['21-15', false], ['15-21', true], ['21-', true], ['abc', true], ['21 15', true], ['121-119', true]]) {
    assert.equal(ok(raw, 1, p1, 21).ok, false, `${raw} / p1=${p1}`);
  }
});

test('Best of 3 to 11 (and to 21): two or three games, no games after the match is decided', () => {
  assert.deepEqual(ok('11-7, 11-9', 3, true, 11), {ok: true, text: '11-7, 11-9'});
  assert.deepEqual(ok('11-7, 8-11, 11-9', 3, true, 11), {ok: true, text: '11-7, 8-11, 11-9'});
  assert.deepEqual(ok('7-11, 9-11', 3, false, 11), {ok: true, text: '7-11, 9-11'});
  assert.equal(ok('12-10, 11-9', 3, true, 11).ok, true);
  assert.equal(ok('11-9, 11-13', 3, true, 11).ok, false, 'a split without a decider');
  assert.equal(ok('11-5, 11-6, 11-4', 3, true, 11).ok, false, 'extra game after the match was won');
  assert.equal(ok('11-5', 3, true, 11).ok, false, 'a Best of 3 needs at least two games');
  assert.equal(ok('11-5, 11-6, 11-7, 11-8', 3, true, 11).ok, false);
  assert.equal(ok('11-10, 11-6', 3, true, 11).ok, false);
  assert.equal(ok('21-15, 21-18', 3, true, 21).ok, true);
  assert.equal(ok('23-21, 18-21, 21-19', 3, true, 21).ok, true);
  assert.equal(ok('21-15, 21-18', 3, true, 11).ok, false, 'games to 21 are not games to 11');
  assert.equal(ok('11-7, 11-9', 3, true, 21).ok, false, 'games to 11 are not games to 21');
});

test('historical Best of 5 is still understood (corrections and displays of old results)', () => {
  assert.equal(ok('11-5, 11-6, 11-7', 5, true, 11).ok, true);
  assert.equal(ok('9-11, 11-7, 8-11, 11-8, 7-11', 5, false, 11).ok, true);
  assert.equal(ok('11-5, 11-6', 5, true, 11).ok, false);
});

test('score text is always normalized the same way the server stores it', () => {
  assert.equal(ok(' 11 - 7 ,11–9 ', 3, true, 11).text, '11-7, 11-9');
});

test('event list model carries what choosing and deleting by name needs, and refuses anything else', () => {
  const e = {event_id: '11111111-1111-4111-8111-111111111111', name: 'FFTT3', date: '2026-11-22', lifecycle: 'draft', role: 'organizer', revision: 0,
    can_create: true, tables: 3, players: 0, deletable: true};
  const [m] = parseMyEvents([e]);
  assert.deepEqual([m.name, m.tables, m.players, m.deletable, m.lifecycle], ['FFTT3', 3, 0, true, 'draft']);
  for (const bad of [{...e, extra: 1}, {...e, deletable: 'yes'}, {...e, tables: 99}, {...e, players: 65}, {...e, role: 'scorekeeper'}, {...e, lifecycle: 'gone'}]) {
    assert.throws(() => parseMyEvents([bad]));
  }
  // a scorekeeper's row never carries organizer-only facts
  assert.doesNotThrow(() => parseMyEvents([{...e, role: 'scorekeeper', players: null, deletable: false}]));
});

const PUBLIC_EVENT = (matchExtra = {}, finaleExtra = null) => ({event_id: '22222222-2222-4222-8222-222222222222', event_name: 'Public', event_date: '2026-11-22', status: 'active',
  revision: 3, tables: 2, updated_at: '2026-11-22T10:00:00Z',
  finale: finaleExtra && {status: 'pending', team_1: ['A', 'B'], team_2: ['C', 'D'], winner_team: null, game_scores: '', ...finaleExtra},
  brackets: [{name: 'championship', matches: [{match_id: 'championship-c-0-0', bracket: 'championship', round: 0, slot: 0, player_1_name: 'A', player_2_name: 'C', winner_name: null,
    game_scores: '', status: 'pending', table_number: 1, phase: 'playing', ...matchExtra}]}]});

test('public projection: format fields are optional, validated when present, and nothing else is allowed', () => {
  const plain = projectPublicTournaments([PUBLIC_EVENT()])[0].championship[0];
  assert.deepEqual([plain.bestOf, plain.points], [null, null]);
  const bo1 = projectPublicTournaments([PUBLIC_EVENT({best_of: 1, points_to_win: 21})])[0].championship[0];
  assert.deepEqual([bo1.bestOf, bo1.points], [1, 21]);
  assert.deepEqual([projectPublicTournaments([PUBLIC_EVENT({best_of: 5, points_to_win: 11})])[0].championship[0].bestOf], [5], 'a historical Best of 5 is displayed as played');
  assert.doesNotThrow(() => projectPublicTournaments([PUBLIC_EVENT({best_of: null, points_to_win: null})]));
  for (const bad of [{best_of: 2, points_to_win: 11}, {best_of: 3, points_to_win: 15}, {best_of: 3}, {points_to_win: 11}, {best_of: '3', points_to_win: 11},
    {rating: 3}, {email: 'a@b.invalid'}, {best_of: 3, points_to_win: 11, player_id: 'x'}]) {
    assert.throws(() => projectPublicTournaments([PUBLIC_EVENT(bad)]), undefined, JSON.stringify(bad));
  }
  const f = projectPublicTournaments([PUBLIC_EVENT({}, {best_of: 3, points_to_win: 11})])[0].finale;
  assert.deepEqual([f.bestOf, f.points], [3, 11]);
  assert.throws(() => projectPublicTournaments([PUBLIC_EVENT({}, {best_of: 3})]));
  assert.throws(() => projectPublicTournaments([PUBLIC_EVENT({}, {best_of: 3, points_to_win: 11, ratings: [1, 2]})]));
});
