/** A person's action must never be silently dropped because a background poll holds the session lock.
 * The session runs one privileged operation at a time; polling reads pass wait:false and are skipped when busy, which is right for a
 * poll. Opening a scoring dialog (reading its saved games) and the receipt check after saving a game are PERSON-initiated, so they
 * must queue behind the poll instead of failing with "Completed-game records are unavailable".
 * Root cause of the CI failures in PR #84 run 42763342815 (and one transient seen live on 2026-11-10). Fictional data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './harness.mjs';
import {roster} from './helpers.mjs';
import {createStaffCore, createPendingLedger, createGamePendingLedger} from '../../app/staff_core.mjs';

async function ready() {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn();
  assert.ok((await org.core.actions.addPlayers(roster(8))).ok);
  assert.ok((await org.core.actions.setCheckinAll(true)).ok);
  assert.ok((await org.core.actions.buildChampionship()).ok);
  await a.signIn(); await a.core.refresh({force: true});
  const row = a.core.state.desk[0];
  assert.ok((await org.core.actions.assignTable(row.matchId, 1)).ok);
  await a.core.refresh({force: true});
  return {w, org, a, row};
}

test('opening a match while a background refresh holds the session lock still loads its games (previously: "unavailable")', {timeout: 120000}, async () => {
  const {w, a, row} = await ready();
  try {
    w.fake.hooks.delayMs = 40;                       // every request takes a moment, so the refresh is genuinely in flight
    const poll = a.core.refresh({force: true});      // a polling refresh now holds the one-at-a-time session lock
    const read = await a.core.readGameProgress(row.matchId);
    await poll;
    assert.equal(read.ok, true, read.message);
    assert.deepEqual(read.data.games, []);
  } finally { w.fake.hooks.delayMs = 0; await w.fake.local.db.close(); }
});

test('contract: only the polling refresh may be skipped when the session is busy; every person-initiated read and the post-save receipt check queue', {timeout: 120000}, async () => {
  const {w, a, row} = await ready();
  try {
    // The real core over the real session, with a thin wrapper that records how every call asks to be scheduled.
    const calls = [];
    const wrapped = Object.freeze({...a.session, authorized: (fn, opts = {}) => {
      calls.push({caller: (new Error().stack.split('\n')[2] ?? '').trim().replace(/^at (async )?/, '').split(' ')[0], wait: opts.wait ?? true});
      return a.session.authorized(fn, opts);
    }});
    const core = createStaffCore({session: wrapped, api: a.api, scoreTransport: a.scoreTransport, ledger: createPendingLedger(a.storage),
      gameLedger: createGamePendingLedger(a.storage), now: w.now, isOnline: () => true});
    await core.started({role: 'scorekeeper', eventId: w.eventId});
    calls.length = 0;
    const progress = await core.readGameProgress(row.matchId);
    await core.readDoublesProgress();
    assert.ok(progress.ok, progress.message);
    const saved = await core.saveCompletedGame({matchId: row.matchId, snapshot: progress.data, gameIndex: 1, player1Score: 11, player2Score: 5});   // submit + receipt check
    assert.equal(saved.ok, true, saved.message);
    await core.refresh({force: true});
    const skippable = calls.filter(c => c.wait === false).map(c => c.caller);
    assert.ok(skippable.length > 0 && skippable.every(label => label === 'refresh' || label === 'Object.refresh'), `only the polling refresh may opt out of queueing; got ${JSON.stringify(calls)}`);
    assert.ok(calls.length >= 5, 'readGameProgress, readDoublesProgress, submit, receipt check and refresh all went through the session');
    // the saved game is really there once the desk has been refreshed
    const again = await core.readGameProgress(row.matchId);
    assert.deepEqual(again.data.games, [[11, 5]]);
  } finally { await w.fake.local.db.close(); }
});
