/** Additional fictional, allowlisted public feeds for the three-table TV tests. Kept beside the TV tests;
 * the shared base fixture is unchanged. */
import {fixture} from '../fixtures/tv-fixture.mjs';
const match = (id, round, slot, p1, p2, extra = {}) => ({match_id: id, bracket: 'championship', round, slot, player_1_name: p1, player_2_name: p2, winner_name: null, game_scores: '', status: 'pending', table_number: null, phase: 'waiting', best_of: 3, points_to_win: 11, ...extra});
/** Three configured tables, all in play: the FFTT 3 game-day shape. Table 1 carries confirmed game progress. */
export function threeTableFixture({long = false} = {}) {
  const f = fixture(), ev = f[0], champ = ev.brackets[0].matches;
  ev.tables = 3;
  const live = champ.filter(m => m.phase === 'playing');
  live[0].game_progress = {games: [[11, 7]], version: 1, epoch: 0, updated_at: '2026-11-07T12:00:00Z'};
  live[1].game_progress = null;
  champ.push(match('t3', 0, 6, long ? 'Bartholomew Featherstonehaugh-Cholmondeley' : 'Priya Natarajan', long ? 'Maximiliano Rodriguez-Villalobos' : 'Samuel Okafor', {phase: 'playing', table_number: 3, best_of: 1, points_to_win: 21}));
  return f;
}
