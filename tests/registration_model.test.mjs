/** Registration model: header mapping, CSV, duplicate detection, rating suggestion, privacy. Fictional fixtures only.
 * Zero network. Run: node --test tests/registration_model.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv, mapHeaders, buildRegistrants, suggestRating, parseRegistrationPayload, importCsv, safeName, shortName, nameKey,
  similarNames, normEmail, normPhone, maskEmail, maskPhone, looksLikeContact, REF_PATTERN} from '../contracts/registration_model.mjs';

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

test('headers: the fixture form maps every field; wording changes still map; a missing name column is reported', () => {
  const {index, missing} = mapHeaders(parseCsv(FIXTURE)[0]);
  assert.deepEqual(missing, []);
  for (const f of ['timestamp', 'name', 'email', 'phone', 'frequency', 'experience', 'rallies', 'spin', 'attack', 'description', 'selfLevel']) assert.ok(index[f] !== undefined, f);
  assert.equal(new Set(Object.values(index)).size, Object.keys(index).length, 'a column feeds at most one field');
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

test('rating suggestion: levels follow the documented inputs, with an honest confidence and plain-language basis', async () => {
  const r = await build();
  const level = n => by(r, n).suggestedRating;
  assert.equal(level('Eli Brandtley'), 1, 'never plays, just learning');
  assert.equal(level('Ben Marlowe'), 2);
  assert.equal(level('Dee Larkspur'), 2, 'casual, monthly, keeps the ball in play');
  assert.equal(level('Ada Quillfeather'), 3);
  assert.equal(level('Hal Wintersby'), 3, 'consistent with some spin is Intermediate, not Strong');
  assert.equal(level('Jo Marchettis'), 4, 'strong game without organized-play experience is capped at Level 4');
  assert.equal(level('Cy Fennelwick'), 5);
  assert.equal(level('Nia Rowland'), 5);
  assert.equal(by(r, 'Kit Alderman').ratingConfidence, 'low');
  assert.equal(by(r, 'Kit Alderman').suggestedRating, 3);
  assert.deepEqual(by(r, 'Kit Alderman').ratingBasis, ['No playing details were given; starting at Intermediate']);
  assert.ok(by(r, 'Cy Fennelwick').ratingBasis.includes('Has club, league, school-team or tournament experience'));
  assert.ok(r.registrants.every(x => x.suggestedRating >= 1 && x.suggestedRating <= 5));
  // only a self label: use it, but say so
  assert.deepEqual(suggestRating({selfLevel: 'Beginner'}), {level: 1, confidence: 'low', basis: ['Self-described: Beginner']});
  assert.equal(suggestRating({selfLevel: 'Advanced'}).level, 4, 'a bare "Advanced" never goes above Level 4');
  // junk never throws
  for (const bad of [undefined, null, {}, {frequency: 5}, {spin: {}}, {description: '💥'.repeat(500)}]) assert.ok(suggestRating(bad).level >= 1);
  // a strong game described with experience can reach Level 5; without experience it cannot
  const strong = {frequency: 'daily', rallies: 'yes', spin: 'yes', attack: 'yes', description: 'competitive league player', selfLevel: 'advanced'};
  assert.equal(suggestRating({...strong, experience: 'yes, league'}).level, 5);
  assert.equal(suggestRating({...strong, experience: 'no'}).level, 4);
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
