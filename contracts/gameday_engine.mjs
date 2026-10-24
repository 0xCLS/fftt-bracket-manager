/** FFTT game-day tournament engine: PURE functions shared by the staff app, the spectator app and tests.
 * No DOM, network or storage. The seeding and partner logic is ported verbatim from the approved
 * single-file application (index.html) and is checked against it by tests/gameday_engine.test.mjs, so the
 * cloud-connected build seeds exactly like the approved UI. The server remains the authority: it only
 * accepts a seed layout it can validate, builds the bracket itself, and decides every result.
 */
export const RATING_NAMES = Object.freeze({
  1: 'Beginner', 2: 'Recreational', 3: 'Intermediate', 4: 'Strong Intermediate', 5: 'Advanced / Competitive',
});
export const ratingName = n => RATING_NAMES[n] || 'Intermediate';

export function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

/** Rating-aware seed layout. `players`: [{id, name, rating, ratingStatus}]. Returns slot ids
 * (null = bye) in bracket order; length is a power of two. Byes go to the highest-rated players. */
export function seedSlots(players) {
  const ranked = [...players].sort((a, b) => b.rating - a.rating
    || (a.ratingStatus === 'established' ? 0 : 1) - (b.ratingStatus === 'established' ? 0 : 1)
    || a.name.localeCompare(b.name));
  const size = Math.max(2, nextPow2(ranked.length));
  const byes = size - ranked.length;
  const groups = ranked.slice(0, byes).map(p => [p]);
  const pool = ranked.slice(byes);
  while (pool.length >= 2) {
    const a = pool.shift();
    const lowerNear = pool.some(p => p.rating === a.rating - 1);
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i], gap = Math.abs(a.rating - b.rating);
      const samePenalty = (gap === 0 && lowerNear) ? 12 : 0;
      const score = gap * 10 + samePenalty;
      if (score < bestScore) { best = i; bestScore = score; }
    }
    groups.push([a, pool.splice(best, 1)[0]]);
  }
  const groupCount = size / 2;
  let seedOrder = [1];
  for (let n = 2; n <= groupCount; n *= 2) seedOrder = seedOrder.flatMap(seed => [seed, n + 1 - seed]);
  const slots = Array(size).fill(null);
  seedOrder.forEach((rank, i) => {
    const group = groups[rank - 1];
    slots[2 * i] = group[0].id;
    slots[2 * i + 1] = group[1]?.id || null;
  });
  return slots;
}

/** Player records from the organizer snapshot -> engine shape. */
export const enginePlayers = players => players.map(p => ({
  id: p.id, name: p.name, rating: p.rating, ratingStatus: p.rating_status,
}));

export function roundName(totalRounds, r, kind) {
  if (r === totalRounds - 1) return kind === 'championship' ? 'Final' : 'Consolation Final';
  if (r === totalRounds - 2) return 'Semifinals';
  if (r === totalRounds - 3) return 'Quarterfinals';
  return r === 0 ? 'Opening Round' : `Round ${r + 1}`;
}

export const bestOf = (kind, isFinal, event) =>
  (kind === 'championship' && isFinal) ? (event.final_best_of ?? 5) : (event.regular_best_of ?? 3);

/** Mirror of the server's score rules, for immediate feedback only. Blank = winner only.
 * Returns {ok:true,text} or {ok:false,error}. */
export function normalizeGameScores(raw, best, p1Won) {
  const value = String(raw ?? '').trim();
  if (value === '') return {ok: true, text: ''};
  const needed = (best + 1) / 2;
  const games = value.split(',').map(x => x.trim());
  if (games.length < needed || games.length > best) {
    return {ok: false, error: `Enter ${needed} to ${best} completed game scores separated by commas, or leave blank.`};
  }
  let w1 = 0, w2 = 0;
  const out = [];
  for (let i = 0; i < games.length; i++) {
    const m = games[i].match(/^(\d{1,2})\s*[-–—]\s*(\d{1,2})$/);
    if (!m) return {ok: false, error: 'Use game scores such as 11-8, 8-11, 11-7.'};
    const a = Number(m[1]), b = Number(m[2]);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi < 11 || hi - lo < 2 || (hi > 11 && hi - lo !== 2)) {
      return {ok: false, error: 'Each game goes to 11 and must be won by 2 (exactly 2 after deuce).'};
    }
    if (a > b) w1++; else w2++;
    if (i < games.length - 1 && Math.max(w1, w2) >= needed) {
      return {ok: false, error: 'Extra games were entered after the match was already won.'};
    }
    out.push(`${a}-${b}`);
  }
  const winnerWins = p1Won ? w1 : w2, loserWins = p1Won ? w2 : w1;
  if (winnerWins !== needed || loserWins >= needed) {
    return {ok: false, error: 'The game scores do not match the selected winner.'};
  }
  return {ok: true, text: out.join(', ')};
}

/** Consolation candidates in doubles-partner preference order (beginner-to-intermediate first). */
export function partnerCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    const ap = a.rating <= 3 ? 0 : 1, bp = b.rating <= 3 ? 0 : 1;
    return ap - bp || a.rating - b.rating || a.name.localeCompare(b.name);
  });
}

/** Balanced partner suggestion; verbatim logic from the approved app. finalists: [fa, fb] (with ratings). */
export function suggestPartners(finalists, candidates) {
  const ordered = partnerCandidates(candidates);
  const low = ordered.filter(p => p.rating <= 3);
  const pool = low.length >= 2 ? low : ordered;
  if (finalists.length < 2 || pool.length < 2) return null;
  const [fa, fb] = finalists;
  let best = null;
  for (let i = 0; i < pool.length; i++) for (let j = 0; j < pool.length; j++) {
    if (i === j) continue;
    const a = pool[i], b = pool[j];
    const diff = Math.abs((fa.rating + a.rating) - (fb.rating + b.rating));
    const penalty = (a.rating > 3 ? 2 : 0) + (b.rating > 3 ? 2 : 0);
    const score = diff * 10 + penalty;
    if (!best || score < best.score) best = {a, b, score};
  }
  return best && {partner1: best.a, partner2: best.b};
}

const played = m => m.status === 'complete';
const roundsOf = ms => ms.reduce((n, m) => Math.max(n, m.round + 1), 0);

/** Standings from match lists. `matches`: [{bracket, round, slot, status, p1, p2, winner}] with opaque
 * participant keys (ids on the staff side, names on the public side). `finale`: {team1:[a,b], team2:[a,b], winnerTeam}.
 * Third place is NOT invented: both beaten semifinalists are listed as semifinalists. */
export function computeStandings({matches, finale = null}) {
  const champ = matches.filter(m => m.bracket === 'championship');
  const cons = matches.filter(m => m.bracket === 'consolation');
  const finalOf = list => { const r = roundsOf(list); return list.find(m => m.round === r - 1 && m.slot === 0) ?? null; };
  const loserOf = m => m.winner === m.p1 ? m.p2 : m.p1;
  const out = {
    champion: null, runnerUp: null, semifinalists: [], consolationChampion: null, consolationRunnerUp: null,
    doubles: null, matchesPlayed: {}, belowTwoMatches: [], complete: false,
  };
  const cf = finalOf(champ);
  if (cf && played(cf)) { out.champion = cf.winner; out.runnerUp = loserOf(cf); }
  const rounds = roundsOf(champ);
  if (rounds >= 2) {
    out.semifinalists = champ.filter(m => m.round === rounds - 2 && played(m)).map(loserOf);
  }
  const kf = finalOf(cons);
  if (kf && played(kf)) { out.consolationChampion = kf.winner; out.consolationRunnerUp = loserOf(kf); }
  if (finale && finale.winnerTeam) {
    out.doubles = {winners: finale.winnerTeam === 1 ? finale.team1 : finale.team2,
                   losers: finale.winnerTeam === 1 ? finale.team2 : finale.team1};
  }
  for (const m of matches) {
    if (!played(m)) continue;
    for (const k of [m.p1, m.p2]) if (k) out.matchesPlayed[k] = (out.matchesPlayed[k] ?? 0) + 1;
  }
  out.complete = !!out.champion && (cons.length === 0 || !!out.consolationChampion) && (!finale || !!out.doubles || !finale.team1);
  return out;
}
