/** FFTT registration model: turns the rows of the organizer's PRIVATE sign-up sheet into reviewable registrants.
 *
 * PURE: no network, storage, DOM or secrets. It runs in two places with the same code and the same tests:
 *   1. the server-side adapter (server/registration/*), which reads the sheet with a service account that never
 *      leaves the server, and
 *   2. the browser, only for the organizer's PRIVATE CSV import fallback (a file the organizer picks; it is
 *      parsed in memory, never uploaded, never stored).
 *
 * PRIVACY CONTRACT. Contact details (e-mail, phone) are read ONLY to detect duplicates, and then discarded: the
 * output carries masked hints at most ("a•••@e•••.org", "•••• 0142"), never a full address or number, and never
 * the free-text answers. Every output object is rebuilt from an allowlist (see `toRegistrant`), so adding a
 * column to the sheet can never leak into the app. The opaque `ref` is a keyed hash made by the caller.
 *
 * RATING SUGGESTION is a transparent heuristic over the inputs that knowledge/PLAYER_RATING_SYSTEM.md names
 * (how often the person plays; club/league/school/tournament experience; sustaining rallies; intentional spin;
 * attacking easy balls; a short description of their game) plus the old self-label as ONE weak input. It only
 * ever suggests a PROVISIONAL FFTT Level 1-5; the organizer confirms (or changes) every rating.
 */

export const MAX_REGISTRANTS = 200;
export const MAX_FIELD_LENGTH = 400;

// ---------------------------------------------------------------- small text helpers
const clean = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_LENGTH);
const fold = v => clean(v).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const normEmail = v => { const e = clean(v).toLowerCase(); return /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(e) ? e : null; };
export const normPhone = v => { const d = clean(v).replace(/\D/g, ''); const t = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return t.length >= 7 && t.length <= 15 ? t : null; };
const firstChar = t => Array.from(t)[0];
export const maskEmail = e => { const m = /^([^@]+)@([^@]+)\.([^.@]+)$/.exec(e ?? ''); return m ? `${firstChar(m[1])}•••@${firstChar(m[2])}•••.${m[3]}` : null; };
export const maskPhone = p => (p ? `•••• ${p.slice(-2)}` : null);

/** "Ada  Quill " -> "ada quill" (accents, case, punctuation and spacing ignored). */
export const nameKey = v => fold(v).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Public bracket convention: first name + last initial ("Ada Q."). A single word stays as it is. */
export function shortName(full) {
  const parts = clean(full).split(' ').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  const last = parts[parts.length - 1].replace(/[^\p{L}]/gu, '');
  return `${parts[0]} ${last ? last[0].toUpperCase() + '.' : ''}`.trim();
}
const PHONE_LIKE = /\d[^\d]{0,2}\d[^\d]{0,2}\d[^\d]{0,2}\d[^\d]{0,2}\d[^\d]{0,2}\d[^\d]{0,2}\d/;
export const looksLikeContact = t => /@/.test(t) || PHONE_LIKE.test(t);
/** A name that is safe to show and to send to the roster: any word carrying an "@" or a digit is dropped (people
 * sometimes type a phone number into the name box). `issue` says why the organizer should look at it. */
export function safeName(v) {
  const original = clean(v);
  // words carrying "@" or a digit go; markup/quoting characters go; a leading spreadsheet-formula character goes
  let kept = original.split(' ').filter(t => t && !/[@\d]/.test(t) && !/:\/\/|^www\./i.test(t)).join(' ').replace(/["<>`{}\\]/g, '').replace(/^[=+\-\s]+/, '').slice(0, 80).trim();
  if (!original) return {text: 'Unnamed registrant', issue: 'No name was given.'};
  if (!kept) return {text: 'Unnamed registrant', issue: 'The name contained only contact details or numbers; enter the name.'};
  if (kept !== original) return {text: kept, issue: 'Contact details, numbers or symbols were removed from the name; check it.'};
  return {text: kept, issue: null};
}
// A registration time is shown as text; only a plain date/time shape is ever forwarded (never arbitrary cell content).
const STAMP = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}( \d{1,2}:\d{2}(:\d{2})?( ?[AP]M)?)?$/i;
export const stampText = v => { const t = clean(v); return STAMP.test(t) ? t : ''; };
const SIMILAR_MAX_LEN = 60;
function editDistanceAtMost1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || a.length > SIMILAR_MAX_LEN || b.length > SIMILAR_MAX_LEN) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}
/** "ada q" vs "ada quill": same first name and the later word is an initial/prefix of the other's last name. */
function sameFirstAndInitial(a, b) {
  const x = a.split(' '), y = b.split(' ');
  if (x.length < 2 || y.length < 2 || x[0] !== y[0]) return false;
  const lx = x[x.length - 1], ly = y[y.length - 1];
  return (lx.length === 1 && ly.startsWith(lx)) || (ly.length === 1 && lx.startsWith(ly));
}
export const similarNames = (a, b) => a !== b && a.length > 0 && b.length > 0 && (editDistanceAtMost1(a, b) || sameFirstAndInitial(a, b));

// ---------------------------------------------------------------- CSV (RFC 4180) for the private import fallback
export function parseCsv(text, {maxRows = MAX_REGISTRANTS + 1, maxCells = 40} = {}) {
  const rows = []; let row = [], cell = '', quoted = false, i = 0;
  const s = String(text ?? '').replace(/^﻿/, '');
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); if (row.some(c => c.trim() !== '')) rows.push(row.slice(0, maxCells)); row = []; };
  for (; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') endCell();
    else if (c === '\n') endRow();
    else if (c === '\r') { if (s[i + 1] === '\n') i++; endRow(); }
    else cell += c;
    if (rows.length > maxRows) break;
  }
  if (cell !== '' || row.length) endRow();
  return rows.slice(0, maxRows);
}

// ---------------------------------------------------------------- header mapping (tolerant of wording changes)
const FIELD_PATTERNS = [
  ['timestamp', /^(timestamp|submitted|submission( time| date)?|date submitted|time stamp)\b/i],
  ['email', /e-?mail/i],
  ['phone', /phone|mobile|cell|whatsapp|text(ing)? number/i],
  ['firstName', /^(first|given)\s*name\b|^first$/i],
  ['lastName', /^(last|family|sur)\s*name\b|^last$/i],
  ['name', /^(full\s*)?name\b|^your name\b|^player( name)?\b|^participant\b/i],
  ['frequency', /how (often|frequently)|how much .*play|play(ing)? (frequency|regularly)|frequency/i],
  ['experience', /(club|league|school[- ]?team|tournament|competitive)[^?]*(experience|played|play\b)|experience[^?]*(club|league|school|tournament|competitive)|(prior|previous|past) (play|experience)/i],
  ['rallies', /rall(y|ies)/i],
  ['spin', /\bspin\b/i],
  ['attack', /attack|smash|loop|put away|aggressive/i],
  ['description', /(which|what).*(statement|description|describes|best matches)|describe your (game|play)|playing description|your game/i],
  ['selfLevel', /(skill|ability|experience|playing) level|how would you (rate|describe) (your|yourself)|beginner.*intermediate|self[- ]?(rating|assessment)/i],
];
/** Returns {index: {field: columnIndex}, missing: [fields]}. First matching column wins; one column feeds one field. */
export function mapHeaders(headerRow) {
  const index = {}, used = new Set();
  const headers = headerRow.map(h => clean(h));
  for (const [field, pattern] of FIELD_PATTERNS) {
    const at = headers.findIndex((h, i) => !used.has(i) && h !== '' && pattern.test(h));
    if (at >= 0) { index[field] = at; used.add(at); }
  }
  const missing = [];
  if (index.name === undefined && index.firstName === undefined) missing.push('name');
  return {index, missing};
}

// ---------------------------------------------------------------- rating suggestion
// The approved FFTT3 form's answer choices are matched EXACTLY (ordered scales), with a tolerant fallback for the
// older Yes/Sometimes/No wording. Free text is never forwarded; only these small scale positions are used.
const fold2 = v => fold(v).replace(/[—–]/g, '-');

/** Playing profile: the EXPLICIT leading label wins ("Beginner — … control …" is a Beginner, whatever words follow).
 * Returns 0..4 (Beginner … Advanced) or null. Keyword guessing is only a fallback for text with no leading label. */
const PROFILE_LABELS = [[4, /^(advanced|competitive)\b/], [3, /^strong intermediate\b/], [2, /^intermediate\b/], [1, /^recreational\b/], [0, /^(beginner|new)\b/]];
const PROFILE_KEYWORDS = [
  [4, /(club|league|tournament|coach|ranked|rated|expert)/], [3, /(strong|loop|topspin|varied serves|aggressive|good footwork)/],
  [2, /(consistent|placement|solid|steady)/], [1, /(casual|for fun|recreational|hobby|social)/],
  [0, /(just (start|learn)|brand new|first time|never played|learning|barely)/],
];
export function profileLevel(v) {
  const t = fold2(v);
  if (!t) return null;
  for (const [tier, re] of PROFILE_LABELS) if (re.test(t)) return tier;
  for (const [tier, re] of PROFILE_KEYWORDS) if (re.test(t)) return tier;
  return null;
}
/** Rally consistency (six approved sentences) -> 0..5, or null. The most specific phrase is tested first. */
export function rallyLevel(v) {
  const t = fold2(v);
  if (!t) return null;
  if (/under pressure|strong rallies/.test(t)) return 5;
  if (/control placement/.test(t)) return 4;
  if (/usually sustain|reasonable consistency/.test(t)) return 3;
  if (/short rallies/.test(t)) return 2;
  if (/still learning|difficulty sustaining/.test(t)) return 1;
  if (/haven.?t played|don.?t know/.test(t)) return 0;
  // older wording
  if (/^(y|yes|always|reliably|consistently|usually)\b/.test(t)) return 4;
  if (/^(sometimes|occasionally|a little|somewhat|maybe|kind of|not always)\b/.test(t)) return 2;
  if (/^(n|no|never|not really|rarely|not yet)\b/.test(t)) return 1;
  return null;
}
/** Spin: No / A little / Sometimes / Yes, fairly consistently / Yes, confidently -> 0..4. */
export function spinLevel(v) {
  const t = fold2(v);
  if (!t) return null;
  if (/confident/.test(t)) return 4;
  if (/fairly consistent|consistently/.test(t)) return 3;
  if (/^sometimes/.test(t)) return 2;
  if (/^a little|^a bit/.test(t)) return 1;
  if (/^(n|no|never|not at all|none)\b/.test(t)) return 0;
  if (/^(y|yes|always|regularly)\b/.test(t)) return 3;
  return null;
}
/** Attack: No / Rarely / Sometimes / Usually / Yes, confidently -> 0..4. */
export function attackLevel(v) {
  const t = fold2(v);
  if (!t) return null;
  if (/confident/.test(t)) return 4;
  if (/^usually|^often|^consistently/.test(t)) return 3;
  if (/^sometimes/.test(t)) return 2;
  if (/^(rarely|seldom|a little)/.test(t)) return 1;
  if (/^(n|no|never|not at all|none)\b/.test(t)) return 0;
  if (/^(y|yes|always|regularly)\b/.test(t)) return 3;
  return null;
}
/** How often they play: Never / Rarely / Occasionally / A few times a month / About once a week / Several times a week -> 0..5. */
export function frequencyLevel(v) {
  const t = fold2(v);
  if (!t) return null;
  if (/(several times a week|multiple times a week|daily|every day|most days|\d+\s*times? (a|per) week)/.test(t)) return 5;
  if (/(once a week|weekly|every week|about once a week)/.test(t)) return 4;
  if (/(few times a month|monthly|once a month|couple of times a month|a month)/.test(t)) return 3;
  if (/occasional|now and then|once in a while|few times a year|yearly|holiday/.test(t)) return 2;
  if (/rare/.test(t)) return 1;
  if (/(never|not currently|not at all|none|haven.?t played)/.test(t)) return 0;
  return null;
}
/** League, club or school-team experience: No / Yes, a little / Yes, quite a bit -> 0..2. */
export function experienceLevel(v) {
  const t = fold2(v);
  if (!t) return null;
  if (/^(no|none|never|n\/a|nope|not)\b/.test(t)) return 0;
  if (/quite a bit|a lot|extensive|for years|many years/.test(t)) return 2;
  if (/a little|a bit|some\b|briefly/.test(t)) return 1;
  if (/(club|league|school|team|tournament|compet|coach|varsity|rated|yes)/.test(t)) return 2;
  return null;
}
/** Older self-label (Beginner/Intermediate/Advanced) from other forms: a weak input only, never used by the FFTT3 form. */
const selfLevel = v => {
  const t = fold2(v);
  if (!t) return null;
  if (/(advanced|expert|competitive|strong|pro)/.test(t)) return 3;
  if (/intermediate|medium|average|decent/.test(t)) return 2;
  if (/(recreational|casual|social)/.test(t)) return 1;
  if (/(beginner|novice|new)/.test(t)) return 0;
  return null;
};

const FREQ_TEXT = ['Never plays', 'Rarely plays', 'Plays occasionally', 'Plays a few times a month', 'Plays about once a week', 'Plays several times a week'];
const RALLY_TEXT = ['Has not played yet, so rally consistency is unknown', 'Is still learning and has difficulty sustaining rallies', 'Can sustain short rallies sometimes',
  'Can usually sustain rallies with reasonable consistency', 'Sustains rallies consistently and controls placement', 'Sustains strong rallies consistently, including under pressure'];
const SPIN_TEXT = ['Does not use spin on purpose', 'Uses spin a little', 'Uses spin sometimes', 'Uses spin fairly consistently', 'Uses spin confidently'];
const ATTACK_TEXT = ['Does not attack easier balls', 'Rarely attacks easier balls', 'Sometimes attacks easier balls', 'Usually attacks easier balls', 'Attacks easier balls confidently'];
const EXP_TEXT = ['No league, club or school-team experience', 'A little league, club or school-team experience', 'Quite a bit of league, club or school-team experience'];
const PROFILE_TEXT = ['Chose the Beginner profile', 'Chose the Recreational profile', 'Chose the Intermediate profile', 'Chose the Strong Intermediate profile', 'Chose the Advanced / Competitive profile'];
const SELF_TEXT = ['Self-described: Beginner', 'Self-described: Recreational', 'Self-described: Intermediate', 'Self-described: Advanced'];
// each signal: weight, and the fraction of the way up the FFTT scale its answer points to (0 = Level 1 ... 1 = Level 5)
const FRAC = {
  profile: [0, .25, .5, .75, 1], rally: [0, .05, .2, .45, .65, .9], spin: [0, .25, .5, .75, 1], attack: [0, .25, .5, .75, 1],
  frequency: [0, .1, .2, .4, .6, .85], experience: [0, .5, 1], self: [0, .25, .5, .85],
};
const WEIGHT = {profile: 4, rally: 3, spin: 1.5, attack: 1.5, frequency: 1, experience: 1.5, self: 1};
const levelFromScore = x => (x < .12 ? 1 : x < .38 ? 2 : x < .60 ? 3 : x < .82 ? 4 : 5);

/** answers: raw strings {frequency, experience, rallies, spin, attack, description (= the playing profile), selfLevel}.
 * Returns {level 1-5, confidence 'low'|'medium'|'high', basis: string[]}. Never throws.
 *
 * How it decides (all of it shown to the organizer): every answered question points part-way up the Level 1-5 scale;
 * the weighted average gives a level. Then two guard rails keep it honest:
 *   - the person's EXPLICIT profile choice anchors the result: it can differ from that profile by at most one level;
 *   - Level 5 additionally needs organized-play experience (or the Advanced profile with some experience).
 * If the other answers disagree with the profile by two levels or more, confidence drops and the basis says so.
 * This is a PROVISIONAL suggestion; the organizer confirms or changes every rating. */
export function suggestRating(input) {
  const a = input !== null && typeof input === 'object' ? input : {};
  const sig = {profile: profileLevel(a.description), rally: rallyLevel(a.rallies), spin: spinLevel(a.spin), attack: attackLevel(a.attack),
    frequency: frequencyLevel(a.frequency), experience: experienceLevel(a.experience), self: selfLevel(a.selfLevel)};
  const given = Object.entries(sig).filter(([, v]) => v !== null);
  let confidence = given.length >= 5 ? 'high' : given.length >= 3 ? 'medium' : 'low';
  const basis = [];
  if (sig.profile !== null) basis.push(PROFILE_TEXT[sig.profile]);
  if (sig.rally !== null) basis.push(RALLY_TEXT[sig.rally]);
  if (sig.frequency !== null) basis.push(FREQ_TEXT[sig.frequency]);
  if (sig.experience !== null && sig.experience > 0) basis.push(EXP_TEXT[sig.experience]);
  if (sig.spin !== null && sig.spin > 0) basis.push(SPIN_TEXT[sig.spin]);
  if (sig.attack !== null && sig.attack > 0) basis.push(ATTACK_TEXT[sig.attack]);
  if (sig.self !== null && sig.profile === null) basis.push(SELF_TEXT[sig.self]);
  if (given.length === 0) return {level: 3, confidence: 'low', basis: ['No playing details were given; starting at Intermediate']};
  const used = given.filter(([k]) => !(k === 'self' && sig.profile !== null));   // an old label never competes with the real profile
  const score = used.reduce((t, [k, v]) => t + WEIGHT[k] * FRAC[k][v], 0) / used.reduce((t, [k]) => t + WEIGHT[k], 0);
  const raw = levelFromScore(score);
  let level = raw;
  if (sig.profile !== null) {
    const anchor = sig.profile + 1;
    level = Math.min(anchor + 1, Math.max(anchor - 1, level));
    if (Math.abs(raw - anchor) >= 2) {
      confidence = confidence === 'high' ? 'medium' : 'low';
      basis.push(raw > anchor ? 'Other answers point higher than the chosen profile; check at warm-up' : 'Other answers point lower than the chosen profile; check at warm-up');
    }
  }
  const organized = sig.experience === 2 || (sig.experience !== null && sig.experience >= 1 && sig.profile === 4);
  if (level === 5 && !organized) { level = 4; basis.push('Level 5 needs league, club or tournament experience; suggested Level 4'); }
  return {level, confidence, basis: basis.slice(0, 8)};
}

// ---------------------------------------------------------------- building registrants
/** Build the organizer's registrant list from sheet rows.
 * @param rows        array of arrays (header row first)
 * @param refFor      async (identity: string) => opaque reference. The identity is the row's stable key (never shown).
 * @returns {registrants, duplicates, summary, warnings}
 */
export async function buildRegistrants(rows, {refFor} = {}) {
  if (typeof refFor !== 'function') throw new TypeError('refFor is required');
  if (!Array.isArray(rows) || rows.length === 0) return {registrants: [], duplicates: [], summary: summarize([], []), warnings: ['The sheet has no rows.']};
  const {index, missing} = mapHeaders(rows[0]);
  if (missing.length) return {registrants: [], duplicates: [], summary: summarize([], []), warnings: ['No name column was found in the sheet header.']};
  const cell = (row, field) => (index[field] === undefined ? '' : clean(row[index[field]]));
  const out = [], warnings = [];
  let skipped = 0;
  const seenIdentity = new Map();
  for (let r = 1; r < rows.length && out.length < MAX_REGISTRANTS; r++) {
    const row = rows[r];
    const full = cell(row, 'name') || [cell(row, 'firstName'), cell(row, 'lastName')].filter(Boolean).join(' ');
    if (!full) { if (row.some(c => clean(c) !== '')) skipped++; continue; }
    const email = normEmail(cell(row, 'email')), phone = normPhone(cell(row, 'phone'));
    const stamp = stampText(cell(row, 'timestamp'));
    const safe = safeName(full);
    // the stable identity of a registration: when it was made + who made it (never displayed, only hashed)
    const identity = [stamp, email ?? '', phone ?? '', nameKey(full)].join('|');
    const n = (seenIdentity.get(identity) ?? 0) + 1; seenIdentity.set(identity, n);
    const ref = await refFor(n === 1 ? identity : `${identity}|#${n}`);
    const rating = suggestRating({frequency: cell(row, 'frequency'), experience: cell(row, 'experience'), rallies: cell(row, 'rallies'),
      spin: cell(row, 'spin'), attack: cell(row, 'attack'), description: cell(row, 'description'), selfLevel: cell(row, 'selfLevel')});
    out.push({
      ref, name: safe.text, shortName: shortName(safe.text), registeredAt: stamp, rating,
      nameIssue: safe.issue,
      hint: {email: maskEmail(email), phone: maskPhone(phone)},
      _keys: {email, phone, name: nameKey(full)},
    });
  }
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} without a name ${skipped === 1 ? 'was' : 'were'} skipped.`);
  const groups = groupDuplicates(out);
  const registrants = out.map((x, i) => toRegistrant(x, groups.byIndex.get(i) ?? null));
  return {registrants, duplicates: groups.list, summary: summarize(registrants, groups.list), warnings};
}

function groupDuplicates(list) {
  const parent = list.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const reasons = new Map();   // pair "i|j" -> Set(reason)
  const note = (i, j, reason) => { const k = i < j ? `${i}|${j}` : `${j}|${i}`; if (!reasons.has(k)) reasons.set(k, new Set()); reasons.get(k).add(reason); parent[find(i)] = find(j); };
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]._keys, b = list[j]._keys;
    if (a.email && a.email === b.email) note(i, j, 'same-email');
    if (a.phone && a.phone === b.phone) note(i, j, 'same-phone');
    if (a.name && a.name === b.name) note(i, j, 'same-name');
    else if (similarNames(a.name, b.name)) note(i, j, 'similar-name');
  }
  const members = new Map();
  list.forEach((_, i) => { const r = find(i); if (!members.has(r)) members.set(r, []); members.get(r).push(i); });
  const byIndex = new Map(), outList = [];
  let g = 0;
  for (const m of members.values()) {
    if (m.length < 2) continue;
    g++;
    const all = new Set();
    for (let x = 0; x < m.length; x++) for (let y = x + 1; y < m.length; y++) {
      const k = m[x] < m[y] ? `${m[x]}|${m[y]}` : `${m[y]}|${m[x]}`;
      for (const r of reasons.get(k) ?? []) all.add(r);
    }
    const order = ['same-email', 'same-phone', 'same-name', 'similar-name'];
    const rs = order.filter(r => all.has(r));
    const strength = rs.some(r => r === 'same-email' || r === 'same-phone') ? 'definite' : rs.includes('same-name') ? 'probable' : 'possible';
    const id = `g${g}`;
    m.forEach(i => byIndex.set(i, {group: id, reasons: rs, strength}));
    outList.push({id, reasons: rs, strength, refs: m.map(i => list[i].ref)});
  }
  return {byIndex, list: outList};
}

/** The ONLY shape that leaves this module: an explicit allowlist, bounded and cleaned. */
function toRegistrant(x, dup) {
  return Object.freeze({
    ref: x.ref, name: clean(x.name).slice(0, 120), shortName: clean(x.shortName).slice(0, 80), registeredAt: clean(x.registeredAt).slice(0, 40),
    suggestedRating: x.rating.level, ratingConfidence: x.rating.confidence, ratingBasis: Object.freeze(x.rating.basis.slice(0, 8)),
    nameIssue: x.nameIssue, hint: Object.freeze({email: x.hint.email, phone: x.hint.phone}),
    duplicate: dup ? Object.freeze({group: dup.group, reasons: Object.freeze([...dup.reasons]), strength: dup.strength}) : null,
  });
}
function summarize(registrants, groups) {
  return Object.freeze({total: registrants.length, duplicateGroups: groups.length,
    needsNameFix: registrants.filter(r => r.nameIssue).length, lowConfidence: registrants.filter(r => r.ratingConfidence === 'low').length});
}

// ---------------------------------------------------------------- the wire contract (server -> browser), validated strictly
export const REF_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const REG_KEYS = ['ref', 'name', 'shortName', 'registeredAt', 'suggestedRating', 'ratingConfidence', 'ratingBasis', 'nameIssue', 'hint', 'duplicate'];
const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const keysOk = (o, keys) => plain(o) && Object.keys(o).length === keys.length && keys.every(k => k in o);
/** Validates a registration payload; throws on anything outside the contract (a contact detail can never pass). */
export function parseRegistrationPayload(raw) {
  const fail = () => { throw new TypeError('invalid registration payload'); };
  if (!plain(raw) || Object.keys(raw).some(k => !['source', 'fetchedAt', 'registrants', 'duplicates', 'summary', 'warnings'].includes(k))
    || !['google-sheets', 'synthetic-fixture', 'csv-import'].includes(raw.source) || typeof raw.fetchedAt !== 'string'
    || !Array.isArray(raw.registrants) || raw.registrants.length > MAX_REGISTRANTS || !Array.isArray(raw.duplicates) || raw.duplicates.length > MAX_REGISTRANTS
    || !Array.isArray(raw.warnings) || raw.warnings.length > 50) fail();
  const refs = new Set();
  const registrants = raw.registrants.map(r => {
    if (!keysOk(r, REG_KEYS) || typeof r.ref !== 'string' || !REF_PATTERN.test(r.ref) || refs.has(r.ref)
      || typeof r.name !== 'string' || r.name.length > 120 || typeof r.shortName !== 'string' || r.shortName.length > 80
      || typeof r.registeredAt !== 'string' || r.registeredAt.length > 40 || (r.registeredAt !== '' && !STAMP.test(r.registeredAt))
      || !Number.isInteger(r.suggestedRating) || r.suggestedRating < 1 || r.suggestedRating > 5
      || !['low', 'medium', 'high'].includes(r.ratingConfidence) || !Array.isArray(r.ratingBasis) || r.ratingBasis.length > 8
      || !r.ratingBasis.every(b => typeof b === 'string' && b.length <= 120)
      || !(r.nameIssue === null || (typeof r.nameIssue === 'string' && r.nameIssue.length <= 120))
      || !keysOk(r.hint, ['email', 'phone']) || !(r.hint.email === null || (typeof r.hint.email === 'string' && /^.•••@.•••\.[^.@]+$/u.test(r.hint.email)))
      || !(r.hint.phone === null || (typeof r.hint.phone === 'string' && /^•••• \d{2}$/u.test(r.hint.phone)))
      || !(r.duplicate === null || (keysOk(r.duplicate, ['group', 'reasons', 'strength']) && typeof r.duplicate.group === 'string' && /^g\d{1,4}$/.test(r.duplicate.group)
        && Array.isArray(r.duplicate.reasons) && r.duplicate.reasons.every(x => ['same-email', 'same-phone', 'same-name', 'similar-name'].includes(x))
        && ['definite', 'probable', 'possible'].includes(r.duplicate.strength)))) fail();
    // a full e-mail address or phone number anywhere in a displayed text field is refused outright
    for (const t of [r.name, r.shortName, r.nameIssue ?? '', ...r.ratingBasis]) if (looksLikeContact(t)) fail();
    refs.add(r.ref);
    return Object.freeze({...r, ratingBasis: Object.freeze([...r.ratingBasis]), hint: Object.freeze({...r.hint}),
      duplicate: r.duplicate && Object.freeze({...r.duplicate, reasons: Object.freeze([...r.duplicate.reasons])})});
  });
  const duplicates = raw.duplicates.map(d => {
    if (!keysOk(d, ['id', 'reasons', 'strength', 'refs']) || typeof d.id !== 'string' || !/^g\d{1,4}$/.test(d.id) || !Array.isArray(d.refs) || d.refs.length < 2
      || !d.refs.every(x => refs.has(x))) fail();
    return Object.freeze({id: d.id, reasons: Object.freeze([...d.reasons]), strength: d.strength, refs: Object.freeze([...d.refs])});
  });
  if (!plain(raw.summary) || !['total', 'duplicateGroups', 'needsNameFix', 'lowConfidence'].every(k => Number.isInteger(raw.summary[k]))) fail();
  return Object.freeze({source: raw.source, fetchedAt: raw.fetchedAt.slice(0, 40), registrants: Object.freeze(registrants),
    duplicates: Object.freeze(duplicates), summary: Object.freeze({...raw.summary}), warnings: Object.freeze(raw.warnings.map(w => String(w).slice(0, 200)))});
}

/** Browser-side private import: a CSV file the organizer picked. `refSalt` should be the event id so the same
 * file always yields the same refs for that event (re-importing never duplicates a check-in). */
export async function importCsv(text, {refSalt}) {
  if (typeof refSalt !== 'string' || refSalt.length < 8) throw new TypeError('refSalt required');
  const enc = new TextEncoder();
  const refFor = async identity => {
    const d = await crypto.subtle.digest('SHA-256', enc.encode(`fftt-csv-v1|${refSalt}|${identity}`));
    return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
  };
  const result = await buildRegistrants(parseCsv(text), {refFor});
  return parseRegistrationPayload({source: 'csv-import', fetchedAt: new Date().toISOString(), ...result});
}
