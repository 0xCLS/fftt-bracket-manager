/** Bracket Manager registration lookup and check-in against the REAL SQL (PGlite) behind the real Pages Function, with a fake
 * Google serving ONE fictional sheet to TWO real-mode events (the November 8 / November 22 situation). Fictional people only.
 * Proves: event-scoped authorization of exactly the Bracket Manager role; that registration provenance is verified by the
 * database (forged, replayed, retargeted, expired or wrongly-keyed proofs all fail); duplicate/idempotent/locked behaviour;
 * no contact data in anything the desk receives; and that the sourced rollback removes the feature without touching the rest. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createDeskWorld, readSql, GATE, SHEET, TAB, ROWS} from './desk_world.mjs';
import {createGate, checkinFields, sourceFingerprint} from '../../server/registration/gate.mjs';

const PRIVATE = /example\.invalid|555-01|734-555|\(734\)|PRIVATE KEY|ya29|"hint"|shortName/i;   // contact details, credentials, masked hints
const FP = () => sourceFingerprint({configured: true, kind: 'google-sheets', spreadsheetId: SHEET, worksheet: TAB});
const find = (body, name, n = 0) => body.registrants.filter(r => r.name === name)[n];
const forbidden = e => e.code === '42501' && e.message === 'forbidden';
const conflict = detail => e => e.code === 'P0001' && e.message === 'fftt_conflict' && e.detail === detail;

/** Two real events sharing one sheet; bm1 is Bracket Manager of E1 only, bm2 of E2 only; scorer is a Scorekeeper of E1. */
async function setup(opts) {
  const w = await createDeskWorld(opts);
  const E1 = await w.newEvent('FICTIONAL NOV 8 REHEARSAL', '2026-11-08');
  const E2 = await w.newEvent('FICTIONAL NOV 22 GAMES', '2026-11-22');
  await w.grant('bm1', E1, 'bracket_manager'); await w.grant('bm2', E2, 'bracket_manager');
  await w.grant('scorer', E1, 'scorekeeper');
  await w.source(E1); await w.source(E2);
  return {w, E1, E2};
}
/** What the Function does for a check-in, performed by the test so a forgery can alter any part of it. */
async function signedCall(w, who, eventId, items, {secret = GATE, fp = null, user = who, event = eventId, tamper = null, now} = {}) {
  const gate = createGate(secret, {now});
  const f = fp ?? await FP();
  const {exp, proof} = await gate.sign('checkin', event, w.ids[user], checkinFields(f, items));
  return w.rpc(who, 'fftt_bm_registration_checkin_v1', {p_event_id: eventId, p_items: tamper ? tamper(items) : items, p_source_fp: f, p_exp: exp, p_proof: proof});
}

test('new eligible events need no deployment event list: both events share one sheet and each gets its own lookup, roster and check-ins', {timeout: 240000}, async () => {
  const {w, E1, E2} = await setup();
  assert.equal(w.env.REGISTRATION_EVENT_IDS, undefined, 'the deployment names no event');
  const one = await w.lookup('bm1', E1), two = await w.lookup('bm2', E2);
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.equal(one.body.registrants.length, 20); assert.equal(one.body.checkInOpen, true);
  assert.ok(one.body.registrants.every((r, i) => r.ref !== two.body.registrants[i].ref), 'references are event-scoped: the same person has a different reference in each event');
  // a THIRD event created later, with the same sheet, works at once with no configuration change
  const E3 = await w.newEvent('FICTIONAL LATER EVENT', '2026-12-13'); await w.grant('bm1', E3, 'bracket_manager'); await w.source(E3);
  assert.equal((await w.lookup('bm1', E3)).status, 200);

  const ben1 = find(one.body, 'Ben Marlowe'), ben2 = find(two.body, 'Ben Marlowe');
  const a = await w.checkin('bm1', E1, {ref: ben1.ref});
  assert.equal(a.status, 200); assert.deepEqual([a.body.status, a.body.outcome], ['saved', 'created']);
  assert.deepEqual((await w.roster(E2)), [], 'the other event roster is untouched');
  const b = await w.checkin('bm2', E2, {ref: ben2.ref, level: 4});
  assert.deepEqual([b.body.status, b.body.outcome], ['saved', 'created']);
  const r1 = await w.roster(E1), r2 = await w.roster(E2);
  assert.deepEqual([r1.length, r2.length], [1, 1]);
  assert.deepEqual([r1[0].display_name, r1[0].rating, r1[0].source, r1[0].checked_in, r1[0].rating_confirmed, r1[0].rating_status], ['Ben Marlowe', 2, 'registration', true, false, 'provisional'], 'the suggested level from the sheet');
  assert.equal(r2[0].rating, 4, 'an explicit desk level');
  assert.notEqual(r1[0].id, r2[0].id);
  // idempotent: the second press changes nothing, adds no revision and no audit row
  const rev = (await w.fake.local.admin('select revision from fftt_private.events where id = $1', [E1]))[0].revision;
  const again = await w.checkin('bm1', E1, {ref: ben1.ref});
  assert.deepEqual([again.status, again.body.status, again.body.outcome, again.body.playerId], [200, 'unchanged', 'existing', r1[0].id]);
  assert.equal((await w.fake.local.admin('select revision from fftt_private.events where id = $1', [E1]))[0].revision, rev);
  assert.equal((await w.audit(E1)).filter(x => x.operation === 'registration_checkin').length, 1);
  // the lookup now shows who is on the roster, from the database (not a name guess)
  const after = await w.lookup('bm1', E1);
  assert.deepEqual(find(after.body, 'Ben Marlowe').roster, {playerId: r1[0].id, checkedIn: true});
  assert.equal(find(after.body, 'Cy Fennelwick').roster, null);
  assert.equal(after.body.rosterSize, 1);
  const log = (await w.audit(E1)).find(x => x.operation === 'registration_checkin');
  assert.deepEqual([log.after_state.via, log.after_state.outcome, log.actor_id], ['bracket_manager', 'created', w.ids.bm1]);
});

test('authorization is event-scoped and exactly the Bracket Manager grant: everyone else is refused by the Function and by the database', {timeout: 240000}, async () => {
  const {w, E1, E2} = await setup();
  const ok = await w.lookup('bm1', E1); assert.equal(ok.status, 200);
  const ref = find(ok.body, 'Cy Fennelwick').ref;
  for (const [who, event, label] of [['bm1', E2, 'cross-event (BM of another event)'], ['bm2', E1, 'cross-event the other way'], ['scorer', E1, 'Scorekeeper'], ['outsider', E1, 'unassigned'],
    ['org', E1, 'an Organizer does not use the desk grant'], ['org2', E1, 'another Organizer-less account']]) {
    assert.equal((await w.lookup(who, event)).status, 403, 'lookup ' + label);
    assert.equal((await w.checkin(who, event, {ref})).status, 403, 'check-in ' + label);
  }
  assert.equal((await w.lookup(null, E1)).status, 401, 'no token');
  assert.equal((await w.lookup('bm1', '99999999-9999-4999-8999-999999999999')).status, 403, 'an event the caller does not hold');
  assert.deepEqual(await w.roster(E1), []);
  // the Bracket Manager cannot use any Organizer-only action
  const organizerOnly = {load: {}, capabilities: {}, inspect: {spreadsheet: SHEET}, test: {spreadsheet: SHEET, worksheet: TAB, mapping: {}}};
  for (const [action, extra] of Object.entries(organizerOnly)) {
    assert.equal((await w.ask('bm1', E1, {action, ...extra})).status, 403, 'BM may not ' + action);
    assert.equal((await w.ask('scorer', E1, {action, ...extra})).status, 403, 'Scorekeeper may not ' + action);
  }
  // …nor reach the source or the Organizer's own check-in in the database
  await assert.rejects(w.rpc('bm1', 'fftt_registration_source_v5', {p_event_id: E1}), forbidden);
  await assert.rejects(w.rpc('bm1', 'fftt_set_registration_source_v5', {p_event_id: E1, p_source: {kind: 'fixture'}}), forbidden);
  await assert.rejects(w.rpc('bm1', 'fftt_checkin_registrants_v4', {p_event_id: E1, p_registrants: [{ref, name: 'Invented Person', rating: 5, source: 'registration'}], p_check_in: true}), forbidden);
  await assert.rejects(w.rpc('bm1', 'fftt_organizer_snapshot_v3', {p_event_id: E1}), forbidden);
  // the Organizer still has the unchanged workflow: load + the Organizer's own check-in RPC
  const org = await w.ask('org', E1, {action: 'load'});
  assert.equal(org.status, 200); assert.equal(org.body.registrants.length, 20);
  assert.equal((await w.rpc('org', 'fftt_checkin_registrants_v4', {p_event_id: E1, p_check_in: true, p_registrants: [{ref: org.body.registrants[1].ref, name: 'Ben Marlowe', rating: 2, rating_status: 'provisional', source: 'registration'}]})).status, 'saved');
  // revocation is immediate with the very same still-valid token
  await w.grant('revoked', E1, 'bracket_manager');
  assert.equal((await w.lookup('revoked', E1)).status, 200);
  await w.revoke('revoked', E1);
  assert.equal((await w.lookup('revoked', E1)).status, 403, 'revoked: lookup');
  assert.equal((await w.checkin('revoked', E1, {ref})).status, 403, 'revoked: check-in');
  await assert.rejects(signedCall(w, 'revoked', E1, [{ref, name: 'Cy Fennelwick', rating: 5}]), forbidden);
  // a role change from Bracket Manager to Scorekeeper removes the desk too
  await w.grant('bm2', E2, 'scorekeeper');
  assert.equal((await w.lookup('bm2', E2)).status, 403, 'demoted');
  // anonymous callers cannot execute anything new
  for (const fn of ['fftt_bm_registration_lookup_v1', 'fftt_bm_registration_checkin_v1']) {
    await assert.rejects(w.fake.local.rpc(null, fn, fn.endsWith('lookup_v1') ? {p_event_id: E1, p_exp: 1, p_proof: 'a'.repeat(64)}
      : {p_event_id: E1, p_items: [], p_source_fp: 'fixture', p_exp: 1, p_proof: 'a'.repeat(64)}), e => e.code === '42501');
  }
});

test('the desk receives no contact data, no short names, no source or sheet details, no credentials', {timeout: 240000}, async () => {
  const {w, E1} = await setup();
  const r = await w.lookup('bm1', E1);
  const text = JSON.stringify(r.body);
  assert.ok(!PRIVATE.test(text), 'nothing private: ' + (text.match(PRIVATE) ?? [''])[0]);
  assert.ok(!text.includes(SHEET) && !/spreadsheet|worksheet|docs\.google|serviceAccount|column/i.test(text), 'no sheet identifiers');
  assert.deepEqual(Object.keys(r.body).sort(), ['checkInOpen', 'duplicates', 'fetchedAt', 'registrants', 'rosterSize', 'source', 'sourceName', 'summary', 'warnings']);
  assert.deepEqual(Object.keys(r.body.registrants[0]).sort(), ['duplicate', 'name', 'nameIssue', 'ratingBasis', 'ratingConfidence', 'ratingReview', 'ref', 'registeredAt', 'roster', 'suggestedRating']);
  assert.ok(!/@|\d{3}[-. ]?\d{4}/.test(r.body.registrants.map(x => x.name).join(' ')), 'names carry no contact detail');
  // what the check-in answers is equally small
  const c = await w.checkin('bm1', E1, {ref: find(r.body, 'Cy Fennelwick').ref});
  assert.deepEqual(Object.keys(c.body).sort(), ['eventRevision', 'outcome', 'playerId', 'status']);
  // stored data and audit hold no contact detail, answer text or sheet id
  const stored = JSON.stringify(await w.roster(E1)) + JSON.stringify(await w.audit(E1)) + JSON.stringify(await w.fake.local.admin('select * from fftt_private.registration_links'));
  assert.ok(!PRIVATE.test(stored) && !stored.includes(SHEET));
  // the bracket manager snapshot still shows no registration references
  const snap = await w.rpc('bm1', 'fftt_bracket_manager_snapshot_v1', {p_event_id: E1});
  assert.ok(snap.players.every(p => p.registration_refs.length === 0));
});

test('registration provenance: the browser cannot invent, alter, retarget or replay a registration; forged or wrongly keyed proofs are refused by the database', {timeout: 240000}, async () => {
  const {w, E1, E2} = await setup();
  const L = await w.lookup('bm1', E1); const cy = find(L.body, 'Cy Fennelwick');
  // 1. the Function: an unknown reference (well-formed but not in the sheet) and another event's reference are refused; nothing is inserted
  const invented = crypto.randomBytes(24).toString('base64url');
  const bad = await w.checkin('bm1', E1, {ref: invented});
  assert.deepEqual([bad.status, bad.body.error], [404, 'registration-not-found']);
  const other = find(await (await w.lookup('bm2', E2)).body, 'Cy Fennelwick').ref;
  assert.equal((await w.checkin('bm1', E1, {ref: other})).status, 404, 'a reference from another event is not a registration of this one');
  // names and ratings sent by the browser are not part of the contract at all
  for (const extra of [{name: 'Invented Person'}, {rating: 5}, {source: 'registration'}, {player_id: crypto.randomUUID()}]) assert.equal((await w.checkin('bm1', E1, {ref: cy.ref, ...extra})).status, 400, JSON.stringify(extra));
  assert.equal((await w.checkin('bm1', E1, {ref: cy.ref, level: 6})).status, 400); assert.equal((await w.checkin('bm1', E1, {ref: cy.ref, level: 2.5})).status, 400);
  assert.equal((await w.checkin('bm1', E1, {ref: 'short'})).status, 400);
  assert.deepEqual(await w.roster(E1), []);

  // 2. the database, called directly as the Bracket Manager (what a modified browser could do)
  const item = {ref: cy.ref, name: 'Cy Fennelwick', rating: 5};
  await assert.rejects(w.rpc('bm1', 'fftt_bm_registration_checkin_v1', {p_event_id: E1, p_items: [item], p_source_fp: await FP(), p_exp: Math.floor(Date.now() / 1000) + 30, p_proof: '0'.repeat(64)}), forbidden);
  await assert.rejects(w.rpc('bm1', 'fftt_bm_registration_checkin_v1', {p_event_id: E1, p_items: [item], p_source_fp: await FP(), p_exp: Math.floor(Date.now() / 1000) + 30, p_proof: 'not-a-proof'}), forbidden);
  await assert.rejects(w.rpc('bm1', 'fftt_bm_registration_lookup_v1', {p_event_id: E1, p_exp: Math.floor(Date.now() / 1000) + 30, p_proof: '1'.repeat(64)}), forbidden, 'the source/links are not readable without a proof');
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {secret: 'a-different-secret-that-is-long-enough-0001'}), forbidden, 'wrong key');
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {tamper: it => [{...it[0], name: 'Cy Fennelwicks'}]}), forbidden, 'altered name');
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {tamper: it => [{...it[0], rating: 1}]}), forbidden, 'altered level');
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {tamper: it => [{...it[0], ref: crypto.randomBytes(24).toString('base64url')}]}), forbidden, 'altered reference');
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {tamper: it => [...it, {ref: crypto.randomBytes(24).toString('base64url'), name: 'Extra Person', rating: 3, same_as_ref: it[0].ref}]}), forbidden, 'an appended item');
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {user: 'bm2'}), forbidden, "another person's proof");
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {event: E2}), forbidden, "another event's proof");
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {now: () => Date.now() - 300000}), forbidden, 'expired');
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {now: () => Date.now() + 600000}), forbidden, 'too far in the future');
  await assert.rejects(signedCall(w, 'bm1', E1, [item], {fp: 'f'.repeat(64)}), conflict('source-changed'), 'a request naming a source that is not the current one');
  assert.deepEqual(await w.roster(E1), [], 'every forgery left the roster empty');
  // an invented person with a perfectly valid proof for the invented data is impossible without the secret; with it, this is the Function's job:
  // and a proof for the true values works, once and again (idempotent)
  const good = await signedCall(w, 'bm1', E1, [item]);
  assert.deepEqual([good.status, good.outcome], ['saved', 'created']);
  assert.equal((await signedCall(w, 'bm1', E1, [item])).status, 'unchanged', 'a replay of the same signed request changes nothing');
  assert.equal((await w.roster(E1)).length, 1);
  // 3. the unsigned part of a request (link_player_id) can never smuggle a different identity: it must name a roster player of the SAME name
  const ada = find(L.body, 'Ben Marlowe');
  const walkin = await w.rpc('bm1', 'fftt_event_day_walkin_v1', {p_event_id: E1, p_name: 'Someone Else', p_rating: 3});
  await assert.rejects(signedCall(w, 'bm1', E1, [{ref: ada.ref, name: 'Ben Marlowe', rating: 2, link_player_id: walkin.player_id}]), conflict('link-name-mismatch'));
  await assert.rejects(signedCall(w, 'bm1', E1, [{ref: ada.ref, name: 'Ben Marlowe', rating: 2, link_player_id: crypto.randomUUID()}]), e => e.code === '22023');
  assert.equal((await w.roster(E1)).length, 2, 'only the true check-in and the explicit walk-in');
});

test('duplicates and existing roster records: merge only what the model grouped, never create a second player, link a same-named roster player on request', {timeout: 240000}, async () => {
  const {w, E1} = await setup();
  const L = (await w.lookup('bm1', E1)).body;
  const adas = L.registrants.filter(r => r.duplicate?.group === 'g1');
  assert.equal(adas.length, 3);
  const full = adas.filter(r => !r.nameIssue);
  const joes = L.registrants.filter(r => r.duplicate?.group === 'g2');
  // merging a registration that is not in the same group is refused
  const cy = find(L, 'Cy Fennelwick');
  assert.equal((await w.checkin('bm1', E1, {ref: full[0].ref, merge_refs: [cy.ref]})).status, 422);
  assert.equal((await w.checkin('bm1', E1, {ref: full[0].ref, merge_refs: [joes[0].ref]})).status, 422, 'another group');
  assert.equal((await w.checkin('bm1', E1, {ref: cy.ref, merge_refs: [full[0].ref]})).status, 422, 'the primary is not part of a group');
  assert.equal((await w.checkin('bm1', E1, {ref: full[0].ref, merge_refs: [full[0].ref]})).status, 400);
  assert.equal((await w.checkin('bm1', E1, {ref: full[0].ref, merge_refs: [crypto.randomBytes(24).toString('base64url')]})).status, 422);
  assert.deepEqual(await w.roster(E1), []);
  // one person, three submissions (one with only "Ada Q"): one player, all three references linked
  const m = await w.checkin('bm1', E1, {ref: full[0].ref, merge_refs: [full[1].ref, adas.find(r => r.nameIssue).ref]});
  assert.deepEqual([m.status, m.body.outcome], [200, 'created']);
  let roster = await w.roster(E1);
  assert.equal(roster.length, 1); assert.equal(roster[0].refs.length, 3);
  // a later press on the duplicate registration finds the same person
  const dup = await w.checkin('bm1', E1, {ref: full[1].ref});
  assert.deepEqual([dup.body.status, dup.body.outcome, dup.body.playerId], ['unchanged', 'existing', roster[0].id]);
  assert.equal((await w.roster(E1)).length, 1, 'no second Ada');
  const L2 = (await w.lookup('bm1', E1)).body;
  assert.ok(L2.registrants.filter(r => r.duplicate?.group === 'g1').every(r => r.roster?.playerId === roster[0].id && r.roster.checkedIn));
  // a registration with an incomplete name or no usable name cannot be checked in by the desk (an Organizer fixes the sheet; a walk-in is separate)
  for (const r of L.registrants.filter(x => x.nameIssue && x.duplicate === null)) {
    const res = await w.checkin('bm1', E1, {ref: r.ref, level: 3});
    assert.deepEqual([res.status, res.body.error], [422, 'name-incomplete'], r.name);
  }
  // no suggested level: the desk must choose one
  const kit = find(L, 'Kit Alderman');
  assert.equal(kit.suggestedRating, null);
  assert.deepEqual([(await w.checkin('bm1', E1, {ref: kit.ref})).status, (await w.checkin('bm1', E1, {ref: kit.ref})).body.error], [422, 'level-required']);
  assert.equal((await w.checkin('bm1', E1, {ref: kit.ref, level: 3})).status, 200);
  // a roster player (a walk-in) with the same name: no accidental duplicate, an explicit link is the safe resolution
  const walkin = await w.rpc('bm1', 'fftt_event_day_walkin_v1', {p_event_id: E1, p_name: 'Hal Wintersby', p_rating: 4});
  const hal = find(L, 'Hal Wintersby');
  const clash = await w.checkin('bm1', E1, {ref: hal.ref});
  assert.deepEqual([clash.status, clash.body.error, clash.body.detail], [409, 'conflict', 'duplicate-name']);
  assert.equal((await w.roster(E1)).filter(p => p.display_name === 'Hal Wintersby').length, 1);
  const linked = await w.checkin('bm1', E1, {ref: hal.ref, link_player_id: walkin.player_id});
  assert.deepEqual([linked.status, linked.body.outcome, linked.body.playerId], [200, 'linked', walkin.player_id]);
  const hw = (await w.roster(E1)).find(p => p.display_name === 'Hal Wintersby');
  assert.deepEqual([hw.rating, hw.source, hw.checked_in, hw.refs.length], [4, 'walk_in', true, 1], "the roster player's own level and source are not rewritten");
  // an existing roster player not yet checked in is recognized and simply checked in
  const [ivyPlayer] = await w.fake.local.admin("insert into fftt_private.players(event_id, display_name, rating, rating_status, checked_in, source) values ($1,'Ivy Castelan',2,'provisional',false,'manual') returning id", [E1]);
  const ivy = find(L, 'Ivy Castelan');
  const li = await w.checkin('bm1', E1, {ref: ivy.ref, link_player_id: ivyPlayer.id});
  assert.deepEqual([li.body.outcome, li.body.playerId], ['linked', ivyPlayer.id]);
  assert.equal((await w.roster(E1)).find(p => p.display_name === 'Ivy Castelan').source, 'registration');
});

test('late arrivals, brackets and event state: check-in closes when the Championship exists or the event is not open; the walk-in rule is unchanged', {timeout: 300000}, async () => {
  const {w, E1, E2} = await setup();
  const L = (await w.lookup('bm1', E1)).body;
  for (const n of ['Ben Marlowe', 'Cy Fennelwick', 'Dee Larkspur', 'Eli Brandtley']) assert.equal((await w.checkin('bm1', E1, {ref: find(L, n).ref})).status, 200);
  const ids = (await w.roster(E1)).map(p => p.id);
  await w.rpc('bm1', 'fftt_build_championship_v3', {p_event_id: E1, p_slots: ids, p_expected_generation: 0, p_confirm: false});
  const late = await w.checkin('bm1', E1, {ref: find(L, 'Fay Hollowell').ref});
  assert.deepEqual([late.status, late.body.error, late.body.detail], [409, 'conflict', 'check-in-closed']);
  assert.equal((await w.lookup('bm1', E1)).body.checkInOpen, false, 'the desk is told it is locked');
  // an earlier registration is still recognized as already checked in (read-only), and a direct, correctly signed call is refused by the database too
  assert.equal(find((await w.lookup('bm1', E1)).body, 'Ben Marlowe').roster.checkedIn, true);
  await assert.rejects(signedCall(w, 'bm1', E1, [{ref: find(L, 'Fay Hollowell').ref, name: 'Fay Hollowell', rating: 5}]), conflict('bracket-locked'));
  await assert.rejects(w.rpc('bm1', 'fftt_event_day_walkin_v1', {p_event_id: E1, p_name: 'Late Arrival', p_rating: 2}), conflict('bracket-locked'));
  assert.equal((await w.roster(E1)).length, 4);
  // the other event is independent and still open
  assert.equal((await w.lookup('bm2', E2)).body.checkInOpen, true);
  assert.equal((await w.checkin('bm2', E2, {ref: find((await w.lookup('bm2', E2)).body, 'Fay Hollowell').ref})).status, 200);
  // an archived/complete event: not open
  await w.fake.local.admin("update fftt_private.events set lifecycle = 'complete' where id = $1", [E2]);
  assert.equal((await w.lookup('bm2', E2)).body.checkInOpen, false);
  assert.equal((await w.checkin('bm2', E2, {ref: find((await w.lookup('bm2', E2)).body, 'Gus Pemberly').ref})).status, 409);
});

test('roster limit and source state: disabled, missing, changed and unreadable sources check nobody in; the fictional source never serves a real event', {timeout: 300000}, async () => {
  const {w, E1, E2} = await setup();
  const L = (await w.lookup('bm1', E1)).body, cy = find(L, 'Cy Fennelwick');
  // switched off by the Organizer: refused (no sheet read for the desk, no check-in)
  await w.source(E1, {enabled: false});
  let r = await w.lookup('bm1', E1); assert.deepEqual([r.status, r.body.error], [403, 'source-disabled']);
  assert.equal((await w.checkin('bm1', E1, {ref: cy.ref})).status, 403);
  await assert.rejects(signedCall(w, 'bm1', E1, [{ref: cy.ref, name: 'Cy Fennelwick', rating: 5}]), conflict('source-not-enabled'), 'the database refuses a check-in from a disabled source');
  // removed entirely: a real event offers no source
  await w.rpc('org', 'fftt_clear_registration_source_v5', {p_event_id: E1});
  r = await w.lookup('bm1', E1); assert.deepEqual([r.status, r.body.error], [503, 'registration-not-configured']);
  await assert.rejects(signedCall(w, 'bm1', E1, [{ref: cy.ref, name: 'Cy Fennelwick', rating: 5}], {fp: 'fixture'}), conflict('source-not-enabled'), 'the fictional source cannot serve a real event');
  // changed: a proof made for the old sheet is refused (source-changed), the current one works
  await w.source(E1);
  const oldFp = await FP();
  await w.source(E1, {worksheet: 'Other tab'});
  await assert.rejects(signedCall(w, 'bm1', E1, [{ref: cy.ref, name: 'Cy Fennelwick', rating: 5}], {fp: oldFp}), conflict('source-changed'));
  await w.source(E1);
  assert.equal((await w.checkin('bm1', E1, {ref: cy.ref})).status, 200);
  // the Function mode switches stay in force
  w.env.REGISTRATION_GOOGLE_MODE = 'diagnostic';
  r = await w.lookup('bm2', E2); assert.deepEqual([r.status, r.body.error], [403, 'google-not-allowed']);
  w.env.REGISTRATION_GOOGLE_MODE = 'off';
  assert.equal((await w.lookup('bm2', E2)).status, 403);
  w.env.REGISTRATION_GOOGLE_MODE = 'enabled';
  w.env.REGISTRATION_ENABLED = 'false';
  assert.equal((await w.lookup('bm2', E2)).status, 503, 'the global switch');
  w.env.REGISTRATION_ENABLED = 'true';
  assert.equal((await w.lookup('bm2', E2)).status, 200);
  // Google outages and an unshared sheet are generic, sanitized, and check nobody in
  w.google.sheets[SHEET].shared = false; w.state.cache.clear();
  r = await w.lookup('bm2', E2); assert.equal(r.status, 502); assert.ok(!JSON.stringify(r.body).includes(SHEET));
  assert.equal((await w.checkin('bm2', E2, {ref: find(L, 'Cy Fennelwick').ref})).status, 502);
  w.google.sheets[SHEET].shared = true; w.state.cache.clear();
  // roster limit (64) is enforced by the database
  const rows = Array.from({length: 64}, (_, i) => `('${E2}','Filler Player ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}',3,'provisional',false,'manual')`).join(',');
  await w.fake.local.admin(`insert into fftt_private.players(event_id, display_name, rating, rating_status, checked_in, source) values ${rows}`);
  r = await w.checkin('bm2', E2, {ref: find((await w.lookup('bm2', E2)).body, 'Dee Larkspur').ref});
  assert.deepEqual([r.status, r.body.error, r.body.detail], [409, 'conflict', 'roster-full']);
});

test('synthetic events keep their isolation: the fictional source serves only a synthetic event, a live sheet never does', {timeout: 300000}, async () => {
  const w = await createDeskWorld();
  w.env.REGISTRATION_FIXTURE = 'true';
  const [ev] = await w.fake.local.admin(`insert into fftt_private.events(event_name,event_date,table_count,created_by,synthetic_only) values ('FICTIONAL SYNTHETIC REHEARSAL','2026-11-01',2,$1,true) returning id`, [w.ids.org]);
  await w.fake.local.admin(`insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer'),($1,$3,'bracket_manager')`, [ev.id, w.ids.org, w.ids.bm1]);
  const r = await w.lookup('bm1', ev.id);
  assert.deepEqual([r.status, r.body.source], [200, 'synthetic-fixture']);
  const c = await w.checkin('bm1', ev.id, {ref: find(r.body, 'Ben Marlowe').ref});
  assert.deepEqual([c.status, c.body.outcome], [200, 'created']);
  // a live Google source cannot be enabled on it, and even a saved (disabled) one is not served
  await assert.rejects(w.source(ev.id), e => e.message === 'fftt_conflict' && e.detail === 'google-not-allowed-synthetic');
  await w.source(ev.id, {enabled: false});
  assert.equal((await w.lookup('bm1', ev.id)).body.error, 'source-disabled', 'a saved but switched-off sheet is not read');
  await assert.rejects(signedCall(w, 'bm1', ev.id, [{ref: find(r.body, 'Cy Fennelwick').ref, name: 'Cy Fennelwick', rating: 5}]), conflict('source-not-enabled'), 'the database refuses a live-source check-in on a synthetic event');
  // and a synthetic event never leaks into a real one: the real event has its own roster and nothing from it
  const E = await w.newEvent('FICTIONAL REAL-MODE EVENT', '2026-11-22'); await w.grant('bm2', E, 'bracket_manager'); await w.source(E);
  assert.deepEqual(await w.roster(E), []);
});

test('the gate fails closed: no secret in the Function, no key in the database, or the wrong key, serves nothing', {timeout: 300000}, async () => {
  for (const [label, opts, mutate, expected] of [
    ['Function has no gate secret', {gate: null}, null, [503, 'registration-not-configured']],
    ['Function secret too short', {gate: 'short'}, null, [503, 'registration-not-configured']],
    ['key never installed in the database', {installGate: false}, null, [403, 'forbidden']],
    ['Function and database disagree', {}, w => { w.env.REGISTRATION_GATE_SECRET = 'a-completely-different-gate-secret-9999'; }, [403, 'forbidden']],
  ]) {
    const {w, E1} = await setup(opts);
    if (mutate) mutate(w);
    const r = await w.lookup('bm1', E1);
    assert.deepEqual([r.status, r.body.error], expected, label);
    assert.equal((await w.checkin('bm1', E1, {ref: crypto.randomBytes(24).toString('base64url')})).status, expected[0], label + ' (check-in)');
    assert.deepEqual(await w.roster(E1), [], label);
  }
  // the Organizer's existing workflow does not depend on the gate at all
  const {w, E1} = await setup({gate: null, installGate: false});
  assert.equal((await w.ask('org', E1, {action: 'load'})).status, 200);
});

test('database objects: privileges, SECURITY DEFINER hygiene, the proof algorithm and the secret table', {timeout: 240000}, async () => {
  const {w, E1} = await setup();
  const q = (sql, p = []) => w.fake.local.admin(sql, p);
  // HMAC-SHA256 in SQL equals the standard implementation (RFC 4231 style vectors, short/long keys, unicode)
  for (const [key, msg] of [['Jefe', 'what do ya want for nothing?'], ['k'.repeat(20), 'Hi There'], ['K'.repeat(131), 'Test Using Larger Than Block-Size Key - Hash Key First'],
    ['k'.repeat(64), ''], ['clé-secrète-ünïcode-0123456789abcdef', 'Zoë\u001fMarlowe|7']]) {
    const [{h}] = await q('select fftt_private.hmac_sha256_hex(convert_to($1,\'UTF8\'), convert_to($2,\'UTF8\')) h', [key, msg]);
    assert.equal(h, crypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(msg)).digest('hex'), key.slice(0, 12));
  }
  const fns = ['fftt_private.install_registration_gate_v1(text)', 'fftt_private.hmac_sha256_hex(bytea,bytea)', 'fftt_private.registration_gate_ok(text,uuid,text,bigint,text)',
    'fftt_private.registration_source_fp(uuid)'];
  for (const f of fns) for (const role of ['anon', 'authenticated', 'service_role', 'public'])
    assert.equal((await q(`select ${role === 'public' ? `has_function_privilege('public', '${f}', 'execute')` : `has_function_privilege('${role}', '${f}', 'execute')`} ok`))[0].ok, false, `${role} cannot execute ${f}`);
  const exposed = ['fftt_private.bm_registration_lookup_v1(uuid,bigint,text)', 'fftt_private.bm_registration_checkin_v1(uuid,jsonb,text,bigint,text)',
    'public.fftt_bm_registration_lookup_v1(uuid,bigint,text)', 'public.fftt_bm_registration_checkin_v1(uuid,jsonb,text,bigint,text)'];
  for (const f of exposed) {
    assert.equal((await q(`select has_function_privilege('authenticated', '${f}', 'execute') ok`))[0].ok, true, f);
    for (const role of ['anon', 'public']) assert.equal((await q(`select has_function_privilege('${role}', '${f}', 'execute') ok`))[0].ok, false, `${role} cannot execute ${f}`);
  }
  // every private function is SECURITY DEFINER with an empty search_path; wrappers are SECURITY INVOKER with an empty search_path
  const defs = await q(`select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'fftt_private' and p.proname in ('install_registration_gate_v1','hmac_sha256_hex','registration_gate_ok','registration_source_fp','bm_registration_lookup_v1','bm_registration_checkin_v1'))
       or (n.nspname = 'public' and p.proname in ('fftt_bm_registration_lookup_v1','fftt_bm_registration_checkin_v1'))
    order by n.nspname, p.proname`);
  assert.equal(defs.length, 8);
  for (const d of defs) {
    assert.ok(d.proconfig?.some(c => c.startsWith('search_path=')), d.proname + ' pins search_path');
    if (d.proname.startsWith('fftt_bm_')) assert.equal(d.prosecdef, false, d.proname + ' (public wrapper) is SECURITY INVOKER');
    else if (d.proname !== 'hmac_sha256_hex') assert.equal(d.prosecdef, true, d.proname);
  }
  // the secret is unreachable: no API role can read the table, and it is stored as bytes, never returned by any function
  const tx = async role => w.fake.local.db.transaction(async t => { await t.query(`set local role ${role}`); return (await t.query('select secret from fftt_private.registration_gate')).rows; });
  for (const role of ['anon', 'authenticated', 'service_role']) await assert.rejects(tx(role), /permission denied/, role);
  assert.equal((await q('select count(*)::int n from fftt_private.registration_gate'))[0].n, 1);
  await assert.rejects(q("select fftt_private.install_registration_gate_v1('short')"), /32 to 200/);
  assert.equal((await q('select count(*)::int n from fftt_private.registration_gate'))[0].n, 1, 'still one row');
  // existing Organizer privileges and the Bracket Manager's existing ones are exactly as before
  assert.equal((await q("select has_function_privilege('authenticated', 'public.fftt_registration_source_v5(uuid)', 'execute') ok"))[0].ok, true);
  await assert.rejects(w.rpc('bm1', 'fftt_registration_source_v5', {p_event_id: E1}), forbidden);
  // an item list that is not an array, empty or oversized is a validation error (after the role check)
  for (const items of [null, {}, [], Array.from({length: 7}, (_, i) => ({ref: crypto.randomBytes(24).toString('base64url'), name: 'A B' + i, rating: 1}))])
    await assert.rejects(w.rpc('bm1', 'fftt_bm_registration_checkin_v1', {p_event_id: E1, p_items: items, p_source_fp: 'fixture', p_exp: 1, p_proof: 'a'.repeat(64)}), e => e.code === '22023');
  await assert.rejects(w.rpc('scorer', 'fftt_bm_registration_checkin_v1', {p_event_id: E1, p_items: [], p_source_fp: 'fixture', p_exp: 1, p_proof: 'a'.repeat(64)}), forbidden);
});

test('rollback: removes only the new objects; the roster check-in, walk-in, Organizer workflow and earlier check-ins survive', {timeout: 240000}, async () => {
  const {w, E1} = await setup();
  const L = (await w.lookup('bm1', E1)).body;
  assert.equal((await w.checkin('bm1', E1, {ref: find(L, 'Ben Marlowe').ref})).status, 200);
  await w.fake.local.db.exec(readSql('rollback'));
  await w.fake.local.db.exec(readSql('rollback'));   // safe to run twice
  const gone = await w.fake.local.admin(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('bm_registration_lookup_v1','bm_registration_checkin_v1','fftt_bm_registration_lookup_v1','fftt_bm_registration_checkin_v1','registration_gate_ok','hmac_sha256_hex','install_registration_gate_v1','registration_source_fp')`);
  assert.deepEqual(gone, []);
  assert.equal((await w.fake.local.admin("select to_regclass('fftt_private.registration_gate') t"))[0].t, null);
  // the Function now answers "not set up" for the desk and changes nothing
  const r = await w.lookup('bm1', E1); assert.deepEqual([r.status, r.body.error], [503, 'registration-not-configured']);
  assert.equal((await w.checkin('bm1', E1, {ref: find(L, 'Cy Fennelwick').ref})).status, 503);
  // everything else is untouched
  assert.equal((await w.roster(E1)).length, 1, 'the earlier check-in remains');
  assert.equal((await w.rpc('bm1', 'fftt_bracket_manager_snapshot_v1', {p_event_id: E1})).players.length, 1);
  assert.equal((await w.rpc('bm1', 'fftt_event_day_walkin_v1', {p_event_id: E1, p_name: 'Walk In Person', p_rating: 3})).status, 'saved');
  const p = (await w.roster(E1)).find(x => x.display_name === 'Ben Marlowe');
  assert.equal((await w.rpc('bm1', 'fftt_set_checkin_v3', {p_event_id: E1, p_player_id: p.id, p_checked_in: false})).status, 'updated');
  assert.equal((await w.ask('org', E1, {action: 'load'})).status, 200);
  await assert.rejects(w.rpc('bm1', 'fftt_registration_source_v5', {p_event_id: E1}), forbidden);
  // and it can be applied again (the candidate is re-runnable after a rollback)
  await w.fake.local.db.exec(readSql('registration'));
  await w.fake.local.admin('select fftt_private.install_registration_gate_v1($1)', [GATE]);
  assert.equal((await w.lookup('bm1', E1)).status, 200);
});

test('the same behavior on the synthetic (non-upgraded) schema: real-mode only features stay off, the desk works for synthetic events only', {timeout: 240000}, async () => {
  const w = await createDeskWorld({upgraded: false});
  w.env.REGISTRATION_FIXTURE = 'true';
  const E = await w.newEvent('FICTIONAL SYNTHETIC EVENT', '2026-11-01'); await w.grant('bm1', E, 'bracket_manager');
  const r = await w.lookup('bm1', E);
  assert.deepEqual([r.status, r.body.source], [200, 'synthetic-fixture']);
  assert.equal((await w.checkin('bm1', E, {ref: find(r.body, 'Dee Larkspur').ref})).status, 200);
  assert.equal((await w.lookup('scorer', E)).status, 403);
  assert.deepEqual(ROWS.length > 20, true);
});
