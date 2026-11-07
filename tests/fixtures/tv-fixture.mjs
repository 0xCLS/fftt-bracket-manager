/** Fictional, allowlisted public feed for TV tests and screenshots. */
const match = (id, round, slot, p1, p2, extra = {}) => ({match_id: id, bracket: 'championship', round, slot, player_1_name: p1, player_2_name: p2, winner_name: null, game_scores: '', status: 'pending', table_number: null, phase: 'waiting', best_of: 3, points_to_win: 11, ...extra});
export function fixture() {
  const matches = [
    match('a', 0, 0, 'Alexandria Montgomery-Fitzgerald', 'Michael Lewis', {phase:'playing', table_number:1, game_scores:'11-7, 8-11'}),
    match('b', 0, 1, 'Jordan Williams', 'Evangeline Worthington-Smythe', {phase:'playing', table_number:2}),
    ...Array.from({length:4}, (_, i) => match(`q${i}`, 0, i + 2, `Fictional Player ${i + 1}`, `Fictional Opponent ${i + 1}`, {phase:'up_next'})),
    match('r', 1, 0, 'Taylor Smith', 'Morgan James', {status:'complete', phase:'done', winner_name:'Taylor Smith', game_scores:'11-7, 8-11, 11-9'}),
    ...Array.from({length:3}, (_, i) => match(`result-${i}`, 1, i + 1, `Winner ${i + 1}`, `Opponent ${i + 1}`, {status:'complete', phase:'done', winner_name:`Winner ${i + 1}`, game_scores:'11-6, 11-8'})),
    match('f', 2, 0, null, null),
  ];
  return [{event_id:'12345678-1234-4123-8123-123456789abc',event_name:'Forging Fellowship Games',event_date:'2026-11-22',status:'active',revision:1,tables:2,updated_at:'2026-11-07T00:00:00Z',finale:null,brackets:[{name:'championship',matches},{name:'consolation',matches:[match('c',0,0,'Jamie Lee','Casey Ross',{bracket:'consolation'})]}]}];
}
export function largeFixture() {
  const f = fixture();
  const matches = [];
  for (let round=0; round<6; round++) for (let slot=0; slot<32 / 2 ** round; slot++) matches.push(match(`large-${round}-${slot}`, round, slot, `Player ${round}-${slot} A`, `Player ${round}-${slot} B`));
  f[0].brackets[0].matches = matches;
  return f;
}
