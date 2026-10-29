/** Event management and match formats (organizer). Events are chosen, opened, archived, restored and (only when
 * empty drafts) deleted BY NAME; technical event ids never appear. Formats are configured per category, locked
 * once a result exists, and shown honestly for historical events. */
import {FORMAT_KEYS, FORMAT_LABELS, DEFAULT_FORMATS, ALLOWED_BEST_OF, ALLOWED_POINTS, formatLabel, matchCategory} from '../contracts/gameday_engine.mjs';

const FILTERS = [['active', 'Active'], ['draft', 'Draft'], ['complete', 'Completed'], ['archived', 'Archived'], ['all', 'All']];
const STATUS_TEXT = {draft: 'Draft', active: 'Active', complete: 'Completed', archived: 'Archived'};
const STATUS_TONE = {draft: 'blue', active: 'good', complete: '', archived: 'warn'};
const CATEGORY_HELP = {
  champ: 'Every championship round before the final.', champ_final: 'The final of the championship bracket.',
  cons: 'Every consolation round before the final.', cons_final: 'The final of the consolation bracket.',
  doubles: 'The single Mixed-Skill Doubles match.',
};

export function createEventsView(ctx) {
  const {core, s, h, clear, pill, toast, result, confirmDialog, openDialog, remember, draft, forget, rerender, openEvent} = ctx;
  let filter = null;
  const writable = () => core.canWrite();

  // ---------------------------------------------------------------- formats
  const lockedCategories = sn => {
    const locked = new Set();
    for (const m of sn.matches) if (m.status === 'complete') locked.add(matchCategory(m.bracket, m.nextId === null));
    if (sn.doubles?.winnerTeam) locked.add('doubles');
    return locked;
  };
  function formatsCard(sn) {
    const e = sn.event, locked = lockedCategories(sn);
    const legacy = sn.matches.filter(m => m.formatLegacy && m.status !== 'bye' && m.status !== 'empty');
    const editable = (e.lifecycle === 'draft' || e.lifecycle === 'active');
    const sel = {};
    const rows = FORMAT_KEYS.map(k => {
      const cur = e.formats[k], isLocked = locked.has(k);
      const bo = h('select', {id: `fmt-${k}-bo`, 'data-draft': `fmt:${k}:bo`, disabled: !editable || isLocked || !writable(), 'aria-label': `${FORMAT_LABELS[k]}: number of games`},
        ALLOWED_BEST_OF.map(n => h('option', {value: n, text: `Best of ${n}`, selected: n === (draft(`fmt:${k}:bo`, cur.bestOf) | 0)})));
      const pts = h('select', {id: `fmt-${k}-pts`, 'data-draft': `fmt:${k}:pts`, disabled: !editable || isLocked || !writable(), 'aria-label': `${FORMAT_LABELS[k]}: points per game`},
        ALLOWED_POINTS.map(n => h('option', {value: n, text: `Games to ${n}`, selected: n === (draft(`fmt:${k}:pts`, cur.points) | 0)})));
      sel[k] = {bo, pts, cur};
      return h('div', {class: 'format-row' + (isLocked ? ' is-locked' : '')},
        h('div', {class: 'format-name'}, h('strong', {text: FORMAT_LABELS[k]}), h('span', {class: 'muted', text: CATEGORY_HELP[k]}),
          isLocked ? pill('Locked · a result is recorded', 'warn') : null),
        h('div', {class: 'format-controls'}, bo, pts));
    });
    const save = h('button', {type: 'button', class: 'primary', disabled: !editable || !writable(), text: 'Save match formats',
      on: {click: async () => {
        const changes = {};
        for (const k of FORMAT_KEYS) {
          if (locked.has(k)) continue;
          const f = {bestOf: Number(sel[k].bo.value), points: Number(sel[k].pts.value)};
          if (f.bestOf !== sel[k].cur.bestOf || f.points !== sel[k].cur.points) changes[k] = f;
        }
        if (!Object.keys(changes).length) { toast('No format was changed.'); return; }
        const lines = Object.entries(changes).map(([k, f]) => `${FORMAT_LABELS[k]}: ${formatLabel(f, {separator: ', '})}`);
        if (!(await confirmDialog('Change match formats?', `${lines.join('. ')}. This applies to matches that have not been played; matches with a result keep theirs.`, 'Save formats'))) return;
        if (result(await core.actions.setFormats(changes), 'Match formats saved.')) forget('fmt:');
      }}});
    const reset = h('button', {type: 'button', class: 'ghost', disabled: !editable || !writable(), text: 'Use the recommended formats',
      on: {click: () => {
        for (const k of FORMAT_KEYS) {
          if (locked.has(k)) continue;
          sel[k].bo.value = String(DEFAULT_FORMATS[k].bestOf); sel[k].pts.value = String(DEFAULT_FORMATS[k].points);
          remember(`fmt:${k}:bo`, String(DEFAULT_FORMATS[k].bestOf)); remember(`fmt:${k}:pts`, String(DEFAULT_FORMATS[k].points));
        }
        toast('Recommended formats selected. Press Save to apply them.');
      }}});
    return h('section', {class: 'card formats-card', 'aria-labelledby': 'fmtTitle'},
      h('div', {class: 'section-heading'}, h('span', {class: 'section-icon', 'aria-hidden': 'true', text: '02'}),
        h('div', {}, h('span', {class: 'section-overline', text: 'MATCH FORMATS'}), h('h2', {id: 'fmtTitle', text: 'How each match is scored'}))),
      h('p', {class: 'section-description', text: 'Best of 1 or Best of 3, games to 11 or 21, always won by two points. A format can be changed until a result is recorded for it.'}),
      !editable ? h('div', {class: 'notice warn', text: 'This event is finished or archived, so its formats are read-only.'}) : null,
      legacy.length ? h('div', {class: 'notice', role: 'note'}, h('b', {text: 'Historical matches keep their original format. '}),
        `${legacy.length} match${legacy.length === 1 ? '' : 'es'} in this event ${legacy.length === 1 ? 'was' : 'were'} set up before formats were configurable (for example a Best of 5 final). They are never rewritten, and their results and corrections still follow that format.`) : null,
      h('div', {class: 'format-grid'}, rows),
      h('div', {class: 'setup-save'}, save, reset,
        h('span', {class: 'setup-help', text: 'Recommended: championship Best of 3 to 11 · consolation Best of 1 to 21 · doubles finale Best of 3 to 11.'})));
  }

  // ---------------------------------------------------------------- events
  function deleteDialog(ev) {
    openDialog((dlg, close) => {
      const typed = h('input', {type: 'text', id: 'delConfirm', autocomplete: 'off', placeholder: ev.name, 'aria-describedby': 'delHelp'});
      const msg = h('p', {class: 'status bad', role: 'alert'});
      const go = h('button', {type: 'button', class: 'danger', disabled: true, text: 'Delete permanently'});
      typed.addEventListener('input', () => { go.disabled = typed.value.trim() !== ev.name; });
      go.addEventListener('click', async () => {
        go.disabled = true; msg.textContent = '';
        const r = await core.actions.deleteEvent(ev.eventId, typed.value);
        if (r.ok) { toast(`“${ev.name}” was deleted.`); close(); rerender(); } else { msg.textContent = r.message; go.disabled = typed.value.trim() !== ev.name; }
      });
      dlg.append(h('div', {class: 'dlg'}, h('h3', {text: 'Delete this empty draft event?'}),
        h('p', {id: 'delHelp'}, h('b', {text: ev.name}), ` (${ev.date}) has no players, bracket or results. Deleting it removes it for good and cannot be undone. Completed events, events with results and archived events can never be deleted here.`),
        h('label', {for: 'delConfirm', text: 'Type the event name to confirm'}), typed, msg,
        h('div', {class: 'dlg-actions'}, h('button', {type: 'button', text: 'Keep the event', on: {click: close}}), go)));
      queueMicrotask(() => typed.focus());
    }, {label: 'Delete event'});
  }

  function eventsCard() {
    const create = s.events.some(e => e.canCreate);
    const counts = Object.fromEntries(FILTERS.map(([k]) => [k, s.events.filter(e => k === 'all' || e.lifecycle === k).length]));
    if (filter === null) {
      filter = s.events.find(e => e.eventId === s.eventId)?.lifecycle ?? 'active';
      if (!counts[filter] && counts.all) filter = 'all';
    }
    const name = h('input', {type: 'text', id: 'newName', maxlength: 120, placeholder: 'Event name', 'data-draft': 'newName', required: true});
    const date = h('input', {type: 'date', id: 'newDate', 'data-draft': 'newDate', required: true});
    const tables = h('input', {type: 'number', id: 'newTables', min: 1, max: 12, value: 2, 'data-draft': 'newTables'});
    const shown = s.events.filter(e => filter === 'all' || e.lifecycle === filter);
    const chips = h('div', {class: 'chips', role: 'group', 'aria-label': 'Filter events by status'},
      FILTERS.map(([k, t]) => h('button', {type: 'button', class: 'chip', 'aria-pressed': String(filter === k), text: `${t} (${counts[k]})`,
        on: {click: () => { filter = k; rerender(); }}})));
    const rows = shown.map(e => {
      const current = e.eventId === s.eventId;
      const organizer = e.role === 'organizer';
      return h('tr', {class: current ? 'is-current' : ''},
        h('td', {'data-label': 'Event'}, h('strong', {text: e.name}), organizer && e.players !== null ? h('span', {class: 'src', text: `${e.players} player${e.players === 1 ? '' : 's'} · ${e.tables} table${e.tables === 1 ? '' : 's'}`}) : null),
        h('td', {'data-label': 'Date'}, e.date),
        h('td', {'data-label': 'Status'}, pill(STATUS_TEXT[e.lifecycle], STATUS_TONE[e.lifecycle])),
        h('td', {'data-label': 'Actions', class: 'event-actions'},
          current ? pill('Open now', 'good') : h('button', {class: 'small', type: 'button', text: 'Open', 'aria-label': `Open ${e.name}`,
            on: {click: async () => { const r = await core.selectEvent(e.eventId); if (!r.ok) toast(r.message, 'bad'); else openEvent(); }}}),
          organizer && e.lifecycle !== 'archived' ? h('button', {class: 'small ghost', type: 'button', disabled: !writable(), text: 'Archive', 'aria-label': `Archive ${e.name}`,
            on: {click: async () => { if (await confirmDialog('Archive this event?', `“${e.name}” is hidden from spectators and moved to Archived. Nothing is deleted, and you can restore it later.`, 'Archive', {danger: true})) result(await core.actions.archiveEvent(e.eventId), 'Archived.'); }}}) : null,
          organizer && e.lifecycle === 'archived' ? h('button', {class: 'small', type: 'button', disabled: !writable(), text: 'Restore', 'aria-label': `Restore ${e.name}`,
            on: {click: async () => { const r = await core.actions.restoreEvent(e.eventId); if (result(r, 'Restored. It is not public until you publish it again.')) { filter = null; rerender(); } }}}) : null,
          e.deletable && !current ? h('button', {class: 'small danger', type: 'button', disabled: !writable(), text: 'Delete…', 'aria-label': `Delete ${e.name}`, on: {click: () => deleteDialog(e)}}) : null,
          e.deletable && current ? h('span', {class: 'muted small-note', text: 'Open another event to delete this one.'}) : null));
    });
    return h('section', {class: 'card events-card', 'aria-labelledby': 'evTitle'},
      h('div', {class: 'card-head'}, h('div', {}, h('h2', {id: 'evTitle', text: 'Your events'}),
        h('p', {class: 'card-sub', text: 'Choose an event by name. Only an empty draft can be deleted; everything else can be archived and restored.'}))),
      chips,
      rows.length ? h('div', {class: 'scroll-x'}, h('table', {class: 'responsive-table'}, h('thead', {}, h('tr', {}, ['Event', 'Date', 'Status', 'Actions'].map(t => h('th', {scope: 'col', text: t})))), h('tbody', {}, rows)))
        : h('div', {class: 'empty-state', text: counts.all ? `No ${(FILTERS.find(f => f[0] === filter)?.[1] ?? '').toLowerCase()} events.` : 'No events yet.'}),
      create ? h('form', {class: 'create-event', novalidate: true, on: {submit: async ev => { ev.preventDefault();
          if (result(await core.actions.createEvent(name.value, date.value, Number(tables.value)), 'Event created. It is empty and not public.')) { forget('new'); ctx.goTab('players'); } }}},
        h('h3', {text: 'Create a new event'}),
        h('div', {class: 'create-grid'},
          h('div', {class: 'create-name'}, h('label', {for: 'newName', text: 'Name'}), name),
          h('div', {}, h('label', {for: 'newDate', text: 'Date'}), date),
          h('div', {}, h('label', {for: 'newTables', text: 'Tables'}), tables)),
        h('div', {class: 'row'}, h('button', {class: 'primary', type: 'submit', disabled: !writable(), text: 'Create event'}))) : null);
  }
  return {formatsCard, eventsCard};
}
