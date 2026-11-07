/** Anonymous, read-only TV presentation. The public feed remains the sole source of data. */
import {h, fill, $} from './dom.mjs';
import {startPublicFeed, pickEvent} from './public_core.mjs';
import {deriveBoard} from '../contracts/gameday_public.mjs';
import {roundName, normalizeGameScores} from '../contracts/gameday_engine.mjs';
import {parseGames} from './game_tiles.mjs';

const wanted = new URLSearchParams(location.search).get('e');
const durations = {match: 30000, results: 12000, championship: 18000, consolation: 18000};
const labels = {match: 'MATCH CENTER', results: 'COMPLETED RESULTS', championship: 'CHAMPIONSHIP BRACKET', consolation: 'CONSOLATION BRACKET'};
let view, event, board, screen = 'match', paused = false, deadline = Date.now() + durations.match, signature = '', lastRenderedState = '', segment = 0;
const bracketLabel = m => `${m.bracket === 'championship' ? 'Championship' : 'Consolation'} Bracket`;
const roundLabel = (m, ev) => roundName(Math.max(...ev[m.bracket].map(x => x.round), 0) + 1, m.round, m.bracket);
const details = (m, ev) => [bracketLabel(m), roundLabel(m, ev), m.bestOf ? `Best of ${m.bestOf}` : null].filter(Boolean).join(' · ');
const name = n => n || 'To be determined';
function tally(m) {
  // This contract only publishes final results. Never treat a pending score as live progress.
  if (m.status !== 'complete' || !m.bestOf || !m.points || !m.winnerName || !m.scores) return null;
  const parsed = parseGames(m.scores);
  if (!parsed?.length || !normalizeGameScores(m.scores, m.bestOf, m.winnerName === m.name1, m.points).ok) return null;
  return [parsed.filter(g => g.a > g.b).length, parsed.filter(g => g.b > g.a).length];
}
function games(m) {
  const t = tally(m);
  return t ? parseGames(m.scores).map((g, i) => `G${i + 1} ${g.a}–${g.b}`).join('   ·   ') : (m.scores === 'W/O' ? 'Walkover' : m.status === 'complete' && m.scores && (!m.bestOf || !m.points) ? `Recorded: ${m.scores}` : 'Game scores unavailable');
}
function liveGameProgress(m) {
  if (view?.state === 'expired' || view?.state === 'invalid') return h('div', {class: 'score-pending', text: 'Progress unavailable'});
  if (m.progress === undefined) return h('div', {class: 'score-pending', text: 'Game scores pending'});
  if (m.progress === null) return h('div', {class: 'score-pending', text: 'Awaiting Game 1'});
  const {games, won, decided} = m.progress;
  return h('div', {class: 'score-pending live-game-progress'},
    h('span', {class: 'tiny-label', text: view?.state === 'stale' ? 'LAST CONFIRMED · OUT OF DATE' : 'CONFIRMED GAMES WON'}),
    h('strong', {text: won.join('–')}),
    h('span', {class: 'game-lines', text: games.map((g, i) => `G${i + 1} ${g[0]}–${g[1]}`).join('  ·  ')}),
    h('span', {class: 'tiny-label', text: decided ? 'AWAITING OFFICIAL MATCH CONFIRMATION' : `GAME ${games.length + 1} NEXT`}));
}
function tableCard(table) {
  const m = board.playing.find(x => x.table === table);
  return h('article', {class: 'table-card' + (m ? ' active' : '')},
    h('div', {class: 'card-top'}, h('span', {class: 'table-label', text: `TABLE ${table}`}), h('span', {class: 'status-label', text: m ? '●  NOW PLAYING' : 'AVAILABLE'})),
    m ? h('div', {class: 'match-content'}, h('div', {class: 'players'}, h('div', {class: 'player-name', text: name(m.name1)}), h('div', {class: 'versus', text: 'VS'}), h('div', {class: 'player-name', text: name(m.name2)})),
      liveGameProgress(m),
      h('div', {class: 'match-meta', text: details(m, event)})) : h('div', {class: 'empty-table'}, h('strong', {text: 'Table open'}), h('span', {text: 'Waiting for the next match'})));
}
function matchCenter() {
  return h('div', {class: 'match-center'}, h('section', {class: 'now-section'}, h('div', {class: 'section-heading'}, h('h2', {text: 'Now Playing'}), h('span', {text: 'LIVE TABLES'})), h('div', {class: 'table-grid'}, tableCard(1), tableCard(2))),
    h('section', {class: 'next-section'}, h('div', {class: 'section-heading'}, h('h2', {text: 'Up Next'}), h('span', {text: 'MATCH QUEUE'})),
      board.upNext.length ? h('div', {class: 'next-grid'}, board.upNext.slice(0, 4).map(m => h('article', {class: 'next-card'}, h('div', {class: 'next-names'}, h('span', {text: name(m.name1)}), h('span', {class: 'next-vs', text: 'vs'}), h('span', {text: name(m.name2)})), h('div', {class: 'next-meta', text: `${details(m, event)} · ${m.table ? `Table ${m.table}` : 'Table to be assigned'}`})))) : h('div', {class: 'next-empty', text: 'Upcoming matches will appear here when announced.'})));
}
function champion(kind) {
  const ms = event[kind]; if (!ms.length) return null;
  const lastRound = Math.max(...ms.map(m => m.round));
  const m = ms.find(x => x.round === lastRound && x.slot === 0 && x.status === 'complete' && x.winnerName && x.name1 && x.name2);
  return m ? {winner: m.winnerName, runner: m.winnerName === m.name1 ? m.name2 : m.name1} : null;
}
function results() {
  const c = champion('championship'), k = champion('consolation');
  const doubles = event.finale?.status === 'complete' && event.finale.winnerTeam ? (event.finale.winnerTeam === 1 ? event.finale.team1 : event.finale.team2).join(' + ') : null;
  return h('div', {class: 'results-view'}, (c || k || doubles) ? h('div', {class: 'champions'}, c ? h('div', {}, h('span', {text: 'CHAMPIONSHIP CHAMPION'}), h('strong', {text: c.winner}), h('small', {text: `Runner-up · ${c.runner}`})) : null, k ? h('div', {}, h('span', {text: 'CONSOLATION CHAMPION'}), h('strong', {text: k.winner})) : null, doubles ? h('div', {}, h('span', {text: 'MIXED-SKILL DOUBLES WINNERS'}), h('strong', {text: doubles})) : null) : null,
    h('div', {class: 'results-grid'}, board.recent.slice(0, 6).map(m => { const t = tally(m); return h('article', {class: 'result-card'}, h('div', {class: 'result-top', text: `${bracketLabel(m)} · ${roundLabel(m, event)}${m.table ? ` · Table ${m.table}` : ''}`}), h('div', {class: 'result-body'}, h('div', {class: 'result-players'}, h('div', {class: m.winnerName === m.name1 ? 'winner' : '', text: name(m.name1)}), h('div', {class: m.winnerName === m.name2 ? 'winner' : '', text: name(m.name2)})), h('div', {class: 'result-tally', text: t ? `${t[0]}–${t[1]}` : '—'})), h('div', {class: 'result-games', text: games(m)})); })));
}
function bracketWindows(ms) {
  const rounds = [...new Set(ms.map(m => m.round))].sort((a, b) => a - b);
  const windows = [];
  for (let i = 0; i < rounds.length; i += 3) {
    const group = rounds.slice(i, i + 3), first = group[0];
    const maxSlot = Math.max(...ms.filter(m => m.round === first).map(m => m.slot));
    for (let page = 0; page <= Math.floor(maxSlot / 4); page++) windows.push({rounds: group, first, page});
  }
  return windows;
}
function bracket(kind) {
  const ms = event[kind].filter(m => m.status !== 'empty');
  const totalRounds = Math.max(...ms.map(m => m.round)) + 1;
  // Window each group of rounds independently, avoiding repeated final rounds in large brackets.
  const windows = bracketWindows(ms), pages = windows.length;
  const {rounds, first: firstRound, page} = windows[Math.min(segment, pages - 1)];
  const champ = champion(kind);
  return h('div', {class: 'bracket-view' + (kind === 'consolation' && ms.length === 1 ? ' single-match' : '')}, h('div', {class: 'bracket-caption'}, h('span', {text: pages > 1 ? `BRACKET SEGMENT ${segment + 1} / ${pages}` : 'TOURNAMENT PROGRESSION'}), champ ? h('strong', {text: `CHAMPION  ·  ${champ.winner}`}) : null),
    h('div', {class: 'bracket-columns'}, rounds.map(r => { const factor = 2 ** (r - firstRound); const selected = ms.filter(m => m.round === r && m.slot >= Math.floor(page * 4 / factor) && m.slot <= Math.floor((page * 4 + 3) / factor)); return h('div', {class: 'bracket-round'}, h('div', {class: 'round-heading', text: roundName(totalRounds, r, kind)}), h('div', {class: 'bracket-matches'}, selected.map(m => h('article', {class: `bracket-match ${m.phase === 'playing' ? 'playing' : ''}`, 'data-round': m.round, 'data-slot': m.slot}, h('div', {class: 'bracket-state', text: m.status === 'bye' ? 'BYE' : m.status === 'complete' ? 'COMPLETED' : m.phase === 'playing' ? 'NOW PLAYING' : 'UPCOMING'}), [m.name1, m.name2].map(n => h('div', {class: 'bracket-player' + (n && n === m.winnerName ? ' winner' : ''), text: name(n)})), m.status === 'complete' && m.scores ? h('div', {class: 'bracket-scores', text: games(m)}) : null)))); })));
}
function drawConnections() {
  const columns = document.querySelector('.bracket-columns');
  if (!columns) return;
  const bounds = columns.getBoundingClientRect();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'bracket-connectors'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  const rounds = [...columns.querySelectorAll('.bracket-round')];
  for (let i = 0; i < rounds.length - 1; i++) {
    const next = [...rounds[i + 1].querySelectorAll('.bracket-match')];
    for (const card of rounds[i].querySelectorAll('.bracket-match')) {
      const target = next.find(n => Number(n.dataset.round) === Number(card.dataset.round) + 1 && Number(n.dataset.slot) === Math.floor(Number(card.dataset.slot) / 2));
      if (!target) continue;
      const a = card.getBoundingClientRect(), b = target.getBoundingClientRect();
      const x1 = a.right - bounds.left, y1 = a.top + a.height / 2 - bounds.top;
      const x2 = b.left - bounds.left, y2 = b.top + b.height / 2 - bounds.top, mid = (x1 + x2) / 2;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`); svg.append(line);
    }
  }
  columns.prepend(svg);
}
function available() {
  const slides = ['match']; if (!event) return slides;
  if (board.recent.length || champion('championship') || champion('consolation') || (event.finale?.status === 'complete' && event.finale.winnerTeam)) slides.push('results');
  for (const k of ['championship', 'consolation']) if (event[k].some(m => m.status !== 'empty' && (m.name1 || m.name2))) slides.push(k);
  return slides;
}
function render() {
  $('screenLabel').textContent = labels[screen];
  $('evName').textContent = event?.name || 'Tournament Games';
  $('evDate').textContent = event ? new Date(`${event.date}T12:00:00Z`).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'}) : '';
  if (!event) { fill($('main'), h('div', {class: 'waiting'}, h('div', {class: 'eyebrow', text: 'FFTT GAMES'}), h('h2', {text: 'The tournament board is standing by'}), h('p', {text: 'Matchups and results will appear here when available.'}))); return; }
  fill($('main'), screen === 'match' ? matchCenter() : screen === 'results' ? results() : bracket(screen));
  drawConnections();
}
function select(next) { if (!available().includes(next)) return; screen = next; segment = 0; deadline = Date.now() + durations[screen]; render(); }
function move(dir) { const slides = available(), index = slides.indexOf(screen); select(slides[(index + dir + slides.length) % slides.length]); }
function toggle() { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; if (!paused) deadline = Date.now() + durations[screen]; }
$('prev').addEventListener('click', () => move(-1)); $('next').addEventListener('click', () => move(1)); $('pause').addEventListener('click', toggle);
document.querySelectorAll('[data-screen]').forEach(b => b.addEventListener('click', () => select(b.dataset.screen)));
window.addEventListener('resize', () => { document.querySelector('.bracket-connectors')?.remove(); drawConnections(); });
document.addEventListener('keydown', e => { if (e.target.tagName === 'BUTTON') return; if (e.key === 'ArrowRight') move(1); else if (e.key === 'ArrowLeft') move(-1); else if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === '1') select('match'); else if (e.key === '2') select('results'); else if (e.key === '3') select('championship'); else if (e.key === '4') select('consolation'); });
setInterval(() => { if (paused || Date.now() < deadline) return; if (screen === 'championship' || screen === 'consolation') { const ms = event?.[screen] || []; const pages = bracketWindows(ms.filter(m => m.status !== 'empty')).length;  if (segment + 1 < pages) { segment++; deadline = Date.now() + durations[screen]; render(); return; } } move(1); }, 250);
startPublicFeed({onUpdate(next) { view = next; const flag = $('live'); flag.className = `feed-status ${view.state}`; flag.textContent = view.state === 'current' ? '●  LIVE' : view.state === 'stale' ? `OUT OF DATE · ${Math.round(view.ageMs / 1000)}s` : 'NO CURRENT DATA';
  const picked = pickEvent(view.events, wanted); const nextSignature = JSON.stringify(picked); if (nextSignature === signature && lastRenderedState === view.state) return; signature = nextSignature; lastRenderedState = view.state; event = picked; board = event ? deriveBoard(event) : null; if (event && (screen === 'championship' || screen === 'consolation')) segment = Math.min(segment, Math.max(0, bracketWindows(event[screen].filter(m => m.status !== 'empty')).length - 1)); if (!available().includes(screen)) { screen = 'match'; segment = 0; deadline = Date.now() + durations.match; } render(); }});
