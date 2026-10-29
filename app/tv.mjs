/** TV / projector board: anonymous, read-only, large type, no controls. Freshness is always shown;
 * stale information is labelled, and removed entirely after two minutes without a good read. */
import {h, clear, fill, $} from './dom.mjs';
import {startPublicFeed, pickEvent} from './public_core.mjs';
import {deriveBoard} from '../contracts/gameday_public.mjs';
import {bracketView} from './bracket_view.mjs';
import {computeStandings} from '../contracts/gameday_engine.mjs';

const wanted = new URLSearchParams(location.search).get('e');
const ROTATE_MS = 15000;
let rot = 0, rotAt = Date.now();
const line = (m, big = false) => h('div', {class: 'tv-line'},
  m.table ? h('span', {class: 'tbl', text: `Table ${m.table} · `}) : null, `${m.name1} vs ${m.name2}`,
  h('small', {text: m.status === 'complete' ? `${m.winnerName} won ${m.scores}` : `${m.bracket === 'championship' ? 'Championship' : 'Consolation'} · Round ${m.round + 1}`},
    m.bestOf && m.points ? h('span', {class: 'fmt', text: `Best of ${m.bestOf} · to ${m.points}`}) : null));

function standings(ev) {
  const matches = [...ev.championship.map(m => ({...m, bracket: 'championship'})), ...ev.consolation.map(m => ({...m, bracket: 'consolation'}))]
    .map(m => ({bracket: m.bracket, round: m.round, slot: m.slot, status: m.status, p1: m.name1, p2: m.name2, winner: m.winnerName}));
  return computeStandings({matches, finale: ev.finale ? {team1: ev.finale.team1, team2: ev.finale.team2, winnerTeam: ev.finale.winnerTeam} : null});
}
function render(view) {
  const flag = $('live');
  if (view.state === 'current') { flag.className = 'live-flag'; flag.textContent = 'LIVE'; }
  else if (view.state === 'stale') { flag.className = 'stale-flag'; flag.textContent = `OUT OF DATE · ${Math.round(view.ageMs / 1000)}s`; }
  else { flag.className = 'stale-flag'; flag.textContent = 'NO CURRENT DATA'; }
  const main = $('main');
  const ev = pickEvent(view.events, wanted);
  if (!ev) { fill(main, h('div', {class: 'tv-card'}, h('h2', {text: view.state === 'empty' ? 'Waiting for the tournament feed' : 'No event is public yet'}))); return; }
  $('evName').textContent = ev.name;
  const board = deriveBoard(ev), st = standings(ev);
  if (Date.now() - rotAt > ROTATE_MS) { rot++; rotAt = Date.now(); }
  const slides = [];
  if (ev.championship.length) slides.push(['Championship bracket', bracketView(ev.championship, 'championship')]);
  if (ev.consolation.length) slides.push(['Consolation bracket', bracketView(ev.consolation, 'consolation')]);
  if (ev.finale) slides.push(['Mixed-Skill Doubles finale', h('div', {}, h('div', {class: 'tv-line', text: `Team A: ${ev.finale.team1.join(' + ')}`}), h('div', {class: 'tv-line', text: `Team B: ${ev.finale.team2.join(' + ')}`}),
    ev.finale.winnerTeam ? h('div', {class: 'champ', text: `Winners: ${(ev.finale.winnerTeam === 1 ? ev.finale.team1 : ev.finale.team2).join(' + ')}`}) : null)]);
  const slide = slides.length ? slides[rot % slides.length] : null;
  fill(main,
    st.champion ? h('div', {class: 'tv-card'}, h('h2', {text: 'Champion'}), h('div', {class: 'champ', text: st.champion}), h('div', {text: `Runner-up: ${st.runnerUp}`}),
      st.consolationChampion ? h('div', {text: `Consolation champion: ${st.consolationChampion}`}) : null) : null,
    h('div', {class: 'tv-cols'},
      h('div', {}, h('div', {class: 'tv-card'}, h('h2', {text: 'Now playing'}), board.playing.length ? board.playing.map(m => line(m)) : h('div', {class: 'tv-line', text: 'No matches on a table'})),
        h('div', {class: 'tv-card'}, h('h2', {text: 'Up next'}), board.upNext.length ? board.upNext.slice(0, 6).map(m => line(m)) : h('div', {class: 'tv-line', text: 'Nothing queued'}))),
      h('div', {}, h('div', {class: 'tv-card'}, h('h2', {text: 'Latest results'}), board.recent.length ? board.recent.slice(0, 6).map(m => line(m)) : h('div', {class: 'tv-line', text: 'No results yet'})))),
    slide ? h('div', {class: 'tv-card'}, h('h2', {text: slide[0]}), slide[1]) : null);
}
startPublicFeed({onUpdate: render});
