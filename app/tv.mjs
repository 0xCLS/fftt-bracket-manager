/** Anonymous, read-only TV presentation. The public feed remains the sole source of data. */
import {h, fill, $} from './dom.mjs';
import {startPublicFeed, pickEvent, isShowcase} from './public_core.mjs';
import {deriveBoard} from '../contracts/gameday_public.mjs';
import {roundName, normalizeGameScores, formatLabel} from '../contracts/gameday_engine.mjs';
import {parseGames} from './game_tiles.mjs';

const wanted = new URLSearchParams(location.search).get('e');
const durations = {match: 30000, results: 12000, championship: 18000, consolation: 18000};
const labels = {match: 'MATCH CENTER', results: 'COMPLETED RESULTS', championship: 'CHAMPIONSHIP BRACKET', consolation: 'CONSOLATION BRACKET'};
let view, event, board, screen = 'match', paused = false, deadline = Date.now() + durations.match, signature = '', segment = 0;
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
/**
 * Dots reflect FINAL, contract-validated best-of-three games only. PR #59
 * owns intermediate public progress and can later supply a verified adapter.
 */
function winDots(m, player) {
  if (m.bestOf !== 3) return null;
  const wins = tally(m);
  if (!wins) return null;
  const n = wins[player];
  return h('span', {class:'game-win-dots',role:'img',
    'aria-label': `${name(player === 0 ? m.name1 : m.name2)}: ${n} verified game win${n === 1 ? '' : 's'} in the final best-of-three result`},
    Array.from({length:3}, (_,i)=>h('span',{class:'win-dot' + (i<n ? ' earned' : ''),'aria-hidden':'true'})));
}
function games(m) {
  const t = tally(m);
  return t ? parseGames(m.scores).map((g, i) => `G${i + 1} ${g.a} - ${g.b}`).join('   ·   ') : (m.scores === 'W/O' ? 'Walkover' : m.status === 'complete' && m.scores && (!m.bestOf || !m.points) ? `Recorded: ${m.scores}` : 'Game scores unavailable');
}

const tableWord = number => number === 1 ? 'ONE' : number === 2 ? 'TWO' : String(number);
const matchFormat = m => m.bestOf === 3 ? 'BEST OF THREE' : m.bestOf === 1 ? 'SINGLE GAME' : m.bestOf ? 'BEST OF ' + m.bestOf : 'MATCH FORMAT PENDING';

function tablePlayerName(raw) {
  const full=name(raw), parts=full.trim().split(/\s+/);
  const stacked=parts.length>1 && raw && !/^to be determined$/i.test(full);
  return h('div',{class:'player-name'+(stacked?' stacked':''),'aria-label':full},
    stacked
      ? [h('span',{class:'player-first',text:parts[0]+' '}),h('span',{class:'player-last',text:parts.slice(1).join(' ')})]
      : h('span',{class:'player-full',text:full}));
}
function tableCard(table) {
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
        h('div',{class:'match-player'},tablePlayerName(m.name1)),
        h('div',{class:'versus-line'},h('span',{class:'versus',text:'VS'})),
        h('div',{class:'match-player'},tablePlayerName(m.name2))),
      h('div',{class:'match-meta',text:matchFormat(m)}))
    :h('div',{class:'empty-table'},h('strong',{text:'Table open'}),h('span',{text:'Waiting for the next match'})));
  return h('div',{class:'table-stage table-stage-'+table},
    ...(table===1?[outLabel,panel]:[panel,outLabel]));
}

function matchCenter() {
  const playing = board.playing.filter(m => m.table === 1 || m.table === 2).length;
  return h('div',{class:'match-center broadcast-match-center'},
    h('div',{class:'match-status-rail'},
      h('span',{class:'section-heading'}, h('span',{text:isShowcase(event) ? 'Sample Matches' : 'MATCH CENTER'})),
      h('span',{class:'status-count',text:isShowcase(event) ? 'FICTIONAL SHOWCASE · DEMO TABLES' : '● TWO TABLES · ' + playing + (playing === 1 ? ' MATCH' : ' MATCHES')})),
    h('section',{class:'now-section'},h('div',{class:'table-grid'},tableCard(1),tableCard(2))),
    h('section',{class:'next-section'},
      h('div',{class:'queue-banner'},h('strong',{text:'UP NEXT'}),h('small',{text:'ON DECK'})),
      board.upNext.length ? h('div',{class:'next-grid'},board.upNext.slice(0,2).map(m =>
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
      h('div',{},h('span',{class:'title-kicker',text:'OFFICIAL FINAL SCORES / 02'}),
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

function bracketWindows(ms) {
  const rounds = [...new Set(ms.map(m => m.round))].sort((a, b) => a - b);
  const windows = [];
  for (let i = 0; i < rounds.length; i += 3) {
    const group = rounds.slice(i, i + 3), first = group[0];
    const maxSlot = Math.max(...ms.filter(m => m.round === first).map(m => m.slot));
    for (let page = 0; page <= Math.floor(maxSlot / 2); page++) windows.push({rounds: group, first, page});
  }
  return windows;
}

function bracket(kind) {
  const ms=event[kind].filter(m=>m.status !== 'empty');
  const totalRounds=Math.max(...ms.map(m=>m.round))+1;
  const windows=bracketWindows(ms),pages=windows.length;
  const {rounds,first:firstRound,page}=windows[Math.min(segment,pages-1)];
  const champ=champion(kind);
  const solitary=ms.length === 1;
  const featuredFinal=rounds.length === 1 && rounds[0] === totalRounds-1;
  const consolationFinalOnScreen=kind==='consolation' && (featuredFinal || solitary || rounds.includes(totalRounds-1));
  return h('div',{class:'bracket-view cinematic-bracket ' + (kind==='championship' ? 'championship-path' : 'consolation-path') + (solitary ? ' single-match' : '') + (featuredFinal ? ' featured-final' : '')},
    h('div',{class:'broadcast-title'},
      h('div',{},h('span',{class:'title-kicker',text:kind==='championship' ? 'THE ROAD TO THE TITLE / 03' : consolationFinalOnScreen ? 'THE FINAL SHOWDOWN / 04' : 'THE ROAD TO THE FINAL / 04'}),
        h('h2',{},kind==='championship' ? [h('span',{text:'THE ROAD '}),h('em',{text:'TO THE FINAL'})] : [h('span',{text:'CONSOLATION '}),h('em',{text:consolationFinalOnScreen ? 'FINAL' : 'BRACKET'})])),
      h('span',{class:'title-side',text:kind==='championship' ? 'CHAMPIONSHIP · FEATURED BRACKET PATH' : consolationFinalOnScreen ? 'THE LAST MATCH · FINAL SHOWDOWN' : 'CONSOLATION · BRACKET PROGRESSION'})),
    h('div',{class:'bracket-caption'},
      h('span',{text:pages>1 ? 'BRACKET SEGMENT '+(segment+1)+' / '+pages : 'TOURNAMENT PROGRESSION'}),
      champ ? h('strong',{text:'CHAMPION · '+champ.winner}) : null),
    h('div',{class:'bracket-columns'},rounds.map((r,idx)=>{
      const factor=2**(r-firstRound);
      const selected=ms.filter(m=>m.round === r && m.slot>=Math.floor(page*2/factor) && m.slot<=Math.floor((page*2+1)/factor));
      const isFinal=r === totalRounds-1;
      // Reserve one dramatic callout for the final visible advancing round;
      // never duplicate the same 'One Step Closer' headline in adjacent columns.
      const midFeature=kind==='championship' && !isFinal && idx===rounds.length-1 && idx>0 && selected.length === 1;
      return h('div',{class:'bracket-round' + (isFinal ? ' last-round' : '') + (midFeature ? ' mid-feature' : ''),'data-round':r},
        h('div',{class:'round-heading',text:(idx+1<10?'0'+(idx+1):idx+1)+' / '+roundName(totalRounds,r,kind)}),
        h('div',{class:'bracket-matches'},selected.map(m=>
          h('article',{class:'bracket-match ' + (m.phase==='playing' ? 'playing' : m.status==='complete' ? 'completed' : 'upcoming'),'data-round':m.round,'data-slot':m.slot},
            isFinal ? h('div',{class:'final-feature-label','aria-hidden':'true'},h('span',{class:'final-star',text:'★'}),h('strong',{},h('span',{text:kind === 'consolation' ? 'ONE MORE' : 'ONE MATCH.'}),h('em',{text:kind === 'consolation' ? 'MATCH' : 'ONE CHAMPION.'}))) : null,
            midFeature ? h('div',{class:'semifinal-feature-label','aria-hidden':'true'},h('span',{text:'THE NEXT SHOWDOWN'}),h('strong',{},h('span',{text:'ONE STEP'}),h('em',{text:'CLOSER.'}))) : null,
            h('span',{class:'bracket-table-stamp',text:m.table ? '0' + m.table : ''}),
            h('div',{class:'bracket-state',text:m.status==='bye'?'BYE':m.status==='complete'?'COMPLETED':m.phase==='playing'?(isShowcase(event)?'SAMPLE MATCH':'NOW PLAYING'):'UPCOMING'}),
            m.name1||m.name2 ? [m.name1,m.name2].flatMap((n,i)=>{
              const row=h('div',{class:'bracket-player-row'+(n&&n===m.winnerName?' winner':'')},
                h('div',{class:'bracket-player'+(n&&n===m.winnerName?' winner':''),text:name(n)}),winDots(m,i));
              return i === 0 && m.name1 && m.name2 && isFinal ? [row,h('div',{class:'versus-line bracket-vs','aria-hidden':'true'},h('span',{class:'versus',text:'VS'}))] : [row];
            }) : h('div',{class:'bracket-pending-pair'},
              h('strong',{text:isFinal?'Finalists to be determined':'Matchup to be determined'}),
              h('span',{text:'Players will appear as earlier matches are decided.'})),
            m.status==='complete'&&m.scores ? h('div',{class:'bracket-scores',text:games(m)}) : null))));
    })),
    kind==='championship' ? h('div',{class:'bracket-progress'},rounds.flatMap((r,i)=>[
      ...(i ? [h('span',{text:'—'})] : []),
      h('strong',{text:roundName(totalRounds,r,kind).toUpperCase()})])) : null);
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
  document.body.dataset.broadcastScreen = screen;
  $('demoBadge').hidden = !isShowcase(event);
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
startPublicFeed({onUpdate(next) { view = next; const picked = pickEvent(view.events, wanted); const flag = $('live'); flag.className = `feed-status ${picked ? view.state : 'empty'}`; flag.textContent = !picked ? 'NO CURRENT DATA' : view.state === 'current' ? (isShowcase(picked) ? 'DEMO DATA' : '●  LIVE') : view.state === 'stale' ? `OUT OF DATE · ${Math.round(view.ageMs / 1000)}s` : 'NO CURRENT DATA';
  const nextSignature = JSON.stringify(picked); if (nextSignature === signature) return; signature = nextSignature; event = picked; board = event ? deriveBoard(event) : null; if (event && (screen === 'championship' || screen === 'consolation')) segment = Math.min(segment, Math.max(0, bracketWindows(event[screen].filter(m => m.status !== 'empty')).length - 1)); if (!available().includes(screen)) { screen = 'match'; segment = 0; deadline = Date.now() + durations.match; } render(); }});
