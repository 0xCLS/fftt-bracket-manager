/** Anonymous, read-only TV presentation. The public feed remains the sole source of data. */
import {h, fill, $} from './dom.mjs';
import {startPublicFeed, pickEvent, isShowcase} from './public_core.mjs';
import {deriveBoard} from '../contracts/gameday_public.mjs';
import {roundName, normalizeGameScores, formatLabel} from '../contracts/gameday_engine.mjs';
import {parseGames} from './game_tiles.mjs';

const wanted = new URLSearchParams(location.search).get('e');
// The broadcast has exactly two screens. Brackets stay on the Spectator website.
const durations = {match: 30000, results: 12000};
const labels = {match: 'MATCH CENTER', results: 'RESULTS'};
let view, event, board, screen = 'match', paused = false, deadline = Date.now() + durations.match, signature = '', lastRenderedState = '';
const bracketLabel = m => `${m.bracket === 'championship' ? 'Championship' : 'Consolation'} Bracket`;
const roundLabel = (m, ev) => roundName(Math.max(...ev[m.bracket].map(x => x.round), 0) + 1, m.round, m.bracket);
const details = (m, ev) => [bracketLabel(m), roundLabel(m, ev), m.bestOf && m.points ? formatLabel({bestOf: m.bestOf, points: m.points}) : null].filter(Boolean).join(' · ');
const name = n => n || 'To be determined';
function tally(m) {
  // This contract only publishes final results. Never treat a pending score as live progress.
  if (m.status !== 'complete' || !m.bestOf || !m.points || !m.winnerName || !m.scores) return null;
  const parsed = parseGames(m.scores);
  if (!parsed?.length || !normalizeGameScores(m.scores, m.bestOf, m.winnerName === m.name1, m.points).ok) return null;
  return [parsed.filter(g => g.a > g.b).length, parsed.filter(g => g.b > g.a).length];
}
/** Dots use validated saved games for active matches and official final scores for completed matches. */
function winDots(m, player) {
  if (m.bestOf !== 3) return null;
  const active = m.phase === 'playing' && m.status === 'pending'
    && view && (view.state === 'current' || view.state === 'stale') && m.progress?.games?.length;
  const wins = active ? m.progress.won : tally(m);
  if (!wins) return null;
  const n = wins[player];
  const qualifier = active ? (view.state === 'stale' ? 'last confirmed, out of date' : 'confirmed while match is active') : 'verified final';
  return h('span', {class:'game-win-dots',role:'img',
    'aria-label': `${name(player === 0 ? m.name1 : m.name2)}: ${n} ${qualifier} game win${n === 1 ? '' : 's'}`},
    Array.from({length:3}, (_,i)=>h('span',{class:'win-dot' + (i<n ? ' earned' : ''),'aria-hidden':'true'})));
}
function games(m) {
  const t = tally(m);
  return t ? parseGames(m.scores).map((g, i) => `G${i + 1} ${g.a} - ${g.b}`).join('   ·   ') : (m.scores === 'W/O' ? 'Walkover' : m.status === 'complete' && m.scores && (!m.bestOf || !m.points) ? `Recorded: ${m.scores}` : 'Game scores unavailable');
}

const TABLE_WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];
const tableWord = number => TABLE_WORDS[number] || String(number);
/** Tables the event is configured for (the public feed validates 1-12). */
const tableTotal = ev => Math.min(12, Math.max(1, Number(ev?.tables) || 2));
const matchFormat = m => {
  const format = m.bestOf === 3 ? 'BEST OF THREE' : m.bestOf === 1 ? 'SINGLE GAME' : m.bestOf ? 'BEST OF ' + m.bestOf : 'MATCH FORMAT PENDING';
  return m.bestOf && m.points ? `${format} · TO ${m.points}` : format;
};
function liveGameProgress(m) {
  if (m.status !== 'pending' || m.phase !== 'playing' ||
      !m.progress?.games?.length || !['current','stale'].includes(view?.state)) return null;
  const {games, won, decided} = m.progress;
  return h('div',{class:'live-game-progress',role:'status','aria-live':'polite'},
    h('span',{class:'progress-kicker',text:view.state === 'stale' ? 'LAST CONFIRMED · OUT OF DATE' : 'CONFIRMED GAMES'}),
    h('strong',{class:'progress-tally',text:won.join('–')}),
    h('span',{class:'progress-lines',text:games.map((g,i)=>`G${i+1} ${g[0]}–${g[1]}`).join('  ·  ')}),
    h('span',{class:'progress-next',text:decided ? 'AWAITING OFFICIAL MATCH CONFIRMATION' : `GAME ${games.length+1} NEXT`}));
}

function tablePlayerName(raw) {
  const full=name(raw), parts=full.trim().split(/\s+/);
  const stacked=parts.length>1 && raw && !/^to be determined$/i.test(full);
  return h('div',{class:'player-name'+(stacked?' stacked':''),'aria-label':full},
    stacked
      ? [h('span',{class:'player-first',text:parts[0]+' '}),h('span',{class:'player-last',text:parts.slice(1).join(' ')})]
      : h('span',{class:'player-full',text:full}));
}
function tableCard(table, total) {
  const m=board.playing.find(x=>x.table===table), sample=isShowcase(event);
  const outLabel=h('div',{class:'table-outside-label','aria-label':'Table '+table},
    h('strong',{class:'table-outside-number',text:'0'+table}),
    h('span',{class:'table-outside-word',text:'TABLE '+tableWord(table)}));
  const panel=h('article',{class:'table-card broadcast-match'+(m?' active':''),'data-table':'0'+table},
    h('div',{class:'card-top'},
      h('span',{class:'match-round',text:m?bracketLabel(m)+' · '+roundLabel(m,event):'TABLE AVAILABLE'}),
      h('span',{class:'status-label',text:m?(sample?'● SAMPLE MATCH':'● NOW PLAYING'):'AVAILABLE'})),
    m?h('div',{class:'match-content'},
      h('div',{class:'players'},
        h('div',{class:'match-player'},tablePlayerName(m.name1),winDots(m,0)),
        h('div',{class:'versus-line'},h('span',{class:'versus',text:'VS'})),
        h('div',{class:'match-player'},tablePlayerName(m.name2),winDots(m,1))),
      liveGameProgress(m),
      h('div',{class:'match-meta',text:matchFormat(m)}))
    :h('div',{class:'empty-table'},h('strong',{text:'Table open'}),h('span',{text:'Waiting for the next match'})));
  // Two-table events keep the approved side labels (outer edges); three or more put each label above its card.
  return h('div',{class:'table-stage table-stage-'+table+' accent-'+((table-1)%3)},
    ...(total===2 && table===2?[panel,outLabel]:[outLabel,panel]));
}

function matchCenter() {
  const total = tableTotal(event);
  const tables = Array.from({length: total}, (_, i) => i + 1);
  const playing = board.playing.filter(m => m.table >= 1 && m.table <= total).length;
  const tableLabel = `${tableWord(total)} TABLE${total === 1 ? '' : 'S'}`;
  return h('div',{class:'match-center broadcast-match-center' + (total >= 3 ? ' multi-table' : ''),'data-tables':total},
    h('div',{class:'match-status-rail'},
      h('span',{class:'section-heading'}, h('span',{text:isShowcase(event) ? 'Sample Matches' : 'MATCH CENTER'})),
      h('span',{class:'status-count',text:isShowcase(event) ? 'FICTIONAL SHOWCASE · DEMO TABLES' : `● ${tableLabel} · ${playing} ${playing === 1 ? 'MATCH' : 'MATCHES'}`})),
    h('section',{class:'now-section'},h('div',{class:'table-grid','data-tables':total},tables.map(t => tableCard(t, total)))),
    h('section',{class:'next-section'},
      h('div',{class:'queue-banner'},h('strong',{text:'UP NEXT'}),h('small',{text:'ON DECK'})),
      board.upNext.length ? h('div',{class:'next-grid'},board.upNext.slice(0,3).map(m =>
        h('article',{class:'next-card'},
          h('div',{class:'next-meta',text:bracketLabel(m) + ' · ' + roundLabel(m,event)}),
          h('div',{class:'next-names'},h('span',{text:name(m.name1)}),h('span',{class:'next-vs',text:'vs'}),h('span',{text:name(m.name2)})))))
      : h('div',{class:'next-empty',text:'Upcoming matches will appear here when announced.'})));
}

function champion(kind) {
  const ms = event[kind]; if (!ms.length) return null;
  const lastRound = Math.max(...ms.map(m => m.round));
  const m = ms.find(x => x.round === lastRound && x.slot === 0 && x.status === 'complete' && x.winnerName && x.name1 && x.name2);
  return m ? {winner: m.winnerName, runner: m.winnerName === m.name1 ? m.name2 : m.name1} : null;
}

function results() {
  const c=champion('championship'),k=champion('consolation');
  const doubles=event.finale?.status === 'complete' && event.finale.winnerTeam ? (event.finale.winnerTeam === 1 ? event.finale.team1 : event.finale.team2).join(' + ') : null;
  const ordered=board.recent.slice(0,4);
  // Prefer a verified close final for the featured broadcast story; do not imply recency.
  const featured=ordered.find(m=>{const t=tally(m);return m.bestOf===3 && t && t[0]+t[1]===3;}) || ordered[0];
  const recent=featured ? [featured,...ordered.filter(m=>m!==featured)] : ordered;
  return h('div',{class:'results-view cinematic-results'},
    h('div',{class:'broadcast-title'},
      h('div',{},h('span',{class:'title-kicker',text:'OFFICIAL FINAL SCORES'}),
        h('h2',{},h('span',{text:'THE RESULT '}),h('em',{text:'IS IN'}))),
      h('span',{class:'title-side',text:'RECORDED · VERIFIED · FINAL'})),
    (c || k || doubles) ? h('div',{class:'champions'},
      c ? h('div',{},h('span',{text:'CHAMPIONSHIP CHAMPION'}),h('strong',{text:c.winner}),h('small',{text:'Runner-up · '+c.runner})) : null,
      k ? h('div',{},h('span',{text:'CONSOLATION CHAMPION'}),h('strong',{text:k.winner})) : null,
      doubles ? h('div',{},h('span',{text:'MIXED-SKILL DOUBLES WINNERS'}),h('strong',{text:doubles})) : null) : null,
    h('div',{class:'results-grid','data-rows':Math.min(3,Math.max(1,Math.ceil(recent.length/2)))},
      recent.map((m,i)=>{
        const t=tally(m);
        return h('article',{class:'result-card' + (i === 0 ? ' lead-result' : '')},
          h('div',{class:'result-top'},
            h('span',{text:i === 0 ? (m === board.recent[0] ? '✓ JUST FINISHED · ' : '★ FEATURED FINAL · ') + bracketLabel(m) + ' · ' + roundLabel(m,event) : bracketLabel(m) + ' · ' + roundLabel(m,event)}),
            h('span',{class:'result-final',text:'FINAL'})),
          h('div',{class:'result-body'},
            h('div',{class:'result-players'},
              [m.name1,m.name2].map((n,index)=>
                h('div',{class:'result-player' + (n && n === m.winnerName ? ' winner' : '')},
                  i === 0 ? h('span',{class:'result-role',text:n && n === m.winnerName ? 'WINNER' : 'RUNNER-UP'}) : null,
                  h('span',{class:'result-player-name',text:name(n)}),
                  winDots(m,index)))),
            h('div',{class:'result-score'},
              h('span',{class:'score-caption',text:i === 0 ? 'FINAL · BEST OF ' + (m.bestOf || '—') : 'GAMES'}),
              h('div',{class:'result-tally',text:t ? t[0] + ' - ' + t[1] : '—'}))),
          h('div',{class:'result-games',text:games(m)}));
      })));
}

function available() {
  const slides = ['match']; if (!event) return slides;
  if (board.recent.length || champion('championship') || champion('consolation') || (event.finale?.status === 'complete' && event.finale.winnerTeam)) slides.push('results');
  return slides;
}
function render() {
  $('screenLabel').textContent = labels[screen];
  document.body.dataset.broadcastScreen = screen;
  $('demoBadge').hidden = !isShowcase(event);
  $('evName').textContent = event?.name || 'Tournament Games';
  $('evDate').textContent = event ? new Date(`${event.date}T12:00:00Z`).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'}) : '';
  if (!event) { fill($('main'), h('div', {class: 'waiting'}, h('div', {class: 'eyebrow', text: 'FFTT GAMES'}), h('h2', {text: 'The tournament board is standing by'}), h('p', {text: 'Matchups and results will appear here when available.'}))); return; }
  fill($('main'), screen === 'match' ? matchCenter() : results());
}
function select(next) { if (!available().includes(next)) return; screen = next; deadline = Date.now() + durations[screen]; render(); }
function move(dir) { const slides = available(), index = slides.indexOf(screen); select(slides[(index + dir + slides.length) % slides.length]); }
function toggle() { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; if (!paused) deadline = Date.now() + durations[screen]; }
$('prev').addEventListener('click', () => move(-1)); $('next').addEventListener('click', () => move(1)); $('pause').addEventListener('click', toggle);
document.querySelectorAll('[data-screen]').forEach(b => b.addEventListener('click', () => select(b.dataset.screen)));
document.addEventListener('keydown', e => { if (e.target.tagName === 'BUTTON') return; if (e.key === 'ArrowRight') move(1); else if (e.key === 'ArrowLeft') move(-1); else if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === '1') select('match'); else if (e.key === '2') select('results'); });
setInterval(() => { if (paused || Date.now() < deadline) return; move(1); }, 250);
startPublicFeed({onUpdate(next) { view = next; const picked = pickEvent(view.events, wanted); const flag = $('live'); flag.className = `feed-status ${picked ? view.state : 'empty'}`; flag.textContent = !picked ? 'NO CURRENT DATA' : view.state === 'current' ? (isShowcase(picked) ? 'DEMO DATA' : '●  LIVE') : view.state === 'stale' ? `OUT OF DATE · ${Math.round(view.ageMs / 1000)}s` : 'NO CURRENT DATA';
  const nextSignature = JSON.stringify(picked); if (nextSignature === signature && lastRenderedState === view.state) return; signature = nextSignature; lastRenderedState = view.state; event = picked; board = event ? deriveBoard(event) : null; if (!available().includes(screen)) { screen = 'match'; deadline = Date.now() + durations.match; } render(); }});
