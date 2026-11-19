/** Fictional completed-event public feed for the Spectator winners summary and Doubles finale card tests.
 * Kept beside the public tests; the shared base fixture is unchanged. */
import {fixture} from '../fixtures/tv-fixture.mjs';
const match = (id, round, slot, p1, p2, extra = {}) => ({match_id: id, bracket: 'championship', round, slot, player_1_name: p1, player_2_name: p2, winner_name: null, game_scores: '', status: 'pending', table_number: null, phase: 'waiting', best_of: 3, points_to_win: 11, ...extra});
/** Fictional completed event: Championship, Consolation and Mixed-Skill Doubles all decided.
 * `doubles`: 'pending' (teams chosen, not played), 'complete' (decided) or null. Doubles is Best of 1 to 21. */
export function completedFixture({doubles = 'complete', long = false} = {}) {
  const f = fixture(), ev = f[0];
  const A = long ? 'Alexandria Montgomery-Fitzgerald' : 'Taylor Smith', B = long ? 'Evangeline Worthington-Smythe' : 'Morgan James';
  const done = (id, round, slot, p1, p2, win, scores, bracket = 'championship', extra = {}) =>
    match(id, round, slot, p1, p2, {bracket, status: 'complete', phase: 'done', winner_name: win, game_scores: scores, ...extra});
  ev.status = 'complete';
  ev.brackets = [
    {name: 'championship', matches: [
      done('c0', 0, 0, A, 'Jordan Williams', A, '11-7, 11-9'), done('c1', 0, 1, B, 'Casey Ross', B, '11-5, 8-11, 11-6'),
      done('cf', 1, 0, A, B, A, '11-7, 8-11, 11-9')]},
    {name: 'consolation', matches: [done('k0', 0, 0, 'Jamie Lee', 'Riley Quinn', 'Jamie Lee', '21-15', 'consolation', {best_of: 1, points_to_win: 21})]},
  ];
  ev.finale = doubles ? {
    status: doubles, team_1: [A, long ? 'Bartholomew Featherstonehaugh' : 'Jamie Lee'], team_2: [B, long ? 'Maximiliano Rodriguez-Villalobos' : 'Riley Quinn'],
    winner_team: doubles === 'complete' ? 1 : null, game_scores: doubles === 'complete' ? '21-17' : '', best_of: 1, points_to_win: 21} : null;
  return f;
}
