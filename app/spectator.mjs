/** Anonymous spectator view: no sign-in, no e-mail, no storage. Names, tables and results only. */
import {h, clear, fill, $} from './dom.mjs';
import {startPublicFeed, pickEvent} from './public_core.mjs';
import {deriveBoard} from '../contracts/gameday_public.mjs';
import {bracketView} from './bracket_view.mjs';
import {computeStandings} from '../contracts/gameday_engine.mjs';

let tab = 'now', last = null, wanted = new URLSearchParams(location.search).get('e');
const TABS = [['now', 'Now & next'], ['bracket', 'Bracket'], ['results', 'Results']];

function standings(ev) {
  const matches = [...ev.championship.map(m => ({...m, bracket: 'championship'})), ...ev.consolation.map(m => ({...m, bracket: 'consolation'}))]
    .map(m => ({bracket: m.bracket, round: m.round, slot: m.slot, status: m.status, p1: m.name1, p2: m.name2, winner: m.winnerName}));
  const f = ev.finale;
  return computeStandings({matches, finale: f ? {team1: f.team1, team2: f.team2, winnerTeam: f.winnerTeam} : null});
}
const formatLine = m => (m?.bestOf && m?.points ? `Best of ${m.bestOf} · to ${m.points}` : '');
const matchCard = m => h('div', {class: 'board-match'},
  m.table ? h('div', {class: 'tbl', text: `Table ${m.table}`}) : null,
  h('div', {class: 'names', text: `${m.name1} vs ${m.name2}`}),
  h('div', {class: 'muted', text: `${m.bracket === 'championship' ? 'Championship' : 'Consolation'} · Round ${m.round + 1}`}),
  formatLine(m) ? h('div', {class: 'fmt-line', text: formatLine(m)}) : null);

function viewNow(ev, board) {
  return h('div', {},
    h('h2', {text: 'Now playing'}),
    board.playing.length ? h('div', {class: 'now-grid'}, board.playing.map(matchCard)) : h('div', {class: 'empty-state', text: 'No matches are on a table right now.'}),
    h('h2', {text: 'Up next'}),
    board.upNext.length ? h('div', {class: 'now-grid'}, board.upNext.slice(0, 8).map(matchCard)) : h('div', {class: 'empty-state', text: 'Nothing queued yet.'}),
    ev.finale ? finaleCard(ev.finale) : null);
}
function finaleCard(f) {
  return h('div', {class: 'card'}, h('h2', {text: 'Mixed-Skill Doubles finale'}),
    h('div', {class: 'grid two'}, h('div', {class: 'stat ice'}, h('b', {text: 'Team A'}), h('span', {text: f.team1.join(' + ')})), h('div', {class: 'stat lav'}, h('b', {text: 'Team B'}), h('span', {text: f.team2.join(' + ')}))),
    f.bestOf && f.points ? h('p', {class: 'fmt-line', text: `Best of ${f.bestOf} · to ${f.points}`}) : null,
    f.winnerTeam ? h('div', {class: 'notice good', text: `Winners: ${(f.winnerTeam === 1 ? f.team1 : f.team2).join(' + ')}${f.scores ? ' · ' + f.scores : ''}`}) : h('p', {class: 'muted', text: 'Coming up after the championship final.'}));
}
function viewBracket(ev) {
  return h('div', {},
    h('div', {class: 'card'}, h('h2', {text: 'Championship'}),
      h('p', {class: 'help bracket-hint', text: 'Swipe sideways within the bracket to see later rounds.'}),
      bracketView(ev.championship, 'championship')),
    ev.consolation.length ? h('div', {class: 'card'}, h('h2', {text: 'Consolation'}),
      h('p', {class: 'help bracket-hint', text: 'Swipe sideways within the bracket to see later rounds.'}),
      bracketView(ev.consolation, 'consolation')) : null);
}
function viewResults(ev, board) {
  const st = standings(ev);
  return h('div', {},
    st.champion ? h('div', {class: 'champion-banner'}, h('h2', {text: `Champion: ${st.champion}`}), h('p', {text: `Runner-up: ${st.runnerUp}`}),
      st.consolationChampion ? h('p', {text: `Consolation champion: ${st.consolationChampion}`}) : null,
      st.doubles ? h('p', {text: `Doubles winners: ${st.doubles.winners.join(' + ')}`}) : null) : null,
    h('div', {class: 'card'}, h('h2', {text: 'Completed matches'}),
      board.recent.length ? h('table', {}, h('tbody', {}, board.recent.map(m => h('tr', {}, h('td', {text: m.bracket === 'championship' ? 'Champ.' : 'Cons.'}),
        h('td', {text: `${m.name1} vs ${m.name2}`}), h('td', {text: `${m.winnerName} won`}), h('td', {class: 'mono', text: m.scores}))))) : h('div', {class: 'empty-state', text: 'No results yet.'})));
}

function render(view) {
  const live = $('live');
  const events = view.events;
  const ev = pickEvent(events, wanted);
  if (view.state === 'empty') { live.className = 'pill warn'; live.textContent = 'Waiting for the feed…'; }
  else if (view.state === 'stale') { live.className = 'pill bad'; live.textContent = `Out of date · last update ${Math.round(view.ageMs / 1000)}s ago`; }
  else if (!ev) { live.className = 'pill warn'; live.textContent = 'No public event'; }
  else { live.className = 'pill good'; live.textContent = 'Live'; }
  const pick = $('evPick');
  pick.hidden = events.length < 2;
  if (!pick.hidden) { clear(pick); for (const e of events) pick.append(h('option', {value: e.id, text: e.name, selected: e.id === ev?.id})); }
  clear($('tabs'));
  for (const [id, text] of TABS) $('tabs').append(h('button', {type: 'button', text, 'aria-current': id === tab ? 'page' : null, on: {click: () => { tab = id; render(last); }}}));
  const main = $('main');
  if (!ev) {
    clear(main);
    $('evName').textContent = 'Forging Fellowship Table Tennis Games';
    $('evMeta').textContent = '';
    main.append(h('div', {class: 'empty-state', text: view.state === 'empty' ? 'The bracket is not available right now. This page checks again automatically.' : 'No event is public yet. Check back soon.'}));
    return;
  }
  $('evName').textContent = ev.name;
  $('evMeta').textContent = `${ev.date} · ${ev.status === 'complete' ? 'Final results' : 'In progress'}`;
  const board = deriveBoard(ev);
  fill(main, view.state === 'stale' ? h('div', {class: 'notice warn', text: 'The connection dropped. This is the last information received — it may be out of date.'}) : null,
    tab === 'now' ? viewNow(ev, board) : tab === 'bracket' ? viewBracket(ev) : viewResults(ev, board));
}
$('evPick').addEventListener('change', e => { wanted = e.target.value; render(last); });
startPublicFeed({onUpdate: v => { last = v; render(v); }});
