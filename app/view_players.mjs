/** Players & check-in (organizer only). One screen for: the sign-up sheet (read-only), one-click and bulk check-in,
 * duplicate reconciliation, walk-ins, rating confirmation and the roster itself.
 *
 * What is shown about a registrant: name, a masked contact hint ("a•••@e•••.org"), a SUGGESTED level with the plain
 * reasons, and a state. Full contact details never reach this page (the adapter strips them) and nothing here is
 * ever sent to a public view. Every state change goes through the audited server RPCs; this file only asks.
 *
 * UI-only choices (search text, filter, ticked rows, edited names/levels, dismissed duplicate groups) live in this
 * closure, so the background refresh that rebuilds the pane can never reset them. */
import {ratingName} from '../contracts/gameday_engine.mjs';
import {nameKey, similarNames} from '../contracts/registration_model.mjs';
import {createRegistrationSettings, registrationState, STATE_TEXT} from './view_registration.mjs';

const SOURCE_STATE = {'google-sheets': 'connected', 'synthetic-fixture': 'fictional', 'csv-import': 'csv'};
const REASON_TEXT = {'same-email': 'Same e-mail', 'same-phone': 'Same phone', 'same-name': 'Same name', 'similar-name': 'Similar name'};
const FILTERS = [['todo', 'Not checked in'], ['all', 'Everyone'], ['in', 'Checked in'], ['attention', 'Needs a look']];
const CONFIDENCE_TEXT = {high: 'confident', medium: 'fairly sure', low: 'a guess', none: 'no suggestion'};
const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 5 ? 'just now' : s < 90 ? `${s} seconds ago` : `${Math.round(s / 60)} minutes ago`; };

export function createPlayersView(ctx) {
  const {core, s, h, clear, pill, toast, result, confirmDialog, remember, draft, forget, rerender} = ctx;
  const settingsCard = createRegistrationSettings(ctx);
  const reg = {query: '', filter: null, selected: new Set(), edits: new Map(), merge: new Map(), paint: {list: () => {}, bulk: () => {}}, model: () => null};
  const fresh = ref => reg.model()?.rows.find(x => x.r.ref === ref) ?? null;
  const dismissedKey = () => `fftt.reg.dismissed.v1.${s.eventId}`;
  const readDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(dismissedKey()) ?? '[]')); } catch { return new Set(); } };
  const writeDismissed = set => { try { localStorage.setItem(dismissedKey(), JSON.stringify([...set].slice(0, 200))); } catch { /* optional */ } };
  const signature = refs => [...refs].sort().join('|');
  const levelLabel = n => `Level ${n} · ${ratingName(n)}`;
  const writable = () => core.canWrite();

  /** Joins the sheet's registrants to the roster (by opaque ref) and works out each row's state. */
  function model(sn, payload) {
    const byRef = new Map();
    for (const p of sn.players) for (const r of p.registrationRefs) byRef.set(r, p);
    const dismissed = readDismissed();
    const groups = new Map(payload.duplicates.map(g => [g.id, g]));
    const rosterKeys = sn.players.map(p => ({p, key: nameKey(p.name)}));
    const open = new Set();   // unresolved duplicate groups: no member is on the roster yet, and the organizer has not dismissed it
    for (const g of payload.duplicates) {
      const members = g.refs.map(r => byRef.get(r));
      if (!dismissed.has(signature(g.refs)) && members.some(m => !m)) open.add(g.id);
    }
    const rows = payload.registrants.map(r => {
      const player = byRef.get(r.ref) ?? null;
      const edit = reg.edits.get(r.ref) ?? {};
      const name = (edit.name ?? r.name).trim();
      const key = nameKey(name);
      const rosterMatch = player ? null : (rosterKeys.find(x => x.key === key) ?? rosterKeys.find(x => similarNames(x.key, key)))?.p ?? null;
      const dupOpen = r.duplicate && open.has(r.duplicate.group);
      const attention = !!(r.nameIssue || dupOpen || r.ratingConfidence === 'low' || r.ratingConfidence === 'none' || r.ratingReview || rosterMatch);
      const state = player ? (player.checkedIn ? 'in' : 'roster') : 'new';
      return {r, player, name, edit, rosterMatch, dupOpen: !!dupOpen, attention, state, rating: edit.rating ?? r.suggestedRating ?? null};
    });
    return {rows, open: payload.duplicates.filter(g => open.has(g.id)), byRef};
  }

  // ---------------------------------------------------------------- check-in actions
  const itemFor = row => ({ref: row.r.ref, name: row.name, rating: row.rating, source: 'registration',
    ratingConfirmed: row.edit.rating !== undefined, ...(row.rosterMatch && nameKey(row.rosterMatch.name) === nameKey(row.name) ? {linkPlayerId: row.rosterMatch.id} : {})});
  async function checkInRows(refs, label) {
    const rows = refs.map(fresh).filter(Boolean);      // always the CURRENT edits, never a stale copy
    if (!rows.length) return false;
    const unrated = rows.find(x => x.rating === null);
    if (unrated) { toast(`Choose a level for ${unrated.name} first: no level could be suggested.`, 'warn'); return false; }
    const clash = new Map();
    for (const row of rows) { const k = nameKey(row.name); clash.set(k, [...(clash.get(k) ?? []), row.name]); }
    const same = [...clash.values()].find(v => v.length > 1);
    if (same) { toast(`${same[0]} appears more than once in this selection. Review the full names and clarify one entry first.`, 'bad'); return false; }
    const ok = result(await core.actions.checkinRegistrants(rows.map(itemFor), true), label);
    if (ok) for (const row of rows) { reg.selected.delete(row.r.ref); reg.edits.delete(row.r.ref); }
    return ok;
  }

  function registrantRow(row) {
    const {r, player} = row;
    const nameId = 'rn-' + r.ref.slice(0, 10);
    const stateText = row.state === 'in' ? ['Checked in', 'good'] : row.state === 'roster' ? ['On roster, not checked in', 'blue']
      : row.dupOpen ? ['Possible duplicate', 'warn'] : row.rosterMatch ? ['Looks like a roster player', 'warn'] : ['Not checked in', ''];
    const editing = reg.edits.has(r.ref) && reg.edits.get(r.ref).open === true;
    const canAct = row.state !== 'in' && writable() && row.rating !== null;
    const selectable = row.state !== 'in' && !row.dupOpen && row.rating !== null;
    const primary = row.state === 'in'
      ? h('button', {type: 'button', class: 'small', disabled: !writable() || !player, text: 'Undo', 'aria-label': `Undo check-in for ${row.name}`,
        on: {click: async () => result(await core.actions.checkinRegistrants([{ref: r.ref, name: row.name, rating: row.rating, source: 'registration'}], false), `${row.name} is no longer checked in.`)}})
      : row.state === 'roster'
        ? h('button', {type: 'button', class: 'small primary', disabled: !canAct, text: 'Check in', 'aria-label': `Check in ${row.name}`,
          on: {click: async () => result(await core.actions.setCheckin(player.id, true), `${player.name} checked in.`)}})
        : row.dupOpen
          ? h('a', {class: 'link-button', href: '#dups', text: 'Review duplicate', on: {click: ev => { ev.preventDefault(); document.getElementById('dups')?.scrollIntoView({block: 'start'}); document.getElementById('dups')?.focus(); }}})
          : h('button', {type: 'button', class: 'small primary', disabled: !canAct, 'aria-label': `${row.rosterMatch ? 'Link and check in' : 'Check in'} ${row.name}`,
            text: row.rosterMatch && nameKey(row.rosterMatch.name) === nameKey(row.name) ? 'Link & check in' : 'Check in',
            on: {click: async () => { await checkInRows([r.ref], `${row.name} checked in.`); }}});
    return h('li', {class: 'reg-row' + (row.state === 'in' ? ' is-in' : '') + (row.attention && row.state !== 'in' ? ' is-attn' : ''), 'data-ref': r.ref},
      h('label', {class: 'reg-pick'}, h('input', {type: 'checkbox', checked: reg.selected.has(r.ref), disabled: !selectable || !writable(), 'aria-label': `Select ${row.name}`,
        on: {change: ev => { ev.target.checked ? reg.selected.add(r.ref) : reg.selected.delete(r.ref); reg.paint.bulk(); }}})),
      h('div', {class: 'reg-main'},
        h('strong', {class: 'reg-name', text: row.name}),
        h('span', {class: 'reg-sub'},
          r.name !== row.name && r.name !== 'Unnamed registrant' ? `Registered as ${r.name}` : null,
          r.hint.email || r.hint.phone ? h('span', {class: 'reg-hint', text: [r.hint.email, r.hint.phone].filter(Boolean).join(' · '), title: 'Masked: full contact details are never shown here.'}) : null),
        r.nameIssue ? h('span', {class: 'reg-note warn', text: r.nameIssue}) : null,
        r.suggestedRating === null && row.edit.rating === undefined ? h('span', {class: 'reg-note warn', text: 'No playing-assessment answers: choose this player\'s level before checking in.'}) : null,
        r.ratingReview && r.suggestedRating !== null && row.edit.rating === undefined ? h('span', {class: 'reg-note warn', text: 'Organizer review: the answers disagree with the chosen profile. Check the suggested level.'}) : null,
        row.rosterMatch && row.state === 'new' ? h('span', {class: 'reg-note', text: `Roster already has “${row.rosterMatch.name}”.`}) : null),
      h('div', {class: 'reg-level'},
        h('span', {class: 'rating-chip', 'aria-hidden': 'true', text: row.rating === null ? '–' : String(row.rating)}),
        h('span', {class: 'reg-level-text'}, h('span', {text: row.rating === null ? 'No level yet' : levelLabel(row.rating)}),
          h('span', {class: 'muted', text: row.edit.rating !== undefined ? 'Your choice' : row.rating === null ? 'Choose one to check in' : `Suggested · ${CONFIDENCE_TEXT[r.ratingConfidence]}`}))),
      h('div', {class: 'reg-state'}, pill(...stateText)),
      h('div', {class: 'reg-actions'}, primary,
        row.state !== 'in' ? h('button', {type: 'button', class: 'small ghost', 'aria-expanded': String(editing), 'aria-controls': nameId + '-edit', text: editing ? 'Done' : 'Edit',
          'aria-label': `${editing ? 'Finish editing' : 'Edit name and level for'} ${row.name}`,
          on: {click: () => { const e = reg.edits.get(r.ref) ?? {}; reg.edits.set(r.ref, {...e, open: !editing}); reg.paint.list(); }}}) : null),
      editing ? h('div', {class: 'reg-edit', id: nameId + '-edit'},
        h('div', {}, h('label', {for: nameId, text: 'Name on the bracket'}),
          h('input', {type: 'text', id: nameId, maxlength: 80, value: row.name, autocomplete: 'off',
            on: {input: ev => { reg.edits.set(r.ref, {...(reg.edits.get(r.ref) ?? {}), open: true, name: ev.target.value}); }}})),
        h('div', {}, h('label', {for: nameId + '-lv', text: 'FFTT level'}),
          h('select', {id: nameId + '-lv', on: {change: ev => { reg.edits.set(r.ref, {...(reg.edits.get(r.ref) ?? {}), open: true, rating: Number(ev.target.value)}); reg.paint.list(); }}},
            row.rating === null ? h('option', {value: '', text: 'Choose a level', selected: true, disabled: true}) : null,
            [1, 2, 3, 4, 5].map(n => h('option', {value: n, text: levelLabel(n), selected: n === row.rating})))),
        r.ratingBasis.length ? h('div', {class: 'reg-basis'}, h('b', {text: 'Why this suggestion'}), h('ul', {}, r.ratingBasis.map(b => h('li', {text: b})))) : null) : null);
  }

  // ---------------------------------------------------------------- the registration card
  function registrationCard(sn) {
    const rg = s.registrations;
    const listEl = h('ul', {class: 'reg-list', role: 'list', 'aria-label': 'Registrants'});
    const bulkEl = h('div', {class: 'bulk-bar', role: 'region', 'aria-label': 'Bulk check-in', hidden: true});
    const countEl = h('p', {class: 'muted reg-count', role: 'status', 'aria-live': 'polite'});
    const chipsEl = h('div', {class: 'chips', role: 'group', 'aria-label': 'Filter registrants'});
    let view = null;
    const current = () => (rg.payload ? model(sn, rg.payload) : null);
    reg.model = current; reg.paint = {list: () => paintList(), bulk: () => paintBulk()};
    function matches(row) {
      const f = reg.filter ?? 'todo';
      if (f === 'todo' && row.state === 'in') return false;
      if (f === 'in' && row.state !== 'in') return false;
      if (f === 'attention' && !(row.attention && row.state !== 'in')) return false;
      const q = nameKey(reg.query);
      return !q || nameKey(row.name).includes(q) || nameKey(row.r.name).includes(q);
    }
    function paintBulk() {
      if (!view) return;
      const picked = view.rows.filter(x => reg.selected.has(x.r.ref) && x.state !== 'in' && !x.dupOpen && x.rating !== null);
      const ready = view.rows.filter(x => x.state !== 'in' && !x.dupOpen && x.rating !== null && matches(x));
      clear(bulkEl); bulkEl.hidden = picked.length === 0 && ready.length === 0;
      bulkEl.append(
        h('span', {class: 'bulk-count', text: picked.length ? `${picked.length} selected` : `${ready.length} ready to check in`}),
        picked.length
          ? h('span', {class: 'row'},
            h('button', {type: 'button', class: 'primary small', disabled: !writable(), text: `Check in ${picked.length} selected`,
              on: {click: async () => { await checkInRows(picked.map(x => x.r.ref), `${picked.length} player${picked.length === 1 ? '' : 's'} checked in.`); }}}),
            h('button', {type: 'button', class: 'small', text: 'Clear selection', on: {click: () => { reg.selected.clear(); paintList(); }}}))
          : h('span', {class: 'row'},
            h('button', {type: 'button', class: 'small', disabled: ready.length === 0 || !writable(), text: `Select all ${ready.length} shown`,
              on: {click: () => { for (const x of ready) reg.selected.add(x.r.ref); paintList(); }}})));
    }
    function paintList() {
      view = current();
      clear(listEl); clear(chipsEl);
      if (!view) return;
      const counts = {todo: view.rows.filter(x => x.state !== 'in').length, all: view.rows.length, in: view.rows.filter(x => x.state === 'in').length,
        attention: view.rows.filter(x => x.attention && x.state !== 'in').length};
      const active = reg.filter ?? 'todo';
      for (const [id, text] of FILTERS) {
        chipsEl.append(h('button', {type: 'button', class: 'chip', 'aria-pressed': String(active === id), text: `${text} (${counts[id]})`,
          on: {click: () => { reg.filter = id; paintList(); }}}));
      }
      const shown = view.rows.filter(matches);
      for (const row of shown) listEl.append(registrantRow(row));
      countEl.textContent = shown.length === view.rows.length ? `${shown.length} registrant${shown.length === 1 ? '' : 's'}`
        : `Showing ${shown.length} of ${view.rows.length}`;
      if (!shown.length) listEl.append(h('li', {class: 'empty-state', text: reg.query ? 'No one matches that search.' : active === 'todo' ? 'Everyone is checked in. 🎉' : 'Nothing in this view.'}));
      paintBulk();
    }
    const search = h('input', {type: 'search', id: 'regSearch', placeholder: 'Search by name', autocomplete: 'off', value: reg.query, 'aria-label': 'Search registrants by name',
      on: {input: ev => { reg.query = ev.target.value; paintList(); }}});
    const fileInput = h('input', {type: 'file', id: 'regFile', accept: '.csv,text/csv', class: 'sr-only', tabindex: '-1', 'aria-label': 'Registration sheet exported as a CSV file',
      on: {change: async ev => {
        const f = ev.target.files?.[0]; ev.target.value = '';
        if (!f) return;
        if (f.size > 1_000_000) { toast('That file is too large for a sign-up sheet.', 'bad'); return; }
        const r = await core.actions.importRegistrationsCsv(await f.text());
        if (r.ok) { reg.selected.clear(); reg.edits.clear(); toast(`${r.payload.registrants.length} registrants read from the file. They stay in this browser only.`); }
        else toast(r.message, 'warn');
      }}});
    const loading = rg.status === 'loading';
    const head = h('div', {class: 'card-head'},
      h('div', {}, h('h2', {id: 'regTitle', text: 'Registrations'}),
        h('p', {class: 'card-sub', text: 'Find a name, review any suggested level, and check in. Checking in adds a player to the roster if needed.'})),
      h('div', {class: 'row'},
        h('button', {type: 'button', class: 'primary', id: 'regLoad', disabled: loading || !writable(), text: loading ? 'Loading…' : rg.payload ? 'Reload from the sheet' : 'Load registrations', 'aria-busy': String(loading),
          on: {click: async () => { const r = await core.actions.loadRegistrations(); if (r.ok) toast(`${r.payload.registrants.length} registrants loaded.`); /* a failure is explained once, inline, below */ }}}),
        h('button', {type: 'button', id: 'regImport', text: 'Import a private CSV…', on: {click: () => fileInput.click()}}),
        fileInput,
        rg.payload ? h('button', {type: 'button', class: 'ghost', text: 'Clear list', title: 'Forget the loaded registrations in this browser', on: {click: () => { reg.selected.clear(); reg.edits.clear(); core.actions.clearRegistrations(); }}}) : null));
    let body;
    if (!rg.payload) {
      if (rg.status === 'error') {
        const st = STATE_TEXT[registrationState({code: rg.code})];
        // ONE persistent, plain explanation (never also a toast): what happened, and what to do
        body = h('div', {class: 'notice ' + (st.tone || 'warn'), role: 'alert', id: 'regError'}, h('b', {text: st.label + '. '}), rg.error,
          rg.code === 'not-configured' ? ' A private CSV file is read in this browser only; it is not uploaded or saved.' : null);
      } else body = h('div', {class: 'empty-state', text: loading ? 'Reading the registrations…' : 'Load sign-ups to search and check in players. To change the source, use Registration settings above.'});
    } else {
      body = h('div', {class: 'reg-body'},
        h('div', {class: 'reg-meta'},
          pill(STATE_TEXT[SOURCE_STATE[rg.payload.source]]?.label ?? 'Registrations', STATE_TEXT[SOURCE_STATE[rg.payload.source]]?.tone ?? ''),
          rg.payload.sourceName ? h('span', {class: 'muted', text: rg.payload.sourceName}) : null,
          h('span', {class: 'muted', text: `Loaded ${ago(Date.now() - rg.at)}`}),
          rg.error ? pill('Reload failed — showing the last list', 'bad') : null,
          rg.payload.summary.needsRating ? pill(`${rg.payload.summary.needsRating} need a level`, 'warn') : null,
          rg.payload.summary.needsNameFix ? pill(`${rg.payload.summary.needsNameFix} name${rg.payload.summary.needsNameFix === 1 ? '' : 's'} to check`, 'warn') : null),
        rg.error ? h('div', {class: 'notice warn', role: 'alert', id: 'regError', text: rg.error}) : null,
        rg.payload.warnings.map(w => h('div', {class: 'notice warn', text: w})),
        h('div', {class: 'reg-tools'}, h('div', {class: 'reg-search'}, h('label', {for: 'regSearch', class: 'sr-only', text: 'Search registrants'}), search), chipsEl),
        countEl, bulkEl, listEl);
    }
    queueMicrotask(paintList);
    return h('section', {class: 'card reg-card', 'aria-labelledby': 'regTitle'}, head, body);
  }

  // ---------------------------------------------------------------- duplicates
  function duplicatesCard(sn) {
    const rg = s.registrations;
    if (!rg.payload) return null;
    const v = model(sn, rg.payload);
    if (!v.open.length) return null;
    return h('section', {class: 'card card-warn', id: 'dups', tabindex: '-1', 'aria-labelledby': 'dupTitle'},
      h('div', {class: 'card-head'}, h('div', {}, h('h2', {id: 'dupTitle', text: `Possible duplicates (${v.open.length})`}),
        h('p', {class: 'card-sub', text: 'These registrations look like the same person. Choose the one to keep: the others are merged into the same player. If they are different people, say so and nothing changes.'}))),
      v.open.map(g => {
        const members = g.refs.map(ref => v.rows.find(x => x.r.ref === ref)).filter(Boolean);
        const chosen = reg.merge.get(g.id) ?? members.find(m => m.player)?.r.ref ?? members[0].r.ref;
        const primary = members.find(m => m.r.ref === chosen) ?? members[0];
        return h('div', {class: 'dup-group'},
          h('div', {class: 'row'}, h('b', {text: members.map(m => m.name).filter((x, i, a) => a.indexOf(x) === i).join(' / ')}),
            ...g.reasons.map(x => pill(REASON_TEXT[x], x === 'same-email' || x === 'same-phone' ? 'warn' : ''))),
          h('div', {class: 'dup-members', role: 'radiogroup', 'aria-label': 'Registration to keep'},
            members.map(m => h('label', {class: 'dup-member'},
              h('input', {type: 'radio', name: 'keep-' + g.id, value: m.r.ref, checked: m.r.ref === chosen, on: {change: () => { reg.merge.set(g.id, m.r.ref); rerender(); }}}),
              h('span', {}, h('strong', {text: m.name}), h('span', {class: 'muted', text: [m.r.registeredAt && `registered ${m.r.registeredAt}`, m.r.hint.email, m.r.hint.phone].filter(Boolean).join(' · ')}))))),
          h('div', {class: 'row'},
            h('button', {type: 'button', class: 'primary small', disabled: !writable(), text: 'Same person: merge and check in',
              on: {click: async () => {
                const others = members.filter(m => m !== primary);
                const items = [itemFor(primary), ...others.map(o => ({ref: o.r.ref, name: o.name, rating: o.rating, source: 'registration', sameAsRef: primary.r.ref}))];
                if (result(await core.actions.checkinRegistrants(items, true), `${primary.name} checked in (${members.length} registrations merged).`)) { reg.merge.delete(g.id); }
              }}}),
            h('button', {type: 'button', class: 'small', text: 'Different people',
              on: {click: () => { const d = readDismissed(); d.add(signature(g.refs)); writeDismissed(d); toast('Marked as different people.'); rerender(); }}})));
      }));
  }

  // ---------------------------------------------------------------- walk-ins
  function walkInCard(sn) {
    let rating = draft('walkRating', 3);
    const name = h('input', {type: 'text', id: 'wName', maxlength: 80, autocomplete: 'off', placeholder: 'First and last name', 'data-draft': 'walkName', required: true, 'aria-describedby': 'wHelp'});
    const msg = h('p', {class: 'status bad', role: 'alert', id: 'wMsg'});
    const hint = h('span', {class: 'muted', text: ratingName(rating)});
    const seg = h('div', {class: 'seg', role: 'radiogroup', 'aria-label': 'FFTT level for the walk-in'},
      [1, 2, 3, 4, 5].map(n => h('label', {}, h('input', {type: 'radio', name: 'wRating', value: n, checked: n === rating,
        on: {change: () => { rating = n; remember('walkRating', n); hint.textContent = ratingName(n); }}}), h('span', {text: String(n)}))));
    const go = async () => {
      msg.textContent = '';
      const v = name.value.trim().replace(/\s+/g, ' ');
      if (!v) { msg.textContent = 'Enter the walk-in’s name.'; name.focus(); return; }
      if (sn.players.some(p => nameKey(p.name) === nameKey(v))) { msg.textContent = `${v} is already on the roster. Check the full name before adding another player.`; name.focus(); return; }
      if (result(await core.actions.checkinRegistrants([{name: v, rating, source: 'walk_in'}], true), `${v} checked in.`)) { name.value = ''; forget('walk'); rerender(); document.getElementById('wName')?.focus(); }
    };
    return h('section', {class: 'card', 'aria-labelledby': 'walkTitle'},
      h('div', {class: 'card-head'}, h('div', {}, h('h2', {id: 'walkTitle', text: 'Quick walk-in check-in'}),
        h('p', {class: 'card-sub', id: 'wHelp', text: 'Add someone who did not register online. Name only, no contact details.'}))),
      h('form', {class: 'walk-form', novalidate: true, on: {submit: ev => { ev.preventDefault(); go(); }}},
        h('div', {class: 'walk-name'}, h('label', {for: 'wName', text: 'Name'}), name),
        h('fieldset', {class: 'walk-level'}, h('legend', {}, 'FFTT level ', hint), seg),
        h('div', {class: 'walk-go'}, h('button', {type: 'submit', class: 'primary', disabled: !writable(), text: 'Add and check in'})),
        msg));
  }

  // ---------------------------------------------------------------- roster
  function rosterCard(sn) {
    const built = sn.brackets.length > 0;
    const inBracket = new Set(sn.matches.flatMap(m => [m.p1, m.p2]).filter(Boolean));
    const unconfirmed = sn.players.filter(p => !p.ratingConfirmed);
    const srcText = {manual: 'Entered by hand', registration: 'Registration', walk_in: 'Walk-in'};
    const checked = sn.players.filter(p => p.checkedIn).length;
    const rows = sn.players.map(p => h('tr', {class: 'player-row'},
      h('td', {'data-label': 'Player'}, h('strong', {text: p.name}), h('span', {class: 'src', text: srcText[p.source]})),
      h('td', {'data-label': 'Level'}, h('select', {'aria-label': `Level for ${p.name}`, disabled: !writable(),
        on: {change: async ev => result(await core.actions.confirmRatings([{id: p.id, rating: Number(ev.target.value)}]), `${p.name}: level confirmed.`)}},
        [1, 2, 3, 4, 5].map(n => h('option', {value: n, text: levelLabel(n), selected: n === p.rating})))),
      h('td', {'data-label': 'Review'}, p.ratingConfirmed ? pill('Confirmed', 'good')
        : h('span', {class: 'row tight'}, pill('Suggested', 'warn'), h('button', {type: 'button', class: 'small', disabled: !writable(), text: 'Confirm', 'aria-label': `Confirm level ${p.rating} for ${p.name}`,
          on: {click: async () => result(await core.actions.confirmRatings([{id: p.id, rating: p.rating}]), `${p.name}: level ${p.rating} confirmed.`)}}))),
      h('td', {'data-label': 'Experience'}, h('select', {'aria-label': `Rating basis for ${p.name}`, disabled: !writable(),
        on: {change: async ev => result(await core.actions.updatePlayer({...p, ratingStatus: ev.target.value}))}},
        [['provisional', 'Provisional'], ['established', 'Established']].map(([v, t]) => h('option', {value: v, text: t, selected: v === p.ratingStatus})))),
      h('td', {'data-label': 'Checked in'}, h('label', {class: 'check'}, h('input', {type: 'checkbox', checked: p.checkedIn, disabled: !writable() || (inBracket.has(p.id) && p.checkedIn), 'aria-label': `${p.name} checked in`,
        on: {change: async ev => { const r = await core.actions.setCheckin(p.id, ev.target.checked); if (!result(r)) ev.target.checked = !ev.target.checked; }}}))),
      h('td', {'data-label': 'Status'}, inBracket.has(p.id) ? pill('In bracket', 'blue') : h('button', {class: 'small danger', type: 'button', disabled: !writable(), text: 'Remove', 'aria-label': `Remove ${p.name}`,
        on: {click: async () => { if (await confirmDialog('Remove player?', `Remove ${p.name} from the roster?`, 'Remove', {danger: true})) result(await core.actions.removePlayer(p.id), 'Player removed.'); }}}))));
    return h('section', {class: 'card', 'aria-labelledby': 'rosterTitle'},
      h('div', {class: 'card-head'}, h('div', {}, h('h2', {id: 'rosterTitle', text: `Roster · ${checked} of ${sn.players.length} checked in`}),
        h('p', {class: 'card-sub', text: 'Review playing levels and attendance before seeding. Ratings stay private to staff.'})),
        h('div', {class: 'row'},
          unconfirmed.length ? h('button', {type: 'button', class: 'small primary', disabled: !writable(), text: `Confirm ${unconfirmed.length} suggested level${unconfirmed.length === 1 ? '' : 's'}`,
            on: {click: async () => { if (await confirmDialog('Confirm all suggested levels?', `This marks the ${unconfirmed.length} suggested level${unconfirmed.length === 1 ? '' : 's'} as reviewed. Change any you disagree with first.`, 'Confirm levels')) result(await core.actions.confirmRatings(unconfirmed.map(p => ({id: p.id, rating: p.rating}))), 'Levels confirmed.'); }}}) : null,
          h('button', {class: 'small', type: 'button', disabled: !writable(), text: 'Check in all', on: {click: async () => result(await core.actions.setCheckinAll(true))}}),
          h('button', {class: 'small', type: 'button', disabled: !writable() || built, text: 'Clear check-ins', title: built ? 'Not possible once a bracket is built' : null, on: {click: async () => result(await core.actions.setCheckinAll(false))}}))),
      sn.players.length ? h('div', {class: 'scroll-x'}, h('table', {class: 'responsive-table'},
        h('thead', {}, h('tr', {}, ['Player', 'Level', 'Review', 'Experience', 'Checked in', ''].map(t => h('th', {scope: 'col', text: t})))),
        h('tbody', {}, rows)))
        : h('div', {class: 'empty-state', text: 'No players yet. Load the registrations, add a walk-in or enter names by hand.'}));
  }

  // ---------------------------------------------------------------- manual entry (names only)
  function manualCard(sn) {
    const name = h('input', {type: 'text', id: 'pName', maxlength: 80, autocomplete: 'off', placeholder: 'First and last name', 'data-draft': 'pName', required: true});
    let rating = draft('pRating', 3);
    const hint = h('span', {class: 'muted', text: '· ' + ratingName(rating)});
    const ratingSeg = h('div', {class: 'seg', role: 'radiogroup', 'aria-label': 'FFTT rating'},
      [1, 2, 3, 4, 5].map(n => h('label', {}, h('input', {type: 'radio', name: 'pRating', value: n, checked: n === rating, on: {change: () => { rating = n; remember('pRating', n); hint.textContent = '· ' + ratingName(n); }}}), h('span', {text: String(n)}))));
    const bulk = h('textarea', {id: 'pBulk', 'data-draft': 'pBulk', placeholder: 'One player per line:  Name, rating (1-5), provisional|established\nAda Quill, 3, provisional'});
    return h('details', {class: 'card details-card', 'data-draft': 'manualOpen', open: draft('manualOpen', sn.players.length === 0 && !s.registrations.payload)},
      h('summary', {}, h('span', {class: 'summary-title', text: 'Enter names by hand'}), h('span', {class: 'muted', text: 'Add several names at once; use walk-in check-in for individual arrivals.'})),
      h('div', {class: 'grid two manual-grid'},
        h('form', {class: 'manual-form', on: {submit: async ev => { ev.preventDefault();
          if (result(await core.actions.addPlayers([{name: name.value, rating, rating_status: 'provisional'}]), 'Player added.')) { name.value = ''; forget('pName'); document.getElementById('pName')?.focus(); } }}},
          h('h3', {text: 'Add a player'}), h('label', {for: 'pName', text: 'Name'}), name,
          h('fieldset', {}, h('legend', {}, 'FFTT rating ', hint), ratingSeg),
          h('div', {class: 'row'}, h('button', {class: 'primary', type: 'submit', disabled: !writable(), text: 'Add player'})),
          h('p', {class: 'help', text: 'Ratings are internal to FFTT staff and never shown to spectators. Do not enter phone numbers or e-mail addresses.'})),
        h('div', {class: 'manual-form'}, h('h3', {text: 'Paste a list'}), h('label', {for: 'pBulk', text: 'Players'}), bulk,
          h('div', {class: 'row'}, h('button', {type: 'button', disabled: !writable(), text: 'Add players from list', on: {click: async () => {
            const parsed = ctx.parseBulk(bulk.value);
            if (parsed.errors.length) { toast(parsed.errors[0], 'bad'); return; }
            if (!parsed.players.length) return;
            if (result(await core.actions.addPlayers(parsed.players), `${parsed.players.length} player(s) added.`)) { bulk.value = ''; forget('pBulk'); }
          }}})))));
  }

  return function viewPlayers() {
    const sn = s.snapshot;
    if (!sn) return ctx.loading();
    const built = sn.brackets.length > 0;
    const checked = sn.players.filter(p => p.checkedIn).length;
    const unconfirmed = sn.players.filter(p => !p.ratingConfirmed).length;
    const rg = s.registrations.payload;
    const onRoster = rg ? new Set(sn.players.flatMap(p => p.registrationRefs)) : null;
    const kpi = (n, label, tone) => h('div', {class: 'mini-kpi ' + (tone ?? '')}, h('strong', {text: String(n)}), h('span', {text: label}));
    return h('div', {class: 'players-page'},
      built ? h('div', {class: 'notice warn players-bracket-notice', role: 'status', text: 'Championship bracket already built. New check-ins will not appear until you rebuild it.'}) : null,
      h('div', {class: 'mini-kpis', role: 'group', 'aria-label': 'Check-in summary'},
        kpi(checked, 'Checked in', 'ice'), kpi(sn.players.length, 'On the roster', 'lav'),
        rg ? kpi(rg.registrants.filter(r => !onRoster.has(r.ref)).length, 'Registered, not here yet', 'lime') : null,
        kpi(unconfirmed, 'Levels to confirm', unconfirmed ? 'butter' : '')),
      h('div', {class: 'players-workspace'},
        h('div', {class: 'players-main'}, settingsCard(sn), registrationCard(sn), duplicatesCard(sn)),
        h('div', {class: 'players-side'}, walkInCard(sn))),
      rosterCard(sn), manualCard(sn));
  };
}
