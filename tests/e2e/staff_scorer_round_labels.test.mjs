/** Focused Scorer round-label regression using fake HTTPS + disposable Postgres.
 * No hosted credentials, events or production services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';
import {buildConsolation, playAllPlayable} from './helpers.mjs';
import {parseEventBrief} from '../../contracts/gameday_api.mjs';

const T = 30000;
const PHONE = {viewport: {width: 390, height: 844}, mobile: true};
const SQL = fs.readFileSync(new URL('../../supabase/proposals/FFTT3_SCORER_ROUND_DEPTH_20261110_DO_NOT_APPLY.sql', import.meta.url), 'utf8');
const EVENT = '00000000-0000-4000-8000-000000000001';
const brief = {event_id: EVENT, name: 'Synthetic test', date: '2099-11-12', tables: 2, lifecycle: 'active', generation: 1, revision: 2};

test('Scorer event brief round totals are optional on old hosts, strict and private on upgraded hosts', () => {
  assert.equal(parseEventBrief(brief).rounds, null);
  assert.deepEqual(parseEventBrief({...brief, rounds: {championship: 3, consolation: null}}).rounds, {championship: 3, consolation: null});
  assert.throws(() => parseEventBrief({...brief, rounds: {championship: 3}}));
  assert.throws(() => parseEventBrief({...brief, rounds: {championship: 3, consolation: 0}}));
  assert.throws(() => parseEventBrief({...brief, rounds: {championship: 3, consolation: null, players: []}}));
});

test('Scorer dialog and review use accurate Championship quarters, semis, Final and Consolation Final', {timeout: 240000}, async () => {
  const w = await createBrowserWorld({players: 8, staffRoles: true});
  const db = w.fake.local, E = w.eventId;
  try {
    await db.db.exec(SQL); // the proposed, still-UNDEPLOYED read-only function replacement
    await db.rpc(w.ids.org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
    const snap = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
    await db.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(snap.players)), p_expected_generation: 0, p_confirm: false});
    const ctx = {db, E, org: w.ids.org, skA: w.ids.a, skB: w.ids.b, snap: () => db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
    const initial = await db.rpc(w.ids.a, 'fftt_event_brief_v3', {p_event_id: E});
    assert.deepEqual(initial.rounds, {championship: 3, consolation: null});
    assert.equal(JSON.stringify(initial).includes('display_name'), false, 'no player roster is exposed');
    await assert.rejects(db.rpc(w.ids.out, 'fftt_event_brief_v3', {p_event_id: E}), 'an outsider cannot read even round depth');
    const a = await w.device('a', PHONE);
    await a.signIn('a', {keep: true});   // tab-persisted session so page.reload() keeps the Scorer signed in

    async function checkScorerRound(expected) {
      await a.page.locator('.queue-card').first().waitFor({timeout: T});
      await a.page.locator('.queue-card').first().getByRole('button', {name: 'Record result'}).click();
      const dlg = a.page.locator('dialog[open]');
      await dlg.locator('.game-step').first().waitFor({timeout: T});
      assert.equal(await dlg.locator('h3').first().innerText(), `Record result · ${expected}`);
      const inputs = dlg.locator('.games input');
      // Championship is Best of 3 to 11 (two games shown as four fields); Consolation is Best of 1 to 21 (one game, two fields).
      const scores = expected.startsWith('Consolation') ? ['21', '15'] : ['11', '7', '11', '5'];
      assert.equal(await inputs.count(), expected.startsWith('Consolation') ? 2 : 6);
      for (const [i, v] of scores.entries()) await inputs.nth(i).fill(v);
      await dlg.locator('.winner-pick label').first().click();
      await dlg.getByRole('button', {name: 'Review result'}).click();
      await dlg.locator('.review').waitFor({timeout: T});
      assert.match(await dlg.locator('.review').innerText(), new RegExp(expected));
      await dlg.locator('button.dlg-x').click();
      await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
    }

    await checkScorerRound('Championship Quarterfinals');
    assert.equal(await playAllPlayable(ctx, {only: 'championship', limit: 4}), 4);
    await a.page.reload();
    await checkScorerRound('Championship Semifinals');
    assert.equal(await playAllPlayable(ctx, {only: 'championship', limit: 2}), 2);
    await a.page.reload();
    await checkScorerRound('Championship Final');
    assert.equal(await playAllPlayable(ctx, {only: 'championship', limit: 1}), 1);
    await buildConsolation(ctx);
    const withConsolation = await db.rpc(w.ids.a, 'fftt_event_brief_v3', {p_event_id: E});
    assert.deepEqual(withConsolation.rounds, {championship: 3, consolation: 2});
    await a.page.reload();
    await checkScorerRound('Consolation Semifinals');
    assert.equal(await playAllPlayable(ctx, {only: 'consolation', limit: 2}), 2);
    await a.page.reload();
    await checkScorerRound('Consolation Final');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});

// ---- Scorer privilege boundary and SQL safety, disposable PGlite only ----------------------------------------------------------------------
import {setupEvent, buildChampionship} from './helpers.mjs';
import {createHostedEquivalentDb} from './hosted_equivalent.mjs';
const ROLLBACK = fs.readFileSync(new URL('../../supabase/proposals/FFTT3_SCORER_ROUND_DEPTH_ROLLBACK_20261110_DO_NOT_APPLY.sql', import.meta.url), 'utf8');
const HOSTED_BASELINE_FP = 'e00fe3f2f144e0e001fb7d5b75c722dc';   // md5(pg_get_functiondef) of fftt_private.event_brief_v3 read from the hosted project on 2026-11-10
const briefFp = ctx => ctx.db.admin(`select md5(pg_get_functiondef('fftt_private.event_brief_v3(uuid)'::regprocedure)) fp`).then(r => r[0].fp);
const refused = p => assert.rejects(p, e => e.code === '42501' || /forbidden|permission denied/i.test(e.message));

test('a Scorer still cannot read privileged bracket, roster, contact, audit, export or Organizer information; the brief adds exactly two integers', {timeout: 120000}, async () => {
  const ctx = await setupEvent({players: 8, tables: 2});
  try {
    await ctx.db.db.exec(SQL);
    await buildChampionship(ctx);
    const scorerBrief = await ctx.db.rpc(ctx.skA, 'fftt_event_brief_v3', {p_event_id: ctx.E});
    assert.deepEqual(Object.keys(scorerBrief).sort(), ['date', 'event_id', 'generation', 'lifecycle', 'name', 'revision', 'rounds', 'tables']);
    assert.deepEqual(Object.keys(scorerBrief.rounds).sort(), ['championship', 'consolation']);
    assert.deepEqual(scorerBrief.rounds, {championship: 3, consolation: null});
    assert.ok(Object.values(scorerBrief.rounds).every(v => v === null || Number.isInteger(v)), 'aggregate integers only');
    const text = JSON.stringify(scorerBrief);
    for (const forbidden of ['Ada Quill', 'Ben Marlow', 'rating', 'email', 'phone', 'player', 'seed', 'score', 'staff']) assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `brief must not expose ${forbidden}`);
    // the same Organizer-only reads remain refused to a Scorer, and to an outsider and anonymous callers
    for (const fn of ['fftt_organizer_snapshot_v3', 'fftt_audit_log_v3', 'fftt_export_event_v3']) {
      await refused(ctx.db.rpc(ctx.skA, fn, {p_event_id: ctx.E, ...(fn === 'fftt_audit_log_v3' ? {p_limit: 10} : {})}));
      await refused(ctx.db.rpc(ctx.outsider, fn, {p_event_id: ctx.E, ...(fn === 'fftt_audit_log_v3' ? {p_limit: 10} : {})}));
    }
    await refused(ctx.db.rpc(ctx.outsider, 'fftt_event_brief_v3', {p_event_id: ctx.E}));
    await refused(ctx.db.rpc(null, 'fftt_event_brief_v3', {p_event_id: ctx.E}));
    // the Organizer's richer snapshot is untouched
    assert.ok((await ctx.snap()).players.length === 8);
  } finally { await ctx.db.db.close(); }
});

test('proposed SQL on the hosted-equivalent layering: baseline equals the hosted fingerprint; replay and drift refused; rollback restores the exact baseline', {timeout: 120000}, async () => {
  const db = await createHostedEquivalentDb({corrections: true});
  try {
    const org = await db.addUser('org@scorer-labels.invalid', {platformOrganizer: true}), scorer = await db.addUser('scorer@scorer-labels.invalid');
    const E = (await db.rpc(org, 'fftt_create_event_v3', {p_name: 'FICTIONAL LABELS', p_date: '2026-11-22', p_table_count: 2})).event_id;
    await db.rpc(org, 'fftt_set_staff_v3', {p_event_id: E, p_email: 'scorer@scorer-labels.invalid', p_action: 'grant', p_role: 'scorekeeper'});
    await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: ['Ada Quill', 'Ben Marlow', 'Cy Fennel', 'Dee Larkin'].map((name, i) => ({name, rating: 1 + i, rating_status: 'provisional'}))});
    const ctx = {db, E, org, snap: () => db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
    for (const p of (await ctx.snap()).players) await db.rpc(org, 'fftt_set_checkin_v3', {p_event_id: E, p_player_id: p.id, p_checked_in: true});
    const fp = () => db.admin(`select md5(pg_get_functiondef('fftt_private.event_brief_v3(uuid)'::regprocedure)) fp`).then(r => r[0].fp);
    assert.equal(await fp(), HOSTED_BASELINE_FP, 'hosted-equivalent baseline fingerprint equals the hosted function');
    assert.equal((await db.admin('select count(*)::int n from fftt_private.events where synthetic_only=false'))[0].n >= 1, true, 'real-mode: the hosted fingerprint guard is active');
    await assert.rejects(db.db.exec(ROLLBACK), /absent/);        // nothing to roll back yet
    await db.db.exec('rollback');
    await db.db.exec(SQL);                                       // passes the real-mode fingerprint guard
    assert.notEqual(await fp(), HOSTED_BASELINE_FP);
    await assert.rejects(db.db.exec(SQL), /baseline drift or already installed/);
    await db.db.exec('rollback');
    await buildChampionship(ctx);
    assert.deepEqual((await db.rpc(scorer, 'fftt_event_brief_v3', {p_event_id: E})).rounds, {championship: 2, consolation: null});
    const dataBefore = JSON.stringify(await db.admin('select (select count(*) from fftt_private.players) p, (select count(*) from fftt_private.matches) m, (select count(*) from fftt_private.audit_events) a'));
    await db.db.exec(ROLLBACK);
    assert.equal(await fp(), HOSTED_BASELINE_FP, 'rollback restores the exact baseline function');
    assert.equal('rounds' in (await db.rpc(scorer, 'fftt_event_brief_v3', {p_event_id: E})), false);
    assert.equal(JSON.stringify(await db.admin('select (select count(*) from fftt_private.players) p, (select count(*) from fftt_private.matches) m, (select count(*) from fftt_private.audit_events) a')), dataBefore, 'rollback touches no data');
    // a drifted hosted baseline is refused (install is a real-mode database here)
    await db.db.exec(`create or replace function fftt_private.event_brief_v3(p_event_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $f$
      declare e fftt_private.events%rowtype; begin select * into e from fftt_private.events where id = p_event_id; perform fftt_private.staff_role_for_event(p_event_id);
      return pg_catalog.jsonb_build_object('event_id', e.id, 'name', e.event_name, 'extra', 1); end; $f$;`);
    await assert.rejects(db.db.exec(SQL), /hosted fingerprint differs/);
    await db.db.exec('rollback');
  } finally { await db.db.close(); }
});

test('older server without round metadata: a Scorer never sees a guessed "Semifinals"; the Final is still labelled from the server flag', {timeout: 240000}, async () => {
  const w = await createBrowserWorld({players: 8, staffRoles: true});   // the proposed SQL is deliberately NOT installed
  const db = w.fake.local, E = w.eventId;
  try {
    await db.rpc(w.ids.org, 'fftt_set_checkin_bulk_v3', {p_event_id: E, p_player_ids: null, p_checked_in: true});
    const snap = await db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
    await db.rpc(w.ids.org, 'fftt_build_championship_v3', {p_event_id: E, p_slots: seedSlots(enginePlayers(snap.players)), p_expected_generation: 0, p_confirm: false});
    const ctx = {db, E, org: w.ids.org, skA: w.ids.a, skB: w.ids.b, snap: () => db.rpc(w.ids.org, 'fftt_organizer_snapshot_v3', {p_event_id: E})};
    assert.equal('rounds' in (await db.rpc(w.ids.a, 'fftt_event_brief_v3', {p_event_id: E})), false, 'old host: no rounds field');
    const a = await w.device('a', PHONE);
    await a.signIn('a', {keep: true});
    const titleOf = async () => {
      await a.page.locator('.queue-card').first().waitFor({timeout: T});
      await a.page.locator('.queue-card').first().getByRole('button', {name: 'Record result'}).click();
      const dlg = a.page.locator('dialog[open]');
      await dlg.locator('.game-step').first().waitFor({timeout: T});
      const title = await dlg.locator('h3').first().innerText();
      await dlg.locator('button.dlg-x').click();
      await a.page.locator('dialog[open]').waitFor({state: 'detached', timeout: T});
      return title;
    };
    assert.equal(await titleOf(), 'Record result · Championship Round 1');
    await playAllPlayable(ctx, {only: 'championship', limit: 4}); await a.page.reload();
    assert.equal(await titleOf(), 'Record result · Championship Round 2');
    await playAllPlayable(ctx, {only: 'championship', limit: 2}); await a.page.reload();
    assert.equal(await titleOf(), 'Record result · Championship Final');
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); await db.db.close(); }
});
