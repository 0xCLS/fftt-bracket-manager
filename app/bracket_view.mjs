/** Bracket rendering shared by the staff app and the public spectator view. Input is normalized match
 * records ({round, slot, name1, name2, winnerName, status, scores, table, phase}); names are display text
 * only and are placed with textContent. */
import {h} from './dom.mjs';
import {scoreTiles} from './game_tiles.mjs';
import {roundName} from '../contracts/gameday_engine.mjs';

export function groupRounds(matches) {
  const rounds = [];
  for (const m of [...matches].sort((a, b) => a.round - b.round || a.slot - b.slot)) (rounds[m.round] ??= []).push(m);
  return rounds.filter(Boolean);
}

function label(m) {
  if (m.status === 'bye') return ['BYE', 'blue'];
  if (m.status === 'empty') return ['—', ''];
  if (m.status === 'complete') return ['Completed', 'good'];
  if (m.phase === 'playing' || (m.table && m.name1 && m.name2)) return [`Now playing${m.table ? ' · Table ' + m.table : ''}`, 'blue'];
  if (m.name1 && m.name2) return ['Ready', 'blue'];
  return ['Waiting', ''];
}

const formatText = m => (m.bestOf && m.points ? `Best of ${m.bestOf} · to ${m.points}` : null);

/** Bracket for staff and spectators. Each match shows ITS OWN format (a historical Best of 5 stays Best of 5). */
export function bracketView(matches, kind) {
  const rounds = groupRounds(matches);
  if (!rounds.length) return h('div', {class: 'empty-state', text: 'Bracket not built yet.'});
  return h('div', {class: 'bracket', role: 'group', tabindex: '0', 'aria-label': kind === 'championship' ? 'Championship bracket' : 'Consolation bracket'},
    rounds.map((round, r) => h('div', {class: 'round'},
      h('div', {class: 'round-title', text: roundName(rounds.length, r, kind)}),
      round.filter(m => m.status !== 'empty').map(m => {
        const [text, tone] = label(m);
        const format = m.status === 'bye' ? null : formatText(m);
        return h('div', {class: 'match' + (m.status === 'pending' && m.table && m.name1 && m.name2 ? ' playing' : '')},
          h('div', {class: 'match-head'}, h('span', {text: m.status === 'bye' ? 'Bye' : (format ?? 'Match')}),
            h('span', {class: 'pill mini' + (tone ? ' ' + tone : ''), text})),
          [['name1', m.name1], ['name2', m.name2]].map(([, name]) => {
            const win = name && m.winnerName === name;
            return h('div', {class: 'playerline' + (win ? ' winner' : '') + (name ? '' : ' empty')},
              h('span', {text: name || '—'}), h('span', {text: win ? '✓' : ''}));
          }),
          (m.status === 'complete' && m.scores) ? h('div', {class: 'match-foot'}, scoreTiles(m.scores, {left: m.name1 || 'First player', right: m.name2 || 'Second player', compact: true, caption: false})) : null);
      }))));
}
