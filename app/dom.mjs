/** Tiny DOM helpers. Everything is built with createElement/textContent: server data never reaches innerHTML. */
export const $ = id => document.getElementById(id);

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') { if (v) el[k] = true; }
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function clear(el) { el.replaceChildren(); return el; }
/** Replace the children of `el`; null/undefined/false are skipped (Element.append would print "null"). */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false));
  return el;
}

/** Compact, non-obstructive notifications. One fixed stack (top-right on wide screens, top strip on phones, never over
 * the bottom action bars), at most three at once, identical messages merged, each dismissible. Success/info use a polite
 * status region; errors and warnings are announced as alerts. Anything that needs the person to ACT (a failed load, a
 * validation problem) is explained persistently inline next to the thing that failed; a toast is only a brief
 * confirmation, so the same long message never appears twice. */
const TOAST_MS = {'': 4000, good: 4000, warn: 7000, bad: 9000};
const TOAST_MARK = {'': '✓', good: '✓', warn: '!', bad: '!'};
export function toast(message, kind = '') {
  const text = String(message ?? '').trim();
  if (!text) return;
  const tone = kind in TOAST_MS ? kind : '';
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div', {id: 'toasts', class: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false'});
    document.body.append(box);
  }
  // sit just below the status bar (whatever height it wraps to), never over it; on phones it is a top strip
  const bar = document.querySelector('.topbar');
  const below = bar && window.innerWidth > 560 ? Math.round(bar.getBoundingClientRect().bottom) + 8 : 0;
  box.style.top = below > 14 ? below + 'px' : '';
  for (const old of [...box.children]) if (old.dataset.msg === text) old.remove();
  const item = h('div', {class: 'toast' + (tone ? ' ' + tone : ''), role: tone === 'bad' || tone === 'warn' ? 'alert' : 'status', 'data-msg': text},
    h('span', {class: 'toast-mark', 'aria-hidden': 'true', text: TOAST_MARK[tone]}),
    h('span', {class: 'toast-text', text}),
    h('button', {type: 'button', class: 'toast-close', 'aria-label': 'Dismiss notification', text: '×', on: {click: () => item.remove()}}));
  box.append(item);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => item.remove(), TOAST_MS[tone]);
}

/** Password field with a small eye / eye-off icon button INSIDE the field, at the right. The input keeps its own
 * autocomplete behaviour; the button is a real, focusable control with a descriptive label and aria-pressed. */
const EYE = {
  on: [['path', {d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z'}], ['circle', {cx: 12, cy: 12, r: 3}]],
  off: [['path', {d: 'M3 3l18 18'}], ['path', {d: 'M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1'}], ['path', {d: 'M9.9 9.9a3 3 0 0 0 4.2 4.2'}]],
};
function eyeIcon(kind) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'eye-icon'})) svg.setAttribute(k, String(v));
  for (const [tag, attrs] of EYE[kind]) { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); svg.append(el); }
  return svg;
}
/** Wires `button` (an existing <button type=button>) as the show/hide control for `input` and gives it the eye icon. */
export function attachPasswordToggle(input, button, {label = 'password'} = {}) {
  const paint = () => {
    const shown = input.type === 'text';
    button.replaceChildren(eyeIcon(shown ? 'off' : 'on'));
    button.setAttribute('aria-pressed', String(shown));
    button.setAttribute('aria-label', shown ? `Hide ${label}` : `Show ${label}`);
    button.title = shown ? `Hide ${label}` : `Show ${label}`;
  };
  button.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; paint(); });   // focus stays on the button
  paint();
  return paint;
}

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], {type: type + ';charset=utf-8'}));
  const a = h('a', {href: url, download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const pill = (text, kind = '') => h('span', {class: 'pill' + (kind ? ' ' + kind : ''), text});
