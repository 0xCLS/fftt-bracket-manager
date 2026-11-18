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
/* Award icons represent confirmed results, not an assertion about a physical prize.
 * Use the unframed trophy for Championship first place; every medal is its
 * own round metallic disc, with NO ribbon or additional circular badge. */
const awardMark = (kind, place) => {
  if (kind === 'championship' && place === 1)
    return h('span', {class: 'spectator-award-trophy', role: 'img',
      'aria-label': 'Champion, first place', title: 'Champion · 1st place', text: '🏆'});
  const gold = place === 1;
  return h('span', {class: 'spectator-award-disc ' + (gold ? 'gold' : 'silver'),
    role: 'img', 'aria-label': gold ? 'Gold medal, first place' : 'Silver medal, runner-up',
    title: gold ? 'Gold medal · 1st place' : 'Silver medal · 2nd place',
    text: gold ? '1' : '2'});
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
      formatLine(m) ? h('span', {class: 'spectator-now-format', text: formatLine(m)}) : null));
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
function finaleCard(f) {
  return h('div', {class: 'card spectator-finale'}, h('h2', {text: 'Mixed-Skill Doubles finale'}),
    h('div', {class: 'grid two'}, h('div', {class: 'stat ice'}, h('b', {text: 'Team A'}), h('span', {text: f.team1.join(' + ')})), h('div', {class: 'stat lav'}, h('b', {text: 'Team B'}), h('span', {text: f.team2.join(' + ')}))),
    f.bestOf && f.points ? h('p', {class: 'fmt-line', text: `Best of ${f.bestOf} · to ${f.points}`}) : null,
    f.winnerTeam ? h('div', {class: 'notice good'}, h('p', {text: `Winners: ${(f.winnerTeam === 1 ? f.team1 : f.team2).join(' + ')}`}),
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
    h('div', {class: 'spectator-result-scorebox'},
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

function viewResults(ev, board, feedState) {
  const st = standings(ev);
  const championship = board.recent.filter(m => m.bracket === 'championship');
  const consolation = board.recent.filter(m => m.bracket === 'consolation');
  return h('div', {class: 'spectator-results'},
    st.champion ? h('div', {class: 'champion-banner spectator-winners-banner'},
      h('h2', {}, awardMark('championship', 1), h('span', {text: `Champion: ${st.champion}`})),
      h('p', {}, awardMark('championship', 2), h('span', {text: `Runner-up: ${st.runnerUp}`})),
      st.consolationChampion ? h('p', {}, awardMark('consolation', 1),
        h('span', {text: `Consolation bracket champion: ${st.consolationChampion}`})) : null,
      st.consolationRunnerUp ? h('p', {}, awardMark('consolation', 2),
        h('span', {text: `Consolation bracket runner-up: ${st.consolationRunnerUp}`})) : null,
      st.doubles ? h('div', {class: 'spectator-winners-doubles'},
        h('p', {}, h('span', {text: 'Mixed-Skill Doubles winners: '}),
          ...st.doubles.winners.map(name => h('span', {class: 'spectator-awarded-name'},
            h('span', {text: name}), awardMark('doubles', 1)))),
        h('p', {}, h('span', {text: 'Mixed-Skill Doubles runners-up: '}),
          ...st.doubles.losers.map(name => h('span', {class: 'spectator-awarded-name'},
            h('span', {text: name}), awardMark('doubles', 2))))) : null) : null,
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
