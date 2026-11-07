import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatEventDate} from '../app/date_format.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const spectator = read('app/spectator.mjs');
const html = read('app/spectator.html');
const css = read('app/app.css');

test('spectator uses approved public copy and complete bracket names', () => {
  assert.match(html, /Forging Fellowship Table Tennis · Building community through fellowship/);
  assert.doesNotMatch(html, /Public view · names and results only · FFTT Bracket Manager/);
  assert.match(spectator, /Consolation bracket champion:/);
  assert.match(spectator, /'Championship Bracket' : 'Consolation Bracket'/);
});

test('spectator score-pair separators reuse Staff Recent results shade and stay spectator-scoped', () => {
  assert.match(css, /\[aria-labelledby="recentTitle"\] \.score-game\+\.score-game::before\{[^}]*background:#d3d9e0/);
  assert.match(css, /#main\.public-wrap \.scores-cell \.score-game\+\.score-game::before/);
  assert.match(css, /#main\.public-wrap \.spectator-finale \.score-game\+\.score-game::before/);
  assert.match(css, /width:1px;background:#d3d9e0;pointer-events:none/);
  assert.match(css, /#main\.public-wrap \.spectator-finale\{margin-top:var\(--space-5\)\}/);
  assert.match(spectator, /class: 'card spectator-finale'/);
});

test('spectator date is formatted as abbreviated month, day, year without timezone drift', () => {
  assert.equal(formatEventDate('2026-11-11'), 'Nov 11, 2026');
  assert.equal(formatEventDate('2026-11-22'), 'Nov 22, 2026');
  assert.equal(formatEventDate('2028-02-29'), 'Feb 29, 2028');
  assert.equal(formatEventDate('2026-02-29'), '2026-02-29');
  assert.equal(formatEventDate('TBD'), 'TBD');
  assert.match(spectator, /formatEventDate\(ev\.date\)/);
});
