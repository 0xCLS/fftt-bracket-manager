import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatEventDate} from '../app/date_format.mjs';
import {spectatorGameWins} from '../app/spectator_game_dots.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const spectator = read('app/spectator.mjs');
const html = read('app/spectator.html');
const css = read('app/app.css');

test('spectator uses approved public copy and complete bracket names', () => {
  assert.match(html, /Forging Fellowship Table Tennis · Building community through fellowship/);
  assert.doesNotMatch(html, /Public view · names and results only · FFTT Bracket Manager/);
  assert.match(spectator, /awardColumn\('Consolation', 'consolation'/);
  assert.match(spectator, /resultsGroup\('Championship Bracket', championship, feedState, completedFinal/);
  assert.match(spectator, /resultsGroup\('Consolation Bracket', consolation, feedState, completedFinal/);
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

test('spectator win dots reuse only confirmed best-of-three game progress', () => {
  const base={bestOf:3, points:11, name1:'Player A',name2:'Player B',
    status:'pending',phase:'playing',scores:'',winnerName:null,
    progress:{games:[[11,7],[9,11]],won:[1,1]}};
  assert.deepEqual(spectatorGameWins(base,'current')?.won,[1,1]);
  assert.equal(spectatorGameWins(base,'current')?.source,'confirmed');
  assert.equal(spectatorGameWins(base,'stale')?.source,'stale');
  assert.equal(spectatorGameWins(base,'empty'),null);
  assert.equal(spectatorGameWins({...base,progress:null},'current'),null);
  assert.equal(spectatorGameWins({...base,bestOf:1},'current'),null);
  assert.equal(spectatorGameWins({...base,progress:{games:[[11,7]],won:[2,0]}},'current'),null);
});
test('spectator dots validate official final scores and avoid walkovers', () => {
  const m={bestOf:3,points:11,name1:'Player A',name2:'Player B',
    status:'complete',phase:'done',winnerName:'Player A',scores:'11-6, 8-11, 11-9',progress:null};
  assert.deepEqual(spectatorGameWins(m,'current')?.won,[2,1]);
  assert.equal(spectatorGameWins(m,'current')?.source,'final');
  assert.equal(spectatorGameWins({...m,scores:'W/O'},'current'),null);
  assert.equal(spectatorGameWins({...m,winnerName:'Player B'},'current'),null);
});
test('spectator renders TV-style three dots only for supported matches', () => {
  assert.match(spectator, /class: 'spectator-game-dots'/);
  assert.match(spectator, /Array\.from\(\{length: 3\}/);
  assert.match(spectator, /board\.playing\.map\(m => matchCard\(m, feedState\)\)/);
  assert.match(spectator, /spectatorMatchup\(m, feedState, true, m\.id === finalId/);
  assert.match(css, /#main\.public-wrap \.spectator-win-dot\.earned/);
});

test('spectator Results groups complete matches into bracket sections without duplicate winner column', () => {
  assert.match(spectator, /board\.recent\.filter\(m => m\.bracket === 'championship'\)/);
  assert.match(spectator, /board\.recent\.filter\(m => m\.bracket === 'consolation'\)/);
  assert.match(spectator, /h\('ol', \{class: 'spectator-results-list'\}/);
  assert.match(spectator, /text: m\.id === finalId \? 'Final' : `Round \$\{m\.round \+ 1\}`/);
  assert.match(spectator, /scoreTiles\(m\.scores, \{left: m\.name1, right: m\.name2, caption: false\}\)/);
  // Retain V4 comprehensive regression's stable score-tile hook inside the new Results card.
  assert.match(spectator, /class: 'spectator-result-scorebox scores-cell'/);
  assert.match(spectator, /'aria-label': 'Match winner'/);
  assert.doesNotMatch(spectator, /\$\{m\.winnerName\} won/);
  assert.doesNotMatch(spectator, /board\.recent\.map\(m => h\('tr'/);
});

test('spectator Results styling remains scoped and responsive', () => {
  assert.match(css, /#main\.public-wrap \.spectator-results-group\{/);
  assert.match(css, /#main\.public-wrap \.spectator-result\{/);
  assert.match(css, /#main\.public-wrap \.spectator-result-scorebox \.score-games\{/);
  assert.match(css, /@media\(max-width:700px\)\{\s*#main\.public-wrap \.spectator-results-heading/);
});

test('spectator Now and next visually distinguishes actual playing from queued matches', () => {
  assert.match(spectator, /const playing = m\.phase === 'playing'/);
  assert.match(spectator, /class: 'spectator-now-live', text: 'Playing'/);
  assert.match(spectator, /class: 'fmt-line spectator-now-format'/);
  assert.match(spectator, /class: 'now-grid spectator-now-playing-grid'/);
  assert.match(spectator, /class: 'now-grid spectator-now-queue-grid'/);
  assert.match(spectator, /playing \? h\('div', \{class: 'spectator-now-status'/);
  assert.match(css, /#main\.public-wrap \.spectator-now-card\.is-playing\{/);
  assert.match(css, /#main\.public-wrap \.spectator-now-card\.is-up-next\{/);
  assert.match(css, /#main\.public-wrap \.spectator-now-meta\{/);
});

test('spectator Bracket preserves shared renderer, compact byes, and accessible navigation', () => {
  assert.match(spectator, /import \{bracketView, groupRounds\} from '\.\/bracket_view\.mjs'/);
  assert.match(spectator, /spectatorBracket\(ev\.championship, 'championship'\)/);
  assert.match(spectator, /spectatorBracket\(ev\.consolation, 'consolation'\)/);
  assert.match(spectator, /class: 'spectator-bracket-shell'/);
  assert.match(spectator, /'aria-label': 'Previous ' \+ kind \+ ' round'/);
  assert.match(spectator, /'aria-label': 'Next ' \+ kind \+ ' round'/);
  assert.match(spectator, /class: 'spectator-bracket-position span-'/);
  assert.match(spectator, /children\.has\(2 \* m\.slot\) && children\.has\(2 \* m\.slot \+ 1\)/);
  assert.match(spectator, /new Set\(slots\)\.size === slots\.length/);
  assert.match(css, /#main\.public-wrap \.spectator-bracket-position\.is-bye \.playerline\.empty\{display:none\}/);
  assert.match(css, /#main\.public-wrap \.spectator-bracket\.has-grounded-slots \.spectator-bracket-connector\{/);
  assert.doesNotMatch(spectator, /\.innerHTML\s*=/);
});

test('finished singles finals get correct award icons without ribbons or badges', () => {
  assert.match(spectator, /const completedFinal = matches =>/);
  assert.match(spectator, /m\.status === 'complete' && m\.name1 && m\.name2/);
  assert.match(spectator, /last\.length !== 1 \|\| last\[0\]\.slot !== 0/);
  assert.match(spectator, /kind === 'championship' && place === 1/);
  assert.match(spectator, /class: 'spectator-award-trophy'/);
  assert.match(spectator, /class: 'spectator-award-disc ' \+ \(gold \? 'gold' : 'silver'\)/);
  assert.match(spectator, /text: gold \? '1' : '2'/);
  assert.match(spectator, /finalKind \? awardMark\(finalKind, winner \? 1 : 2\) : null/);
  assert.match(spectator, /final = completedFinal\(matches\)/);
  assert.match(css, /#main\.public-wrap \.spectator-award-disc\{/);
  assert.match(css, /border-radius:50%;border:1px solid/);
  assert.doesNotMatch(css, /spectator-award-ribbon/);
});

test('doubles awards only after official finale and one disc for each player', () => {
  assert.match(spectator, /decided \? awardMark\('doubles', f\.winnerTeam === number \? 1 : 2\) : null/);
  assert.match(spectator, /awardGroup\('doubles', 1, 'Winners', st\.doubles\.winners\)/);
  assert.match(spectator, /awardGroup\('doubles', 2, 'Runners-up', st\.doubles\.losers\)/);
  assert.match(spectator, /awardMark\(kind, place\), h\('span', \{class: 'spectator-award-person'/);
  assert.match(spectator, /awardGroup\('consolation', 2, 'Runner-up'/);
});

test('winners summary is three labelled categories with a fixed medal column and the existing yellow', () => {
  assert.match(spectator, /awardColumn\('Championship', 'championship'/);
  assert.match(spectator, /awardColumn\('Mixed-Skill Doubles', 'doubles'/);
  assert.match(spectator, /'data-columns': columns\.length/);
  assert.match(spectator, /class: 'champion-banner spectator-winners-banner'/);
  assert.match(css, /\.champion-banner\{[^}]*background:var\(--butter\)/);
  assert.match(css, /@media\(min-width:720px\)\{[^]*spectator-winners-grid\[data-columns="3"\]\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\.spectator-award-member\{display:grid;grid-template-columns:26px minmax\(0,1fr\)/);
  assert.match(spectator, /const medalFace = gold =>/);
  assert.match(spectator, /medalFace\(gold\), h\('span', \{class: 'spectator-medal-number'/);
  assert.match(css, /\.spectator-award-disc\.gold\{--medal-engrave:#9c6b16/);
  assert.match(css, /\.spectator-award-disc \.spectator-medal-art\{/);
  assert.match(css, /\.spectator-award-disc \.spectator-medal-number\{/);
  assert.doesNotMatch(spectator, /Mixed-Skill Doubles winners: |Consolation bracket champion:/);
});

test('doubles finale format note is subtle, only until the finale is decided, and teams stack', () => {
  assert.match(spectator, /f\.bestOf === 1 \? `Single game to \$\{f\.points\}`/);
  assert.match(spectator, /!decided && finaleFormat\(f\) \? h\('span', \{class: 'spectator-finale-format'/);
  assert.match(spectator, /class: 'spectator-finale-members'/);
  assert.doesNotMatch(spectator, /h\('p', \{class: 'fmt-line', text: `Best of \$\{f\.bestOf\} · to \$\{f\.points\}`\}\)/);
  assert.match(css, /\.spectator-finale-members\{[^}]*flex-direction:column/);
  assert.match(css, /\.spectator-finale \.grid\.two\{grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,240px\),1fr\)\)\}/);
});

