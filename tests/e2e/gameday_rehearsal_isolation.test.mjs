/** Nov 8 rehearsal readiness: a SEPARATE rehearsal event next to a real-mode "Nov 22" event in the same project.
 * Runs the UPGRADED single-project schema (real-mode events, synthetic_only = false) in a throw-away in-process
 * PostgreSQL. Fictional names and .invalid addresses only; nothing here contacts Supabase, Google or Cloudflare.
 * Run: node --test tests/e2e/gameday_rehearsal_isolation.test.mjs (after `npm ci` in tests/e2e) */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalDb} from './localdb.mjs';
import {roster, buildChampionship, buildConsolation, playAllPlayable, deskOf, submit, winningScore, swap} from './helpers.mjs';

const refOf = i => 'REGREF' + String(i).padStart(14, '0') + 'xyz';
const code = e => e?.code;

async function world() {
  const db = await createLocalDb({upgraded: true});
  const org = await db.addUser('organizer@fftt-rehearsal.invalid', {platformOrganizer: true});
  const users = {
    realScorer: await db.addUser('real-scorer@fftt-rehearsal.invalid'),      // Nov 22 scorer, NOT on the rehearsal
    skA: await db.addUser('scorer-a@fftt-rehearsal.invalid'),                // rehearsal only
    skB: await db.addUser('scorer-b@fftt-rehearsal.invalid'),                // rehearsal only
    shared: await db.addUser('shared-scorer@fftt-rehearsal.invalid'),        // on BOTH events
    outsider: await db.addUser('outsider@fftt-rehearsal.invalid'),
  };
  const make = async name => (await db.rpc(org, 'fftt_create_event_v3', {p_name: name, p_date: '2026-11-22', p_table_count: 2})).event_id;
  const R = await make('Fictional FFTT3 (Nov 22)');
  const T = await make('Fictional FFTT3 Rehearsal (Nov 8)');
  const grant = (E, email) => db.rpc(org, 'fftt_set_staff_v3', {p_event_id: E, p_email: email, p_action: 'grant', p_role: 'scorekeeper'});
  await grant(R, 'real-scorer@fftt-rehearsal.invalid');
  await grant(R, 'shared-scorer@fftt-rehearsal.invalid');
  await grant(T, 'scorer-a@fftt-rehearsal.invalid');
  await grant(T, 'scorer-b@fftt-rehearsal.invalid');
  await grant(T, 'shared-scorer@fftt-rehearsal.invalid');
  const ctx = (E, skA, skB) => ({db, E, org, skA, skB, outsider: users.outsider, snap: () => db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: E})});
  return {db, org, users, R, T, real: ctx(R, users.realScorer, users.shared), reh: ctx(T, users.skA, users.skB)};
}

/** Everything an organizer can observe about an event; must be byte-identical after rehearsal activity. */
const fingerprint = async (w, ctx) => JSON.stringify({
  snapshot: await ctx.snap(),
  audit: await w.db.rpc(w.org, 'fftt_audit_log_v3', {p_event_id: ctx.E, p_limit: 200}),
  desk: await deskOf(ctx, ctx.skA === w.users.skA ? w.users.skA : w.users.shared).catch(e => code(e)),
});

test('a full rehearsal (CSV-style import, check-in, byes, consolation, doubles, publication) never touches the Nov 22 event', async () => {
  const w = await world();
  const {db, org, R, T, real, reh} = w;
  try {
    // Nov 22 holds the actual registrants, nobody checked in, nothing published (the real current state).
    await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: R, p_players: roster(21)});
    const before = await fingerprint(w, real);
    assert.equal((await real.snap()).players.some(p => p.checked_in), false, 'Nov 22 starts with nobody checked in');
    assert.deepEqual(await db.publicTournaments(), [], 'nothing published');

    // The rehearsal imports the SAME names privately and checks in only those present (17 of 21).
    const names = roster(21);
    const present = names.slice(0, 17);
    const regs = present.map((p, i) => ({ref: refOf(i + 1), name: p.name, rating: p.rating, rating_status: p.rating_status, source: 'registration'}));
    const res = await db.rpc(org, 'fftt_checkin_registrants_v4', {p_event_id: T, p_registrants: regs});
    assert.deepEqual([res.status, res.created], ['saved', 17]);
    const s0 = await reh.snap();
    assert.equal(s0.players.length, 17, 'no-shows never enter the rehearsal roster');
    assert.ok(s0.players.every(p => p.checked_in));
    assert.equal(s0.event.name ?? s0.event.event_name, 'Fictional FFTT3 Rehearsal (Nov 8)');

    // Championship from the Nov 8 checked-in count: byes are produced and exactly the checked-in players appear.
    await buildChampionship(reh);
    const s1 = await reh.snap();
    const champ = s1.matches.filter(m => m.bracket === 'championship');
    assert.ok(champ.some(m => m.status === 'bye'), '17 players need byes');
    const seated = new Set(champ.flatMap(m => [m.player_1_id, m.player_2_id]).filter(Boolean));
    assert.deepEqual([...seated].sort(), s1.players.map(p => p.id).sort(), 'every checked-in player, and only them, is seated');

    // Two scorers on two different matches at once: both accepted. Same match at once: one accepted, one told it is stale.
    const desk = await deskOf(reh, w.users.skA);
    assert.ok(desk.length >= 2);
    const [x, y] = await Promise.all([
      submit(reh, w.users.skA, desk[0], desk[0].player_1_id, winningScore(false, 0), {table: 1}),
      submit(reh, w.users.skB, desk[1], desk[1].player_1_id, winningScore(false, 1), {table: 2}),
    ]);
    assert.deepEqual([x.status, y.status], ['accepted', 'accepted'], 'independent matches never block each other');
    const next = (await deskOf(reh, w.users.skA))[0];
    const [p, q] = await Promise.all([
      submit(reh, w.users.skA, next, next.player_1_id, winningScore(false, 0)),
      submit(reh, w.users.skB, next, next.player_2_id, swap(winningScore(false, 1))),
    ]);
    assert.deepEqual([p.status, q.status].sort(), ['accepted', 'rejected']);
    assert.equal((p.status === 'rejected' ? p : q).reason, 'stale-match-version');
    // a stale replay with the OLD version after acceptance is refused and nothing double-applies
    const replay = await submit(reh, w.users.skB, next, next.player_2_id, swap(winningScore(false, 1)));
    assert.equal(replay.status, 'rejected');
    assert.equal((await reh.snap()).matches.filter(m => m.id === next.match_id).length, 1);

    // Finish: round 1 → consolation eligibility → consolation → Mixed-Skill Doubles → results.
    await playAllPlayable(reh, {only: 'championship'});
    let s = await reh.snap();
    assert.equal(s.brackets.find(b => b.kind === 'championship').status, 'complete');
    assert.ok(s.consolation_candidates.length >= 2, 'first-time consolation eligibility is computed');
    // A player whose first competitive match was a win after a bye is NOT eligible; a first-match loser is.
    const lostFirst = new Set(s.matches.filter(m => m.bracket === 'championship' && m.status === 'complete')
      .map(m => (m.winner_id === m.player_1_id ? m.player_2_id : m.player_1_id)));
    assert.ok(s.consolation_candidates.every(c => lostFirst.has(c.player_id)), 'only players who actually lost are offered consolation');
    assert.match((await buildConsolation(reh)).status, /built/);
    await playAllPlayable(reh, {only: 'consolation'});
    s = await reh.snap();
    assert.ok(s.brackets.every(b => b.status === 'complete'));
    const placed = s.consolation_candidates.filter(c => c.state === 'placed').map(c => c.player_id);
    const champIds = new Set(s.matches.filter(m => m.is_final && m.bracket === 'championship').flatMap(m => [m.player_1_id, m.player_2_id]));
    const [d1, d2] = placed.filter(id => !champIds.has(id));
    const foreignId = (await real.snap()).players[0].id;
    const smuggled = await db.rpc(org, 'fftt_set_doubles_teams_v3', {p_event_id: T, p_partner_1: foreignId, p_partner_2: d2}).catch(e => e);
    assert.ok(smuggled instanceof Error && ['player', 'partners'].includes(smuggled.detail),
      'a Nov 22 player id cannot be a rehearsal doubles partner (refused as not-found/ineligible once the championship IS complete): ' + smuggled?.detail);
    await db.rpc(org, 'fftt_set_doubles_teams_v3', {p_event_id: T, p_partner_1: d1, p_partner_2: d2});
    assert.equal((await db.rpc(w.users.skA, 'fftt_record_doubles_result_v3', {p_event_id: T, p_winner_team: 1, p_game_scores: '11-8, 9-11, 11-7'})).status, 'recorded');

    // Publication is off by default and affects the rehearsal only; names appear only after the explicit opt-in.
    assert.deepEqual(await db.publicTournaments(), [], 'spectator off: real names are not public');
    await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: T, p_visible: true});
    let pub = await db.publicTournaments();
    assert.deepEqual(pub.map(e => e.event_name), ['Fictional FFTT3 Rehearsal (Nov 8)']);
    const pubText = JSON.stringify(pub);
    assert.ok(!pubText.includes(T) && !pubText.includes(R) && s.players.every(pl => !pubText.includes(pl.id)), 'no private ids');
    assert.ok(!/rating|email|phone|@/i.test(pubText.replace(/"rating[^"]*"/g, '')), 'no levels or contact details');
    assert.ok(!pubText.includes(names[18].name), 'a roster-only Nov 22 registrant who did not attend is not published');
    await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: T, p_visible: false});
    assert.deepEqual(await db.publicTournaments(), [], 'hiding the rehearsal removes everything public again');

    // Results export and private backup are event-scoped.
    const exp = JSON.stringify(await db.rpc(org, 'fftt_export_event_v3', {p_event_id: T}));
    assert.ok(exp.includes(names[0].name));
    assert.ok(!exp.includes(names[18].name), 'the rehearsal backup carries only the rehearsal roster');
    assert.ok(!exp.includes(R), 'the rehearsal backup does not mention the Nov 22 event id');
    await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: T, p_lifecycle: 'complete'});

    assert.equal(await fingerprint(w, real), before, 'the Nov 22 snapshot, audit trail and desk are byte-identical after the whole rehearsal');
  } finally { await db.db.close(); }
});

test('independent staff per event: scorers cannot cross events, and a foreign id cannot be smuggled into another event', async () => {
  const w = await world();
  const {db, org, users, R, T, real, reh} = w;
  try {
    await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: R, p_players: roster(8)});
    await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: T, p_players: roster(8)});
    for (const c of [real, reh]) for (const p of (await c.snap()).players) await db.rpc(org, 'fftt_set_checkin_v3', {p_event_id: c.E, p_player_id: p.id, p_checked_in: true});
    await buildChampionship(real); await buildChampionship(reh);
    const realRow = (await deskOf(real, users.realScorer))[0];
    const rehRow = (await deskOf(reh, users.skA))[0];
    const [realSnap, rehSnap] = [await real.snap(), await reh.snap()];
    const before = [JSON.stringify(realSnap), JSON.stringify(rehSnap)];

    // Staff of one event have no rights in the other (read or write), as seen from their own session.
    assert.deepEqual((await db.rpc(users.skA, 'fftt_my_events_v4', {})).map(e => e.event_id), [T]);
    assert.deepEqual((await db.rpc(users.realScorer, 'fftt_my_events_v4', {})).map(e => e.event_id), [R]);
    assert.deepEqual((await db.rpc(users.shared, 'fftt_my_events_v4', {})).map(e => e.event_id).sort(), [R, T].sort());
    assert.equal(code(await deskOf(reh, users.realScorer).catch(e => e)), '42501', 'Nov 22 scorer cannot read the rehearsal desk');
    assert.equal(code(await deskOf(real, users.skA).catch(e => e)), '42501', 'rehearsal scorer cannot read the Nov 22 desk');
    assert.equal(code(await submit(reh, users.realScorer, rehRow, rehRow.player_1_id, winningScore(false)).catch(e => e)), '42501');
    assert.equal(code(await submit(real, users.skA, realRow, realRow.player_1_id, winningScore(false)).catch(e => e)), '42501');
    assert.equal(code(await db.rpc(users.skA, 'fftt_assign_table_v3', {p_event_id: R, p_match_id: realRow.match_id, p_table_number: 1}).catch(e => e)), '42501');

    // A scorer who works BOTH events cannot record a rehearsal match through the Nov 22 event id (or the reverse).
    const confused = await db.rpc(users.shared, 'fftt_submit_match_result_v2', {p_event_id: R, p_match_id: rehRow.match_id,
      p_bracket_generation: rehRow.bracket_generation, p_expected_match_version: rehRow.match_version, p_submission_id: crypto.randomUUID(),
      p_winner_id: rehRow.player_1_id, p_game_scores: winningScore(false), p_table_number: 1}).catch(e => e);
    assert.ok(confused instanceof Error || confused.status === 'rejected', 'cross-event match id is never accepted: ' + JSON.stringify(confused?.status ?? confused?.message));
    const confused2 = await db.rpc(users.shared, 'fftt_assign_table_v3', {p_event_id: R, p_match_id: rehRow.match_id, p_table_number: 1}).catch(e => e);
    assert.ok(confused2 instanceof Error, 'a rehearsal match cannot be given a Nov 22 table');

    // The organizer, too, cannot cross ids: check-in, removal, bracket slots, doubles, corrections, forfeits.
    const realPlayer = realSnap.players[0], rehPlayer = rehSnap.players[0];
    const refused = async (label, p) => assert.ok((await p.catch(e => e)) instanceof Error, label);
    await refused('check-in with a Nov 22 player id under the rehearsal', db.rpc(org, 'fftt_set_checkin_v3', {p_event_id: T, p_player_id: realPlayer.id, p_checked_in: false}));
    await refused('bulk check-in with foreign ids', db.rpc(org, 'fftt_set_checkin_bulk_v3', {p_event_id: T, p_player_ids: [realPlayer.id], p_checked_in: false}));
    await refused('removal with a foreign id', db.rpc(org, 'fftt_remove_player_v3', {p_event_id: T, p_player_id: realPlayer.id}));
    await refused('correction of a foreign match', db.rpc(org, 'fftt_correct_result_v3', {p_event_id: T, p_match_id: realRow.match_id,
      p_expected_match_version: realRow.match_version, p_winner_id: realRow.player_1_id, p_game_scores: winningScore(false), p_reason: 'cross-event'}));
    await refused('forfeit of a foreign match', db.rpc(org, 'fftt_forfeit_match_v3', {p_event_id: T, p_match_id: realRow.match_id,
      p_expected_match_version: realRow.match_version, p_absent_player_id: realRow.player_1_id, p_reason: 'cross-event'}));
    const sRehNow = await reh.snap();
    await refused('rebuild with foreign player ids', db.rpc(org, 'fftt_build_championship_v3', {p_event_id: T,
      p_slots: [realPlayer.id, ...sRehNow.players.slice(1).map(p => p.id)].slice(0, 8), p_expected_generation: sRehNow.event.generation, p_confirm: true}));
    assert.deepEqual([JSON.stringify(await real.snap()), JSON.stringify(await reh.snap())], before, 'every refused call changed nothing');

    // Organizer-only operations stay organizer-only for rehearsal scorers.
    for (const [fn, args] of [
      ['fftt_upsert_players_v3', {p_event_id: T, p_players: roster(1)}], ['fftt_set_checkin_v3', {p_event_id: T, p_player_id: rehPlayer.id, p_checked_in: false}],
      ['fftt_build_championship_v3', {p_event_id: T, p_slots: [], p_expected_generation: 1, p_confirm: true}],
      ['fftt_set_visibility_v3', {p_event_id: T, p_visible: true}], ['fftt_export_event_v3', {p_event_id: T}],
      ['fftt_checkin_registrants_v4', {p_event_id: T, p_registrants: []}],
      ['fftt_correct_result_v3', {p_event_id: T, p_match_id: rehRow.match_id, p_expected_match_version: rehRow.match_version, p_winner_id: rehRow.player_1_id, p_game_scores: '', p_reason: 'scorer'}],
    ]) assert.equal(code(await db.rpc(users.skA, fn, args).catch(e => e)), '42501', fn + ' is organizer-only');

    // Two tables per event, counted separately: table 1 may be in use in BOTH events at once.
    assert.equal((await db.rpc(users.skA, 'fftt_assign_table_v3', {p_event_id: T, p_match_id: rehRow.match_id, p_table_number: 1})).status, 'updated');
    assert.equal((await db.rpc(users.realScorer, 'fftt_assign_table_v3', {p_event_id: R, p_match_id: realRow.match_id, p_table_number: 1})).status, 'updated');
    const second = (await deskOf(reh, users.skA)).find(r => r.match_id !== rehRow.match_id);
    assert.equal((await db.rpc(users.skB, 'fftt_assign_table_v3', {p_event_id: T, p_match_id: second.match_id, p_table_number: 1}).catch(e => e)).detail, 'table-in-use');
    assert.equal((await db.rpc(users.skB, 'fftt_assign_table_v3', {p_event_id: T, p_match_id: second.match_id, p_table_number: 3}).catch(e => e)).message, 'fftt_validation_error', 'only tables 1 and 2 exist');
    assert.ok(await db.rpc(users.skB, 'fftt_assign_table_v3', {p_event_id: T, p_match_id: second.match_id, p_table_number: 2}), 'table 2 is free');

    // Revoking the shared scorer from the REHEARSAL (drill) leaves their Nov 22 grant intact; re-granting restores it.
    await db.rpc(org, 'fftt_set_staff_v3', {p_event_id: T, p_email: 'shared-scorer@fftt-rehearsal.invalid', p_action: 'revoke', p_role: null});
    assert.equal(code(await deskOf(reh, users.shared).catch(e => e)), '42501', 'revoked from the rehearsal at once');
    assert.ok((await deskOf(real, users.shared)).length > 0, 'the Nov 22 grant is untouched by a rehearsal revocation');
    await db.rpc(org, 'fftt_set_staff_v3', {p_event_id: T, p_email: 'shared-scorer@fftt-rehearsal.invalid', p_action: 'grant', p_role: 'scorekeeper'});
    assert.ok((await deskOf(reh, users.shared)).length > 0, 're-grant restores the rehearsal desk');
    // outsiders see nothing in either event
    assert.equal((await db.rpc(users.outsider, 'fftt_my_events_v4', {})).length, 0);
  } finally { await db.db.close(); }
});

test('publication is per event: a published Nov 22 never exposes the rehearsal, and the reverse', async () => {
  const w = await world();
  const {db, org, R, T, real, reh} = w;
  try {
    for (const [c, n] of [[real, 6], [reh, 6]]) {
      await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: c.E, p_players: c === real ? roster(n) : roster(n).map(p => ({...p, name: 'Rehearsal ' + p.name}))});
      for (const p of (await c.snap()).players) await db.rpc(org, 'fftt_set_checkin_v3', {p_event_id: c.E, p_player_id: p.id, p_checked_in: true});
      await buildChampionship(c);
    }
    const names = e => e.map(x => x.event_name);
    const realLifecycle = (await real.snap()).event.lifecycle;
    assert.deepEqual(await db.publicTournaments(), [], 'both private by default');
    await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: R, p_visible: true});
    let pub = JSON.stringify(await db.publicTournaments());
    assert.ok(pub.includes('Ada Quill') && !pub.includes('Rehearsal Ada Quill'), 'only Nov 22 names are public');
    await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: T, p_visible: true});
    assert.deepEqual(names(await db.publicTournaments()).sort(), ['Fictional FFTT3 (Nov 22)', 'Fictional FFTT3 Rehearsal (Nov 8)']);
    await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: R, p_visible: false});
    pub = JSON.stringify(await db.publicTournaments());
    assert.ok(pub.includes('Rehearsal Ada Quill') && !pub.includes('"Ada Quill"'), 'hiding Nov 22 leaves only the rehearsal public');
    await db.rpc(org, 'fftt_set_visibility_v3', {p_event_id: T, p_visible: false});
    assert.deepEqual(await db.publicTournaments(), []);
    // Archiving the rehearsal never publishes and never removes its audit trail; Nov 22 is unaffected.
    await db.rpc(org, 'fftt_set_lifecycle_v3', {p_event_id: T, p_lifecycle: 'archived'});
    assert.deepEqual(await db.publicTournaments(), []);
    assert.ok((await db.rpc(org, 'fftt_audit_log_v3', {p_event_id: T, p_limit: 50})).length > 0, 'audit trail survives archive');
    assert.equal((await real.snap()).event.lifecycle, realLifecycle, 'Nov 22 lifecycle untouched by archiving the rehearsal');
  } finally { await db.db.close(); }
});
