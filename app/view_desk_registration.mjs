/** Registered-player lookup for the Bracket Manager's event-day Check-in screen.
 *
 * What it does: loads THIS event's registrations (from the Organizer's saved source, through the server), searches them by name, shows
 * each person's suggested level and whether they are already on the roster, warns about duplicate sign-ups and same-named roster
 * players, and checks a person in (adding them to the roster when needed).
 * What it never does: show or hold a contact detail, a sheet link, a credential or a raw form answer; send a name or a level the
 * server did not give it as anything but a choice of level (the server re-reads the sheet and the database verifies it); or change
 * the registration source. Walk-ins stay a separate form above. Every permission and every outcome is decided by the server; this
 * file shows state and asks. */
import {nameKey} from '../contracts/registration_model.mjs';
import {ratingName} from '../contracts/gameday_engine.mjs';
import {levelShield} from './view_players.mjs';

const CONFIDENCE_TEXT = {high: 'confident', medium: 'fairly sure', low: 'a guess', none: 'no suggestion'};
const REASON_TEXT = {'same-email': 'same e-mail', 'same-phone': 'same phone', 'same-name': 'same name', 'similar-name': 'similar name'};
const levelLabel = n => `Level ${n} · ${ratingName(n)}`;
const ago = ms => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 5 ? 'just now' : sec < 90 ? `${sec} seconds ago` : `${Math.round(sec / 60)} minutes ago`; };

export function createDeskRegistration(ctx) {
  const {core, s, h, pill, toast, openDialog, rerender, draft} = ctx;
  let tried = null;
  const lk = () => s.registrationLookup;
  // Load once per fresh (idle) state: the core replaces the object whenever it clears private data (event switch, background, sign-out), so the list
  // reloads by itself after each of those, never loops, and a failed or offline attempt is not retried until the person presses Load/Reload.
  const ensureLoaded = () => {
    const L = lk();
    if (L.status === 'idle' && L !== tried && s.role === 'bracket_manager') { tried = L; queueMicrotask(() => core.actions.loadRegistrationLookup()); }
  };

  /** Joins the lookup to the roster snapshot. The database's own link decides who is "on the roster"; a same-named roster player that
   * is NOT linked is surfaced so nobody is added twice by accident. */
  function model(sn, payload) {
    const players = new Map(sn.players.map(p => [p.id, p]));
    const byName = new Map(sn.players.map(p => [nameKey(p.name), p]));
    const byRef = new Map(payload.registrants.map(r => [r.ref, r]));
    const groups = new Map(payload.duplicates.map(d => [d.id, d]));
    return payload.registrants.map(r => {
      const player = r.roster ? players.get(r.roster.playerId) ?? null : null;
      const checkedIn = r.roster ? (player ? player.checkedIn : r.roster.checkedIn) : false;
      const sameName = r.roster ? null : (byName.get(nameKey(r.name)) ?? null);
      const group = r.duplicate ? groups.get(r.duplicate.group) ?? null : null;
      const others = group ? group.refs.filter(x => x !== r.ref).map(x => byRef.get(x)).filter(Boolean) : [];
      const pending = r.roster ? [] : others.filter(o => !o.roster);
      const needsReview = !r.roster && !r.nameIssue && (pending.length > 0 || sameName !== null || r.suggestedRating === null);
      const state = r.roster ? (checkedIn ? 'in' : 'roster') : 'new';
      return {r, player, checkedIn, sameName, group, others, pending, needsReview, state};
    });
  }

  const outcomeText = (row, res, merged) => {
    const name = row.r.name;
    const extra = merged ? ` (${merged} duplicate registration${merged === 1 ? '' : 's'} merged)` : '';
    if (res.outcome === 'linked') return `${name} matched to the roster and checked in${extra}.`;
    if (res.status === 'unchanged') return `${name} was already checked in.`;
    return `${name} checked in${extra}.`;
  };

  async function submit(row, opts, onDone) {
    const res = await core.actions.checkinRegistration({ref: row.r.ref, ...opts});
    if (res.ok) { toast(outcomeText(row, res.result, (opts.mergeRefs ?? []).length)); onDone?.(true, null); return true; }
    if (res.message) toast(res.message, res.kind === 'outcome-unknown' ? 'warn' : 'bad');
    onDone?.(false, res.message);
    return false;
  }

  const d = (dlg, kids) => dlg.append(h('div', {class: 'dlg'}, kids));
  /** The review dialog: only what needs a decision (level, same person on the roster, duplicate submissions). */
  function review(row, locked) {
    const {r} = row;
    // matching a same-named roster player never changes that player's level; the number is only needed to satisfy the request
    let level = r.suggestedRating ?? row.sameName?.rating ?? null, busy = false;
    const merge = new Map(row.pending.map(o => [o.ref, r.duplicate?.strength !== 'possible']));
    openDialog((dlg, close) => {
      const msg = h('div', {class: 'notice bad', role: 'alert', id: 'deskReviewMsg', hidden: true});
      const confirmBtn = h('button', {type: 'button', class: 'primary', id: 'deskReviewGo', text: row.sameName ? 'Link & check in' : 'Check in'});
      const sync = () => { confirmBtn.disabled = busy || locked || !Number.isInteger(level); };
      const levelSel = h('select', {id: 'deskReviewLevel', 'aria-describedby': 'deskReviewLevelHelp', on: {change: ev => { level = Number(ev.target.value); sync(); }}},
        level === null ? h('option', {value: '', text: 'Choose a level', selected: true, disabled: true}) : null,
        [1, 2, 3, 4, 5].map(n => h('option', {value: n, text: levelLabel(n), selected: n === level})));
      confirmBtn.addEventListener('click', async () => {
        if (busy || !Number.isInteger(level)) return;
        busy = true; sync(); msg.hidden = true;
        const ok = await submit(row, {level: level === r.suggestedRating ? null : level,
          mergeRefs: row.pending.filter(o => merge.get(o.ref)).map(o => o.ref), linkPlayerId: row.sameName?.id ?? null},
          (done, message) => { if (!done) { busy = false; sync(); msg.textContent = message || 'That did not work.'; msg.hidden = false; } });
        if (ok) close();
      });
      sync();
      d(dlg, [
        h('h3', {text: row.sameName ? `Match ${r.name} to the roster` : `Check in ${r.name}`}),
        r.registeredAt ? h('p', {class: 'muted', text: `Signed up ${r.registeredAt}`}) : null,
        row.sameName ? h('div', {class: 'notice warn', role: 'note'}, h('b', {text: 'Already on the roster. '}),
          `“${row.sameName.name}” (${levelLabel(row.sameName.rating)}, ${row.sameName.checkedIn ? 'checked in' : 'not checked in'}) has the same name. If this is the same person, this registration is matched to them and they are checked in; their level is not changed.`) : null,
        row.sameName ? null : h('div', {class: 'field'}, h('label', {for: 'deskReviewLevel', text: 'FFTT level'}), levelSel,
          h('p', {class: 'help', id: 'deskReviewLevelHelp', text: level === null ? 'The sign-up form did not give enough information to suggest a level. Choose one.'
            : `Suggested from the sign-up form (${CONFIDENCE_TEXT[r.ratingConfidence]}). Change it if you know better.`}),
          r.ratingBasis.length ? h('ul', {class: 'desk-reg-basis'}, r.ratingBasis.map(b => h('li', {text: b}))) : null),
        row.pending.length ? h('fieldset', {class: 'desk-reg-merge'}, h('legend', {text: 'Other sign-ups that look like the same person'}),
          h('p', {class: 'help', text: 'Merging means they are the same person: one roster spot, nobody added twice. Leave a box empty if it is a different person.'}),
          row.pending.map(o => h('label', {class: 'check desk-reg-merge-row'},
            h('input', {type: 'checkbox', checked: merge.get(o.ref), on: {change: ev => merge.set(o.ref, ev.target.checked)}, 'aria-label': `Same person: ${o.name}`}),
            h('span', {}, h('b', {text: o.name}), h('span', {class: 'muted', text: ` · ${[o.registeredAt ? `signed up ${o.registeredAt}` : null, o.duplicate ? o.duplicate.reasons.map(x => REASON_TEXT[x]).join(', ') : null].filter(Boolean).join(' · ')}`}))))) : null,
        locked ? h('div', {class: 'notice warn', text: 'Check-in is locked.'}) : null,
        msg,
        h('div', {class: 'dlg-actions'}, h('button', {type: 'button', text: 'Cancel', on: {click: close}}), confirmBtn)]);
    }, {label: `Check in ${r.name}`});
  }
  function rowView(row, locked) {
    const {r} = row;
    const busy = lk().busyRef !== null;
    const thisBusy = lk().busyRef === r.ref;
    const writable = core.canWrite() && !locked && (!busy || thisBusy);
    let action = null, state = null;
    if (row.state === 'in') state = pill('Checked in', 'good');
    else if (row.state === 'roster') {
      state = pill('On roster · not checked in', 'blue');
      action = h('button', {type: 'button', class: 'small primary', disabled: !core.canWrite() || locked, text: 'Check in', 'aria-label': `Check in ${r.name}`,
        on: {click: async () => { const res = await core.actions.setCheckin(row.r.roster.playerId, true); toast(res.ok ? `${r.name} checked in.` : (res.message ?? 'That did not work.'), res.ok ? '' : 'bad'); }}});
    } else if (r.nameIssue) {
      state = pill('Name needs fixing', 'warn');
    } else {
      state = row.pending.length ? pill('Possible duplicate', 'warn') : row.sameName ? pill('Roster has this name', 'warn') : null;
      action = row.needsReview
        ? h('button', {type: 'button', class: 'small primary', disabled: !writable, text: row.sameName ? 'Review & match' : 'Review & check in', 'aria-label': `Review and check in ${r.name}`, on: {click: () => review(row, locked)}})
        : h('button', {type: 'button', class: 'small primary', disabled: !writable, 'aria-busy': String(thisBusy), text: thisBusy ? 'Checking in…' : 'Check in', 'aria-label': `Check in ${r.name}`,
          on: {click: () => submit(row, {})}});
    }
    return h('li', {class: 'desk-reg-row' + (row.state === 'in' ? ' is-in' : '') + (row.needsReview || r.nameIssue ? ' is-attn' : ''), 'data-ref': r.ref},
      h('div', {class: 'desk-reg-main'}, h('strong', {class: 'desk-reg-name', text: r.name}),
        r.nameIssue ? h('span', {class: 'reg-note warn', text: `${r.nameIssue} Ask the Organizer to fix the sheet, or add this player as a walk-in with their full name.`}) : null,
        row.sameName && row.state === 'new' ? h('span', {class: 'reg-note', text: `The roster already has “${row.sameName.name}”.`}) : null,
        row.pending.length ? h('span', {class: 'reg-note', text: `Looks like ${row.pending.map(o => o.name).join(', ')}.`}) : null),
      h('div', {class: 'reg-level'}, levelShield(row.player?.rating ?? r.suggestedRating),
        h('span', {class: 'reg-level-text'},
          h('span', {text: row.player ? levelLabel(row.player.rating) : r.suggestedRating === null ? 'No level yet' : levelLabel(r.suggestedRating)}),
          h('span', {class: 'muted', text: row.player ? 'On the roster' : r.suggestedRating === null ? 'Choose one to check in' : `Suggested · ${CONFIDENCE_TEXT[r.ratingConfidence]}`}))),
      h('div', {class: 'desk-reg-actions'}, state, action));
  }

  return function deskRegistrationCard(sn, {eligible}) {
    ensureLoaded();
    const L = lk(), payload = L.payload;
    const locked = !eligible || (payload ? !payload.checkInOpen : false);
    const loading = L.status === 'loading';
    const rows = payload ? model(sn, payload) : [];
    const query = String(draft('bmSearch', '') ?? '');
    const list = h('ul', {class: 'desk-reg-list', id: 'deskRegList', 'aria-label': 'Registered players'});
    const count = h('p', {class: 'reg-count muted', id: 'deskRegCount', role: 'status'});
    const paint = q => {
      const keys = nameKey(q).split(' ').filter(Boolean);
      const shown = rows.filter(x => keys.every(k => nameKey(x.r.name).includes(k)));
      list.replaceChildren(...shown.map(x => rowView(x, locked)));
      const inCount = rows.filter(x => x.state === 'in').length;
      count.textContent = rows.length === 0 ? '' : keys.length ? `${shown.length} of ${rows.length} registered match “${q.trim()}” · ${inCount} checked in` : `${rows.length} registered · ${inCount} checked in`;
      if (rows.length && !shown.length) list.append(h('li', {class: 'empty-state', text: 'No registered player matches that name. They may be a walk-in: use the form above.'}));
    };
    const search = h('input', {type: 'search', id: 'bmSearch', 'data-draft': 'bmSearch', autocomplete: 'off', spellcheck: 'false', maxlength: 80, placeholder: 'Search registered players by name',
      'aria-label': 'Search registered players by name', disabled: !payload, on: {input: ev => paint(ev.target.value)}});
    const reload = h('button', {type: 'button', class: 'primary', id: 'deskRegLoad', disabled: loading, 'aria-busy': String(loading),
      text: loading ? 'Loading…' : payload ? 'Reload list' : 'Load registrations', on: {click: async () => { const r = await core.actions.loadRegistrationLookup(); if (r.ok) toast(`${r.payload.registrants.length} registered players loaded.`); }}});
    paint(query);
    const body = [];
    if (L.status === 'error' && !payload) body.push(h('div', {class: 'notice warn', role: 'alert', id: 'deskRegError', text: L.error}));
    else if (L.error && payload) body.push(h('div', {class: 'notice warn', role: 'alert', id: 'deskRegError', text: `${L.error} Showing the list from ${ago(Date.now() - L.at)}.`}));
    if (!payload && L.status !== 'error') body.push(h('div', {class: 'empty-state', text: loading ? 'Reading the registrations…' : 'Load the sign-ups to search for a player and check them in.'}));
    if (payload) {
      if (locked) body.push(h('div', {class: 'notice warn', role: 'status', text: 'Check-in is closed (the bracket has been built or the event is not open). Contact the Organizer about a late arrival.'}));
      if (payload.summary.duplicateGroups) body.push(h('p', {class: 'help', text: `${payload.summary.duplicateGroups} sign-up${payload.summary.duplicateGroups === 1 ? '' : 's'} may be the same person: use Review to decide.`}));
      body.push(h('div', {class: 'reg-tools'}, h('div', {class: 'reg-search field'}, h('label', {for: 'bmSearch', class: 'sr-only', text: 'Search registered players by name'}), search)), count, list);
    }
    const stamp = payload ? h('span', {class: 'muted', id: 'deskRegStamp', text: `Updated ${ago(Date.now() - L.at)}`}) : null;
    return h('section', {class: 'card desk-reg', id: 'deskReg', 'aria-labelledby': 'deskRegTitle', 'aria-busy': String(loading || L.busyRef !== null)},
      h('div', {class: 'card-head'}, h('div', {}, h('h2', {id: 'deskRegTitle', text: 'Registered players'}),
        h('p', {class: 'card-sub', text: 'Search the sign-up list and check players in as they arrive. Names and levels come from the sign-up sheet; no contact details are shown.'})),
        h('div', {class: 'row'}, stamp, reload)),
      h('div', {class: 'desk-reg-body'}, body));
  };
}
