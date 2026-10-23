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

let toastTimer = null;
export function toast(message, kind = '') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', {id: 'toast', role: 'status', 'aria-live': 'polite'}); document.body.append(el); }
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'bad' ? 9000 : 4000);
}

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], {type: type + ';charset=utf-8'}));
  const a = h('a', {href: url, download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const pill = (text, kind = '') => h('span', {class: 'pill' + (kind ? ' ' + kind : ''), text});
