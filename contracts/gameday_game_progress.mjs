/** Pure preview/validation of a prefix of SERVER-CONFIRMED game scores.
 * Does not determine an official match result or authorize any write. */
export function summarizeGameProgress(games, bestOf, points) {
  const fail = error => Object.freeze({ok: false, error});
  if (![1,3,5].includes(bestOf) || ![11,21].includes(points)
    || !Array.isArray(games) || games.length > bestOf) return fail('Invalid match format or game count.');
  const needed = (bestOf + 1) / 2;
  const won = [0, 0];
  for (const [i, g] of games.entries()) {
    if (!Array.isArray(g) || g.length !== 2
      || !g.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 99)) return fail('Invalid game scores.');
    const hi = Math.max(...g), diff = Math.abs(g[0] - g[1]);
    if (hi < points || diff < 2 || (hi > points && diff !== 2))
      return fail('Each game must reach the target and be won by two.');
    won[g[0] > g[1] ? 0 : 1]++;
    if (i < games.length - 1 && Math.max(...won) >= needed)
      return fail('Games recorded after the match was decided.');
  }
  const decided = Math.max(...won) === needed;
  return Object.freeze({ok: true, won: Object.freeze(won), decided,
    winnerIndex: decided ? (won[0] === needed ? 0 : 1) : null,
    nextGame: decided ? null : games.length + 1,
    text: games.map(g => g.join('-')).join(', ')});
}
