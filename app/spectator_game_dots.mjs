/** Reuse TV semantics: only server-confirmed saved games or validated official results.
 * Returns null for best-of-one, byes, unsaved games, walkovers and invalid scores. */
import {parseGames} from './game_tiles.mjs';
import {normalizeGameScores} from '../contracts/gameday_engine.mjs';

export function spectatorGameWins(m, feedState) {
  if (m?.bestOf !== 3 || !m.name1 || !m.name2) return null;
  const active = m.status === 'pending' && m.phase === 'playing'
    && (feedState === 'current' || feedState === 'stale')
    && Array.isArray(m.progress?.games) && m.progress.games.length > 0;
  if (active) {
    const won = m.progress.won;
    if (!Array.isArray(won) || won.length !== 2 || won.some(x => !Number.isSafeInteger(x) || x < 0 || x > 2)
      || won[0] + won[1] !== m.progress.games.length) return null;
    return Object.freeze({won: Object.freeze([...won]), source: feedState === 'stale' ? 'stale' : 'confirmed'});
  }
  if (m.status !== 'complete' || !m.winnerName || !m.scores || !m.points) return null;
  const games = parseGames(m.scores);
  if (!games?.length || !normalizeGameScores(m.scores, m.bestOf, m.winnerName === m.name1, m.points).ok) return null;
  return Object.freeze({won: Object.freeze([
    games.filter(g => g.a > g.b).length,
    games.filter(g => g.b > g.a).length
  ]), source: 'final'});
}
