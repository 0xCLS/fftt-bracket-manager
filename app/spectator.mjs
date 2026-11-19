/** Anonymous spectator view: no sign-in, no e-mail, no storage. Names, tables and results only. */
import {h, clear, fill, $} from './dom.mjs';
import {startPublicFeed, pickEvent, isShowcase} from './public_core.mjs';
import {deriveBoard} from '../contracts/gameday_public.mjs';
import {bracketView, groupRounds} from './bracket_view.mjs';
import {scoreTiles} from './game_tiles.mjs';
import {spectatorGameWins} from './spectator_game_dots.mjs';
import {computeStandings} from '../contracts/gameday_engine.mjs';
import {formatEventDate} from './date_format.mjs';

let tab = 'now', last = null, wanted = new URLSearchParams(location.search).get('e');
// The feed reports freshness every second. Do not replace a spectator's bracket DOM
// unless the selected event, its data, the view, or stale state actually changes.
let renderedKey = null, renderedEventId = null, renderedTab = null;
let tabsKey = null, pickerKey = null;
let bracketTouching = false, lastBracketMotionAt = 0;
const BRACKET_SCROLL_IDLE_MS = 1800;
function trackBracketMotion(container) {
  for (const el of container.querySelectorAll('.bracket')) {
    const mark = () => { lastBracketMotionAt = Date.now(); };
    el.addEventListener('touchstart', () => { bracketTouching = true; mark(); }, {passive: true});
    el.addEventListener('touchend', () => { bracketTouching = false; mark(); }, {passive: true});
    el.addEventListener('touchcancel', () => { bracketTouching = false; mark(); }, {passive: true});
    el.addEventListener('scroll', mark, {passive: true});
  }
}
const TABS = [['now', 'Now & next'], ['bracket', 'Bracket'], ['results', 'Results']];

function standings(ev) {
  const matches = [...ev.championship.map(m => ({...m, bracket: 'championship'})), ...ev.consolation.map(m => ({...m, bracket: 'consolation'}))]
    .map(m => ({bracket: m.bracket, round: m.round, slot: m.slot, status: m.status, p1: m.name1, p2: m.name2, winner: m.winnerName}));
  const f = ev.finale;
  return computeStandings({matches, finale: f ? {team1: f.team1, team2: f.team2, winnerTeam: f.winnerTeam} : null});
}
const formatLine = m => (m?.bestOf && m?.points ? `Best of ${m.bestOf} · to ${m.points}` : '');
const gameWinDots = (m, player, feedState) => {
  const score = spectatorGameWins(m, feedState);
  if (!score) return null;
  const wins = score.won[player];
  const name = player === 0 ? m.name1 : m.name2;
  const detail = score.source === 'stale' ? 'last confirmed, may be out of date' :
    score.source === 'final' ? 'verified final' : 'confirmed completed';
  return h('span', {class: 'spectator-game-dots', role: 'img',
    'aria-label': `${name}: ${wins} ${detail} game win${wins === 1 ? '' : 's'} (2 required to win the match)`},
    Array.from({length: 3}, (_, i) => h('span',
      {class: 'spectator-win-dot' + (i < wins ? ' earned' : ''), 'aria-hidden': 'true'})));
};
/* Award icons describe official placements, not physical prizes. Keep the original
 * unframed trophy. Round medal faces borrow the reference's raised rim, engraved
 * laurels and small stars, without ribbons or attachment loops. */
const MEDAL_NS = 'http://www.w3.org/2000/svg';
let medalSerial = 0;
const medalNode = (tag, attrs = {}, children = []) => {
  const node = document.createElementNS(MEDAL_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  node.append(...children);
  return node;
};
const medalFace = gold => {
  // Each instance needs a distinct paint-server ID; many medals can appear together.
  const gradientId = 'spectator-medal-' + (gold ? 'gold-' : 'silver-') + (++medalSerial);
  const palette = gold
    ? ['#fff5ba', '#f2c756', '#d89c26', '#a77413', '#e2b234', '#fff0a1']
    : ['#ffffff', '#e1e7eb', '#adb8c2', '#85919e', '#c7d0d9', '#f9fcff'];
  const svg = medalNode('svg', {class: 'spectator-medal-art', viewBox: '0 0 32 32',
    'aria-hidden': 'true', focusable: 'false'});
  svg.append(medalNode('defs', {}, [
    medalNode('radialGradient', {id: gradientId, cx: '29%', cy: '22%', r: '83%'}, [
      medalNode('stop', {offset: '0%', 'stop-color': palette[0]}),
      medalNode('stop', {offset: '53%', 'stop-color': palette[1]}),
      medalNode('stop', {offset: '100%', 'stop-color': palette[2]})
    ])
  ]));
  svg.append(
    medalNode('circle', {cx: 16, cy: 16, r: 15.25, fill: palette[3]}),
    medalNode('circle', {cx: 16, cy: 16, r: 14.5, fill: palette[4],
      stroke: palette[5], 'stroke-width': '.85'}),
    medalNode('circle', {cx: 16, cy: 16, r: 13.45, fill: 'none',
      stroke: palette[3], 'stroke-width': '.62', 'stroke-dasharray': '.65 1.82'}),
    medalNode('circle', {cx: 16, cy: 16, r: 12.25, fill: 'url(#' + gradientId + ')',
      stroke: palette[5], 'stroke-width': '.75'}),
    medalNode('circle', {cx: 16, cy: 16, r: 10.9, fill: 'none',
      stroke: palette[3], 'stroke-width': '.43', opacity: '.72'}),
    medalNode('path', {class: 'spectator-medal-laurel',
      d: 'M10.8 22.9C7.2 20.1 6.8 15 9.8 10.8 M21.2 22.9C24.8 20.1 25.2 15 22.2 10.8',
      fill: 'none', 'stroke-width': '.8', 'stroke-linecap': 'round'})
  );
  const leafPositions = [[9.3, 12.5, -26], [8.3, 15.4, -38],
    [8.8, 18.6, -52], [10, 21.3, -64]];
  for (const [x, y, angle] of leafPositions) {
    for (const side of [-1, 1]) {
      const cx = side === -1 ? x : 32 - x;
      const rotation = side === -1 ? angle : -angle;
      svg.append(medalNode('ellipse', {class: 'spectator-medal-laurel', cx, cy: y,
        rx: '.85', ry: '1.48', transform: 'rotate(' + rotation + ' ' + cx + ' ' + y + ')'}));
    }
  }
  for (const [i, x] of [12.1, 16, 19.9].entries()) {
    svg.append(medalNode('path', {class: 'spectator-medal-star',
      d: 'M0 -1.4L.4 -.43L1.44 -.43L.6 .2L.93 1.3L0 .66L-.93 1.3L-.6 .2L-1.44 -.43L-.4 -.43Z',
      transform: 'translate(' + x + ' 8.2) scale(' + (i === 1 ? '.85' : '.68') + ')'}));
  }
  return svg;
};
const awardMark = (kind, place) => {
  if (kind === 'championship' && place === 1)
    return h('span', {class: 'spectator-award-trophy', role: 'img',
      'aria-label': 'Champion, first place', title: 'Champion · 1st place', text: '🏆'});
  const gold = place === 1;
  return h('span', {class: 'spectator-award-disc ' + (gold ? 'gold' : 'silver'),
    role: 'img', 'aria-label': gold ? 'Gold medal, first place' : 'Silver medal, runner-up',
    title: gold ? 'Gold medal · 1st place' : 'Silver medal · 2nd place'},
    medalFace(gold), h('span', {class: 'spectator-medal-number', 'aria-hidden': 'true', text: gold ? '1' : '2'}));
};

const completedFinal = matches => {
  if (!matches?.length) return null;
  const highest = Math.max(...matches.map(m => m.round));
  const last = matches.filter(m => m.round === highest);
  if (last.length !== 1 || last[0].slot !== 0) return null;
  const m = last[0];
  return m.status === 'complete' && m.name1 && m.name2
    && (m.winnerName === m.name1 || m.winnerName === m.name2) ? m : null;
};

const spectatorMatchup = (m, feedState, showWinner = false, finalKind = null) => h('div',
  {class: 'spectator-matchup' + (showWinner ? ' spectator-result-matchup' : '')},
  ...[0, 1].map(player => {
    const name = player === 0 ? m.name1 : m.name2;
    const winner = showWinner && name === m.winnerName;
    return h('div', {class: 'spectator-player-row' +
      (showWinner ? (winner ? ' spectator-result-winner' : ' spectator-result-runner-up') : '')},
      h('span', {class: 'spectator-player-name', text: name}),
      winner && !finalKind ? h('span', {class: 'spectator-result-winner-mark', role: 'img',
        'aria-label': 'Match winner', text: '✓'}) : null,
      finalKind ? awardMark(finalKind, winner ? 1 : 2) : null,
      gameWinDots(m, player, feedState));
  }));
const matchCard = (m, feedState) => {
  const playing = m.phase === 'playing';
  return h('article', {class: 'board-match spectator-now-card ' + (playing ? 'is-playing' : 'is-up-next')},
    playing ? h('div', {class: 'spectator-now-status'},
      m.table ? h('span', {class: 'tbl', text: `Table ${m.table}`}) : null,
      h('span', {class: 'spectator-now-live', text: 'Playing'})) : null,
    spectatorMatchup(m, feedState),
    h('div', {class: 'spectator-now-meta'},
      h('span', {text: `${m.bracket === 'championship' ? 'Championship' : 'Consolation'} · Round ${m.round + 1}`}),
      formatLine(m) ? h('span', {class: 'fmt-line spectator-now-format', text: formatLine(m)}) : null));
};

function viewNow(ev, board, feedState) {
  return h('div', {class: 'spectator-now'},
    h('section', {class: 'spectator-now-section'},
      h('h2', {text: isShowcase(ev) ? 'Sample matches' : 'Now playing'}),
      board.playing.length ? h('div', {class: 'now-grid spectator-now-playing-grid'},
        board.playing.map(m => matchCard(m, feedState)))
        : h('div', {class: 'empty-state', text: 'No matches are on a table right now.'})),
    h('section', {class: 'spectator-now-section'},
      h('h2', {text: 'Up next'}),
      board.upNext.length ? h('div', {class: 'now-grid spectator-now-queue-grid'},
        board.upNext.slice(0, 8).map(m => matchCard(m, feedState)))
        : h('div', {class: 'empty-state', text: 'Nothing queued yet.'})),
    ev.finale ? finaleCard(ev.finale) : null);
}
/** "Single game to 21" / "Best of 3 · to 11". Shown only until the finale is officially decided. */
const finaleFormat = f => !f.bestOf || !f.points ? ''
  : f.bestOf === 1 ? `Single game to ${f.points}` : `Best of ${f.bestOf} · to ${f.points}`;
function finaleCard(f) {
  const decided = !!f.winnerTeam;
  const teamCard = (names, number) => h('div', {class: 'stat spectator-finale-team ' + (number === 1 ? 'ice' : 'lav') + (decided && f.winnerTeam === number ? ' is-winner' : '')},
    h('b', {text: 'Team ' + (number === 1 ? 'A' : 'B')}),
    h('ul', {class: 'spectator-finale-members', 'aria-label': 'Team ' + (number === 1 ? 'A' : 'B') + ' players'},
      ...names.map(name => h('li', {class: 'spectator-finale-member'},
        h('span', {class: 'spectator-finale-name', text: name}),
        decided ? awardMark('doubles', f.winnerTeam === number ? 1 : 2) : null))));
  return h('div', {class: 'card spectator-finale'},
    h('div', {class: 'spectator-finale-head'},
      h('h2', {text: 'Mixed-Skill Doubles finale'}),
      !decided && finaleFormat(f) ? h('span', {class: 'spectator-finale-format', text: finaleFormat(f)}) : null),
    h('div', {class: 'grid two'}, teamCard(f.team1, 1), teamCard(f.team2, 2)),
    decided ? h('div', {class: 'notice good'}, h('p', {text: `Winners: ${(f.winnerTeam === 1 ? f.team1 : f.team2).join(' + ')}`}),
      f.scores ? scoreTiles(f.scores, {left: 'Team A', right: 'Team B'}) : null) : h('p', {class: 'muted', text: 'Coming up after the championship final.'}));
}

/* Spectator-only bracket layout. Keep the Staff renderer, official match rows and
 * scored results intact; links follow validated round/slot topology only. */
function spectatorBracket(matches, kind) {
  const bracket = bracketView(matches, kind);
  if (!bracket.classList.contains('bracket')) return bracket;
  bracket.classList.add('spectator-bracket');
  const rounds = groupRounds(matches);
  const roundEls = [...bracket.querySelectorAll(':scope > .round')];
  // Award icons only for officially completed finals, never for byes or
  // in-progress games. The shared Staff bracket renderer remains unchanged.
  const final = completedFinal(matches);
  if (final) {
    const visible = rounds.at(-1).filter(m => m.status !== 'empty');
    const finalIndex = visible.findIndex(m => m.slot === final.slot);
    const finalCard = [...roundEls.at(-1).querySelectorAll(':scope > .match')][finalIndex];
    const lines = [...(finalCard?.querySelectorAll(':scope > .playerline') || [])];
    if (lines.length === 2) {
      const winIndex = final.winnerName === final.name1 ? 0 : 1;
      lines.forEach((line, i) => {
        const check = line.querySelector(':scope > span:last-child');
        if (i === winIndex && check?.textContent === '✓') check.textContent = '';
        line.append(awardMark(kind, i === winIndex ? 1 : 2));
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

function viewBracket(ev) {
  return h('div', {},
    h('div', {class: 'card'}, h('h2', {text: 'Championship'}),
      h('p', {class: 'help bracket-hint', text: 'Swipe sideways within the bracket to see later rounds.'}),
      spectatorBracket(ev.championship, 'championship')),
    ev.consolation.length ? h('div', {class: 'card'}, h('h2', {text: 'Consolation'}),
      h('p', {class: 'help bracket-hint', text: 'Swipe sideways within the bracket to see later rounds.'}),
      spectatorBracket(ev.consolation, 'consolation')) : null);
}
const resultMatch = (m, feedState, finalId) => h('li', {class: 'spectator-result'},
  h('span', {class: 'spectator-result-round', text: m.id === finalId ? 'Final' : `Round ${m.round + 1}`}),
  h('div', {class: 'spectator-result-main'},
    spectatorMatchup(m, feedState, true, m.id === finalId ? m.bracket : null),
    h('div', {class: 'spectator-result-scorebox scores-cell'},
      h('span', {class: 'spectator-result-scorelabel', text: 'Game scores'}),
      scoreTiles(m.scores, {left: m.name1, right: m.name2, caption: false}))));

const resultsGroup = (label, matches, feedState, finalId) => matches.length
  ? h('section', {class: 'card spectator-results-group', 'aria-label': label},
    h('div', {class: 'spectator-results-heading'},
      h('h3', {text: label}),
      h('span', {class: 'spectator-results-count',
        text: `${matches.length} completed match${matches.length === 1 ? '' : 'es'}` } )),
    h('ol', {class: 'spectator-results-list'},
      ...matches.map(m => resultMatch(m, feedState, finalId))))
  : null;

/** One awarded place: the medal (or trophy) sits in a fixed column so every category aligns, and a Doubles
 * team's players stay together under one label. */
const awardGroup = (kind, place, label, names) => h('li', {class: 'spectator-award-group'},
  h('span', {class: 'spectator-award-role', text: label}),
  h('ul', {class: 'spectator-award-members'},
    ...names.map(name => h('li', {class: 'spectator-award-member'},
      awardMark(kind, place), h('span', {class: 'spectator-award-person', text: name})))));
const awardColumn = (title, kind, groups) => h('section', {class: 'spectator-award-column ' + kind, 'aria-label': title},
  h('h3', {class: 'spectator-award-heading', text: title}),
  h('ul', {class: 'spectator-award-groups'}, ...groups));
function winnersSummary(st) {
  const columns = [
    awardColumn('Championship', 'championship', [
      awardGroup('championship', 1, 'Champion', [st.champion]),
      awardGroup('championship', 2, 'Runner-up', [st.runnerUp])]),
    st.consolationChampion ? awardColumn('Consolation', 'consolation', [
      awardGroup('consolation', 1, 'Champion', [st.consolationChampion]),
      st.consolationRunnerUp ? awardGroup('consolation', 2, 'Runner-up', [st.consolationRunnerUp]) : null].filter(Boolean)) : null,
    st.doubles ? awardColumn('Mixed-Skill Doubles', 'doubles', [
      awardGroup('doubles', 1, 'Winners', st.doubles.winners),
      awardGroup('doubles', 2, 'Runners-up', st.doubles.losers)]) : null,
  ].filter(Boolean);
  return h('section', {class: 'champion-banner spectator-winners-banner', 'aria-labelledby': 'winnersTitle'},
    h('h2', {id: 'winnersTitle', class: 'spectator-winners-title', text: 'Tournament winners'}),
    h('div', {class: 'spectator-winners-grid', 'data-columns': columns.length}, ...columns));
}

function viewResults(ev, board, feedState) {
  const st = standings(ev);
  const championship = board.recent.filter(m => m.bracket === 'championship');
  const consolation = board.recent.filter(m => m.bracket === 'consolation');
  return h('div', {class: 'spectator-results'},
    st.champion ? winnersSummary(st) : null,
    h('h2', {class: 'spectator-results-title', text: 'Completed matches'}),
    board.recent.length
      ? h('div', {},
        resultsGroup('Championship Bracket', championship, feedState, completedFinal(ev.championship)?.id),
        resultsGroup('Consolation Bracket', consolation, feedState, completedFinal(ev.consolation)?.id))
      : h('div', {class: 'empty-state', text: 'No results yet.'}));
}

function render(view) {
  const live = $('live');
  const events = view.events;
  const ev = pickEvent(events, wanted);
  if (view.state === 'empty') { live.className = 'pill warn'; live.textContent = 'Waiting for the feed…'; }
  else if (view.state === 'stale') { live.className = 'pill bad'; live.textContent = `Out of date · last update ${Math.round(view.ageMs / 1000)}s ago`; }
  else if (!ev) { live.className = 'pill warn'; live.textContent = 'No public event'; }
  else { live.className = 'pill good'; live.textContent = isShowcase(ev) ? 'Demo data' : 'Live'; }
  $('demoBadge').hidden = !isShowcase(ev);
  $('brandLabel').textContent = isShowcase(ev) ? 'DEMO BRACKET' : 'LIVE BRACKET';
  const pick = $('evPick');
  pick.hidden = events.length < 2;
  const nextPickerKey = JSON.stringify([ev?.id ?? null, events.map(e => [e.id, e.name])]);
  if (nextPickerKey !== pickerKey) {
    pickerKey = nextPickerKey;
    clear(pick);
    if (!pick.hidden) for (const e of events) pick.append(h('option', {value: e.id, text: e.name, selected: e.id === ev?.id}));
  }
  if (tabsKey !== tab) {
    tabsKey = tab;
    clear($('tabs'));
    for (const [id, text] of TABS) $('tabs').append(h('button', {type: 'button', text, 'aria-current': id === tab ? 'page' : null, on: {click: () => { tab = id; render(last); }}}));
  }
  const main = $('main');
  // Keep the live/stale badge current without discarding the user's horizontal
  // swipe position once per second. Data changes still redraw the visible view.
  const nextKey = JSON.stringify([tab, view.state, ev]);
  if (nextKey === renderedKey) return;
  // Live scores can change while a spectator is swiping. Defer the DOM
  // replacement until momentum has stopped; the status badge still updates.
  if (tab === 'bracket' && renderedTab === 'bracket' && renderedEventId === ev?.id
      && (bracketTouching || Date.now() - lastBracketMotionAt < BRACKET_SCROLL_IDLE_MS)) return;
  const positions = tab === 'bracket' && renderedTab === 'bracket' && renderedEventId === ev?.id
    ? [...main.querySelectorAll('.bracket')].map(node => node.scrollLeft) : [];
  renderedKey = nextKey;
  renderedEventId = ev?.id ?? null;
  renderedTab = tab;
  if (!ev) {
    clear(main);
    $('evName').textContent = 'Forging Fellowship Table Tennis Games';
    $('evMeta').textContent = '';
    main.append(h('div', {class: 'empty-state', text: view.state === 'empty' ? 'The bracket is not available right now. This page checks again automatically.' : 'No event is public yet. Check back soon.'}));
    return;
  }
  $('evName').textContent = ev.name;
  $('evMeta').textContent = `${formatEventDate(ev.date)} · ${isShowcase(ev) ? 'Fictional demonstration' : ev.status === 'complete' ? 'Final results' : 'In progress'}`;
  const board = deriveBoard(ev);
  fill(main, view.state === 'stale' ? h('div', {class: 'notice warn', text: 'The connection dropped. This is the last information received — it may be out of date.'}) : null,
    tab === 'now' ? viewNow(ev, board, view.state) : tab === 'bracket' ? viewBracket(ev) : viewResults(ev, board, view.state));
  if (positions.length) [...main.querySelectorAll('.bracket')].forEach((node, i) => {
    if (positions[i] !== undefined) node.scrollLeft = positions[i];
  });
  if (tab === 'bracket') trackBracketMotion(main);
}
$('evPick').addEventListener('change', e => { wanted = e.target.value; render(last); });
startPublicFeed({onUpdate: v => { last = v; render(v); }});
