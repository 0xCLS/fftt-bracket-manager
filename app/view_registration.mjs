/** Registration settings (organizer, THIS event only): where the event's sign-ups come from.
 *
 * What it can do: choose the fictional demo data or ONE Google Sheet for this event; paste the sheet's link or ID; choose
 * the worksheet (tab); see how the form's columns were recognized and change any mapping; run the read-only connection
 * test; switch the connection on or off; show the status and the last successful read.
 * What it never does: write to the sheet, show a cell value, hold a credential, or accept anything but a Google Sheets
 * link/ID (the server checks again). Every outcome and permission is decided by the server; this file shows state and asks.
 *
 * Wording is one vocabulary (contracts/registration_source.mjs SOURCE_STATES): Fictional demo data · Connected Google Sheet ·
 * Not configured · Unauthorized · Temporarily unavailable. UI-only choices live in this closure so the background refresh
 * that rebuilds a pane never resets them. */
import {MAPPING_FIELDS, NO_COLUMN, NO_COLUMN_LABEL, SOURCE_STATES, parseSpreadsheetRef} from '../contracts/registration_source.mjs';

const GROUPS = {identity: 'Who and when', contact: 'Contact fields (used only to spot duplicates; never shown or saved)', assessment: 'Playing assessment (used to suggest a level)'};
const CHECK_TONE = {pass: 'good', fail: 'bad', warn: 'warn', skip: ''};
const CHECK_MARK = {pass: '✓', fail: '✗', warn: '!', skip: '–'};
const when = iso => { if (!iso) return null; const t = Date.parse(iso); if (Number.isNaN(t)) return null; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} minutes ago` : s < 129600 ? `${Math.round(s / 3600)} hours ago` : new Date(t).toLocaleDateString(); };

/** The one place that turns "what we know" into the organizer-facing state. `code` is a registration error kind. */
export function registrationState({payload = null, code = null, source = null, capabilities = null} = {}) {
  if (payload) return payload.source === 'synthetic-fixture' ? 'fictional' : payload.source === 'google-sheets' ? 'connected' : 'csv';
  switch (code) {
    case 'not-configured': return 'not-configured';
    case 'forbidden': case 'access-rejected': case 'source-unauthorized': case 'source-auth': return 'unauthorized';
    case 'source-disabled': return 'disabled';
    case 'not-allowed-here': return 'not-allowed-here';
    case null: case undefined: break;
    default: return 'unavailable';
  }
  if (source?.configured && source.kind === 'google-sheets') return source.enabled ? 'connected' : (source.eventSynthetic ? 'not-allowed-here' : 'disabled');
  if (source?.configured && source.kind === 'fixture') return 'fictional';
  if (!source?.configured && capabilities?.fixtureAvailable && source?.eventSynthetic !== false) return 'fictional';
  return 'not-configured';
}
export const STATE_TEXT = Object.freeze({...SOURCE_STATES, csv: {label: 'Private CSV · this browser only', tone: 'warn', detail: 'A file you picked. It is read in this browser and never uploaded or saved.'}});

export function createRegistrationSettings(ctx) {
  const {core, s, h, clear, pill, toast, result, confirmDialog, rerender} = ctx;
  const writable = () => core.canWrite();
  // UI-only state for the editing session (per event): what is typed/chosen but not yet saved
  const st = {eventId: null, open: false, kind: null, text: '', worksheet: '', mapping: {}, enabled: false, message: null, messageTone: 'bad', dirty: false, copied: false};
  function sync(src) {
    const changedEvent = st.eventId !== s.eventId;
    if (changedEvent) {
      Object.assign(st, {eventId: s.eventId, open: false, kind: null, text: '', worksheet: '', mapping: {}, enabled: false, message: null, dirty: false});
    }
    // Registration settings load asynchronously. Hydrate the saved selection once
    // it arrives, but NEVER overwrite a local draft the Organizer has edited.
    const needsSavedHydration = changedEvent || (!st.dirty && !st.text && !st.worksheet && st.kind === null);
    if (!needsSavedHydration) return;
    if (src?.configured && src.kind === 'google-sheets') {
      st.kind = 'google-sheets'; st.text = src.spreadsheetId ?? ''; st.worksheet = src.worksheet ?? '';
      st.mapping = {...(src.columnMap ?? {})}; st.enabled = !!src.enabled;
    } else if (src?.configured) st.kind = 'fixture';
  }
  let loadedFor = null;
  const ensureLoaded = () => {
    const rs = s.registrationSettings;
    if (rs.status === 'idle' && loadedFor !== s.eventId && s.role === 'organizer') { loadedFor = s.eventId; queueMicrotask(() => core.actions.loadRegistrationSettings()); }
  };
  const say = (text, tone = 'bad') => { st.message = text; st.messageTone = tone; rerender(); };

  function field(label, id, input, help) {
    return h('div', {class: 'field'}, h('label', {for: id, text: label}), input, help ? h('p', {class: 'help', id: id + 'Help', text: help}) : null);
  }

  function sharing(caps, verified) {
    if (verified) return null;
    if (!caps?.serviceAccountEmail) return null;
    const copy = h('button', {type: 'button', class: 'small', text: st.copied ? 'Copied' : 'Copy e-mail', 'aria-label': 'Copy the connection account e-mail',
      on: {click: async () => { try { await navigator.clipboard.writeText(caps.serviceAccountEmail); st.copied = true; rerender(); setTimeout(() => { st.copied = false; rerender(); }, 2500); } catch { toast('Select the e-mail and copy it.', 'warn'); } }}});
    return h('div', {class: 'reg-share-help', role: 'note'},
      h('b', {text: 'Sheet access: '}), 'Share the Google Sheet with this connection account as Viewer (read-only):',
      h('div', {class: 'copy-line'}, h('code', {class: 'account-email', text: caps.serviceAccountEmail}), copy));
  }

  function mappingTable(diag, readOnly) {
    if (!diag || !diag.columns.length) return h('p', {class: 'help', text: 'Run “Test connection” to read the sheet\'s column headings and preview how they will be used.'});
    const headers = diag.columns.map(c => c.header);
    const byField = new Map(diag.columns.filter(c => c.field).map(c => [c.field, c]));
    // Unmapped optional fields stay in the shared schema, but need not clutter
    // forms that already provide Full Name and six playing-assessment answers.
    const visibleFields = MAPPING_FIELDS.filter(([key]) => {
      if (['firstName', 'lastName'].includes(key) && byField.has('name') && !byField.has(key) && st.mapping[key] === undefined) return false;
      if (key === 'selfLevel' && !byField.has(key) && st.mapping[key] === undefined) return false;
      return true;
    });
    const rows = visibleFields.map(([key, label, group]) => {
      const detected = byField.get(key);
      const chosen = st.mapping[key];
      const sel = h('select', {id: 'map-' + key, 'aria-label': `Column for ${label}`, disabled: readOnly || !writable() || s.registrationSettings.busy !== null,
        on: {change: async ev => { const v = ev.target.value; if (v === '') delete st.mapping[key]; else st.mapping[key] = v === '__none__' ? NO_COLUMN : v; st.dirty = true; await runTest(); }}},
        h('option', {value: '', text: detected && detected.how === 'auto' ? `Detected: ${detected.header}` : 'Detect automatically', selected: chosen === undefined}),
        h('option', {value: '__none__', text: NO_COLUMN_LABEL, selected: chosen === NO_COLUMN}),
        headers.map(hd => h('option', {value: hd, text: hd.length > 70 ? hd.slice(0, 67) + '…' : hd, selected: chosen === hd})));
      const state = chosen === NO_COLUMN ? pill('Not used', '') : detected ? pill(detected.how === 'manual' ? 'Chosen by you' : 'Recognized', detected.how === 'manual' ? 'blue' : 'good')
        : pill(group === 'assessment' ? 'Not found · you review levels' : 'Not found', group === 'assessment' ? 'warn' : '');
      return {group, node: h('div', {class: 'map-row'}, h('label', {for: 'map-' + key, text: label}), sel, h('span', {class: 'map-state'}, state))};
    });
    return h('div', {class: 'map-grid'}, ['identity', 'contact', 'assessment'].map(g => h('fieldset', {class: 'map-group'}, h('legend', {text: GROUPS[g]}), rows.filter(r => r.group === g).map(r => r.node))));
  }

  async function runInspect() {
    st.message = null;
    if (parseSpreadsheetRef(st.text) === null) { say('That does not look like a Google Sheets link or ID. Paste the sheet\'s address (docs.google.com/spreadsheets/d/…).'); return; }
    // a DIFFERENT spreadsheet starts from a clean slate: its tab and column choices never carry over from another sheet
    const known = s.registrationSettings.inspect?.spreadsheetId ?? s.registrationSettings.source?.spreadsheetId ?? null;
    if (known !== null && parseSpreadsheetRef(st.text) !== known) { st.mapping = {}; st.worksheet = ''; st.enabled = false; }
    const pending = core.actions.inspectSheet(st.text);   // starts synchronously and marks itself busy…
    rerender();                                            // …so this one repaint shows the busy state
    const r = await pending;
    if (r.kind === 'superseded') return;
    if (r.ok) { const first = r.result.worksheets.find(w => !w.hidden) ?? r.result.worksheets[0]; if (!r.result.worksheets.some(w => w.title === st.worksheet)) st.worksheet = first?.title ?? ''; st.dirty = true; await runTest(); }
    else say(r.message);
  }
  async function runTest() {
    const insp = s.registrationSettings.inspect;
    const id = insp?.spreadsheetId ?? parseSpreadsheetRef(st.text);
    if (!id || !st.worksheet) { rerender(); return; }
    st.message = null;
    const pending = core.actions.testSheet({spreadsheet: id, worksheet: st.worksheet, mapping: st.mapping});
    rerender();
    const r = await pending;
    if (r.kind === 'superseded') return;                  // a newer request is the one the person is waiting for
    if (!r.ok) say(r.message); else rerender();           // finished: repaint once with the result
  }

  function diagnosticList(diag) {
    if (!diag) return null;
    return h('div', {class: 'diag', role: 'region', 'aria-label': 'Connection test results'},
      h('div', {class: 'row'}, pill(diag.ok ? 'Ready to read' : 'Needs attention', diag.ok ? 'good' : 'bad'),
        diag.responseCount !== null ? h('span', {class: 'muted', text: `${diag.responseCount} response${diag.responseCount === 1 ? '' : 's'}`}) : null),
      h('ul', {class: 'diag-list'}, diag.checks.map(c => h('li', {class: 'diag-' + c.status},
        h('span', {class: 'diag-mark ' + (CHECK_TONE[c.status] ?? ''), 'aria-hidden': 'true', text: CHECK_MARK[c.status]}),
        h('span', {}, h('b', {text: c.label}), h('span', {class: 'sr-only', text: ' — ' + ({pass: 'passed', fail: 'failed', warn: 'warning', skip: 'skipped'})[c.status]}), h('span', {class: 'muted', text: ' ' + c.message}))))));
  }

  return function settingsCard(sn) {
    const rs = s.registrationSettings;
    ensureLoaded();
    const src = rs.source, caps = rs.capabilities;
    sync(src);
    const state = registrationState({payload: s.registrations.payload, code: s.registrations.status === 'error' ? s.registrations.code : null, source: src, capabilities: caps});
    const info = STATE_TEXT[state];
    const editable = (sn.event.lifecycle === 'draft' || sn.event.lifecycle === 'active');
    const busy = rs.busy !== null;
    const googleAllowedHere = !src?.eventSynthetic;
    const kind = st.kind ?? (src?.configured ? src.kind : (src?.eventSynthetic === false ? 'google-sheets' : (caps?.fixtureAvailable ? 'fixture' : null)));
    const head = h('div', {class: 'card-head'},
      h('div', {}, h('h2', {id: 'regSetTitle', text: 'Registration settings'}),
        h('p', {class: 'card-sub', text: 'Choose where this event’s sign-ups come from. Google Sheets is read-only.'})),
      h('div', {class: 'row'}, pill(st.dirty ? 'Current: ' + info.label : info.label, info.tone),
        h('button', {type: 'button', class: 'small', id: 'regSetToggle', 'aria-expanded': String(st.open), 'aria-controls': 'regSetBody', text: st.open ? 'Hide settings' : 'Registration settings',
          on: {click: () => { st.open = !st.open; rerender(); }}})));
    const summary = h('div', {class: 'reg-source-line', id: 'regSourceLine'},
      h('span', {class: 'reg-source-heading'}, h('b', {text: info.label}), h('span', {class: 'muted', text: info.detail})),
      src?.configured && src.kind === 'google-sheets'
        ? h('div', {class: 'reg-source-facts'},
            h('span', {}, h('b', {text: 'Sheet'}), ' · ', src.spreadsheetTitle ?? 'Google Sheet'),
            h('span', {}, h('b', {text: 'Tab'}), ' · ', src.worksheet || 'Not selected'),
            src.lastResponseCount !== null ? h('span', {}, h('b', {text: 'Responses'}), ' · ', String(src.lastResponseCount)) : null)
        : null);
    if (!st.open) return h('section', {class: 'card reg-settings', 'aria-labelledby': 'regSetTitle'}, head, summary);

    // ---- body
    const body = [];
    if (rs.status === 'loading' && !src) body.push(h('div', {class: 'loading-state', role: 'status'}, h('span', {class: 'spinner', 'aria-hidden': 'true'}), 'Loading the settings…'));
    if (rs.status === 'error') body.push(h('div', {class: 'notice bad', role: 'alert', text: rs.error ?? 'The settings could not be loaded.'}));
    if (rs.capabilitiesError) body.push(h('div', {class: 'notice warn', role: 'status', text: rs.capabilitiesError === 'not-configured'
      ? 'The registration service is not set up on this site, so only a private CSV and walk-ins are available.' : 'The registration service is temporarily unavailable. Saved settings are shown; tests and reads are paused.'}));
    if (!editable) body.push(h('div', {class: 'notice warn', text: 'This event is finished or archived, so its registration source is read-only.'}));

    const choice = (value, label, text, disabled) => h('label', {class: 'choice' + (kind === value ? ' is-on' : '') + (disabled ? ' is-off' : '')},
      h('input', {type: 'radio', name: 'regKind', value, checked: kind === value, disabled: disabled || !editable || !writable() || busy,
        on: {change: () => { st.kind = value; st.dirty = true; st.message = null; rerender(); }}}),
      h('span', {class: 'choice-card'}, h('strong', {text: label}), h('span', {class: 'muted', text})));
    body.push(h('fieldset', {class: 'choice-group'}, h('legend', {text: 'Registration source'}),
      h('div', {class: 'choices'},
        choice('google-sheets', 'Google Sheet', googleAllowedHere ? 'Use this event’s online sign-ups.' : 'Test the connection; live reading is off in staging.', false),
        src?.eventSynthetic === false ? null : choice('fixture', 'Fictional demo data', 'For rehearsal only; no real players.', !caps?.fixtureAvailable)),
      st.dirty ? h('p', {class: 'help reg-unsaved', role: 'status', text: 'Unsaved changes. Complete the connection details below, then save.'}) : null));

    if (kind === 'google-sheets') {
      const insp = rs.inspect, diag = rs.diagnostic;
      const sheetInput = h('input', {type: 'text', id: 'regSheet', value: st.text, autocomplete: 'off', spellcheck: 'false', placeholder: 'https://docs.google.com/spreadsheets/d/…',
        'aria-describedby': 'regSheetHelp', disabled: !editable || !writable() || busy, on: {input: ev => { st.text = ev.target.value; st.dirty = true; }}});
      const tabs = (insp?.worksheets ?? diag?.worksheets ?? (src?.worksheet ? [{title: src.worksheet, hidden: false}] : [])).filter(w => !w.hidden || w.title === st.worksheet);
      const tabSel = h('select', {id: 'regTab', 'aria-describedby': 'regTabHelp', disabled: !editable || !writable() || busy || tabs.length === 0,
        on: {change: async ev => { st.worksheet = ev.target.value; st.mapping = {}; st.dirty = true; await runTest(); }}},
        tabs.length ? tabs.map(w => h('option', {value: w.title, text: w.title, selected: w.title === st.worksheet})) : h('option', {value: '', text: 'Check the sheet to list its tabs'}));
      const currentSheet = parseSpreadsheetRef(st.text);
      const verifiedSheet = (!!diag?.ok && !!insp?.spreadsheetId && currentSheet === insp.spreadsheetId)
        || (!!src?.configured && src.kind === 'google-sheets' && src.status === 'ready' && currentSheet === src.spreadsheetId);
      body.push(sharing(caps, verifiedSheet));
      body.push(h('div', {class: 'field'}, h('label', {for: 'regSheet', text: 'Spreadsheet link or ID'}),
        h('div', {class: 'input-action'}, sheetInput,
          h('button', {type: 'button', class: 'primary', id: 'regCheck', disabled: !editable || !writable() || busy || !caps?.googleConfigured, text: rs.busy === 'inspect' ? 'Checking…' : 'Check sheet', 'aria-busy': String(rs.busy === 'inspect'), on: {click: runInspect}})),
        h('p', {class: 'help', id: 'regSheetHelp', text: caps?.googleConfigured === false ? 'The Google connection is not set up on this site yet, so a sheet cannot be checked. The administrator needs to add the connection account (see the deployment notes).'
          : 'Only a Google Sheets link or ID is accepted. The sheet\'s title is shown after it is checked.'})));
      body.push(field('Worksheet (tab)', 'regTab', tabSel, 'Select the tab containing registration responses.'));
      if (insp || src?.spreadsheetTitle) body.push(h('p', {class: 'help'}, 'Sheet: ', h('b', {text: insp?.title ?? src.spreadsheetTitle})));
      body.push(h('div', {class: 'row'}, h('button', {type: 'button', id: 'regTest', disabled: !editable || !writable() || busy || !st.worksheet || !caps?.googleConfigured, text: rs.busy === 'test' ? 'Testing…' : 'Test connection', 'aria-busy': String(rs.busy === 'test'), on: {click: runTest}}),
        h('span', {class: 'muted', text: 'Reads only the column headings and a response count. No answers are read.'})));
      body.push(diagnosticList(diag));
      if (diag?.columns?.length) body.push(h('details', {class: 'sub-block reg-mapping-disclosure', open: src?.kind !== 'google-sheets' || !diag.ok},
        h('summary', {},
          h('span', {}, h('strong', {text: 'Column mapping'}), h('span', {class: 'muted', text: ' · Advanced; review only if a heading needs correcting'})),
          pill(diag.ok ? 'Automatically recognized' : 'Needs review', diag.ok ? 'good' : 'warn')),
        h('p', {class: 'help', text: 'We match familiar form headings automatically. Adjust only unmatched columns; levels without assessment answers require your review.'}),
        mappingTable(diag, !editable)));
      if (diag && !diag.ok && diag.checks.some(c => c.status === 'fail' && ['spreadsheet', 'worksheet'].includes(c.id)) && caps?.serviceAccountEmail)
        body.push(h('p', {class: 'help'}, 'If the sheet is not shared yet, share it with ', h('code', {text: caps.serviceAccountEmail}), ' as Viewer, then test again.'));
      const allowedToEnable = googleAllowedHere && caps?.googleMode === 'enabled';
      body.push(h('label', {class: 'check', id: 'regEnableRow'}, h('input', {type: 'checkbox', id: 'regEnable', checked: st.enabled && allowedToEnable, disabled: !editable || !writable() || busy || !allowedToEnable,
        on: {change: ev => { st.enabled = ev.target.checked; st.dirty = true; }}}),
        h('span', {}, h('b', {text: 'Allow reading this sheet for this event'}), h('span', {class: 'muted', text: allowedToEnable ? ' Turn off at any time.'
          : src?.eventSynthetic ? ' This synthetic staging site allows connection tests, not live registration reading.'
          : caps?.googleMode !== 'enabled' ? ' Connection-test mode is active; live reading is not enabled on this site.'
          : ' Live reading is not available.'}))));
      if (src?.configured && src.kind === 'google-sheets') {
        const checked = when(src.lastCheckedAt), ok = when(src.lastOkAt);
        body.push(h('dl', {class: 'status-list'}, h('dt', {text: 'Status'}), h('dd', {text: ({untested: 'Not tested yet', ready: 'Ready', 'needs-attention': 'Needs attention', failed: 'Last test failed'})[src.status]}),
          h('dt', {text: 'Last checked'}), h('dd', {text: checked ?? 'Never'}), h('dt', {text: 'Last successful read'}), h('dd', {text: ok ?? 'Never'}),
          src.lastResponseCount !== null ? [h('dt', {text: 'Responses'}), h('dd', {text: String(src.lastResponseCount)})] : null));
      }
      body.push(h('p', {class: 'help', role: 'note', text: 'Only players you check in join the tournament roster. The sheet is never changed and contact details are not displayed.'}));
    }
    if (kind === 'fixture') {
      body.push(h('p', {class: 'help', role: 'note', text: 'This practice list contains 20 fictional registrations. It does not include actual players.'}));
    }
    if (st.message) body.push(h('div', {class: 'notice ' + st.messageTone, role: st.messageTone === 'bad' ? 'alert' : 'status', id: 'regSetMsg', text: st.message}));

    const insp = rs.inspect;
    const canSave = editable && writable() && !busy && kind && (kind === 'fixture' ? !!caps?.fixtureAvailable : !!(insp?.spreadsheetId ?? parseSpreadsheetRef(st.text)) && !!st.worksheet);
    body.push(h('div', {class: 'row actions'},
      h('button', {type: 'button', class: 'primary', id: 'regSave', disabled: !canSave, text: rs.busy === 'save' ? 'Saving…' : 'Save registration source', on: {click: async () => {
        const base = kind === 'fixture' ? {kind: 'fixture'} : {kind: 'google-sheets', spreadsheetId: insp?.spreadsheetId ?? parseSpreadsheetRef(st.text), spreadsheetTitle: insp?.title ?? src?.spreadsheetTitle ?? null,
          worksheet: st.worksheet, columnMap: st.mapping, enabled: st.enabled};
        const r = await core.actions.saveRegistrationSource(base);
        if (r.ok) { st.dirty = false; st.message = null; toast('Registration source saved.'); rerender(); } else say(r.message);
      }}}),
      src?.configured ? h('button', {type: 'button', class: 'danger', id: 'regRemove', disabled: !editable || !writable() || busy, text: 'Remove this source', on: {click: async () => {
        if (!(await confirmDialog('Remove the registration source?', 'This event will no longer have a registration source. Players already checked in stay on the roster. The sheet itself is not touched.', 'Remove', {danger: true}))) return;
        const r = await core.actions.clearRegistrationSource();
        if (r.ok) { Object.assign(st, {kind: null, text: '', worksheet: '', mapping: {}, enabled: false, dirty: false, message: null}); toast('Registration source removed.'); rerender(); } else say(r.message);
      }}}) : null));
    return h('section', {class: 'card reg-settings', 'aria-labelledby': 'regSetTitle'}, head, h('div', {id: 'regSetBody', class: 'reg-set-body', 'aria-busy': String(busy)}, body));
  };
}
