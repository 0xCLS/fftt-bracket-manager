/** The real staff client stack (session, API, score transport, core) against the real SQL via the fake
 * Supabase HTTP layer. Organizer + two scorekeepers + outsider, fictional data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './harness.mjs';
import {roster, scoreFor} from './helpers.mjs';
import {computeStandings} from '../../contracts/gameday_engine.mjs';

const settle = (ms = 0) => new Promise(r => setTimeout(r, ms));

async function stageField(world, org, n = 12) {
  assert.ok((await org.core.actions.addPlayers(roster(n))).ok);
  assert.ok((await org.core.actions.setCheckinAll(true)).ok);
  assert.equal(org.core.state.snapshot.players.filter(p => p.checkedIn).length, n);
  const b = await org.core.actions.buildChampionship();
  assert.ok(b.ok, b.message);
}
const higherRated = (core, row) => {
  const r = id => core.state.snapshot.players.find(p => p.id === id).rating;
  return r(row.players[0].id) >= r(row.players[1].id) ? row.players[0] : row.players[1];
};
const scoresFor = (row, winnerId) => {
  const w = scoreFor(row.bestOf, row.points);
  return winnerId === row.players[0].id ? w : w.split(', ').map(g => g.split('-').reverse().join('-')).join(', ');
};
async function scoreOne(dev, row, winnerId, tableNumber = 1) {
  const p = dev.core.prepareScore({matchId: row.matchId, winnerId, games: scoresFor(row, winnerId), table: tableNumber});
  assert.ok(p.ok, p.message);
  return dev.core.confirmScore(p);
}

test('organizer and two scorekeepers run a whole fictional tournament through the real client stack', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a'), b = w.device('b', 'b');
  await org.signIn();
  await stageField(w, org, 13);
  await a.signIn(); await b.signIn();
  assert.equal(a.core.state.role, 'scorekeeper');
  assert.equal(a.core.state.snapshot, null, 'a scorekeeper never receives the organizer snapshot (ratings)');

  let played = 0, flip = 0;
  const playAll = async bracket => {
    for (;;) {
      await org.core.refresh({force: true});
      const dev = flip++ % 2 ? b : a;
      await dev.core.refresh({force: true});
      const row = dev.core.state.desk.find(r => r.bracket === bracket);
      if (!row) return;
      const win = higherRated(org.core, row);
      const res = await scoreOne(dev, row, win.id, 1 + (played % 3));
      assert.ok(res.ok, res.message);
      played++;
    }
  };
  await playAll('championship');
  assert.ok(played >= 12);
  await org.core.refresh({force: true});
  assert.equal(org.core.state.snapshot.brackets.find(x => x.kind === 'championship').status, 'complete');
  const cons = await org.core.actions.buildConsolation();
  assert.ok(cons.ok, cons.message);
  await playAll('consolation');
  await org.core.refresh({force: true});
  const snap = org.core.state.snapshot;
  assert.ok(snap.brackets.every(x => x.status === 'complete'));

  // doubles finale
  const key = m => ({bracket: m.bracket, round: m.round, slot: m.slot, status: m.status, p1: m.p1, p2: m.p2, winner: m.winner});
  const st = computeStandings({matches: snap.matches.map(key)});
  const placed = snap.candidates.filter(c => c.state === 'placed').map(c => c.playerId).filter(id => ![st.champion, st.runnerUp].includes(id));
  assert.ok((await org.core.actions.setDoublesTeams(placed[0], placed[1])).ok);
  const dbl = await org.core.actions.recordDoubles(1, '11-8, 11-9');
  assert.ok(dbl.ok, dbl.message);
  assert.ok((await org.core.actions.setVisibility(true)).ok);
  assert.ok((await org.core.actions.setLifecycle('complete')).ok);

  // spectators: anonymous public read only
  const pub = await (await w.fake.clientFetch('spectator')(w.fake.PROJECT + '/rest/v1/fftt_public_tournament_v1?select=*', {headers: {apikey: w.fake.PUBLISHABLE}})).json();
  assert.equal(pub.length, 1);
  assert.equal(pub[0].status, 'complete');
  assert.equal(pub[0].finale.status, 'complete');
  const exported = await org.core.actions.exportEvent();
  assert.ok(exported.ok && exported.data.snapshot.players.length === 13 && exported.data.audit.length > 10);
  assert.ok(org.api.getRequestCount() > 20);
});

test('two scorekeepers submit the same match: one is accepted, the other is told plainly and nothing double-applies', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a'), b = w.device('b', 'b');
  await org.signIn(); await stageField(w, org, 8); await a.signIn(); await b.signIn();
  const row = a.core.state.desk[0];
  const rowB = b.core.state.desk.find(r => r.matchId === row.matchId);
  const pa = a.core.prepareScore({matchId: row.matchId, winnerId: row.players[0].id, games: '11-7, 11-9', table: 1});
  const pb = b.core.prepareScore({matchId: row.matchId, winnerId: rowB.players[1].id, games: '8-11, 9-11', table: 2});
  assert.ok(pa.ok && pb.ok);
  const [ra, rb] = await Promise.all([a.core.confirmScore(pa), b.core.confirmScore(pb)]);
  assert.equal([ra, rb].filter(r => r.ok).length, 1, 'exactly one accepted');
  const loser = [ra, rb].find(r => !r.ok);
  assert.equal(loser.rejected, true);
  assert.match(loser.message, /NOT used/);
  await org.core.refresh({force: true});
  assert.equal(org.core.state.snapshot.matches.filter(m => m.id === row.matchId && m.status === 'complete').length, 1);
  assert.equal(a.core.state.pending, null); assert.equal(b.core.state.pending, null);
});

test('a lost acknowledgment is resolved from the server receipt, without resending', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await stageField(w, org, 8); await a.signIn();
  const row = a.core.state.desk[0];
  const before = a.scoreTransport.stats.scoreRequests;
  w.fake.loseNextReply('a', '/rpc/fftt_submit_match_result_v2');
  const res = await scoreOne(a, row, row.players[0].id);
  assert.equal(res.ok, true, res.message);
  assert.equal(a.scoreTransport.stats.scoreRequests - before, 1, 'the score was sent exactly once');
  await org.core.refresh({force: true});
  assert.equal(org.core.state.snapshot.matches.find(m => m.id === row.matchId).status, 'complete');
  assert.equal(a.core.state.pending, null);
});

test('score never reaches the server: outcome stays unknown, is never auto-retried, survives a reload and is resolved by the person', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await stageField(w, org, 8); await a.signIn();
  const row = a.core.state.desk[0];
  const p = a.core.prepareScore({matchId: row.matchId, winnerId: row.players[0].id, games: '11-7, 11-9', table: 1});
  // the request itself fails to leave the device
  w.fake.failNext('a', '/rest/v1/rpc/fftt_submit_match_result_v2', 503);
  const res = await a.core.confirmScore(p);
  assert.equal(res.unknown, true);
  assert.equal(a.scoreTransport.stats.scoreRequests, 1);
  assert.ok(a.core.state.pending, 'the incident is recorded on this device');
  await settle(5); await a.core.refresh({force: true});
  assert.equal(a.scoreTransport.stats.scoreRequests, 1, 'no automatic retry, ever');
  // phone reload: in-memory state is gone, the durable incident record is not
  a.reload();
  await a.signIn();
  assert.ok(a.core.state.pending, 'the unresolved score is remembered across a reload');
  const check = await a.core.checkPendingScore();
  assert.equal(check.unknown, true);
  assert.match(check.message, /no record/i);
  // the person has verified with the organizer; clearing it lets the score be entered again
  a.core.dismissPendingScore();
  await settle(20); await a.core.refresh({force: true});
  const row2 = a.core.state.desk.find(r => r.matchId === row.matchId);
  assert.ok(row2, 'the match is still waiting');
  assert.ok((await scoreOne(a, row2, row2.players[0].id)).ok);
});

test('a reload after a score that DID land is resolved by the server receipt', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await stageField(w, org, 8); await a.signIn();
  const row = a.core.state.desk[0];
  const p = a.core.prepareScore({matchId: row.matchId, winnerId: row.players[1].id, games: '8-11, 9-11', table: 1});
  // the reply is lost AND the follow-up receipt lookup also fails (a flaky mobile network)
  w.fake.loseNextReply('a', '/rpc/fftt_submit_match_result_v2');
  w.fake.failNext('a', '/rest/v1/rpc/fftt_score_decision_snapshot_v2', 503);
  const res = await a.core.confirmScore(p);
  assert.equal(res.unknown, true, 'unconfirmed while the lookup keeps failing');
  a.reload(); await a.signIn();
  const check = await a.core.checkPendingScore();
  assert.equal(check.ok, true, check.message);
  assert.match(check.message, /did record/);
  assert.equal(a.core.state.pending, null);
});

test('revoking a scorekeeper ends their session and blocks scoring on their next action', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await stageField(w, org, 6); await a.signIn();
  const row = a.core.state.desk[0];
  const r = await org.core.actions.setStaff(w.accounts.a[0], 'revoke', null);
  assert.ok(r.ok, r.message);
  const p = a.core.prepareScore({matchId: row.matchId, winnerId: row.players[0].id, games: '11-7, 11-9', table: 1});
  assert.ok(p.ok, 'staging is local');
  const res = await a.core.confirmScore(p);
  assert.equal(res.ok, false);
  assert.equal(a.core.state.signedIn, false, 'the revoked device is signed out');
  assert.equal(a.core.state.desk.length, 0, 'private rows are cleared');
  await org.core.refresh({force: true});
  assert.equal(org.core.state.snapshot.matches.filter(m => m.status === 'complete').length, 0, 'nothing was scored');
});

test('an outsider cannot sign in to the event, and a scorekeeper cannot reach organizer operations', async () => {
  const w = await createWorld();
  const out = w.device('out', 'out'), a = w.device('a', 'a');
  await assert.rejects(out.signIn(), e => e.kind === 'not-authorized');
  assert.equal(out.core.state.signedIn, false);
  await a.signIn();
  const r = await a.core.actions.addPlayers(roster(2));
  assert.equal(r.ok, false);
  assert.match(r.message, /not allowed/);
  assert.equal(a.core.state.signedIn, true, 'a refused operation does not end the session');
});

test('writes pause when the connection is not confirmed and resume when it is', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org');
  await org.signIn();
  assert.equal(org.core.connection(), 'live');
  org.setOnline(false);
  assert.equal(org.core.connection(), 'offline');
  const blocked = await org.core.actions.addPlayers(roster(1));
  assert.equal(blocked.ok, false); assert.match(blocked.message, /paused/);
  org.setOnline(true);
  w.clock.t += 40_000; // the last confirmed read is now stale
  assert.equal(org.core.connection(), 'stale');
  assert.equal((await org.core.actions.addPlayers(roster(1))).ok, false);
  await org.core.refresh({force: true});
  assert.equal(org.core.connection(), 'live');
  assert.ok((await org.core.actions.addPlayers(roster(1))).ok);
});

test('an unknown organizer write is flagged and the screen is refreshed rather than blindly resent', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org');
  await org.signIn();
  w.fake.loseNextReply('org', '/rpc/fftt_upsert_players_v3');
  const r = await org.core.actions.addPlayers(roster(3));
  assert.equal(r.ok, false);
  assert.match(r.message, /may or may not have been saved/);
  assert.equal(org.core.state.snapshot.players.length, 3, 'the refresh shows what really happened');
});

test('background suspends and clears private data; resume re-proves identity and role; revocation while away ends it', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await stageField(w, org, 6); await a.signIn();
  assert.ok(org.core.state.snapshot);
  org.session.suspend(); org.core.pause();
  assert.equal(org.core.state.snapshot, null);
  assert.equal(org.core.connection(), 'paused');
  const back = await org.core.resume();
  assert.equal(back.ok, true);
  assert.ok(org.core.state.snapshot);
  a.session.suspend(); a.core.pause();
  await org.core.actions.setStaff(w.accounts.a[0], 'revoke', null);
  const gone = await a.core.resume();
  assert.equal(gone.ok, false);
  assert.equal(a.core.state.signedIn, false);
});

test('event creation, selection and sign-out', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn();
  assert.equal(org.core.state.events.length, 1);
  assert.equal(org.core.state.events[0].canCreate, true);
  const made = await org.core.actions.createEvent('Second Synthetic Games', '2026-12-05', 4);
  assert.ok(made.ok, made.message);
  assert.equal(org.core.state.snapshot.event.name, 'Second Synthetic Games');
  assert.equal(org.core.state.events.length, 2);
  assert.equal((await org.core.selectEvent(w.eventId)).ok, true);
  assert.equal(org.core.state.snapshot.event.name, 'Synthetic Rehearsal Games');
  await a.signIn();
  assert.equal(a.core.state.events[0].canCreate, false);
  assert.equal((await a.core.actions.createEvent('Nope', '2026-12-05', 2)).ok, false);
  assert.equal((await a.core.selectEvent(made.res.event_id)).ok, false, 'not authorized for the other event');
  assert.equal(a.core.state.signedIn, true);
  await org.session.signOut(); org.core.signedOut();
  assert.equal(org.core.state.snapshot, null);
});
