import test from 'node:test';
import assert from 'node:assert/strict';
import {resultsText, matchesCsv, standingsFromSnapshot} from '../app/exports.mjs';
import {parseOrganizerSnapshot} from '../contracts/gameday_api.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = [['Ada Quill', 3], ['Ben Marlow', 2], ['=cmd|calc', 4], ['Dee, Larkin', 1]];
const raw = {
  event: {event_id: id(900), name: 'Synthetic Games', date: '2026-11-22', lifecycle: 'complete', tables: 2, generation: 1, revision: 9,
    public_visible: true,
    formats: {champ: {best_of: 3, points: 11}, champ_final: {best_of: 3, points: 11}, cons: {best_of: 1, points: 21}, cons_final: {best_of: 1, points: 21}, doubles: {best_of: 3, points: 11}}},
  players: P.map(([name, rating], i) => ({id: id(i + 1), name, rating, rating_status: 'provisional', checked_in: true, first_champ_loss: false, registration_refs: [], source: 'manual', rating_confirmed: true})),
  brackets: [{kind: 'championship', status: 'complete'}],
  matches: [
    {id: id(11), bracket: 'championship', code: 'C-0-0', round: 0, slot: 0, player_1_id: id(1), player_2_id: id(2), winner_id: id(1), status: 'complete', game_scores: '11-7, 11-9', table: 1, version: 1, is_final: false, next_match_id: id(13), best_of: 3, points: 11, format_legacy: false},
    {id: id(12), bracket: 'championship', code: 'C-0-1', round: 0, slot: 1, player_1_id: id(3), player_2_id: id(4), winner_id: id(3), status: 'complete', game_scores: '11-3, 11-4', table: 2, version: 1, is_final: false, next_match_id: id(13), best_of: 3, points: 11, format_legacy: false},
    {id: id(13), bracket: 'championship', code: 'C-1-0', round: 1, slot: 0, player_1_id: id(1), player_2_id: id(3), winner_id: id(3), status: 'complete', game_scores: '9-11, 11-7, 8-11, 11-8, 7-11', table: 1, version: 1, is_final: true, next_match_id: null, best_of: 5, points: 11, format_legacy: true},
  ],
  consolation_candidates: [], doubles: null, staff: [],
};
const snap = parseOrganizerSnapshot(raw);
test('results text is public-safe: names and results, never ratings or ids', () => {
  const t = resultsText(snap);
  assert.match(t, /Singles Champion: =cmd\|calc/);
  assert.match(t, /Runner-up: Ada Quill/);
  assert.match(t, /Final: Ada Quill vs =cmd\|calc — Winner: =cmd\|calc — 9-11, 11-7, 8-11, 11-8, 7-11 — Best of 5 to 11 \(historical\)/);
  assert.match(t, /Semifinals: Ada Quill vs Ben Marlow — Winner: Ada Quill — 11-7, 11-9 — Best of 3 to 11\n/);
  assert.doesNotMatch(t, /rating|00000000-0000/i);
});
test('CSV quotes commas and neutralizes spreadsheet formulas', () => {
  const c = matchesCsv(snap);
  assert.match(c, /"Dee, Larkin"/);
  assert.match(c, /'=cmd\|calc/);
  assert.equal(c.split('\r\n')[0], 'Bracket,Round,Match,Player 1,Player 2,Winner,Game scores,Table,Status,Format');
  assert.match(c, /championship,1,C-0-0,Ada Quill,Ben Marlow,Ada Quill,"11-7, 11-9",1,complete,Best of 3 to 11\r\n/);
  assert.match(c, /championship,2,C-1-0,.*,Best of 5 to 11 \(historical\)\r\n/);
  assert.doesNotMatch(c, /rating|00000000-0000-4000-8000-0000000000/i);
});
test('played doubles appears in shareable exports with team scores', () => {
  const final = parseOrganizerSnapshot({...raw, doubles: {
    finalist_1: id(1), finalist_2: id(3), partner_1: id(2), partner_2: id(4),
    winner_team: 2, game_scores: '8-11, 11-9, 7-11',
  }});
  const text = resultsText(final);
  assert.ok(text.includes('Mixed-Skill Doubles winners:'));
  assert.ok(text.includes('Mixed-Skill Doubles runners-up:'));
  assert.ok(text.includes('Mixed-Skill Doubles game scores (Team A–Team B): 8-11, 11-9, 7-11'));
  const csvRows = matchesCsv(final).trimEnd().split('\r\n');
  assert.equal(csvRows.length, 5);
  assert.ok(csvRows[4].startsWith('doubles,1,D-FINAL,'));
  assert.ok(csvRows[4].includes('8-11, 11-9, 7-11'));
  assert.ok(csvRows[4].endsWith(',complete,Best of 3 to 11'), csvRows[4]);
  assert.ok(text.includes('Mixed-Skill Doubles format: Best of 3 to 11'));
  assert.ok(!csvRows[4].includes('00000000-0000'));
  const unplayed = parseOrganizerSnapshot({...raw, doubles: {
    finalist_1: id(1), finalist_2: id(3), partner_1: id(2), partner_2: id(4),
    winner_team: null, game_scores: '',
  }});
  assert.equal(matchesCsv(unplayed).trimEnd().split('\r\n').length, 4);
});
test('standings flag players below the two-match standard', () => {
  const s = standingsFromSnapshot(snap);
  assert.equal(s.champion, '=cmd|calc'); assert.equal(s.runnerUp, 'Ada Quill');
  assert.deepEqual(s.belowTwoMatches.sort(), ['Ben Marlow', 'Dee, Larkin']);
});
test('a malformed or oversized server snapshot is refused, not rendered', () => {
  assert.throws(() => parseOrganizerSnapshot({...raw, extra: 1}));
  // a Best of 5 can only be a HISTORICAL match; a new-format match can never claim it, and Best of 5 is not configurable
  assert.throws(() => parseOrganizerSnapshot({...raw, matches: [{...raw.matches[0], best_of: 5}]}));
  assert.throws(() => parseOrganizerSnapshot({...raw, matches: [{...raw.matches[0], points: 15}]}));
  assert.throws(() => parseOrganizerSnapshot({...raw, event: {...raw.event, formats: {...raw.event.formats, champ: {best_of: 5, points: 11}}}}));
  assert.throws(() => parseOrganizerSnapshot({...raw, event: {...raw.event, formats: {champ: raw.event.formats.champ}}}));
  assert.throws(() => parseOrganizerSnapshot({...raw, players: [{...raw.players[0], registration_refs: ['short']}]}));
  assert.throws(() => parseOrganizerSnapshot({...raw, players: [{...raw.players[0], rating: 9}]}));
  assert.throws(() => parseOrganizerSnapshot({...raw, matches: [{...raw.matches[0], winner_id: id(777)}]}));
  assert.throws(() => parseOrganizerSnapshot({...raw, event: {...raw.event, tables: 40}}));
  assert.throws(() => parseOrganizerSnapshot({...raw, players: Array.from({length: 65}, () => raw.players[0])}));
});
import {PUBLIC_HOST} from '../contracts/gameday_public.mjs';
import {C3_HOST} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';
test('the public bundle pins the same project as the signed-in transports', () => assert.equal(PUBLIC_HOST, C3_HOST));
