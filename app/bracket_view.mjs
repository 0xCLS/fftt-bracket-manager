/** Bracket rendering shared by the staff app and the public spectator view. Input is normalized match
 * records ({round, slot, name1, name2, winnerName, status, scores, table, phase}); names are display text
 * only and are placed with textContent. */
import {h} from './dom.mjs';
import {scoreTiles, parseGames} from './game_tiles.mjs';
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

/** Shared compact bracket layout; no changes to official match data or Staff permissions. */
function polishBracketCard(card, match) {
  const head = card.querySelector(':scope > .match-head');
  // Both Staff and Spectator use the same compact BYE presentation.
  if (match.status === 'bye') {
    card.classList.add('spectator-bracket-bye');
    head?.querySelector(':scope > span:first-child')?.remove();
  }
  // A walkover is an administrative result, not completed game play.
  // The match already has an official winner; show that and one clear status
  // instead of repeating the encoded "W/O" in an otherwise empty score footer.
  if (match.status === 'complete' && String(match.scores ?? '').trim().toUpperCase() === 'W/O') {
    card.classList.add('spectator-bracket-walkover');
    const status = head?.querySelector(':scope > .pill');
    if (status) status.textContent = 'Walkover';
    card.querySelector(':scope > .match-foot')?.remove();
  }
  const lines = [...card.querySelectorAll(':scope > .playerline')];
  if (lines.length !== 2 || match.status !== 'complete') return;
  const games = parseGames(match.scores);
  // Best-of-three games fit the narrow bracket columns. Keep the shared
  // accessible score footer for historical Bo5 and irregular recorded scores.
  if (!match.name1 || !match.name2 || !games?.length || games.length > 3) return;
  lines.forEach((line, player) => {
    const name = player === 0 ? match.name1 : match.name2;
    const values = games.map(g => player === 0 ? g.a : g.b);
    const scores = h('span', {class: 'spectator-bracket-inline-score', role: 'group',
      'aria-label': `${name || 'Player ' + (player + 1)} game scores: ${values.map((n, i) => 'Game ' + (i + 1) + ': ' + n).join(', ')}`},
      games.map((g, i) => h('span', {class: 'score-tile ' +
        ((player === 0 ? g.a > g.b : g.b > g.a) ? 'win' : 'lose'),
        'aria-hidden': 'true', text: String(values[i])})));
    line.classList.add('spectator-bracket-player-scored');
    line.querySelector(':scope > span:first-child')?.classList.add('spectator-bracket-player-name');
    line.querySelector(':scope > span:last-child')?.classList.add('spectator-bracket-win-check');
    line.prepend(scores);
  });
  card.classList.add('spectator-bracket-inline');
  card.querySelector(':scope > .match-foot')?.remove();
}
export function polishedBracketView(matches, kind, {final = null, awardMark = null} = {}) {
  const bracket = bracketView(matches, kind);
  if (!bracket.classList.contains('bracket')) return bracket;
  bracket.classList.add('spectator-bracket');
  const rounds = groupRounds(matches);
  const roundEls = [...bracket.querySelectorAll(':scope > .round')];
  // Match cards are paired by sorted round/slot, exactly as the shared renderer
  // builds them. Only the anonymous Spectator nodes are polished.
  rounds.forEach((round, r) => {
    const cards = [...roundEls[r].querySelectorAll(':scope > .match')];
    round.filter(m => m.status !== 'empty').forEach((m, i) => {
      if (cards[i]) polishBracketCard(cards[i], m);
    });
  });
  // Award icons only for officially completed finals, never for byes or
  // in-progress games. The shared Staff bracket renderer remains unchanged.
  if (final && awardMark) {
    const visible = rounds.at(-1).filter(m => m.status !== 'empty');
    const finalIndex = visible.findIndex(m => m.slot === final.slot);
    const finalCard = [...roundEls.at(-1).querySelectorAll(':scope > .match')][finalIndex];
    const lines = [...(finalCard?.querySelectorAll(':scope > .playerline') || [])];
    if (lines.length === 2) {
      const winIndex = final.winnerName === final.name1 ? 0 : 1;
      lines.forEach((line, i) => {
        // Replace the existing right-hand marker instead of appending a fourth
        // grid child: final trophies/medals must share the aligned marker slot
        // with ordinary win checks, even when scores are displayed inline.
        const check = line.querySelector(':scope > .spectator-bracket-win-check')
          ?? line.querySelector(':scope > span:last-child');
        const medal = awardMark(kind, i === winIndex ? 1 : 2);
        if (check) check.replaceWith(medal);
        else line.append(medal);
      });
    }
  }

  // Refuse diagram connectors for partial or noncanonical slot layouts. The
  // original official bracket remains readable, without speculative links.
  const canonical = rounds.length === roundEls.length && rounds.length > 0 && rounds.length <= 7
    && rounds.every((round, r) => {
      const slots = round.map(m => m.slot);
      const capacity = 2 ** (rounds.length - 1 - r);
      return slots.every(slot => Number.isInteger(slot) && slot >= 0 && slot < capacity)
        && new Set(slots).size === slots.length
        && round.filter(m => m.status !== 'empty').length === roundEls[r].querySelectorAll(':scope > .match').length;
    });
  if (canonical) {
    const links = rounds.map((round, r) => {
      if (r === 0) return new Set();
      const children = new Set(rounds[r - 1].filter(m => m.status !== 'empty').map(m => m.slot));
      return new Set(round.filter(m => m.status !== 'empty'
        && children.has(2 * m.slot) && children.has(2 * m.slot + 1)).map(m => m.slot));
    });
    rounds.forEach((round, r) => {
      const roundEl = roundEls[r];
      const cards = [...roundEl.querySelectorAll(':scope > .match')];
      const bySlot = new Map(round.filter(m => m.status !== 'empty')
        .map((m, i) => [m.slot, {match: m, card: cards[i]}]));
      const positions = h('div', {class: 'spectator-bracket-positions'});
      for (let slot = 0, count = 2 ** (rounds.length - 1 - r); slot < count; slot++) {
        const entry = bySlot.get(slot);
        const feeds = r + 1 < rounds.length && links[r + 1].has(Math.floor(slot / 2));
        const paired = r > 0 && links[r].has(slot);
        const position = h('div', {class: 'spectator-bracket-position span-' + (2 ** r)
          + (entry?.match.status === 'bye' ? ' is-bye' : '')
          + (feeds ? ' feeds-next' : '')
          + (paired ? ' has-feeders' : '')
          + (!entry ? ' is-empty' : '')});
        if (paired) position.append(h('span', {class: 'spectator-bracket-connector', 'aria-hidden': 'true'}));
        if (entry) position.append(entry.card);
        positions.append(position);
      }
      roundEl.append(positions);
    });
    bracket.classList.add('has-grounded-slots');
  }
  const jump = direction => {
    const width = bracket.querySelector('.round')?.getBoundingClientRect().width || 260;
    bracket.scrollBy({left: direction * (width + 28), behavior: 'smooth'});
  };
  return h('div', {class: 'spectator-bracket-shell'},
    h('div', {class: 'spectator-bracket-tools'},
      h('span', {class: 'spectator-bracket-legend', text: 'Follow the rounds'}),
      h('div', {class: 'spectator-bracket-controls'},
        h('button', {type: 'button', class: 'spectator-bracket-arrow',
          'aria-label': 'Previous ' + kind + ' round', text: '←',
          on: {click: () => jump(-1)}}),
        h('button', {type: 'button', class: 'spectator-bracket-arrow',
          'aria-label': 'Next ' + kind + ' round', text: '→',
          on: {click: () => jump(1)}}))),
    bracket);
}

