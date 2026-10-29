/** Game scores as equal rounded SQUARES: one tile per player per game, the winner of each game in subtle pastel green and
 * the loser in subtle pastel red. Reusable by every result display (Match Desk, Doubles Finale, brackets, spectator).
 *
 * Reading order: the recorded text "a-b, c-d" is ALWAYS first-named competitor first (player 1 / Team A), whoever won the
 * match, so the left tile of each pair belongs to `left` and the right tile to `right`. Colour is never the only cue:
 * a winning tile also has a solid border and bold figures, a losing tile a dashed border, and each game carries a
 * sentence for screen readers ("Game 2: Ada Q. 9, Ben M. 11. Ben M. won the game"). Nothing is rewritten: the text is
 * only parsed for display; Best of 1/3/5, games to 11 or 21 and deuce scores (12-10, 22-20) all render the same way. */
import {h} from './dom.mjs';

const GAME = /^\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*$/;
/** "11-7, 9-11, 11-8" -> [{a:11,b:7},...] or null when it is not a plain list of games. */
export function parseGames(text) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const games = [];
  for (const part of t.split(',')) {
    const m = GAME.exec(part);
    if (!m) return null;
    games.push({a: Number(m[1]), b: Number(m[2])});
  }
  return games.length <= 7 ? games : null;
}

export function scoreTiles(text, {left = 'First player', right = 'Second player', compact = false, caption = true} = {}) {
  const games = parseGames(text);
  const t = String(text ?? '').trim();
  if (games === null) return h('span', {class: 'score-text mono', text: t});                // unknown shape: show it as recorded
  if (!games.length) return h('span', {class: 'score-text muted', text: t === 'W/O' ? 'Walkover' : 'No game scores'});
  const list = h('ol', {class: 'score-games', role: 'list'}, games.map((g, i) => {
    const aWon = g.a > g.b;
    const sentence = `Game ${i + 1}: ${left} ${g.a}, ${right} ${g.b}. ${aWon ? left : right} won the game.`;
    return h('li', {class: 'score-game'},
      h('span', {class: 'sr-only', text: sentence}),
      h('span', {class: 'score-tile ' + (aWon ? 'win' : 'lose'), 'aria-hidden': 'true', text: String(g.a)}),
      h('span', {class: 'score-tile ' + (aWon ? 'lose' : 'win'), 'aria-hidden': 'true', text: String(g.b)}));
  }));
  return h('div', {class: 'score-tiles' + (compact ? ' compact' : ''), role: 'group', 'aria-label': `Game scores, ${left} first, then ${right}`},
    list, caption ? h('p', {class: 'score-caption', 'aria-hidden': 'true'}, h('span', {text: left}), ' · ', h('span', {text: right})) : null);
}
