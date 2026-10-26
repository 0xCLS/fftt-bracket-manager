/** Registration model: header mapping, CSV, duplicate detection, rating suggestion, privacy. Fictional fixtures only.
 * Zero network. Run: node --test tests/registration_model.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv, mapHeaders, buildRegistrants, suggestRating, parseRegistrationPayload, importCsv, safeName, shortName, nameKey,
  similarNames, normEmail, normPhone, maskEmail, maskPhone, looksLikeContact, REF_PATTERN,
  profileLevel, rallyLevel, spinLevel, attackLevel, frequencyLevel, experienceLevel} from '../contracts/registration_model.mjs';

import {SYNTHETIC_FORM_CSV as FIXTURE} from '../server/registration/synthetic_fixture.mjs';
const refFor = async id => 'T' + Buffer.from(id).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').padEnd(20, 'x').slice(0, 30);
const build = async (text = FIXTURE) => buildRegistrants(parseCsv(text), {refFor});
const by = (r, name) => r.registrants.find(x => x.name === name);

test('CSV: quotes, embedded commas and newlines, CRLF, BOM and blank lines', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","line1\nline2","he said ""hi"""\r\n\r\n1,2,3');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'line1\nline2', 'he said "hi"'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv(''), []);
  assert.equal(parseCsv('a\n'.repeat(5000)).length <= 201, true, 'a huge file is bounded');
});

/** The APPROVED FFTT3 Google Form, word for word: 12 columns and the exact answer choices (fictional answers only). */
const FORM = {
  headers: ['Timestamp', 'Full Name', 'Email Address', 'Phone Number', 'Age Group', 'Have you participated in a previous Forging Fellowship Table Tennis event?',
    'How often do you currently play table tennis?', 'Do you have any league, club, or school-team tennis experience?', 'Which best describes your rally consistency?',
    'Can you intentionally use spin on serves or returns?', 'Can you consistently attack easier balls?', 'Which playing profile best matches your current game?'],
  frequency: ['Several times a week', 'About once a week', 'A few times a month', 'Occasionally', 'Rarely', 'Never'],
  experience: ['No', 'Yes, a little', 'Yes, quite a bit'],
  rally: ["Haven't played, so I don't know how consistently I can sustain a rally", 'I am still learning and have difficulty sustaining rallies',
    'I can sustain short rallies sometimes', 'I can usually sustain rallies with reasonable consistency', 'I can sustain rallies consistently and control placement',
    'I can sustain strong rallies consistently, including under pressure'],
  spin: ['No', 'A little', 'Sometimes', 'Yes, fairly consistently', 'Yes, confidently'],
  attack: ['No', 'Rarely', 'Sometimes', 'Usually', 'Yes, confidently'],
  profile: ['Beginner — New or fairly new to table tennis; still developing reliable serves, returns, and control',
    'Recreational — Comfortable playing casually; can rally and serve, but with limited consistency or shot variety',
    'Intermediate — Can rally consistently, serve reliably, and use some placement, spin, or attacking play',
    'Strong Intermediate — Stronger than the average casual player; uses varied serves/spin, controlled attacks, and match strategy',
    'Advanced / Competitive — Club, league, or tournament-level ability, or comparable demonstrated play'],
};
const answers = ({f = 1, e = 0, r = 3, s = 2, a = 2, p = 2} = {}) => ({frequency: FORM.frequency[f], experience: FORM.experience[e], rallies: FORM.rally[r],
  spin: FORM.spin[s], attack: FORM.attack[a], description: FORM.profile[p]});
const level = (o) => suggestRating(answers(o)).level;

test('headers: the approved form\'s 12 columns map to the right fields, and the unused ones stay unmapped', () => {
  const {index, missing} = mapHeaders(FORM.headers);
  assert.deepEqual(missing, []);
  assert.deepEqual(index, {timestamp: 0, name: 1, email: 2, phone: 3, frequency: 6, experience: 7, rallies: 8, spin: 9, attack: 10, description: 11});
  assert.ok(!Object.values(index).includes(4) && !Object.values(index).includes(5), 'Age Group and previous participation are not rating inputs');
  assert.equal(new Set(Object.values(index)).size, Object.keys(index).length, 'a column feeds at most one field');
  // the rally question must not be mistaken for the playing profile (both start "Which ... best ...")
  assert.equal(FORM.headers[index.rallies], 'Which best describes your rally consistency?');
  assert.equal(FORM.headers[index.description], 'Which playing profile best matches your current game?');
  // the fixture uses exactly this layout
  assert.deepEqual(parseCsv(FIXTURE)[0], FORM.headers);
  // wording changes in OTHER forms still map; a missing name column is reported
  const alt = mapHeaders(['Submitted', 'First Name', 'Last Name', 'Mobile', 'E-mail', 'How frequently do you play?']);
  assert.deepEqual([alt.index.firstName, alt.index.lastName, alt.index.phone, alt.index.email, alt.index.frequency], [1, 2, 3, 4, 5]);
  assert.deepEqual(mapHeaders(['Timestamp', 'Email']).missing, ['name']);
});

test('first and last name columns are joined', async () => {
  const r = await build('Timestamp,First name,Last name,Email\n2026/11/01,Ada,Quillfeather,ada@example.invalid\n');
  assert.equal(r.registrants[0].name, 'Ada Quillfeather');
  assert.equal(r.registrants[0].shortName, 'Ada Q.');
});

test('PRIVACY: no e-mail address, phone number or free-text answer survives into the output', async () => {
  const r = await build();
  const json = JSON.stringify(r);
  assert.ok(!/example\.invalid/i.test(json), 'no full e-mail address');
  assert.ok(!/555[-.\s)]*01\d\d|\b7345550/.test(json), 'no phone number');
  assert.ok(!/Bringing my kids|Typed my|Resubmitted|Possibly the same|household/i.test(json), 'free-text answers are never forwarded');
  for (const x of r.registrants) {
    assert.deepEqual(Object.keys(x).sort(), ['duplicate', 'hint', 'name', 'nameIssue', 'ratingBasis', 'ratingConfidence', 'ref', 'registeredAt', 'shortName', 'suggestedRating']);
    assert.ok(x.hint.email === null || /^.•••@.•••\.[a-z]+$/u.test(x.hint.email));
    assert.ok(x.hint.phone === null || /^•••• \d\d$/u.test(x.hint.phone));
    assert.ok(Object.isFrozen(x));
  }
  // every name the roster would receive is acceptable to the database rules
  for (const x of r.registrants) {
    assert.ok(!looksLikeContact(x.name) && !looksLikeContact(x.shortName), x.name);
    assert.ok(x.name.length >= 1 && x.name.length <= 80);
    assert.ok(!/[=<>"`{}]/.test(x.name[0]) , x.name);
    assert.match(x.ref, REF_PATTERN);
  }
  parseRegistrationPayload({source: 'synthetic-fixture', fetchedAt: '2026-11-08T00:00:00Z', ...r});
});

test('names that carry contact details or formulas are cleaned and flagged, never passed through', async () => {
  const r = await build();
  const lia = r.registrants.find(x => x.name === 'Lia');
  assert.match(lia.nameIssue, /removed/);
  assert.ok(r.registrants.some(x => x.name === 'Unnamed registrant' && /only contact details|No name/.test(x.nameIssue)));
  const formula = r.registrants.find(x => /HYPERLINK/.test(x.name));
  assert.ok(!formula, 'a formula is never kept as a name');
  assert.ok(r.registrants.filter(x => x.name === 'Unnamed registrant').length >= 2, 'formula and e-mail-as-name rows are replaced and flagged');
  assert.equal(safeName('=SUM(A1)').text, 'Unnamed registrant');
  assert.equal(safeName('-Ada Quill').text, 'Ada Quill');
  assert.equal(safeName('see https://x.invalid Ada').text, 'see Ada');
  assert.deepEqual([safeName('Bob 734-555-0100').text, safeName('x@y.org').text, safeName('  ').text], ['Bob', 'Unnamed registrant', 'Unnamed registrant']);
  assert.equal(safeName("Mary-Jane O'Neil").issue, null, 'hyphens and apostrophes inside a name are fine');
  assert.equal(r.summary.needsNameFix, r.registrants.filter(x => x.nameIssue).length);
  assert.equal(r.summary.needsNameFix, 3);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /without a name/);
});

test('duplicates: same e-mail, same phone, same name and similar names are grouped with a strength', async () => {
  const r = await build();
  const adas = r.registrants.filter(x => /^Ada Q/.test(x.name));
  assert.equal(adas.length, 3);
  assert.equal(new Set(adas.map(a => a.duplicate.group)).size, 1, 'both resubmission and short form join one group');
  const g = r.duplicates.find(d => d.id === adas[0].duplicate.group);
  assert.equal(g.strength, 'definite');
  assert.ok(['same-email', 'same-phone', 'same-name'].every(x => g.reasons.includes(x)));
  assert.equal(g.refs.length, 3);
  const jo = r.registrants.filter(x => /^Jo[e]? Marchettis$/.test(x.name));
  assert.equal(jo[0].duplicate.group, jo[1].duplicate.group);
  assert.deepEqual(jo[0].duplicate.reasons, ['same-phone', 'similar-name']);
  assert.equal(r.summary.duplicateGroups, 2);
  assert.equal(by(r, 'Ben Marlowe').duplicate, null, 'unrelated people are never grouped');
  // helper behavior
  assert.ok(similarNames(nameKey('Ada Q'), nameKey('Ada Quillfeather')));
  assert.ok(similarNames('jon smith', 'john smith'));
  assert.ok(!similarNames('ben marlowe', 'dee larkspur'));
  assert.ok(!similarNames('ada quill', 'ada quill'), 'identical names are the same-name case, not similar');
  assert.equal(nameKey('  Ádá   QUILL. '), 'ada quill');
});

test('identical resubmissions get distinct refs; the same input always yields the same refs', async () => {
  const a = await build(), b = await build();
  assert.deepEqual(a.registrants.map(x => x.ref), b.registrants.map(x => x.ref));
  assert.equal(new Set(a.registrants.map(x => x.ref)).size, a.registrants.length);
  const twice = await build('Timestamp,Full name\n2026/11/01,Ada Q\n2026/11/01,Ada Q\n');
  assert.notEqual(twice.registrants[0].ref, twice.registrants[1].ref);
});

test('rating suggestion on the fixture: levels follow the approved answers, with honest confidence and plain-language reasons', async () => {
  const r = await build();
  const lv = n => by(r, n).suggestedRating;
  assert.equal(lv('Eli Brandtley'), 1, 'Beginner, never plays, has not played');
  assert.equal(lv('Pia Dunmoor'), 1);
  assert.equal(lv('Joe Marchettis'), 1);
  assert.equal(lv('Ben Marlowe'), 2); assert.equal(lv('Dee Larkspur'), 2); assert.equal(lv('Gus Pemberly'), 2); assert.equal(lv('Ivy Castelan'), 2);
  assert.equal(lv('Ada Quillfeather'), 3); assert.equal(lv('Hal Wintersby'), 3); assert.equal(lv('Oli Sparkman'), 3);
  assert.equal(lv('Jo Marchettis'), 4, 'Strong Intermediate without organized-play experience');
  assert.equal(lv('Cy Fennelwick'), 5); assert.equal(lv('Nia Rowland'), 5); assert.equal(lv('Fay Hollowell'), 5);
  assert.equal(by(r, 'Kit Alderman').ratingConfidence, 'low');
  assert.equal(by(r, 'Kit Alderman').suggestedRating, 3);
  assert.deepEqual(by(r, 'Kit Alderman').ratingBasis, ['No playing details were given; starting at Intermediate']);
  assert.ok(by(r, 'Cy Fennelwick').ratingBasis.includes('Quite a bit of league, club or school-team experience'));
  assert.ok(by(r, 'Eli Brandtley').ratingBasis.includes('Has not played yet, so rally consistency is unknown'));
  assert.ok(r.registrants.every(x => x.suggestedRating >= 1 && x.suggestedRating <= 5));
  // provisional: the model never marks anything confirmed (the organizer's confirmation is a separate, server-side step)
  assert.ok(r.registrants.every(x => !('confirmed' in x) && !('ratingConfirmed' in x)));
  // junk never throws
  for (const bad of [undefined, null, {}, {frequency: 5}, {spin: {}}, {description: '💥'.repeat(500)}]) assert.ok(suggestRating(bad).level >= 1);
});

test('REGRESSION: every approved answer choice is recognized, in order, from the exact wording', () => {
  assert.deepEqual(FORM.rally.map(rallyLevel), [0, 1, 2, 3, 4, 5], 'the six descriptive rally sentences were being ignored');
  assert.deepEqual(FORM.profile.map(profileLevel), [0, 1, 2, 3, 4]);
  assert.deepEqual(FORM.frequency.map(frequencyLevel), [5, 4, 3, 2, 1, 0]);
  assert.deepEqual(FORM.experience.map(experienceLevel), [0, 1, 2], '"a little" is not "quite a bit"');
  assert.deepEqual(FORM.spin.map(spinLevel), [0, 1, 2, 3, 4]);
  assert.deepEqual(FORM.attack.map(attackLevel), [0, 1, 2, 3, 4]);
  // nothing the form offers is dropped as "unanswered"
  for (const [fn, list] of [[rallyLevel, FORM.rally], [profileLevel, FORM.profile], [frequencyLevel, FORM.frequency], [experienceLevel, FORM.experience], [spinLevel, FORM.spin], [attackLevel, FORM.attack]]) {
    for (const o of list) assert.notEqual(fn(o), null, o);
  }
  // case, spacing and a plain hyphen for the em dash do not matter
  assert.equal(profileLevel('  strong intermediate - stronger than the average casual player '), 3);
  assert.equal(rallyLevel('  I CAN SUSTAIN SHORT RALLIES SOMETIMES '), 2);
});

test('REGRESSION: the explicit profile label wins over incidental words inside the descriptions', () => {
  // "...reliable serves, returns, and CONTROL" must not make a Beginner an Intermediate
  assert.equal(profileLevel(FORM.profile[0]), 0);
  // "Comfortable playing casually" must not make a Recreational an Intermediate
  assert.equal(profileLevel(FORM.profile[1]), 1);
  // "some placement, spin, or attacking play" must not make an Intermediate Strong
  assert.equal(profileLevel(FORM.profile[2]), 2);
  // "varied serves/spin, controlled attacks" is Strong Intermediate, not Advanced
  assert.equal(profileLevel(FORM.profile[3]), 3);
  // "Club, league, or tournament-level ability" belongs to the Advanced label, and appears only there
  assert.equal(profileLevel(FORM.profile[4]), 4);
  // each Level 1-4 profile on its own (nothing else answered) suggests its own level, never one higher
  for (const p of [0, 1, 2, 3]) assert.equal(suggestRating({description: FORM.profile[p]}).level, p + 1, `profile ${p}`);
  assert.equal(suggestRating({description: FORM.profile[4]}).level, 4, 'Advanced on its own is Level 4 until organized-play experience is shown');
  // text with no leading label still falls back to keywords
  assert.equal(profileLevel('I play on a league team'), 4);
  assert.equal(profileLevel('just starting to learn'), 0);
});

test('REGRESSION: rally answers separate "difficulty", "short", "usually consistent", "consistent with placement" and "strong under pressure"', () => {
  // Intermediate profile, otherwise identical answers: only the rally answer changes
  const byRally = FORM.rally.map((_, r) => level({r, p: 2}));
  assert.deepEqual(byRally, [2, 2, 2, 3, 3, 3]);
  assert.ok(byRally[1] < byRally[4], 'difficulty sustaining rallies scores lower than consistent rallies with placement');
  // Recreational profile: placement-level consistency lifts the suggestion, a struggling rally does not
  assert.deepEqual(FORM.rally.map((_, r) => level({r, p: 1})), [2, 2, 2, 2, 3, 3]);
  // Strong Intermediate: strong rallies under pressure reach Level 5 only together with the rest of a strong profile
  assert.equal(level({r: 5, p: 3, f: 0, e: 2, s: 4, a: 4}), 5);
  assert.equal(level({r: 1, p: 3, f: 0, e: 2, s: 4, a: 4}), 4);
  // the reasons quote the actual answer
  assert.ok(suggestRating(answers({r: 1})).basis.includes('Is still learning and has difficulty sustaining rallies'));
  assert.ok(suggestRating(answers({r: 2})).basis.includes('Can sustain short rallies sometimes'));
  assert.ok(suggestRating(answers({r: 5})).basis.includes('Sustains strong rallies consistently, including under pressure'));
});

test('REGRESSION: the chosen profile anchors the suggestion (at most one level away) and disagreement lowers confidence', () => {
  const beginnerTop = suggestRating(answers({p: 0, r: 5, f: 0, e: 0, s: 4, a: 4}));
  assert.equal(beginnerTop.level, 2, 'a Beginner profile is never lifted past Level 2');
  assert.notEqual(beginnerTop.confidence, 'high');
  assert.ok(beginnerTop.basis.some(b => /higher than the chosen profile/.test(b)));
  const advancedWeak = suggestRating(answers({p: 4, r: 1, f: 5, e: 0, s: 0, a: 0}));
  assert.equal(advancedWeak.level, 4, 'an Advanced profile with beginner-like answers is pulled down by one level, not more');
  assert.ok(advancedWeak.basis.some(b => /lower than the chosen profile/.test(b)));
  // agreeing answers keep high confidence
  assert.equal(suggestRating(answers({p: 2})).confidence, 'high');
});

test('REGRESSION: league/club/school-team experience: "a little" and "quite a bit" differ; Level 5 needs organized play', () => {
  const top = {f: 0, r: 5, s: 4, a: 4, p: 4};
  assert.equal(level({...top, e: 0}), 4, 'Advanced profile and strong answers but no experience: Level 4 with a note');
  assert.ok(suggestRating(answers({...top, e: 0})).basis.some(b => /Level 5 needs league, club or tournament experience/.test(b)));
  assert.equal(level({...top, e: 1}), 5, 'Advanced profile with a little organized-play experience');
  assert.equal(level({...top, e: 2}), 5);
  // an experienced player who chose a lower profile is not pushed to 5 unless the rest agrees
  assert.equal(level({e: 2, p: 2, r: 3, s: 2, a: 2, f: 1}), 3);
  assert.ok(suggestRating(answers({e: 1})).basis.includes('A little league, club or school-team experience'));
  assert.ok(suggestRating(answers({e: 2})).basis.includes('Quite a bit of league, club or school-team experience'));
  assert.ok(!suggestRating(answers({e: 0})).basis.some(b => /experience/i.test(b)), 'no experience is not listed as a reason');
});

test('REGRESSION: spin, attack and frequency are ordered scales; missing answers are not penalised', () => {
  const spins = FORM.spin.map((_, s) => level({p: 2, r: 3, f: 2, s, a: 2}));
  const attacks = FORM.attack.map((_, a) => level({p: 2, r: 3, f: 2, s: 2, a}));
  for (const list of [spins, attacks]) assert.ok(list.every((x, i) => i === 0 || x >= list[i - 1]), JSON.stringify(list));
  assert.ok(spins[4] >= spins[0] && attacks[4] >= attacks[0]);
  // only some answers given: judged on those, with lower confidence, not dragged down by silence
  const sparse = suggestRating({description: FORM.profile[2], rallies: FORM.rally[3], frequency: FORM.frequency[1]});
  assert.equal(sparse.level, 3);
  assert.equal(sparse.confidence, 'medium');
  assert.equal(suggestRating({description: FORM.profile[2], rallies: FORM.rally[3]}).confidence, 'low');
  // the old Yes/Sometimes/No wording of other forms still works
  assert.equal(suggestRating({rallies: 'Yes', spin: 'Sometimes', attack: 'Usually', frequency: 'weekly', description: 'Intermediate'}).level, 3);
  assert.deepEqual(suggestRating({selfLevel: 'Beginner'}), {level: 1, confidence: 'low', basis: ['Self-described: Beginner']});
});

test('the whole approved-choice grid stays inside 1-5, deterministic, and never leaks answer text beyond the fixed reasons', () => {
  const known = new Set();
  for (let p = 0; p < 5; p++) for (let r = 0; r < 6; r++) for (let f = 0; f < 6; f += 2) for (let e = 0; e < 3; e++) for (let s = 0; s < 5; s += 2) for (let a = 0; a < 5; a += 2) {
    const x = suggestRating(answers({p, r, f, e, s, a})), y = suggestRating(answers({p, r, f, e, s, a}));
    assert.deepEqual(x, y);
    assert.ok(x.level >= 1 && x.level <= 5 && ['low', 'medium', 'high'].includes(x.confidence) && x.basis.length <= 8);
    assert.ok(x.level >= Math.max(1, p), 'never more than one level below the chosen profile'); assert.ok(x.level <= Math.min(5, p + 2), 'never more than one level above');
    for (const b of x.basis) known.add(b);
  }
  for (const b of known) assert.ok(b.length <= 120 && !/@|\d{4}/.test(b), b);
});

test('payload contract: strict shape; a contact detail anywhere is refused', async () => {
  const r = await build();
  const ok = {source: 'google-sheets', fetchedAt: '2026-11-08T00:00:00Z', ...r};
  const parsed = parseRegistrationPayload(ok);
  assert.equal(parsed.registrants.length, 20);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.registrants));
  const bad = fn => assert.throws(() => parseRegistrationPayload(fn(structuredClone(ok))), /invalid registration payload/);
  bad(p => { p.registrants[0].email = 'ada@example.invalid'; return p; });
  bad(p => { p.registrants[0].hint.email = 'ada@example.invalid'; return p; });
  bad(p => { p.registrants[0].hint.phone = '7345550101'; return p; });
  bad(p => { p.registrants[0].name = 'ada@example.invalid'; return p; });
  bad(p => { p.registrants[0].name = 'Ada 734-555-0101'; return p; });
  bad(p => { p.registrants[0].ratingBasis = ['call 734 555 0101']; return p; });
  bad(p => { p.registrants[0].ref = 'short'; return p; });
  bad(p => { p.registrants[1].ref = p.registrants[0].ref; return p; });
  bad(p => { p.registrants[0].suggestedRating = 6; return p; });
  bad(p => { p.registrants[0].ratingConfidence = 'certain'; return p; });
  bad(p => { p.source = 'somewhere-else'; return p; });
  bad(p => { p.extra = 1; return p; });
  bad(p => { p.duplicates[0].refs = ['ghost-ref-00000000000000']; return p; });
  bad(p => { p.registrants = Array.from({length: 201}, () => p.registrants[0]); return p; });
  assert.throws(() => parseRegistrationPayload(null));
});

test('private CSV import: deterministic per event, never uploads, returns a validated payload', async () => {
  const a = await importCsv(FIXTURE, {refSalt: 'event-one-0001'});
  const b = await importCsv(FIXTURE, {refSalt: 'event-one-0001'});
  const c = await importCsv(FIXTURE, {refSalt: 'event-two-0002'});
  assert.equal(a.source, 'csv-import');
  assert.deepEqual(a.registrants.map(x => x.ref), b.registrants.map(x => x.ref), 're-importing the same file reproduces the refs');
  assert.notEqual(a.registrants[0].ref, c.registrants[0].ref, 'refs are per event');
  assert.equal(a.registrants.length, 20);
  await assert.rejects(importCsv(FIXTURE, {refSalt: ''}));
  const empty = await importCsv('Timestamp,Full name\n', {refSalt: 'event-one-0001'});
  assert.equal(empty.registrants.length, 0);
  const noName = await importCsv('Timestamp,Email\n2026/11/01,ada@example.invalid\n', {refSalt: 'event-one-0001'});
  assert.equal(noName.registrants.length, 0);
  assert.match(noName.warnings[0], /No name column/);
});

test('helpers: contact normalization and masking', () => {
  assert.equal(normEmail(' Ada@Example.INVALID '), 'ada@example.invalid');
  assert.equal(normEmail('not an email'), null);
  assert.equal(normPhone('+1 (734) 555-0101'), '7345550101');
  assert.equal(normPhone('555'), null);
  assert.equal(maskEmail('ada@example.org'), 'a•••@e•••.org');
  assert.equal(maskEmail(null), null);
  assert.equal(maskPhone('7345550142'), '•••• 42');
  assert.equal(shortName('Ada'), 'Ada');
  assert.equal(shortName('Ada van der Quill'), 'Ada Q.');
});
