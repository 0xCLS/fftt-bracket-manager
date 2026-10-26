/** V4 through the REAL client stack (session, API, score transport, staff core, registration client) against the
 * real SQL, over fake HTTP. Reliability: stale formats, duplicate sends, registration privacy lifecycle, events. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './harness.mjs';
import {roster, scoreFor} from './helpers.mjs';

async function stage(org, n = 8) {
  assert.ok((await org.core.actions.addPlayers(roster(n))).ok);
  assert.ok((await org.core.actions.setCheckinAll(true)).ok);
  const b = await org.core.actions.buildChampionship();
  assert.ok(b.ok, b.message);
}

test('a score prepared under an old format is caught before sending; one already in flight is refused by the server and nothing is recorded', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await stage(org); await a.signIn();
  const row = a.core.state.desk[0];
  assert.deepEqual([row.bestOf, row.points], [3, 11]);
  // prepared under Bo3/11 ...
  const stale = a.core.prepareScore({matchId: row.matchId, winnerId: row.players[0].id, games: '11-7, 11-9', table: 1, expect: {bestOf: 3, points: 11}});
  assert.ok(stale.ok);
  // ... then the organizer changes THIS match to Bo1/21 before it is sent
  assert.ok((await org.core.actions.setMatchFormat(row.matchId, 1, 21)).ok);
  const res = await a.core.confirmScore(stale);
  assert.equal(res.ok, false); assert.equal(res.refused, true);
  assert.match(res.message, /NOTHING was recorded/);
  assert.equal(a.core.state.pending, null, 'no unconfirmed-score incident is left behind');
  await org.core.refresh({force: true});
  assert.equal(org.core.state.snapshot.matches.filter(m => m.status === 'complete').length, 0);
  // the refreshed desk shows the new format, and a score for the OLD format is stopped locally
  await a.core.refresh({force: true});
  const fresh = a.core.state.desk.find(r => r.matchId === row.matchId);
  assert.deepEqual([fresh.bestOf, fresh.points], [1, 21]);
  const blocked = a.core.prepareScore({matchId: row.matchId, winnerId: row.players[0].id, games: '21-15', table: 1, expect: {bestOf: 3, points: 11}});
  assert.equal(blocked.ok, false); assert.equal(blocked.formatChanged, true);
  const good = a.core.prepareScore({matchId: row.matchId, winnerId: row.players[0].id, games: '21-15', table: 1, expect: {bestOf: 1, points: 21}});
  assert.ok(good.ok, good.message);
  assert.equal((await a.core.confirmScore(good)).ok, true);
  assert.equal(a.scoreTransport.stats.automaticRetries, 0);
});

test('a double tap on "Confirm and send" sends exactly once', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await stage(org); await a.signIn();
  const row = a.core.state.desk[0];
  const p = a.core.prepareScore({matchId: row.matchId, winnerId: row.players[0].id, games: scoreFor(row.bestOf, row.points), table: 1});
  assert.ok(p.ok);
  const [r1, r2] = await Promise.all([a.core.confirmScore(p), a.core.confirmScore(p)]);
  assert.equal([r1, r2].filter(r => r.ok).length, 1);
  assert.match([r1, r2].find(r => !r.ok).message, /already being sent|Nothing is staged/);
  assert.equal(a.scoreTransport.stats.scoreRequests, 1, 'one request on the wire');
  assert.equal(w.fake.requests('a', '/rest/v1/rpc/fftt_submit_match_result_v2'), 1);
});

test('registrations: organizer-only, in memory only, and dropped with every other private view', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await a.signIn();
  assert.equal(org.core.state.registrations.status, 'idle');
  const r = await org.core.actions.loadRegistrations();
  assert.ok(r.ok, r.message);
  assert.equal(org.core.state.registrations.status, 'ready');
  assert.equal(org.core.state.registrations.payload.source, 'synthetic-fixture');
  assert.equal(org.core.state.registrations.payload.registrants.length, 20);
  assert.ok(!JSON.stringify(org.core.state.registrations).match(/example\.invalid|555/), 'no contact data in client state');
  // a scorekeeper is refused by the client AND would be by the adapter
  const denied = await a.core.actions.loadRegistrations();
  assert.equal(denied.ok, false); assert.match(denied.message, /Only an organizer/);
  assert.equal(a.core.state.registrations.status, 'error');
  // offline: nothing is sent
  org.setOnline(false);
  const off = await org.core.actions.loadRegistrations();
  assert.equal(off.ok, false); assert.match(off.message, /offline/);
  org.setOnline(true);
  // background drops the list; the session proof must be redone to see it again
  org.session.suspend(); org.core.pause();
  assert.equal(org.core.state.registrations.status, 'idle'); assert.equal(org.core.state.registrations.payload, null);
  await org.core.resume();
  assert.equal(org.core.state.registrations.payload, null, 'it is not silently brought back');
  assert.ok((await org.core.actions.loadRegistrations()).ok);
  // an unconfigured adapter gives a plain answer and keeps nothing
  w.registrationEnv = {};
  const none = await org.core.actions.loadRegistrations();
  assert.equal(none.ok, false); assert.match(none.message, /not connected on this site yet/);
  assert.equal(org.core.state.registrations.payload ? 'kept' : 'cleared', 'kept', 'a previously loaded list stays visible, marked as failed to reload');
  assert.equal(org.core.state.registrations.error !== null, true);
  await org.session.signOut(); org.core.signedOut();
  assert.equal(org.core.state.registrations.payload, null);
});

test('check-in through the client: refs link to the roster and survive a reload of the snapshot', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org');
  await org.signIn();
  const {payload} = await org.core.actions.loadRegistrations();
  const pick = payload.registrants.filter(r => !r.nameIssue && !r.duplicate).slice(0, 3);
  const res = await org.core.actions.checkinRegistrants(pick.map(r => ({ref: r.ref, name: r.shortName, rating: r.suggestedRating, source: 'registration'})));
  assert.ok(res.ok, res.message); assert.equal(res.res.created, 3);
  const players = org.core.state.snapshot.players;
  assert.equal(players.length, 3);
  assert.deepEqual(players.map(p => p.registrationRefs[0]).sort(), pick.map(r => r.ref).sort());
  assert.ok(players.every(p => p.checkedIn && !p.ratingConfirmed && p.source === 'registration'));
  assert.ok((await org.core.actions.confirmRatings(players.map(p => ({id: p.id, rating: p.rating})))).ok);
  assert.ok(org.core.state.snapshot.players.every(p => p.ratingConfirmed));
  const dup = await org.core.actions.checkinRegistrants([{name: pick[0].shortName, rating: 3, source: 'walk_in'}]);
  assert.equal(dup.ok, false); assert.match(dup.message, /same name/);
  // the same registrant again is a no-op, not a second player
  assert.ok((await org.core.actions.checkinRegistrants([{ref: pick[0].ref, name: pick[0].shortName, rating: 3, source: 'registration'}])).ok);
  assert.equal(org.core.state.snapshot.players.length, 3);
});

test('events: the list follows archive/restore/delete, the open event cannot be deleted, a restore is never public', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org');
  await org.signIn();
  const made = await org.core.actions.createEvent('Disposable Draft', '2026-12-05', 2);
  assert.ok(made.ok, made.message);
  await org.core.selectEvent(w.eventId);
  const by = name => org.core.state.events.find(e => e.name === name);
  assert.equal(by('Disposable Draft').deletable, true);
  assert.equal((await org.core.actions.deleteEvent(w.eventId, 'Synthetic Rehearsal Games')).ok, false, 'the open event is refused');
  assert.equal((await org.core.actions.deleteEvent(made.res.event_id, 'wrong name')).ok, false);
  assert.ok((await org.core.actions.archiveEvent(made.res.event_id)).ok);
  assert.equal(by('Disposable Draft').lifecycle, 'archived');
  assert.equal((await org.core.actions.deleteEvent(made.res.event_id, 'Disposable Draft')).ok, false, 'an archived event cannot be deleted');
  assert.ok((await org.core.actions.restoreEvent(made.res.event_id)).ok);
  assert.equal(by('Disposable Draft').lifecycle, 'draft');
  const gone = await org.core.actions.deleteEvent(made.res.event_id, 'Disposable Draft');
  assert.ok(gone.ok, gone.message);
  assert.equal(by('Disposable Draft'), undefined);
  assert.equal(org.core.state.events.length, 1);
  assert.equal(org.core.state.signedIn, true, 'managing other events never disturbs the open session');
  // an unknown outcome while deleting is flagged, then the list shows the truth
  const again = await org.core.actions.createEvent('Second Draft', '2026-12-06', 2);
  await org.core.selectEvent(w.eventId);
  w.fake.loseNextReply('org', '/rpc/fftt_delete_event_v4');
  const lost = await org.core.actions.deleteEvent(again.res.event_id, 'Second Draft');
  assert.equal(lost.ok, false); assert.match(lost.message, /may or may not have been saved/);
  assert.equal(by('Second Draft'), undefined, 'the refreshed list shows what really happened');
});

test('the current event is archived: the list and the screen follow, scoring stops, restoring brings it back', async () => {
  const w = await createWorld();
  const org = w.device('org', 'org'), a = w.device('a', 'a');
  await org.signIn(); await stage(org); await a.signIn();
  assert.ok((await org.core.actions.setVisibility(true)).ok);
  assert.ok((await org.core.actions.setLifecycle('archived')).ok);
  assert.equal(org.core.state.events[0].lifecycle, 'archived');
  assert.equal(org.core.state.snapshot.event.lifecycle, 'archived');
  assert.equal(org.core.state.snapshot.event.publicVisible, false);
  await a.core.refresh({force: true});
  assert.equal(a.core.state.deskStatus, 'not-active');
  assert.ok((await org.core.actions.restoreEvent(w.eventId)).ok);
  assert.equal(org.core.state.snapshot.event.lifecycle, 'active');
  assert.equal(org.core.state.snapshot.event.publicVisible, false, 'a restore never re-publishes');
  await a.core.refresh({force: true});
  assert.equal(a.core.state.deskStatus, 'ready');
});
