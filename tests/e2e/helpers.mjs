/** Test-only helpers for the game-day server and browser tests. Fictional data only. */
import {createLocalDb} from './localdb.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

export const FICTIONAL = ['Ada Quill','Ben Marlow','Cy Fennel','Dee Larkin','Eli Brandt','Fay Holloway','Gus Pemberton',
  'Hal Winters','Ivy Castellan','Jo Marchetti','Kit Alder','Lia Vance','Moe Tanner','Nia Rowe','Oli Sparks','Pia Dunmore',
  'Quin Ashby','Rae Linden','Sol Whitaker','Tia Mercer','Uma Fox','Vic Lowell','Wes Hartley','Xan Pryor'];

/** Players with a deterministic spread of ratings 1..5 (mostly mid-range, like a real church event). */
export const roster = n => FICTIONAL.slice(0, n).map((name, i) => ({
  name, rating: [3, 2, 4, 3, 1, 3, 5, 2, 3, 4, 2, 3, 1, 4, 3, 2, 5, 3, 2, 4, 3, 1, 2, 3][i],
  rating_status: i % 3 === 0 ? 'established' : 'provisional',
}));

export async function setupEvent({players = 12, tables = 2, checkIn = true} = {}) {
  const db = await createLocalDb();
  const org = await db.addUser('organizer@fftt-staging.invalid', {platformOrganizer: true});
  const skA = await db.addUser('scorekeeper-a@fftt-staging.invalid');
  const skB = await db.addUser('scorekeeper-b@fftt-staging.invalid');
  const outsider = await db.addUser('outsider@fftt-staging.invalid');
  const ev = await db.rpc(org, 'fftt_create_event_v3', {p_name: 'Synthetic Rehearsal Games', p_date: '2026-11-22', p_table_count: tables});
  const E = ev.event_id;
  await db.rpc(org, 'fftt_set_staff_v3', {p_event_id: E, p_email: 'scorekeeper-a@fftt-staging.invalid', p_action: 'grant', p_role: 'scorekeeper'});
  await db.rpc(org, 'fftt_set_staff_v3', {p_event_id: E, p_email: 'scorekeeper-b@fftt-staging.invalid', p_action: 'grant', p_role: 'scorekeeper'});
  if (players) await db.rpc(org, 'fftt_upsert_players_v3', {p_event_id: E, p_players: roster(players)});
  const snap = () => db.rpc(org, 'fftt_organizer_snapshot_v3', {p_event_id: E});
  if (checkIn) for (const p of (await snap()).players) {
    await db.rpc(org, 'fftt_set_checkin_v3', {p_event_id: E, p_player_id: p.id, p_checked_in: true});
  }
  return {db, E, org, skA, skB, outsider, snap};
}

export const buildChampionship = async ctx => {
  const s = await ctx.snap();
  const slots = seedSlots(enginePlayers(s.players.filter(p => p.checked_in)));
  return ctx.db.rpc(ctx.org, 'fftt_build_championship_v3', {p_event_id: ctx.E, p_slots: slots, p_expected_generation: s.event.generation, p_confirm: s.event.generation > 0});
};

export const buildConsolation = async (ctx, {entrants = null} = {}) => {
  const s = await ctx.snap();
  const byId = new Map(s.players.map(p => [p.id, p]));
  const ids = entrants ?? s.consolation_candidates.map(c => c.player_id);
  const slots = seedSlots(enginePlayers(ids.map(id => byId.get(id))));
  return ctx.db.rpc(ctx.org, 'fftt_build_consolation_v3', {p_event_id: ctx.E, p_slots: slots, p_expected_generation: s.event.generation, p_confirm: false});
};

const WIN3 = ['11-7, 11-9', '11-5, 9-11, 11-8', '12-10, 11-6'];
const WIN5 = ['11-5, 11-6, 11-7', '11-9, 8-11, 11-7, 9-11, 11-8'];
export const winningScore = (isFinal, i = 0) => (isFinal ? WIN5 : WIN3)[i % (isFinal ? WIN5 : WIN3).length];
/** Same scores but with the player-2 side winning (swap each game). */
export const swap = text => text.split(', ').map(g => g.split('-').reverse().join('-')).join(', ');

/** Submit a score as a scorekeeper through the public V2 RPC. */
export function submit(ctx, userId, row, winnerId, scores, {submissionId = crypto.randomUUID(), table = 1, version = row.match_version} = {}) {
  return ctx.db.rpc(userId, 'fftt_submit_match_result_v2', {
    p_event_id: ctx.E, p_match_id: row.match_id, p_bracket_generation: row.bracket_generation,
    p_expected_match_version: version, p_submission_id: submissionId, p_winner_id: winnerId,
    p_game_scores: scores, p_table_number: table,
  });
}

export const deskOf = (ctx, userId) => ctx.db.rpc(userId, 'fftt_matchdesk_v1', {p_event_id: ctx.E}, {rows: true});

/** Play every currently playable match; higher rating wins (p1 on ties); scorekeepers alternate.
 * Returns the number of matches played. */
export async function playAllPlayable(ctx, {only = null, limit = 1000} = {}) {
  let played = 0, flip = 0;
  for (;;) {
    const desk = (await deskOf(ctx, ctx.skA)).filter(r => !only || r.bracket === only);
    if (!desk.length || played >= limit) return played;
    const snap = await ctx.snap();
    const rating = new Map(snap.players.map(p => [p.id, p.rating]));
    const row = desk[0];
    const p1Wins = rating.get(row.player_1_id) >= rating.get(row.player_2_id);
    const final = row.is_championship_final;
    const scores = p1Wins ? winningScore(final, played) : swap(winningScore(final, played));
    const who = flip++ % 2 ? ctx.skB : ctx.skA;
    const res = await submit(ctx, who, row, p1Wins ? row.player_1_id : row.player_2_id, scores, {table: 1});
    if (res.status !== 'accepted') throw new Error('unexpected ' + JSON.stringify(res));
    played++;
  }
}
