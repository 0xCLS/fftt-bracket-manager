/** "Withdraw before play" visibility, driven by the REAL staff client core + REAL SQL (disposable PGlite). Fictional data only.
 * The control must be actionable only on a fresh, server-confirmed, eligible verdict for an Organizer or Bracket Manager;
 * everything else (Scorer, loading, unknown, failed, stale, mismatched, saved game, completed result) fails closed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWorld} from './harness.mjs';
import {roster, scoreFor} from './helpers.mjs';
import {parsePreplayEligibility, GamedayApiError} from '../../contracts/gameday_api.mjs';

const read = f => fs.readFileSync(new URL(`../../supabase/proposals/${f}`, import.meta.url), 'utf8');
const ELIGIBILITY_PATH = '/rest/v1/rpc/fftt_preplay_withdrawal_eligibility_v1';

async function build({install = true} = {}) {
  const w = await createWorld();
  const db = w.fake.local;
  await db.db.exec(read('FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql'));
  await db.db.exec(read('FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql'));
  await db.db.exec(read('FFTT3_REHEARSAL_WALKOVER_WITHDRAWAL_20261109_DO_NOT_APPLY.sql'));
  if (install) await db.db.exec(read('FFTT3_PREPLAY_WITHDRAWAL_ELIGIBILITY_20261110_DO_NOT_APPLY.sql'));
  w.accounts.bm = ['bracket-manager@fftt-staging.invalid', 'bm-pass-' + Math.random().toString(36).slice(2)];
  w.ids.bm = await w.fake.addAccount(...w.accounts.bm);
  await db.rpc(w.ids.org, 'fftt_set_staff_v3', {p_event_id: w.eventId, p_email: w.accounts.bm[0], p_action: 'grant', p_role: 'bracket_manager'});
  const org = w.device('org', 'org'), bm = w.device('bm', 'bm'), a = w.device('a', 'a'), out = w.device('out', 'out');
  await org.signIn();
  assert.ok((await org.core.actions.addPlayers(roster(8))).ok);
  assert.ok((await org.core.actions.setCheckinAll(true)).ok);
  return {w, db, org, bm, a, out};
}
const startBracket = async ({w, org, bm, a}) => {
  assert.ok((await org.core.actions.buildChampionship()).ok);
  await bm.signIn(); await a.signIn();
  await org.core.refresh({force: true}); await bm.core.refresh({force: true}); await a.core.refresh({force: true});
};
const avail = dev => dev.core.preplayWithdrawal();
const saveOneGame = async ({org, a}) => {
  await a.core.refresh({force: true});
  const row = a.core.state.desk[0];
  assert.ok((await org.core.actions.assignTable(row.matchId, 1)).ok);
  await a.core.refresh({force: true});
  const progress = await a.core.readGameProgress(row.matchId);
  assert.ok(progress.ok, progress.message);
  const saved = await a.core.saveCompletedGame({matchId: row.matchId, snapshot: progress.data, gameIndex: 1, player1Score: 11, player2Score: 5});
  assert.ok(saved.ok, saved.message);
  return row;
};

test('Organizer and Bracket Manager are offered it on a server-confirmed eligible bracket; Scorer and outsider never are', {timeout: 120000}, async () => {
  const x = await build();
  try {
    assert.equal(avail(x.org).available, false, 'no bracket yet: not offered');
    await startBracket(x);
    assert.deepEqual([avail(x.org).available, avail(x.org).status], [true, 'eligible']);
    assert.deepEqual([avail(x.bm).available, avail(x.bm).status], [true, 'eligible']);
    assert.deepEqual([avail(x.a).available, avail(x.a).status], [false, 'not-permitted'], 'a Scorekeeper never gets the control');
    assert.equal(x.a.core.state.preplay, null, 'and never even asks the server for the verdict');
    assert.deepEqual((await x.a.core.actions.checkPreplayWithdrawal()).eligible, false);
    // the server verdict, bound to the exact generation and revision this device is looking at
    const p = x.org.core.state.preplay;
    assert.equal(p.eligible, true); assert.equal(p.eventId, x.w.eventId);
    assert.equal(p.revision, x.org.core.state.pulse.revision); assert.equal(p.generation, x.org.core.state.pulse.generation);
  } finally { await x.w.fake.local.db.close(); }
});

test('a saved game hides it for everyone on the next refresh, with ZERO completed matches; the stale window is closed by the click-time check; the server still refuses', {timeout: 120000}, async () => {
  const x = await build();
  try {
    await startBracket(x);
    assert.equal(avail(x.org).available && avail(x.bm).available, true);
    await saveOneGame(x);
    assert.equal(x.org.core.state.snapshot.matches.filter(m => m.status === 'complete').length, 0, 'no match is complete: the old "played === 0" test would have kept showing it');
    // STALE WINDOW: org has not refreshed yet, so its (now outdated) verdict may still say eligible. The click-time check must not agree.
    const click = await x.org.core.actions.checkPreplayWithdrawal();
    assert.deepEqual([click.ok, click.eligible, click.reason], [true, false, 'saved-games-exist']);
    assert.match(click.message, /game has been saved/i);
    assert.equal(avail(x.org).available, false, 'the failed re-check also withdraws the offer immediately');
    await x.bm.core.refresh({force: true});
    assert.deepEqual([avail(x.bm).available, avail(x.bm).reason], [false, 'saved-games-exist']);
    // server-side authorization and refusal are completely intact, even when the UI is bypassed
    const refused = await x.org.core.actions.withdrawPreplay(x.org.core.state.snapshot.players[0].id, 'Left before play');
    assert.equal(refused.ok, false); assert.equal(refused.detail, 'preplay-results-exist');
    assert.equal((await x.out.signIn().catch(() => 'no-access')), 'no-access', 'an outsider has no session on this event');
  } finally { await x.w.fake.local.db.close(); }
});

test('a completed result hides it (played or walkover); an eligible withdrawal still works and then regenerates under a NEW revision', {timeout: 120000}, async () => {
  const x = await build();
  try {
    await startBracket(x);
    // while eligible, the real action works (server authority unchanged)
    const gen = x.org.core.state.snapshot.event.generation;
    const first = x.org.core.state.snapshot.players[0];
    const done = await x.org.core.actions.withdrawPreplay(first.id, 'Fictional early leaver');
    assert.ok(done.ok, done.message);
    assert.equal(x.org.core.state.snapshot.event.generation, gen + 1);
    assert.deepEqual([avail(x.org).available, avail(x.org).status], [true, 'eligible'], 'the new generation is eligible and the verdict is for it');
    assert.equal(x.org.core.state.preplay.generation, gen + 1);
    // now complete one match
    await x.a.core.refresh({force: true});
    const row = x.a.core.state.desk[0];
    const win = row.players[0].id;
    const prepared = x.a.core.prepareScore({matchId: row.matchId, winnerId: win, games: scoreFor(row.bestOf, row.points), table: 1});
    assert.ok(prepared.ok, prepared.message);
    assert.ok((await x.a.core.confirmScore(prepared)).ok);
    await x.org.core.refresh({force: true}); await x.bm.core.refresh({force: true});
    for (const dev of [x.org, x.bm]) assert.deepEqual([avail(dev).available, avail(dev).reason], [false, 'results-exist']);
  } finally { await x.w.fake.local.db.close(); }
});

test('FAIL CLOSED: loading, missing server function, failed or malformed read, wrong event, wrong generation, stale revision', {timeout: 120000}, async () => {
  // (1) the SQL is not installed yet: the verdict cannot be read, so the control is NOT offered at all
  const bare = await build({install: false});
  try {
    await startBracket(bare);
    assert.equal(bare.org.core.state.snapshot.brackets.some(b => b.kind === 'championship'), true, 'a bracket exists and nothing is wrong with the event');
    assert.deepEqual([avail(bare.org).available, avail(bare.org).status], [false, 'unknown']);
    assert.equal((await bare.org.core.actions.checkPreplayWithdrawal()).eligible, false);
  } finally { await bare.w.fake.local.db.close(); }

  const x = await build();
  try {
    // (2) before anything has loaded
    assert.deepEqual([avail(x.bm).available, avail(x.bm).status], [false, 'not-permitted'], 'not signed in yet');
    await startBracket(x);
    assert.equal(avail(x.org).available, true);
    // (3) a failed read on the next full refresh clears the verdict instead of keeping an old yes
    x.w.fake.failNext('org', ELIGIBILITY_PATH, 500);
    await x.org.core.refresh({force: true});
    assert.deepEqual([avail(x.org).available, avail(x.org).status], [false, 'unknown']);
    await x.org.core.refresh({force: true});
    assert.equal(avail(x.org).available, true, 'recovers on the next good read');
    // (4) a failing click-time check fails closed and withdraws the offer
    x.w.fake.failNext('org', ELIGIBILITY_PATH, 503);
    const click = await x.org.core.actions.checkPreplayWithdrawal();
    assert.deepEqual([click.ok, click.eligible], [false, false]);
    assert.equal(avail(x.org).available, false);
    await x.org.core.refresh({force: true});
    // (5) a verdict for another event, another generation or another revision is never trusted
    const good = x.org.core.state.preplay;
    for (const bad of [{...good, eventId: '11111111-1111-4111-8111-111111111111'}, {...good, generation: good.generation + 1}, {...good, revision: good.revision + 1}, {...good, revision: good.revision - 1}]) {
      x.org.core.state.preplay = Object.freeze(bad);
      assert.deepEqual([avail(x.org).available, avail(x.org).status], [false, 'stale']);
    }
    x.org.core.state.preplay = good;
    assert.equal(avail(x.org).available, true);
    // (6) an eligible verdict without an active Championship in view is never actionable
    const snapshot = x.org.core.state.snapshot;
    x.org.core.state.snapshot = {...snapshot, brackets: snapshot.brackets.filter(b => b.kind !== 'championship')};
    assert.deepEqual([avail(x.org).available, avail(x.org).status], [false, 'no-bracket']);
    x.org.core.state.snapshot = snapshot;
    // (7) a switched/ended session leaves nothing behind
    x.org.core.state.signedIn = false;
    assert.equal(avail(x.org).available, false);
    x.org.core.state.signedIn = true;
  } finally { await x.w.fake.local.db.close(); }
});

test('the server verdict is parsed strictly: any malformed answer is refused (so the UI fails closed)', () => {
  const ok = {event_id: '11111111-1111-4111-8111-111111111111', eligible: true, reason: null, generation: 2, revision: 17};
  assert.deepEqual({...parsePreplayEligibility(ok)}, {eventId: ok.event_id, eligible: true, reason: null, generation: 2, revision: 17});
  assert.deepEqual(parsePreplayEligibility({...ok, eligible: false, reason: 'saved-games-exist'}).reason, 'saved-games-exist');
  const malformed = [null, [], 'yes', {}, {...ok, extra: 1}, {...ok, event_id: 'nope'}, {...ok, eligible: 'true'}, {...ok, eligible: 1},
    {...ok, eligible: true, reason: 'results-exist'}, {...ok, eligible: false, reason: null}, {...ok, eligible: false, reason: 'Bad Reason!'},
    {...ok, generation: -1}, {...ok, generation: 1.5}, {...ok, revision: '17'}, {...ok, revision: null}, {event_id: ok.event_id, eligible: true, reason: null, generation: 2}];
  for (const raw of malformed) assert.throws(() => parsePreplayEligibility(raw), e => e instanceof GamedayApiError && e.kind === 'malformed', JSON.stringify(raw));
});
