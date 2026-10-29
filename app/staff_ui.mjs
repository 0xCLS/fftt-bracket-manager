/** FFTT Bracket Manager (staging) — staff screens. Organizer: the whole event. Scorekeeper: the Match Desk.
 * Everything is built with createElement/textContent from validated models; the server decides every
 * outcome, this file only shows state and sends deliberate, confirmed requests through the core. */
import {h, clear, fill, toast, download, pill} from './dom.mjs';
import {bracketView} from './bracket_view.mjs';
import {suggestPartners, enginePlayers, seedSlots, roundName, partnerCandidates, normalizeGameScores, formatLabel, ALLOWED_BEST_OF, ALLOWED_POINTS} from '../contracts/gameday_engine.mjs';
import {normalizeSnapshotMatches, standingsFromSnapshot, resultsText, matchesCsv} from './exports.mjs';
import {createPlayersView, levelShield} from './view_players.mjs';
import {createEventsView} from './view_events.mjs';
import {scoreTiles} from './game_tiles.mjs';

const ORGANIZER_TABS = [['overview', 'Overview'], ['players', 'Players'], ['championship', 'Championship'],
  ['consolation', 'Consolation'], ['desk', 'Match Desk'], ['finale', 'Doubles Finale'], ['results', 'Results & Export'], ['staff', 'Staff']];
const SCOREKEEPER_TABS = [['desk', 'Match Desk']];
/** Fixed outline icon geometry from the approved single-file FFTT navigation. */
const STAFF_NAV_GEOMETRY = Object.freeze({
  overview: [['rect',{x:3,y:3,width:7,height:7,rx:1}],['rect',{x:14,y:3,width:7,height:7,rx:1}],['rect',{x:3,y:14,width:7,height:7,rx:1}],['rect',{x:14,y:14,width:7,height:7,rx:1}]],
  players: [['path',{d:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'}],['circle',{cx:9,cy:7,r:4}],['path',{d:'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'}]],
  championship: [['path',{d:'M8 21h8M12 17v4M7 4h10v7a5 5 0 0 1-10 0V4ZM7 6H4v3a4 4 0 0 0 4 4M17 6h3v3a4 4 0 0 1-4 4'}]],
  consolation: [['path',{d:'M3 11a9 9 0 0 1 16-5l2 2M21 3v5h-5M21 13a9 9 0 0 1-16 5l-2-2M3 21v-5h5'}]],
  desk: [['rect',{x:5,y:4,width:14,height:17,rx:2}],['path',{d:'M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h4'}]],
  finale: [['circle',{cx:7.5,cy:7,r:3}],['circle',{cx:16.5,cy:7,r:3}],['path',{d:'M2 20v-2a5.5 5.5 0 0 1 11 0v2M11 20v-2a5.5 5.5 0 0 1 11 0v2'}]],
  results: [['path',{d:'M4 7V4h16v3M5 7h14v13H5V7ZM9 12h6M9 16h6'}]],
  staff: [['circle',{cx:9,cy:8,r:3}],['path',{d:'M3 21v-2a6 6 0 0 1 12 0v2M17 11h5M19.5 8.5v5'}]],
});
function staffNavIcon(kind) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [name,value] of Object.entries({class:'app-tab-icon',width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) svg.setAttribute(name,String(value));
  for (const [tag,attributes] of STAFF_NAV_GEOMETRY[kind] ?? []) {
    const el = document.createElementNS(ns,tag);
    for (const [name,value] of Object.entries(attributes)) el.setAttribute(name,String(value));
    svg.append(el);
  }
  return svg;
}

const OFFLINE_TOOL = 'https://0xcls.github.io/fftt-bracket-manager/';

export function createStaffUi({core, els, config, signOut}) {
  const s = core.state;
  let tab = 'overview', lastInputAt = 0, dirtyDialog = 0, lastPaneKey = '';
  // Drafts belong to one organizer event and tab; never persist these private values in storage.
  // Anything marked data-draft (or listed in draftInputs) keeps what the person typed or opened across the
  // background refresh that rebuilds a pane; a successful save forgets it.
  const drafts = new Map();
  const draftKey = id => `${s.eventId}:${tab}:${id}`;
  const remember = (id, value) => drafts.set(draftKey(id), value);
  const draft = (id, fallback) => drafts.has(draftKey(id)) ? drafts.get(draftKey(id)) : fallback;
  const forget = prefix => { const start = draftKey(prefix); for (const k of [...drafts.keys()]) if (k.startsWith(start)) drafts.delete(k); };
  const abandonDrafts = () => { drafts.clear(); lastPaneKey = ''; };
  const draftInputs = new Set(['evName', 'evDate', 'evTables', 'dbA', 'dbB', 'dbScores']);
  const draftKeyOf = el => el.dataset?.draft ?? (draftInputs.has(el.id) ? el.id : null);
  const isOrganizer = () => s.role === 'organizer';
  const nameOf = id => s.snapshot?.players.find(p => p.id === id)?.name ?? '—';

  // ------------------------------------------------------------ dialogs
  let dialogSeq = 0;
  function openDialog(build, {label}) {
    const dlg = h('dialog', {'aria-label': label});
    const opener = document.activeElement;
    dirtyDialog++;
    const close = () => { try { dlg.close(); } catch { /* already closed */ } };
    dlg.addEventListener('close', () => {
      dirtyDialog--; dlg.remove();
      // give focus back to whatever opened the dialog (if it survived a refresh, find its twin)
      const target = opener?.isConnected ? opener : (opener?.id ? document.getElementById(opener.id) : null);
      try { target?.focus(); } catch { /* element gone */ }
    });
    dlg.addEventListener('cancel', () => { /* Escape closes; nothing is sent */ });
    document.body.append(dlg);
    build(dlg, close);
    dialogSeq++;
    dlg.showModal();
    return dlg;
  }
  const confirmDialog = (title, text, okLabel, {danger = false} = {}) => new Promise(resolve => {
    let answered = false;
    const dlg = openDialog((d, close) => {
      d.append(h('div', {class: 'dlg'}, h('h3', {text: title}), h('p', {text}),
        h('div', {class: 'dlg-actions'},
          h('button', {type: 'button', text: 'Cancel', on: {click: () => { answered = true; resolve(false); close(); }}}),
          h('button', {type: 'button', class: danger ? 'danger' : 'primary', text: okLabel, on: {click: () => { answered = true; resolve(true); close(); }}}))));
    }, {label: title});
    dlg.addEventListener('close', () => { if (!answered) resolve(false); });
  });
  const result = (r, okText) => {
    if (r.ok) { if (okText) toast(okText); return true; }
    toast(r.message ?? 'That did not work.', 'bad'); return false;
  };

  // ------------------------------------------------------------ chrome
  function renderChrome() {
    const conn = core.connection();
    const age = Math.round((Date.now() - s.lastGoodAt) / 1000);
    const connecting = conn === 'stale' && s.lastGoodAt === 0 && !s.lastError;
    const [text, kind] = connecting ? ['Connecting · verifying tournament', 'warn']
      : conn === 'live' ? [`Live · updated ${age < 2 ? 'just now' : age + 's ago'}`, 'good']
      : conn === 'stale' ? [`Not confirmed for ${age}s · changes paused`, 'bad']
      : conn === 'offline' ? ['Offline · changes paused', 'bad'] : conn === 'paused' ? ['Paused in background', 'warn'] : ['Signed out', 'warn'];
    // Only organizers receive player/match totals. The scorekeeper's brief intentionally contains
    // no roster or results; never turn its absent fields into misleading "0" statistics.
    const snapshot = s.role === 'organizer' ? s.snapshot : null;
    const checked = snapshot?.players?.filter(p => p.checkedIn).length;
    const completed = snapshot?.matches?.filter(m => m.status === 'complete').length;
    fill(els.status,
      pill(text, kind), pill(s.role === 'organizer' ? 'Organizer' : s.role === 'scorekeeper' ? 'Scorekeeper' : '—', 'blue'),
      snapshot ? pill(checked + ' checked in') : null,
      snapshot ? pill(completed + ' matches completed', 'blue') : null,
      snapshot ? (snapshot.candidates?.length ? pill(snapshot.candidates.length + ' consolation candidates', 'warn') : pill('Consolation not ready', 'warn')) : null,
      s.role === 'scorekeeper' && s.brief ? pill(s.brief.lifecycle === 'complete' ? 'Event complete' : 'Match Desk only', s.brief.lifecycle === 'complete' ? 'warn' : 'blue') : null,
      s.pending ? pill('Unconfirmed score', 'warn') : null,
      snapshot?.event?.publicVisible ? pill('Public view ON', 'blue') : null);
    const evs = s.events;
    const eventOptionsKey = JSON.stringify(evs.map(e => [e.eventId, e.name, e.date, e.lifecycle]));
    if (els.eventSelect.dataset.optionsKey !== eventOptionsKey || els.eventSelect.value !== s.eventId) {
      clear(els.eventSelect);
      for (const e of evs) els.eventSelect.append(h('option', {value: e.eventId, text: `${e.name} · ${e.date}${e.lifecycle === 'archived' ? ' (archived)' : ''}`, selected: e.eventId === s.eventId}));
      els.eventSelect.dataset.optionsKey = eventOptionsKey;
    }
    (els.eventSwitch ?? els.eventSelect).hidden = evs.length < 2;
    const tabs = isOrganizer() ? ORGANIZER_TABS : SCOREKEEPER_TABS;
    if (!tabs.some(([id]) => id === tab)) tab = tabs[0][0];
    // keep the same buttons (and focus) when nothing changed; rebuild only when the tab set or selection changed
    const tabsKey = tabs.map(t => t[0]).join() + '|' + tab;
    if (els.tabs.dataset.key !== tabsKey) {
      const hadFocus = els.tabs.contains(document.activeElement) ? document.activeElement.dataset.tab : null;
      clear(els.tabs);
      for (const [id, label] of tabs) {
        els.tabs.append(h('button', {type: 'button', 'data-tab': id, 'aria-current': id === tab ? 'page' : null,
          on: {click: () => { if (tab !== id) abandonDrafts(); tab = id; render(true); focusMain(); }}}, staffNavIcon(id), h('span', {text: label})));
      }
      els.tabs.dataset.key = tabsKey;
      if (hadFocus) els.tabs.querySelector(`[data-tab="${hadFocus}"]`)?.focus();
    }
    els.banner.hidden = !(conn === 'offline' || (conn === 'stale' && !connecting));
    els.banner.textContent = conn === 'offline'
      ? 'You are offline. Cloud changes are paused. The last information stays on screen; use the organizer fallback if needed.'
      : 'The connection could not be confirmed. Cloud changes are paused until it is.';
  }
  /** After choosing a section by keyboard or tap, screen readers and keyboard users land at the top of it. */
  const focusMain = () => { try { els.main.focus({preventScroll: false}); } catch { /* optional */ } };

  // ------------------------------------------------------------ shared view helpers
  const loading = () => h('div', {class: 'loading-state', role: 'status', 'aria-live': 'polite'},
    h('span', {class: 'spinner', 'aria-hidden': 'true'}), s.endedReason ?? 'Loading…');
  const goTab = id => { if (tab !== id) abandonDrafts(); tab = id; render(true); focusMain(); };
  function parseBulk(text) {
    const players = [], errors = [];
    text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((line, i) => {
      const [name, r, st] = line.split(',').map(x => x.trim());
      const rating = r === undefined || r === '' ? 3 : Number(r);
      const status = (st ?? 'provisional').toLowerCase();
      if (!name || !Number.isInteger(rating) || rating < 1 || rating > 5 || !['provisional', 'established'].includes(status)) errors.push(`Line ${i + 1}: use  Name, rating 1-5, provisional or established.`);
      else players.push({name, rating, rating_status: status});
    });
    return {players, errors};
  }
  const viewCtx = {core, s, h, clear, fill, pill, toast, result, confirmDialog, openDialog, remember, draft, forget, loading, parseBulk, goTab,
    rerender: () => render(true), openEvent: () => { abandonDrafts(); tab = 'overview'; render(true); focusMain(); }};
  const viewPlayers = createPlayersView(viewCtx);
  const {formatsCard, eventsCard} = createEventsView(viewCtx);
  const formatOf = m => ({bestOf: m.bestOf, points: m.points});
  const formatText = f => formatLabel(f);

  // ------------------------------------------------------------ views
  function pendingFirstPlayers(sn) {
    const champ = sn.matches.filter(m => m.bracket === 'championship');
    const inBracket = new Set(champ.flatMap(m => [m.p1, m.p2]).filter(Boolean));
    const played = new Set(champ.filter(m => m.status === 'complete').flatMap(m => [m.p1, m.p2]));
    return [...inBracket].filter(id => !played.has(id));
  }
  function viewOverview() {
    const sn = s.snapshot;
    if (!sn) return loading();
    const e = sn.event, checked = sn.players.filter(p => p.checkedIn).length;
    const championshipDone = sn.matches.filter(m => m.bracket === 'championship' && m.status === 'complete').length;
    const stand = standingsFromSnapshot(sn);
    const champ = sn.brackets.find(b => b.kind === 'championship');
    const cons = sn.brackets.find(b => b.kind === 'consolation');
    const pendingFirst = pendingFirstPlayers(sn).length;
    let next;
    if (!sn.players.length) next = 'Load the registrations or add players on the Players tab. Never import actual FFTT3 registrations into staging.';
    else if (checked < 2) next = 'Check in at least two players on the Players tab.';
    else if (!champ) next = 'Build the championship bracket on the Championship tab.';
    else if (champ.status === 'active') next = pendingFirst > 0 && !cons ? 'Record results on the Match Desk. Consolation unlocks when everyone has played once.' : 'Keep recording results on the Match Desk.';
    else if (sn.candidates.length >= 2 && !cons) next = 'Championship is decided. Build the consolation bracket.';
    else if (cons?.status === 'active') next = 'Finish the consolation bracket on the Match Desk.';
    else if (!sn.doubles?.partner1) next = 'Choose the Mixed-Skill Doubles teams on the Doubles Finale tab.';
    else if (!sn.doubles?.winnerTeam) next = 'Play and record the Mixed-Skill Doubles finale.';
    else next = e.lifecycle === 'complete' ? 'The event is complete. Export the results.' : 'Everything is played. Review Results & Export, then mark the event complete.';
    const form = {
      name: h('input', {type: 'text', value: e.name, maxlength: 120, id: 'evName'}),
      date: h('input', {type: 'date', value: e.date, id: 'evDate'}),
      tables: h('input', {type: 'number', min: 1, max: 12, value: e.tables, id: 'evTables'}),
    };
    const field = (label, id, input, cls) => h('div', {class: cls}, h('label', {'for': id, text: label}), input);
    const kpi = (number, label) => h('div', {class: 'kpi'}, h('strong', {text: String(number)}), h('span', {text: label}));
    const format = (number, label, description) => h('li', {},
      h('span', {class: 'format-index', text: number}),
      h('div', {}, h('strong', {text: label}), h('p', {text: description})));
    return h('div', {class: 'overview-page'},
      h('section', {class: 'overview-feature'},
        h('span', {class: 'feature-overline'}, h('span', {class: 'feature-spark', 'aria-hidden': 'true'}), 'FORGING FELLOWSHIP · TOURNAMENT DESK'),
        h('h1', {text: 'Forging Fellowship Table Tennis Games'}),
        h('p', {text: 'Everything you need to prepare the Games, organize players, and keep the competition moving.'}),
        h('div', {class: 'feature-actions'},
          h('button', {type: 'button', class: 'feature-primary', on: {click: () => goTab('players')}}, 'Manage players  ↗'),
          h('button', {type: 'button', class: 'feature-secondary', on: {click: () => goTab('desk')}}, 'Open Match Desk  →'))),
      h('div', {class: 'overview-next', role: 'status'}, h('strong', {text: 'Next: '}), next),
      h('div', {class: 'overview-content'},
        h('div', {class: 'overview-main'},
          h('section', {class: 'card overview-settings', 'aria-labelledby': 'setupTitle'},
            h('div', {class: 'section-heading'},
              h('span', {class: 'section-icon', 'aria-hidden': 'true', text: '01'}),
              h('div', {}, h('span', {class: 'section-overline', text: 'EVENT DETAILS'}), h('h2', {id: 'setupTitle', text: 'Set up your tournament'}))),
            h('p', {class: 'section-description', text: 'Choose the event details before building the bracket.'}),
            h('form', {class: 'form-grid', on: {submit: async ev => { ev.preventDefault(); if (result(await core.actions.updateEvent(form.name.value, form.date.value, Number(form.tables.value)), 'Event saved.')) forget('ev'); }}},
              field('Event name', 'evName', form.name, 'wide'),
              field('Event date', 'evDate', form.date, 'date-field'),
              field('Tables in use', 'evTables', form.tables, 'third'),
              h('div', {class: 'setup-save'},
                h('button', {class: 'primary', type: 'submit', disabled: !core.canWrite(), text: 'Save event setup  →'})))),
          ),
        h('section', {class: 'overview-snapshot', 'aria-label': 'Tournament at a glance'},
          h('div', {class: 'side-section-heading'}, h('span', {class: 'section-overline', text: 'LIVE SNAPSHOT'}), h('h2', {text: 'At a glance'})),
          h('div', {class: 'kpis'},
            kpi(checked, 'Checked-in players'), kpi(championshipDone, 'Championship matches'),
            kpi(sn.candidates.length, 'Consolation entrants'), kpi(e.tables, 'Tables configured')))),
      h('section', {class: 'overview-format'},
        h('div', {class: 'side-section-heading'}, h('span', {class: 'section-overline', text: 'HOW IT WORKS'}), h('h2', {text: 'Three stages. More play.'})),
        h('ol', {class: 'format-steps'},
          format('1', 'Championship', 'Every player begins on the championship side.'),
          format('2', 'Consolation', 'Players who lose their first actual match get another opportunity.'),
          format('3', 'Doubles finale', 'Finalists pair with selected consolation players.')),
        h('p', {class: 'format-footnote', text: 'Ratings stay private. Consolation matchups are reviewed before the bracket is built.'})),
      stand.champion ? h('div', {class: 'champion-banner'},
        h('h2', {text: 'Champion: ' + stand.champion}), h('p', {text: 'Runner-up: ' + stand.runnerUp})) : null,
      h('section', {class: 'overview-history'}, eventsCard()),
      // LAST on the page and the full width of it: the scoring formats are a configuration reference, not first-run setup
      h('section', {class: 'overview-formats', 'aria-label': 'Match scoring formats'}, formatsCard(sn)));
  }

  function normalized(kind) {
    return normalizeSnapshotMatches(s.snapshot).filter(m => m.bracket === kind);
  }
  const formatSummary = (sn, kind) => {
    const real = sn.matches.filter(m => m.bracket === kind && m.status !== 'bye' && m.status !== 'empty');
    const seen = [...new Set(real.map(m => formatText(formatOf(m)) + (m.formatLegacy ? ' (historical)' : '')))];
    return seen;
  };

  function viewChampionship() {
    const sn = s.snapshot;
    if (!sn) return loading();
    const field = sn.players.filter(p => p.checkedIn);
    const champ = sn.brackets.find(b => b.kind === 'championship');
    const preview = field.length >= 2 ? seedSlots(enginePlayers(field.map(p => ({id: p.id, name: p.name, rating: p.rating, rating_status: p.ratingStatus})))) : [];
    const played = sn.matches.filter(m => m.status === 'complete').length;
    const unconfirmed = field.filter(p => !p.ratingConfirmed).length;
    const f = sn.event.formats;
    return h('div', {},
      h('section', {class: 'card', 'aria-labelledby': 'champTitle'},
        h('div', {class: 'card-head'}, h('div', {}, h('h2', {id: 'champTitle', text: champ ? 'Championship bracket' : 'Build the championship bracket'}),
          h('p', {class: 'card-sub', text: `${field.length} player${field.length === 1 ? '' : 's'} checked in. Seeding uses the internal ratings: strongest players are kept apart and receive the byes.`}))),
        !champ ? h('div', {class: 'chips static', 'aria-label': 'Formats this bracket will use'}, pill(`Rounds: ${formatText(f.champ)}`, 'blue'), pill(`Final: ${formatText(f.champ_final)}`, 'blue')) : h('div', {class: 'chips static', 'aria-label': 'Formats in this bracket'}, formatSummary(sn, 'championship').map(t => pill(t, 'blue'))),
        unconfirmed ? h('div', {class: 'notice warn', role: 'status'}, `${unconfirmed} checked-in player${unconfirmed === 1 ? ' has' : 's have'} a suggested level that has not been confirmed. `,
          h('button', {type: 'button', class: 'small', text: 'Review on Players', on: {click: () => goTab('players')}})) : null,
        !champ && preview.length ? h('details', {'data-draft': 'seedPreviewOpen', open: draft('seedPreviewOpen', false)},
          h('summary', {text: 'Preview opening round'}),
          h('ol', {}, pairs(preview).map(([a, b]) => h('li', {text: `${nameOf(a)} vs ${b ? nameOf(b) : 'BYE'}`})))) : null,
        h('div', {class: 'row'},
          !champ ? h('button', {class: 'primary', type: 'button', disabled: !core.canWrite() || field.length < 2, text: 'Build championship bracket',
            on: {click: async () => { if (result(await core.actions.buildChampionship(), 'Championship bracket built.')) goTab('desk'); }}})
            : h('button', {class: 'danger', type: 'button', disabled: !core.canWrite(), text: 'Rebuild (replaces the bracket)', on: {click: async () => {
              const text = played ? `This replaces the bracket and discards ${played} completed result(s) from the current bracket, the consolation bracket and the doubles teams. Scorekeepers will need to refresh. Export a backup first.` : 'This replaces the current bracket.';
              if (await confirmDialog('Rebuild the championship bracket?', text, 'Rebuild', {danger: true})) result(await core.actions.buildChampionship({confirm: true}), 'Bracket rebuilt.'); }}}))),
      champ ? h('section', {class: 'card', 'aria-label': 'Championship bracket'}, bracketView(normalized('championship'), 'championship')) : null);
  }
  const pairs = a => a.reduce((out, x, i) => i % 2 ? out : [...out, [x, a[i + 1] ?? null]], []);

  function viewConsolation() {
    const sn = s.snapshot;
    if (!sn) return loading();
    const champ = sn.brackets.find(b => b.kind === 'championship');
    const cons = sn.brackets.find(b => b.kind === 'consolation');
    if (!champ) return h('div', {class: 'notice warn', text: 'Build the championship bracket first.'});
    const pending = pendingFirstPlayers(sn);
    const cands = sn.candidates.map(c => ({...c, p: sn.players.find(p => p.id === c.playerId)})).filter(c => c.p);
    const checks = new Map(cands.map(c => [c.playerId, h('input', {type: 'checkbox',
      checked: draft(`consolation:${c.playerId}`, true), 'aria-label': `Include ${c.p.name}`,
      on: {change: ev => remember(`consolation:${c.playerId}`, ev.target.checked)}})]));
    const f = sn.event.formats;
    return h('div', {},
      h('section', {class: 'card', 'aria-labelledby': 'consTitle'},
        h('div', {class: 'card-head'}, h('div', {}, h('h2', {id: 'consTitle', text: 'Consolation bracket'}),
          h('p', {class: 'card-sub', text: 'Everyone eliminated in their first real match is included by default (so each player gets at least two matches). Untick someone to leave them out, for example a player who has gone home.'}))),
        !cons ? h('div', {class: 'chips static', 'aria-label': 'Formats this bracket will use'}, pill(`Rounds: ${formatText(f.cons)}`, 'blue'), pill(`Final: ${formatText(f.cons_final)}`, 'blue'))
          : h('div', {class: 'chips static', 'aria-label': 'Formats in this bracket'}, formatSummary(sn, 'consolation').map(t => pill(t, 'blue'))),
        h('div', {class: 'notice ' + (pending.length ? 'warn' : 'good')},
          h('b', {text: `${cands.length}`}), ` first-match loser${cands.length === 1 ? '' : 's'}. `,
          pending.length ? `${pending.length} player(s) have not yet played their first championship match: ${pending.slice(0, 6).map(nameOf).join(', ')}${pending.length > 6 ? '…' : ''}.`
            : 'Everyone has played a first match.'),
        cands.length ? h('div', {class: 'scroll-x'}, h('table', {class: 'responsive-table'}, h('thead', {}, h('tr', {}, ['Include', 'Player', 'Level'].map(t => h('th', {scope: 'col', text: t})))),
          h('tbody', {}, cands.map(c => h('tr', {}, h('td', {'data-label': 'Include'}, cons ? pill(c.state, c.state === 'placed' ? 'good' : '') : checks.get(c.playerId)), h('td', {'data-label': 'Player'}, c.p.name), h('td', {'data-label': 'Level'}, h('span', {class: 'cons-level', role: 'img', 'aria-label': `Level ${c.p.rating}`, title: `Level ${c.p.rating}`}, levelShield(c.p.rating)))))))) : h('div', {class: 'empty-state', text: 'No candidates yet. They appear as first-round matches are decided.'}),
        h('div', {class: 'row'},
          !cons ? h('button', {class: 'primary', type: 'button', disabled: !core.canWrite() || pending.length > 0 || cands.length < 2, text: 'Build consolation bracket',
            on: {click: async () => { const ids = cands.filter(c => checks.get(c.playerId).checked).map(c => c.playerId);
              if (result(await core.actions.buildConsolation({entrantIds: ids}), 'Consolation bracket built.')) goTab('desk'); }}})
            : h('button', {type: 'button', disabled: !core.canWrite() || normalized('consolation').some(m => m.status === 'complete'), text: 'Rebuild (no results yet)', on: {click: async () => {
              const ids = cands.map(c => c.playerId);
              if (await confirmDialog('Rebuild consolation?', 'This replaces the consolation bracket. It has no results yet.', 'Rebuild')) result(await core.actions.buildConsolation({entrantIds: ids, confirm: true}), 'Rebuilt.'); }}}))),
      cons ? h('section', {class: 'card', 'aria-label': 'Consolation bracket'}, bracketView(normalized('consolation'), 'consolation')) : null);
  }

  // ------------------------------------------------------------ Match Desk
  function viewDesk() {
    const tables = s.snapshot?.event.tables ?? s.brief?.tables ?? 12;
    const rows = s.desk;
    const org = isOrganizer();
    const children = [];
    if (s.pending) children.push(pendingBanner());
    if (s.deskStatus === 'not-active') children.push(h('div', {class: 'notice warn', text: s.brief?.lifecycle === 'complete'
      ? 'Event complete. New scoring and table assignments are closed; contact the organizer if a recorded result needs correction.'
      : 'No bracket is active yet. The organizer builds it from the Championship tab.'}));
    if (s.deskStatus === 'denied') children.push(h('div', {class: 'notice bad', role: 'alert', text: 'The Match Desk could not be loaded. Pull to refresh or sign in again.'}));
    const usage = new Map(rows.filter(r => r.table).map(r => [r.table, r]));
    children.push(h('section', {class: 'card', 'aria-labelledby': 'tablesTitle'}, h('h2', {id: 'tablesTitle', class: 'card-title', text: 'Tables'}), h('div', {class: 'row'},
      Array.from({length: tables}, (_, i) => { const m = usage.get(i + 1);
        return pill(m ? `Table ${i + 1} · ${m.players[0].name} v ${m.players[1].name}` : `Table ${i + 1} · free`, (m ? 'blue' : 'good') + ' table-pill'); }))));
    children.push(h('h2', {class: 'page-h2', text: `Ready to play (${rows.length})`}));
    children.push(rows.length ? h('div', {class: 'queue'}, rows.map(r => queueCard(r, tables, org)))
      : h('div', {class: 'empty-state', text:
        s.deskStatus === 'not-active' && (s.brief?.lifecycle === 'complete' || s.snapshot?.event.lifecycle === 'complete')
          ? 'This event is complete. There are no further matches to play.'
          : s.deskStatus === 'not-active' ? 'No bracket is active yet. The organizer builds it from Championship.'
          : s.deskStatus === 'ready' ? 'No playable matches are waiting right now.' : 'Waiting for the Match Desk…'}));
    if (org && s.snapshot) {
      const done = normalizeSnapshotMatches(s.snapshot).filter(m => m.status === 'complete').sort((a, b) => b.round - a.round).slice(0, 12);
      children.push(h('section', {class: 'card', 'aria-labelledby': 'recentTitle'}, h('h2', {id: 'recentTitle', class: 'card-title', text: 'Recent results (organizer corrections)'}),
        done.length ? h('div', {class: 'scroll-x'}, h('table', {class: 'responsive-table'}, h('tbody', {}, done.map(m => h('tr', {}, h('td', {'data-label': 'Match'}, `${m.name1} v ${m.name2}`), h('td', {'data-label': 'Winner'}, `${m.winnerName} won`), h('td', {'data-label': 'Scores', class: 'scores-cell'}, scoreTiles(m.scores, {left: m.name1, right: m.name2, caption: false})),
          h('td', {'data-label': 'Format'}, h('span', {class: 'muted', text: m.bestOf ? `${formatText({bestOf: m.bestOf, points: m.points})}${m.formatLegacy ? ' (historical)' : ''}` : ''})),
          h('td', {}, h('button', {class: 'small', type: 'button', disabled: !core.canWrite(), text: 'Correct…', 'aria-label': `Correct the result of ${m.name1} versus ${m.name2}`, on: {click: () => openCorrection(m)}})))))))
          : h('div', {class: 'muted', text: 'No results yet.'})));
    }
    return h('div', {}, children);
  }
  // UI removes occupied table choices; the server retains the authoritative conflict check.
  const occupiedByOtherMatch = (match, table) => s.desk.some(other =>
    other.matchId !== match.matchId && Number(other.table) === Number(table));
  const tableOption = (match, n) => {
    const occupied = occupiedByOtherMatch(match, n);
    return h('option', {value: n, text: occupied ? `Table ${n} · occupied` : `Table ${n}`,
      disabled: occupied, selected: Number(match.table) === n});
  };
  function queueCard(r, tables, org) {
    const fmt = formatOf(r);
    const sel = h('select', {'aria-label': `Table for ${r.players[0].name} versus ${r.players[1].name}`, disabled: !core.canWrite(), on: {change: async ev => {
      const choice = ev.target.value;
      const saved = await core.actions.assignTable(r.matchId, choice ? Number(choice) : null);
      if (!saved.ok) {
        // Never leave a rejected assignment looking successful on the scorekeeper's phone.
        ev.target.value = r.table ? String(r.table) : '';
        if (saved.detail === 'table-in-use') render(true); // paint the authoritative refreshed desk
      }
      result(saved, choice ? `Assigned to table ${choice}.` : 'Table cleared.');
    }}},
      h('option', {value: '', text: 'No table'}), Array.from({length: tables}, (_, i) => tableOption(r, i + 1)));
    const legacy = fmt.bestOf === 5;
    return h('article', {class: 'queue-card' + (r.table ? ' playing' : ''), 'aria-label': `${r.players[0].name} versus ${r.players[1].name}`},
      h('div', {class: 'row tight'}, pill(r.bracket === 'championship' ? 'Championship' : 'Consolation', 'blue'),
        pill(formatText(fmt) + (legacy ? ' · historical' : '') + (r.isFinal && r.bracket === 'championship' ? ' · Final' : ''), legacy ? 'warn' : ''),
        r.table ? pill(`Table ${r.table}`, 'good') : null),
      h('div', {class: 'versus'}, r.players[0].name, h('span', {class: 'vs', text: 'vs'}), r.players[1].name),
      h('div', {class: 'queue-table'}, h('label', {text: 'Table'}), sel),
      h('div', {class: 'row'}, h('button', {class: 'primary', type: 'button', disabled: !core.canWrite(), text: 'Record result', on: {click: () => openScoreDialog(r, tables)}}),
        org ? h('button', {type: 'button', disabled: !core.canWrite(), text: 'No-show…', on: {click: () => openForfeit(r)}}) : null,
        org ? h('button', {type: 'button', class: 'ghost', disabled: !core.canWrite(), text: 'Format…', 'aria-label': `Change the format of ${r.players[0].name} versus ${r.players[1].name}`, on: {click: () => openFormatDialog(r)}}) : null));
  }
  function pendingBanner() {
    const p = s.pending;
    return h('div', {class: 'notice warn', role: 'alert'},
      h('b', {text: 'An earlier score is not confirmed. '}), `Match ${p.code}, scores ${p.scores}. Do not enter it again until you have checked what the server recorded.`,
      h('div', {class: 'row'},
        h('button', {class: 'primary small', type: 'button', text: 'Check what the server recorded', disabled: s.busy, on: {click: async () => { const r = await core.checkPendingScore(); toast(r.message, r.ok ? '' : 'bad'); render(true); }}}),
        h('button', {class: 'small', type: 'button', text: 'I verified it — dismiss', on: {click: async () => {
          if (await confirmDialog('Dismiss this notice?', 'Only dismiss this after the organizer has checked the server result and paper record. If recorded, do not enter it again. If absent, ask the organizer before a fresh submission.', 'Dismiss')) core.dismissPendingScore(); }}})));
  }

  function openFormatDialog(row) {
    openDialog((dlg, close) => {
      const cur = formatOf(row);
      const bo = h('select', {id: 'mfBo'}, ALLOWED_BEST_OF.map(n => h('option', {value: n, text: `Best of ${n}`, selected: n === cur.bestOf})));
      const pts = h('select', {id: 'mfPts'}, ALLOWED_POINTS.map(n => h('option', {value: n, text: `Games to ${n}`, selected: n === cur.points})));
      const msg = h('p', {class: 'status bad', role: 'alert'});
      dlg.append(h('div', {class: 'dlg'}, h('h3', {text: `Match format · ${row.players[0].name} v ${row.players[1].name}`}),
        h('p', {class: 'help', text: 'Change this match only, before any result is recorded. Games are always won by two points. Anyone already entering a score is asked to reopen the match.'}),
        cur.bestOf === 5 ? h('div', {class: 'notice warn', text: 'This is a historical Best of 5 match. Choosing a new format replaces it for this match.'}) : null,
        h('div', {class: 'grid two'}, h('div', {}, h('label', {for: 'mfBo', text: 'Games'}), bo), h('div', {}, h('label', {for: 'mfPts', text: 'Points per game'}), pts)), msg,
        h('div', {class: 'dlg-actions'}, h('button', {type: 'button', text: 'Cancel', on: {click: close}}),
          h('button', {type: 'button', class: 'primary', text: 'Save format', on: {click: async () => {
            const r = await core.actions.setMatchFormat(row.matchId, Number(bo.value), Number(pts.value));
            if (r.ok) { toast(`Format saved: ${formatText({bestOf: Number(bo.value), points: Number(pts.value)})}.`); close(); render(true); } else msg.textContent = r.message; }}}))));
    }, {label: 'Match format'});
  }

  function openScoreDialog(row, tables) {
    const fmt = formatOf(row);
    const best = fmt.bestOf;
    let winnerId = null, prepared = null;
    const draftGames = Array.from({length: best}, () => ['', '']);
    openDialog((dlg, close) => {
      const body = h('div', {class: 'dlg'});
      dlg.append(body);
      const msg = h('p', {class: 'status bad', role: 'alert'});
      const gameInputs = [];
      const available = Array.from({length: tables}, (_, i) => i + 1).filter(n => !occupiedByOtherMatch(row, n));
      const initial = row.table ?? available[0] ?? null;
      const noFreeTable = initial === null;
      const tableSel = h('select', {id: 'scTable', 'aria-describedby': noFreeTable ? 'scNoFreeTable' : undefined, disabled: noFreeTable},
        initial === null ? h('option', {value: '', text: 'No free table', disabled: true, selected: true}) : null,
        Array.from({length: tables}, (_, i) => {
          const n = i + 1, occupied = occupiedByOtherMatch(row, n);
          return h('option', {value: n, text: occupied ? `Table ${n} · occupied` : `Table ${n}`,
            disabled: occupied, selected: n === initial});
        }));
      function form() {
        gameInputs.length = 0;
        const grid = h('div', {class: 'games'}, h('span'), h('b', {text: row.players[0].name}), h('span'), h('b', {text: row.players[1].name}));
        for (let g = 1; g <= best; g++) {
          const a = h('input', {type: 'text', inputmode: 'numeric', maxlength: 2, 'aria-label': `Game ${g}, ${row.players[0].name}`, pattern: '[0-9]*', value: draftGames[g - 1][0]});
          const b = h('input', {type: 'text', inputmode: 'numeric', maxlength: 2, 'aria-label': `Game ${g}, ${row.players[1].name}`, pattern: '[0-9]*', value: draftGames[g - 1][1]});
          gameInputs.push([a, b]);
          grid.append(h('span', {class: 'muted', text: best === 1 ? 'Game' : `G${g}`}), a, h('span', {text: '–'}), b);
        }
        clear(body).append(h('h3', {text: `Record result · ${roundLabel(row)}`}),
          h('div', {class: 'winner-pick', role: 'radiogroup', 'aria-label': 'Winner'},
            row.players.map(p => h('label', {}, h('input', {type: 'radio', name: 'winner', value: p.id, checked: winnerId === p.id, on: {change: () => { winnerId = p.id; }}}), h('span', {text: `${p.name} won`})))),
          h('p', {class: 'help', text: `${formatText(fmt)}: enter ${best === 1 ? 'the game' : 'each game'} played (first to ${fmt.points}, win by 2).`}), grid,
          h('label', {for: 'scTable', text: 'Table'}), tableSel,
          noFreeTable ? h('p', {class: 'notice warn', id: 'scNoFreeTable', role: 'status', text: 'All tables are occupied. Close this dialog and try again once a table is free. No result has been sent.'}) : null,
          msg,
          h('div', {class: 'dlg-actions'}, h('button', {type: 'button', text: 'Cancel', on: {click: close}}),
            h('button', {type: 'button', class: 'primary', text: 'Review result', disabled: noFreeTable, on: {click: review}})));
      }
      function review() {
        msg.textContent = '';
        if (!tableSel.value) { msg.textContent = 'Choose a free table before reviewing this result.'; return; }
        gameInputs.forEach(([a, b], i) => { draftGames[i] = [a.value, b.value]; });
        if (!winnerId) { msg.textContent = 'Choose who won.'; return; }
        const games = gameInputs.filter(([a, b]) => a.value.trim() !== '' || b.value.trim() !== '').map(([a, b]) => `${a.value.trim()}-${b.value.trim()}`).join(', ');
        const p = core.prepareScore({matchId: row.matchId, winnerId, games, table: Number(tableSel.value), expect: fmt});
        if (!p.ok) { msg.textContent = p.message; return; }
        prepared = p;
        const winner = row.players.find(x => x.id === winnerId), loser = row.players.find(x => x.id !== winnerId);
        const out = h('p', {class: 'status', role: 'status'});
        clear(body).append(h('h3', {text: 'Check before sending'}),
          h('div', {class: 'review'}, `${winner.name} beat ${loser.name}`, h('br'), p.text, h('br'), `Table ${p.tableNumber} · ${roundLabel(row)} · ${formatText(fmt)}`),
          h('p', {class: 'help', text: 'This is sent once. If it cannot be confirmed, the app will NOT resend it by itself.'}), out,
          h('div', {class: 'dlg-actions'},
            h('button', {type: 'button', text: 'Back — edit', on: {click: () => { core.cancelPreparedScore(); form(); }}}),
            h('button', {type: 'button', class: 'primary', text: 'Confirm and send', on: {click: async ev => {
              ev.target.disabled = true; out.textContent = 'Sending…';
              const r = await core.confirmScore(prepared);
              toast(r.message, r.ok ? '' : 'bad'); close(); render(true); }}})));
      }
      dlg.addEventListener('close', () => { if (core.state.score.status === 'prepared') core.cancelPreparedScore(); });
      form();
    }, {label: 'Record result'});
  }
  const roundLabel = r => {
    const total = s.snapshot ? Math.max(...s.snapshot.matches.filter(m => m.bracket === r.bracket).map(m => m.round)) + 1 : r.round + 2;
    return `${r.bracket === 'championship' ? 'Championship' : 'Consolation'} ${roundName(total, r.round, r.bracket)}`;
  };
  function openForfeit(row) {
    let absent = null;
    openDialog((dlg, close) => {
      const reason = h('input', {type: 'text', id: 'ffReason', value: 'Did not arrive at the table', maxlength: 300});
      const msg = h('p', {class: 'status bad', role: 'alert'});
      dlg.append(h('div', {class: 'dlg'}, h('h3', {text: 'Record a no-show'}),
        h('p', {text: 'The opponent advances without a score. This is recorded in the audit log.'}),
        h('div', {class: 'winner-pick', role: 'radiogroup', 'aria-label': 'Who did not show up'},
          row.players.map(p => h('label', {}, h('input', {type: 'radio', name: 'absent', value: p.id, on: {change: () => { absent = p.id; }}}), h('span', {text: `${p.name} did not show`})))),
        h('label', {for: 'ffReason', text: 'Reason'}), reason, msg,
        h('div', {class: 'dlg-actions'}, h('button', {type: 'button', text: 'Cancel', on: {click: close}}),
          h('button', {type: 'button', class: 'danger', text: 'Record no-show', on: {click: async () => {
            if (!absent) { msg.textContent = 'Choose who did not show.'; return; }
            const r = await core.actions.forfeit(row.matchId, row.version, absent, reason.value);
            if (r.ok) { toast('No-show recorded.'); close(); render(true); } else msg.textContent = r.message; }}}))));
    }, {label: 'Record a no-show'});
  }
  function openCorrection(m) {
    const sn = s.snapshot;
    let winnerId = m.winner;
    const fmt = {bestOf: m.bestOf ?? 3, points: m.points ?? 11};
    openDialog((dlg, close) => {
      const scores = h('input', {type: 'text', id: 'crScores', value: m.scores === 'W/O' ? '' : m.scores, placeholder: fmt.bestOf === 1 ? `${fmt.points}-${fmt.points - 6}` : `${fmt.points}-8, 9-${fmt.points}, ${fmt.points}-7`});
      const reason = h('input', {type: 'text', id: 'crReason', maxlength: 300, placeholder: 'Why is this being corrected?'});
      const msg = h('p', {class: 'status bad', role: 'alert'});
      dlg.append(h('div', {class: 'dlg'}, h('h3', {text: `Correct result · ${m.name1} vs ${m.name2}`}),
        h('p', {class: 'help', text: `Only the organizer can correct a result. The change and your reason are written to the audit log. This match was played as ${formatText(fmt)}${m.formatLegacy ? ' (historical format)' : ''}.`}),
        h('div', {class: 'winner-pick', role: 'radiogroup', 'aria-label': 'Winner'},
          [[m.p1, m.name1], [m.p2, m.name2]].map(([id, nm]) => h('label', {}, h('input', {type: 'radio', name: 'crWinner', value: id, checked: id === m.winner, on: {change: () => { winnerId = id; }}}), h('span', {text: `${nm} won`})))),
        h('label', {for: 'crScores', text: 'Game scores (optional)'}), scores, h('label', {for: 'crReason', text: 'Reason (required)'}), reason, msg,
        h('div', {class: 'dlg-actions'}, h('button', {type: 'button', text: 'Cancel', on: {click: close}}),
          h('button', {type: 'button', class: 'primary', text: 'Save correction', on: {click: async () => {
            const norm = normalizeGameScores(scores.value, fmt.bestOf, winnerId === m.p1, fmt.points);
            if (!norm.ok) { msg.textContent = norm.error; return; }
            const live = sn.matches.find(x => x.id === m.id);
            const r = await core.actions.correct(m.id, live.version, winnerId, scores.value, reason.value);
            if (r.ok) { toast('Correction saved.'); close(); render(true); } else msg.textContent = r.message; }}}))));
    }, {label: 'Correct a result'});
  }

  // ------------------------------------------------------------ Doubles finale
  function viewFinale() {
    const sn = s.snapshot;
    if (!sn) return loading();
    const final = sn.matches.find(m => m.bracket === 'championship' && m.isFinal && m.status === 'complete');
    if (!final) return h('div', {class: 'notice warn', text: 'The two finalists are not known yet. The doubles finale follows the championship final.'});
    const f1 = sn.players.find(p => p.id === final.p1), f2 = sn.players.find(p => p.id === final.p2);
    const hasCons = sn.brackets.some(b => b.kind === 'consolation');
    const cand = sn.players.filter(p => p.checkedIn && ![f1.id, f2.id].includes(p.id) && (!hasCons || sn.candidates.some(c => c.playerId === p.id && c.state === 'placed')));
    const ordered = partnerCandidates(cand.map(p => ({...p})));
    const d = sn.doubles;
    const fmt = sn.event.formats.doubles;
    const opts = sel => [h('option', {value: '', text: 'Select a consolation player'}), ordered.map(p => h('option', {value: p.id, text: `${p.name} · Level ${p.rating}`, selected: sel === p.id}))];
    const a = h('select', {id: 'dbA'}, opts(d?.partner1)), b = h('select', {id: 'dbB'}, opts(d?.partner2));
    const teamLine = (x, y) => `${nameOf(x)} + ${nameOf(y)}`;
    const locked = !!d?.winnerTeam;
    const msg = h('p', {class: 'status bad', role: 'alert'});
    const scores = h('input', {type: 'text', id: 'dbScores', placeholder: fmt.bestOf === 1 ? `${fmt.points}-${fmt.points - 6} (optional)` : `${fmt.points}-8, 9-${fmt.points}, ${fmt.points}-7 (optional)`, 'aria-describedby': 'dbHelp'});
    return h('div', {},
      h('section', {class: 'card', 'aria-labelledby': 'dbTitle'},
        h('div', {class: 'card-head'}, h('div', {}, h('h2', {id: 'dbTitle', text: 'Mixed-Skill Doubles finale'}),
          h('p', {class: 'card-sub'}, 'The two championship finalists anchor the teams: ', h('b', {text: f1.name}), ' and ', h('b', {text: f2.name}), '. Each is paired with a beginner-to-intermediate player from the consolation bracket.'))),
        h('div', {class: 'grid two'}, h('div', {}, h('label', {for: 'dbA', text: `Partner for ${f1.name}`}), a), h('div', {}, h('label', {for: 'dbB', text: `Partner for ${f2.name}`}), b)),
        h('div', {class: 'row'},
          h('button', {type: 'button', disabled: locked, text: 'Suggest balanced partners', on: {click: () => {
            const sug = suggestPartners([f1, f2].map(p => ({...p})), ordered);
            if (!sug) { toast('Two finalists and at least two candidates are needed.', 'bad'); return; }
            a.value = sug.partner1.id; b.value = sug.partner2.id;
            remember('dbA', a.value); remember('dbB', b.value); }}}),
          h('button', {type: 'button', class: 'primary', disabled: !core.canWrite() || locked, text: 'Save teams', on: {click: async () => {
            if (!a.value || !b.value || a.value === b.value) { toast('Choose two different partners.', 'bad'); return; }
            result(await core.actions.setDoublesTeams(a.value, b.value), 'Teams saved.'); }}})),
        h('p', {class: 'help', text: 'Present these as teams. Keep individual ratings internal.'})),
      d?.partner1 && d?.partner2 ? h('section', {class: 'card', 'aria-labelledby': 'teamsTitle'}, h('h2', {id: 'teamsTitle', class: 'card-title', text: 'Teams'}),
        h('div', {class: 'grid two'}, h('div', {class: 'stat ice'}, h('b', {text: 'Team A'}), h('span', {text: teamLine(d.finalist1, d.partner1)})),
          h('div', {class: 'stat lav'}, h('b', {text: 'Team B'}), h('span', {text: teamLine(d.finalist2, d.partner2)}))),
        locked ? h('div', {class: 'notice good', id: 'doublesResult'}, h('p', {text: `Result: ${d.winnerTeam === 1 ? 'Team A' : 'Team B'} won · ${formatText(fmt)}.`}),
          d.scores ? scoreTiles(d.scores, {left: 'Team A', right: 'Team B'}) : null)
          : h('form', {on: {submit: async ev => { ev.preventDefault(); msg.textContent = '';
              const team = Number(new FormData(ev.target).get('team'));
              if (!team) { msg.textContent = 'Choose the winning team.'; return; }
              const norm = normalizeGameScores(scores.value, fmt.bestOf, team === 1, fmt.points);
              if (!norm.ok) { msg.textContent = norm.error; return; }
              if (result(await core.actions.recordDoubles(team, scores.value), 'Doubles result recorded.')) forget('dbScores'); }}},
            h('div', {class: 'winner-pick', role: 'radiogroup', 'aria-label': 'Winning team'},
              [[1, 'Team A won'], [2, 'Team B won']].map(([v, t]) => h('label', {}, h('input', {type: 'radio', name: 'team', value: v}), h('span', {text: t})))),
            h('label', {for: 'dbScores', text: `Game scores (optional) · ${formatText(fmt)}`}), scores,
            h('p', {class: 'help', id: 'dbHelp', text: `Games go to ${fmt.points}, won by 2.`}), msg,
            h('div', {class: 'row'}, h('button', {class: 'primary', type: 'submit', disabled: !core.canWrite(), text: 'Record doubles result'})))) : null);
  }

  // ------------------------------------------------------------ Results & export
  function viewResults() {
    const sn = s.snapshot;
    if (!sn) return loading();
    const st = standingsFromSnapshot(sn);
    const e = sn.event;
    const line = (label, v) => v ? h('tr', {}, h('th', {scope: 'row', text: label}), h('td', {text: Array.isArray(v) ? v.join(', ') : v})) : null;
    const publicUrl = config.spectatorUrl;
    return h('div', {},
      h('section', {class: 'card', 'aria-labelledby': 'standTitle'}, h('h2', {id: 'standTitle', class: 'card-title', text: 'Final standings'}),
        st.champion ? h('table', {class: 'kv-table'}, h('tbody', {}, line('Singles champion', st.champion), line('Runner-up', st.runnerUp),
          line('Semifinalists', st.semifinalists.length ? st.semifinalists : null), line('Consolation champion', st.consolationChampion), line('Consolation runner-up', st.consolationRunnerUp),
          st.doubles ? line('Doubles winners', st.doubles.winners.join(' + ')) : null))
          : h('div', {class: 'empty-state', text: 'Standings appear when the championship final is complete.'}),
        h('p', {class: 'help', text: 'Prizes are not assigned automatically. Award positions are confirmed by the organizer.'}),
        st.belowTwoMatches.length && sn.brackets.every(b => b.status === 'complete') ? h('div', {class: 'notice warn', text: `Below the two-match standard: ${st.belowTwoMatches.join(', ')}.`}) : null),
      h('section', {class: 'card', 'aria-labelledby': 'pubTitle'}, h('h2', {id: 'pubTitle', class: 'card-title', text: 'Public view (spectators and TV)'}),
        h('p', {text: e.publicVisible ? 'Spectators can see the bracket, results, Now Playing and Up Next without signing in. Only names, scores, formats and tables are shown — never ratings, contact details or staff data.'
          : 'Nothing is public yet. Turn this on when you are ready for spectators and the TV board to see the event.'}),
        h('div', {class: 'row'}, h('button', {class: e.publicVisible ? '' : 'primary', type: 'button', disabled: !core.canWrite(), text: e.publicVisible ? 'Hide from the public' : 'Publish to spectators',
          on: {click: async () => result(await core.actions.setVisibility(!e.publicVisible), e.publicVisible ? 'No longer public.' : 'Now visible to spectators.')}})),
        publicUrl ? h('p', {class: 'help'}, 'Spectator link: ', h('a', {href: publicUrl, target: '_blank', rel: 'noopener noreferrer', text: publicUrl}), ' · TV board: ', h('a', {href: config.tvUrl, target: '_blank', rel: 'noopener noreferrer', text: config.tvUrl})) : null),
      h('section', {class: 'card', 'aria-labelledby': 'expTitle'}, h('h2', {id: 'expTitle', class: 'card-title', text: 'Export'}),
        h('div', {class: 'row'},
          h('button', {class: 'primary', type: 'button', text: 'Private backup (JSON)', on: {click: async () => {
            const r = await core.actions.exportEvent();
            if (!r.ok) { toast(r.message, 'bad'); return; }
            download(`FFTT_backup_${e.date}.json`, JSON.stringify(r.data, null, 2), 'application/json'); toast('Backup downloaded. It includes internal ratings: keep it private.'); }}}),
          h('button', {type: 'button', text: 'Results (text)', on: {click: () => download(`FFTT_results_${e.date}.txt`, resultsText(sn))}}),
          h('button', {type: 'button', text: 'Matches (CSV)', on: {click: () => download(`FFTT_matches_${e.date}.csv`, matchesCsv(sn), 'text/csv')}}),
          h('button', {type: 'button', text: 'Print', on: {click: () => window.print()}})),
        h('p', {class: 'help', text: 'The private backup contains internal ratings and the audit trail. Results and CSV contain names, scores, formats and teams only; review before sharing.'})),
      h('section', {class: 'card', 'aria-labelledby': 'statusTitle'}, h('h2', {id: 'statusTitle', class: 'card-title', text: 'Event status'}),
        h('div', {class: 'row'},
          h('button', {type: 'button', disabled: !core.canWrite() || e.lifecycle !== 'active', text: 'Mark event complete', on: {click: async () => {
            if (await confirmDialog('Mark the event complete?', 'New match scoring and table assignments stop. An organizer may still make audited corrections to saved results. Publication stays unchanged.', 'Mark complete')) result(await core.actions.setLifecycle('complete'), 'Event marked complete.'); }}}),
          h('button', {type: 'button', class: 'danger', disabled: !core.canWrite() || e.lifecycle === 'archived', text: 'Archive event', on: {click: async () => {
            if (await confirmDialog('Archive this event?', 'It is hidden from the public and moved to Archived. Nothing is deleted: you can restore it from the event list on Overview.', 'Archive', {danger: true})) result(await core.actions.setLifecycle('archived'), 'Archived.'); }}}))),
      h('section', {class: 'card', 'aria-labelledby': 'failTitle'}, h('h2', {id: 'failTitle', class: 'card-title', text: 'If the connection fails'}),
        h('ol', {}, h('li', {text: 'The last bracket stays on screen with a red banner; cloud changes pause by themselves.'}),
          h('li', {text: 'Download a Private backup whenever the connection is good (for example after each round).'}),
          h('li', {}, 'Run the bracket on paper or in the ', h('a', {href: OFFLINE_TOOL, target: '_blank', rel: 'noopener noreferrer', text: 'approved offline Bracket Manager'}), ' on one organizer device.'),
          h('li', {text: 'Enter the finished results here afterwards, one match at a time, only after you have checked the server state.'}))),
      auditCard());
  }
  function auditCard() {
    return h('section', {class: 'card', 'aria-labelledby': 'auditTitle'}, h('div', {class: 'row between'}, h('h2', {id: 'auditTitle', class: 'card-title', text: 'Audit log'}),
      h('button', {class: 'small', type: 'button', text: s.audit ? 'Refresh' : 'Load audit log', on: {click: async () => { await core.actions.loadAudit(); render(true); }}})),
      s.audit ? h('div', {class: 'scroll-x'}, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Action', 'Detail'].map(t => h('th', {scope: 'col', text: t})))),
        h('tbody', {}, s.audit.slice(0, 60).map(a => h('tr', {}, h('td', {class: 'mono', text: a.at.replace('T', ' ').slice(0, 19)}), h('td', {text: a.operation.replaceAll('_', ' ')}), h('td', {text: a.reason ?? ''})))))) : h('p', {class: 'muted', text: 'Every accepted result, correction, bracket build and staff change is recorded.'}));
  }

  // ------------------------------------------------------------ Staff
  function viewStaff() {
    const sn = s.snapshot;
    if (!sn) return loading();
    const email = h('input', {type: 'email', id: 'stEmail', autocapitalize: 'none', autocomplete: 'off', placeholder: 'volunteer@example.org', 'data-draft': 'stEmail'});
    const role = h('select', {id: 'stRole', 'data-draft': 'stRole'}, h('option', {value: 'scorekeeper', text: 'Scorekeeper'}), h('option', {value: 'organizer', text: 'Organizer'}));
    return h('div', {},
      h('section', {class: 'card', 'aria-labelledby': 'staffTitle'}, h('h2', {id: 'staffTitle', class: 'card-title', text: 'Event staff'}),
        h('div', {class: 'scroll-x'}, h('table', {class: 'responsive-table'}, h('thead', {}, h('tr', {}, ['Account', 'Role', 'Status', ''].map(t => h('th', {scope: 'col', text: t})))),
          h('tbody', {}, sn.staff.map(m => h('tr', {}, h('td', {'data-label': 'Account', text: m.email}), h('td', {'data-label': 'Role', text: m.role}), h('td', {'data-label': 'Status'}, pill(m.active ? 'Active' : 'Revoked', m.active ? 'good' : '')),
            h('td', {}, m.active ? h('button', {class: 'small danger', type: 'button', disabled: !core.canWrite(), text: 'Revoke', 'aria-label': `Revoke access for ${m.email}`, on: {click: async () => {
              if (await confirmDialog('Revoke access?', `${m.email} will lose access to this event immediately.`, 'Revoke', {danger: true})) result(await core.actions.setStaff(m.email, 'revoke', null), 'Access revoked.'); }}}) : null)))))),
        h('p', {class: 'help', text: 'Staff accounts are created in advance by the administrator. Here you only give an existing account access to this event, or take it away.'})),
      h('form', {class: 'card', 'aria-labelledby': 'grantTitle', on: {submit: async ev => { ev.preventDefault(); if (result(await core.actions.setStaff(email.value, 'grant', role.value), 'Access granted.')) { email.value = ''; forget('st'); } }}},
        h('h2', {id: 'grantTitle', class: 'card-title', text: 'Give an existing account access'}), h('label', {for: 'stEmail', text: 'Account e-mail'}), email, h('label', {for: 'stRole', text: 'Role'}), role,
        h('div', {class: 'row'}, h('button', {class: 'primary', type: 'submit', disabled: !core.canWrite(), text: 'Grant access'}))));
  }

  // ------------------------------------------------------------ render loop
  const views = {overview: viewOverview, players: viewPlayers, championship: viewChampionship, consolation: viewConsolation,
    desk: viewDesk, finale: viewFinale, results: viewResults, staff: viewStaff};
  function syncConnectionGuard() {
    // A heartbeat may change writability without rebuilding (and erasing) a draft.
    const writable = core.canWrite();
    for (const el of els.main.querySelectorAll('input, select, textarea, button')) {
      if (!writable && !el.disabled) { el.disabled = true; el.dataset.connectionPaused = '1'; }
      else if (writable && el.dataset.connectionPaused === '1') {
        el.disabled = false; delete el.dataset.connectionPaused;
      }
    }
  }
  /** Where the person is: scroll, focused control (and caret) and horizontal scrollers, so a rebuild is invisible. */
  const selectorFor = el => el.id ? `#${CSS.escape(el.id)}` : el.dataset?.draft ? `[data-draft="${CSS.escape(el.dataset.draft)}"]`
    : el.getAttribute('aria-label') ? `[aria-label="${CSS.escape(el.getAttribute('aria-label'))}"]` : null;
  function captureUi() {
    const a = document.activeElement;
    const inMain = a && a !== els.main && els.main.contains(a);
    return {y: window.scrollY, focus: inMain ? {sel: selectorFor(a), start: a.selectionStart ?? null, end: a.selectionEnd ?? null} : null,
      scrollers: [...els.main.querySelectorAll('.scroll-x,.bracket')].map(x => x.scrollLeft)};
  }
  function restoreUi(ui) {
    [...els.main.querySelectorAll('.scroll-x,.bracket')].forEach((x, i) => { if (ui.scrollers[i]) x.scrollLeft = ui.scrollers[i]; });
    if (ui.focus?.sel) {
      let el = null; try { el = els.main.querySelector(ui.focus.sel); } catch { /* odd selector */ }
      if (el && !el.disabled) { el.focus({preventScroll: true}); if (ui.focus.start !== null) { try { el.setSelectionRange(ui.focus.start, ui.focus.end); } catch { /* not a text field */ } } }
    }
    window.scrollTo({top: ui.y});
  }
  function render(force = false) {
    renderChrome();
    const paneKey = JSON.stringify([tab, s.eventId, s.role, s.signedIn,
      s.pulse?.revision, s.pulse?.generation, s.snapshot?.event.revision,
      s.brief?.lifecycle, s.deskStatus, s.pending?.submissionId, s.score.status,
      s.events.map(e => e.eventId + e.lifecycle + e.players + e.deletable).join(), s.audit?.length, s.busy,
      s.registrations.status, s.registrations.at, s.registrationSettings.status, s.registrationSettings.busy, s.registrationSettings.source?.updatedAt,
      s.registrationSettings.inspect?.spreadsheetId, s.registrationSettings.diagnostic?.checks.map(c => c.status).join(), s.registrationSettings.capabilities?.googleMode]);
    if (!force && paneKey === lastPaneKey) { syncConnectionGuard(); return; }
    const active = document.activeElement;
    // typing: text being entered (15 s); a drop-down only protects its own just-made choice for a moment (2 s)
    const typing = active && els.main.contains(active) && Date.now() - lastInputAt < (active.tagName === 'SELECT' ? 2000 : 15000) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
    if (!force && (typing || dirtyDialog > 0)) { syncConnectionGuard(); return; } // never rebuild under a person's fingers
    const ui = captureUi();
    const view = views[tab] ?? views.desk;
    const pane = s.signedIn ? view() : loading();
    const title = {players: 'Players & check-in', championship: 'Championship', consolation: 'Consolation', desk: 'Match Desk',
      finale: 'Doubles Finale', results: 'Results & Export', staff: 'Staff'}[tab];
    const description = {players: 'Check in registered players with one click, add walk-ins and confirm their levels before seeding the bracket.',
      championship: 'Seed the field and build the singles championship bracket.',
      consolation: 'Review first-match losses and build fair additional matches.',
      desk: 'Assign tables and submit server-verified match scores.',
      finale: 'Pair finalists with selected consolation players.',
      results: 'Review standings, publish results and export private backups.',
      staff: 'Manage organizer-approved roles for this event.'}[tab];
    fill(els.main, title && s.signedIn ? h('div', {},
      h('header', {class: 'section-intro'},
        h('div', {class: 'feature-overline'}, h('span', {class: 'feature-spark', 'aria-hidden': 'true'}), 'FORGING FELLOWSHIP · TOURNAMENT DESK'),
        h('h1', {text: title}), h('p', {text: description})), pane) : pane);
    lastPaneKey = paneKey;
    for (const el of els.main.querySelectorAll('[id],[data-draft]')) {
      const k = draftKeyOf(el);
      if (!k || !drafts.has(draftKey(k))) continue;
      const v = drafts.get(draftKey(k));
      if (el.tagName === 'DETAILS') el.open = !!v;
      else if (el.type === 'checkbox') el.checked = !!v;
      else if (typeof v === 'string' || typeof v === 'number') el.value = String(v);
    }
    for (const d of els.main.querySelectorAll('details[data-draft]')) if (d.open) d.dataset.initialToggle = '1';
    restoreUi(ui);
    syncConnectionGuard();
  }
  const capture = ev => {
    if (!els.main.contains(ev.target)) return;
    const k = draftKeyOf(ev.target);
    if (!k) return;
    remember(k, ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value);
  };
  document.addEventListener('input', ev => { if (els.main.contains(ev.target)) lastInputAt = Date.now(); capture(ev); }, true);
  document.addEventListener('change', capture, true);
  // A section's open/closed state is remembered only when the PERSON toggled it. The browser also fires one `toggle`
  // when a rebuilt <details> appears already open; render() marks those so that event is never mistaken for a choice.
  document.addEventListener('toggle', ev => {
    const d = ev.target;
    if (!(d instanceof HTMLDetailsElement) || !els.main.contains(d) || !d.dataset.draft) return;
    if (d.dataset.initialToggle === '1' && d.open) { delete d.dataset.initialToggle; return; }
    delete d.dataset.initialToggle;
    remember(d.dataset.draft, d.open);
  }, true);
  let lastWritable = null;
  setInterval(() => {
    if (!s.signedIn) return;
    renderChrome();
    // a time-based change (the connection went stale, or came back) must disable/enable the buttons now
    const writable = core.canWrite();
    if (writable !== lastWritable) { lastWritable = writable; syncConnectionGuard(); }
  }, 1000);
  return Object.freeze({render, openTab: id => { if (tab !== id) abandonDrafts(); tab = id; render(true); }});
}
