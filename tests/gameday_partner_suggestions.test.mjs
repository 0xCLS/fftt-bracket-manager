/** Mixed-Skill Doubles partner suggestions: pure engine logic, fictional players, zero network.
 * Priority: 1 balanced team strength, 2 mixed-skill teams among equally balanced options,
 * 3 established lower-level partners, 4 deterministic order. The suggestion never replaces the manager's choice. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestPartners, partnerCandidates} from '../contracts/gameday_engine.mjs';

const P = (id, name, rating) => ({id, name, rating});
const strength = (finalist, partner) => finalist.rating + partner.rating;
const mixed = (finalist, partner) => finalist.rating !== partner.rating;
function summary(fa, fb, s) {
  return {diff: Math.abs(strength(fa, s.partner1) - strength(fb, s.partner2)),
    mixedTeams: Number(mixed(fa, s.partner1)) + Number(mixed(fb, s.partner2)),
    levels: [[fa.rating, s.partner1.rating], [fb.rating, s.partner2.rating]]};
}
const names = s => [s.partner1.name, s.partner2.name];

test('rehearsal case: equal totals no longer yield a non-mixed team when both teams can be mixed', () => {
  // Legacy output was Level 2 + Level 2 versus Level 3 + Level 1 (4 v 4, but Team A not mixed).
  const fa = P('f1', 'Finalist A', 2), fb = P('f2', 'Finalist B', 3);
  const pool = [P('c1', 'Ada', 1), P('c2', 'Bo', 2), P('c3', 'Cy', 3)];
  const s = suggestPartners([fa, fb], pool);
  assert.deepEqual(summary(fa, fb, s), {diff: 0, mixedTeams: 2, levels: [[2, 3], [3, 2]]});
  assert.deepEqual(names(s), ['Cy', 'Bo']);
});

test('equal-strength options with same-level alternatives prefer the mixed-skill pairing', () => {
  const fa = P('f1', 'Finalist A', 1), fb = P('f2', 'Finalist B', 1);
  // (1,1) and (2,2) are both exactly balanced; only (2,2) gives two mixed teams.
  const pool = [P('c1', 'Ada', 1), P('c2', 'Bo', 1), P('c3', 'Cy', 2), P('c4', 'Di', 2)];
  const s = suggestPartners([fa, fb], pool);
  assert.deepEqual(summary(fa, fb, s), {diff: 0, mixedTeams: 2, levels: [[1, 2], [1, 2]]});
  assert.deepEqual(names(s), ['Cy', 'Di']);
});

test('one mixed team beats none when two mixed teams are not available at the same balance', () => {
  const fa = P('f1', 'Finalist A', 2), fb = P('f2', 'Finalist B', 3);
  // Zero-difference choices: (2,1) mixes only Team B; (3,2) is unavailable.
  const pool = [P('c1', 'Ada', 1), P('c2', 'Bo', 2)];
  const s = suggestPartners([fa, fb], pool);
  assert.deepEqual(summary(fa, fb, s), {diff: 0, mixedTeams: 1, levels: [[2, 2], [3, 1]]});
});

test('no mixed-skill alternative at equal balance: the existing balanced fallback is used', () => {
  const fa = P('f1', 'Finalist A', 2), fb = P('f2', 'Finalist B', 2);
  // A Level 1 partner would mix one team but leave the teams 3 v 4, so the balanced 2+2 v 2+2 stands.
  const pool = [P('c1', 'Ada', 1), P('c2', 'Bo', 2), P('c3', 'Cy', 2)];
  const s = suggestPartners([fa, fb], pool);
  assert.deepEqual(summary(fa, fb, s), {diff: 0, mixedTeams: 0, levels: [[2, 2], [2, 2]]});
  assert.deepEqual(names(s), ['Bo', 'Cy']);
});

test('balance always outranks mixed-skill: a mixed team is never bought with a worse balance', () => {
  const fa = P('f1', 'Finalist A', 2), fb = P('f2', 'Finalist B', 2);
  // Ada (1) + Di (3) would make both teams mixed, but 2+1 v 2+3 differs by 2. The exactly balanced 2+2 v 2+2 wins.
  const pool = [P('c1', 'Ada', 1), P('c2', 'Bo', 2), P('c3', 'Cy', 2), P('c4', 'Di', 3)];
  const s = suggestPartners([fa, fb], pool);
  assert.deepEqual(summary(fa, fb, s), {diff: 0, mixedTeams: 0, levels: [[2, 2], [2, 2]]});
  // With only a Level 1 and a Level 3 left, nothing is balanced: the smallest available gap (2) is returned.
  assert.equal(summary(fa, fb, suggestPartners([fa, fb], [pool[0], pool[3]])).diff, 2);
});

test('unequal finalist levels: smallest strength gap first, then mixed-skill', () => {
  const fa = P('f1', 'Finalist A', 5), fb = P('f2', 'Finalist B', 2);
  const pool = [P('c1', 'Ada', 1), P('c2', 'Bo', 2), P('c3', 'Cy', 3), P('c4', 'Di', 3)];
  const s = suggestPartners([fa, fb], pool);
  const r = summary(fa, fb, s);
  // Best possible gap with partners at or below Level 3 is 1: (5+1) v (2+3).
  assert.equal(r.diff, 1);
  assert.equal(r.mixedTeams, 2);
  assert.equal(s.partner1.rating, 1);
  assert.equal(s.partner2.rating, 3);
  assert.equal(s.partner2.name, 'Cy', 'name order breaks the Level 3 tie');
});

test('established beginner-to-intermediate pool still wins; higher levels are used only when fewer than two lower candidates exist', () => {
  const fa = P('f1', 'Finalist A', 3), fb = P('f2', 'Finalist B', 3);
  const pool = [P('c1', 'Ada', 2), P('c2', 'Bo', 2), P('c3', 'Cy', 4), P('c4', 'Di', 4)];
  assert.deepEqual(names(suggestPartners([fa, fb], pool)), ['Ada', 'Bo']);
  const sparse = [P('c1', 'Ada', 2), P('c3', 'Cy', 4), P('c4', 'Di', 5)];
  const s = suggestPartners([fa, fb], sparse);
  assert.ok(sparse.includes(s.partner1) && sparse.includes(s.partner2));
  // One Level 3 or lower candidate is not a pool: every candidate is considered, balance first (7 v 8).
  assert.deepEqual(names(s), ['Cy', 'Di']);
});

test('suggestions are deterministic, independent of candidate input order, and use only supplied candidates', () => {
  const fa = P('f1', 'Finalist A', 2), fb = P('f2', 'Finalist B', 3);
  const pool = [P('c1', 'Ada', 1), P('c2', 'Bo', 2), P('c3', 'Cy', 3), P('c4', 'Di', 2), P('c5', 'Ed', 3), P('c6', 'Fy', 1)];
  const reference = suggestPartners([fa, fb], pool);
  for (const order of [[...pool].reverse(), [pool[3], pool[0], pool[5], pool[1], pool[4], pool[2]], pool]) {
    const s = suggestPartners([fa, fb], order);
    assert.equal(s.partner1.id, reference.partner1.id);
    assert.equal(s.partner2.id, reference.partner2.id);
  }
  // Both teams mixed (2+3, 3+2); level then name picks Cy (Level 3) and Bo (Level 2) over Ed and Di.
  assert.deepEqual([reference.partner1.id, reference.partner2.id], ['c3', 'c2']);
  assert.ok(pool.includes(reference.partner1) && pool.includes(reference.partner2));
  assert.notEqual(reference.partner1.id, reference.partner2.id);
  assert.ok(![fa.id, fb.id].includes(reference.partner1.id) && ![fa.id, fb.id].includes(reference.partner2.id));
  // Identical level and name: id is the stable tie-break.
  const twins = [P('z', 'Same', 2), P('a', 'Same', 2), P('m', 'Other', 1)];
  assert.deepEqual(partnerCandidates(twins).map(p => p.id), ['m', 'a', 'z']);
});

test('insufficient input returns no suggestion and never invents a pairing', () => {
  const fa = P('f1', 'Finalist A', 2), fb = P('f2', 'Finalist B', 3);
  assert.equal(suggestPartners([fa, fb], [P('c1', 'Ada', 1)]), null);
  assert.equal(suggestPartners([fa, fb], []), null);
  assert.equal(suggestPartners([fa], [P('c1', 'Ada', 1), P('c2', 'Bo', 2)]), null);
});

test('input candidates and finalists are not mutated', () => {
  const fa = Object.freeze(P('f1', 'Finalist A', 2)), fb = Object.freeze(P('f2', 'Finalist B', 3));
  const pool = Object.freeze([1, 2, 3].map(n => Object.freeze(P('c' + n, 'N' + n, n))));
  assert.ok(suggestPartners([fa, fb], pool));
  assert.deepEqual(pool.map(p => p.id), ['c1', 'c2', 'c3']);
});
