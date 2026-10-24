/** Pure export builders for the staff app. The results text and CSV are PUBLIC-SAFE (names and results only;
 * never ratings, ids or staff data). The private backup is the server's own export document, unchanged. */
import {computeStandings, roundName} from '../contracts/gameday_engine.mjs';

const csvCell = v => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // spreadsheet formula injection guard
  return /[",\n\r]/.test(t) ? '"' + t.replaceAll('"', '""') + '"' : t;
};

export function normalizeSnapshotMatches(snapshot) {
  const name = new Map(snapshot.players.map(p => [p.id, p.name]));
  return snapshot.matches.map(m => ({
    bracket: m.bracket, round: m.round, slot: m.slot, status: m.status, scores: m.scores,
    table: m.table, name1: name.get(m.p1) ?? null, name2: name.get(m.p2) ?? null, winnerName: name.get(m.winner) ?? null,
    p1: m.p1, p2: m.p2, winner: m.winner, id: m.id, code: m.code,
    phase: m.status !== 'pending' ? 'done' : (!m.p1 || !m.p2) ? 'waiting' : m.table ? 'playing' : 'up_next',
  }));
}

export function standingsFromSnapshot(snapshot) {
  const name = new Map(snapshot.players.map(p => [p.id, p.name]));
  const d = snapshot.doubles;
  const st = computeStandings({
    matches: snapshot.matches.map(m => ({bracket: m.bracket, round: m.round, slot: m.slot, status: m.status, p1: m.p1, p2: m.p2, winner: m.winner})),
    finale: d && d.partner1 && d.partner2 ? {team1: [d.finalist1, d.partner1], team2: [d.finalist2, d.partner2], winnerTeam: d.winnerTeam} : null,
  });
  const n = id => name.get(id) ?? '—';
  return {
    raw: st,
    champion: st.champion && n(st.champion), runnerUp: st.runnerUp && n(st.runnerUp),
    semifinalists: st.semifinalists.map(n),
    consolationChampion: st.consolationChampion && n(st.consolationChampion),
    consolationRunnerUp: st.consolationRunnerUp && n(st.consolationRunnerUp),
    doubles: st.doubles && {winners: st.doubles.winners.map(n), losers: st.doubles.losers.map(n)},
    belowTwoMatches: snapshot.players.filter(p => p.checkedIn && (st.matchesPlayed[p.id] ?? 0) < 2).map(p => p.name),
  };
}

export function resultsText(snapshot) {
  const e = snapshot.event, s = standingsFromSnapshot(snapshot);
  const lines = [e.name, e.date, `Checked in: ${snapshot.players.filter(p => p.checkedIn).length}`, ''];
  if (s.champion) lines.push(`Singles Champion: ${s.champion}`, `Runner-up: ${s.runnerUp}`);
  if (s.semifinalists.length) lines.push(`Semifinalists: ${s.semifinalists.join(', ')}`);
  if (s.consolationChampion) lines.push(`Consolation Champion: ${s.consolationChampion}`, `Consolation Runner-up: ${s.consolationRunnerUp}`);
  if (s.doubles) lines.push(`Mixed-Skill Doubles winners: ${s.doubles.winners.join(' + ')}`, `Mixed-Skill Doubles: ${s.doubles.losers.join(' + ')}`);
  lines.push('', 'MATCH RESULTS');
  for (const kind of ['championship', 'consolation']) {
    const ms = normalizeSnapshotMatches(snapshot).filter(m => m.bracket === kind && m.status === 'complete');
    if (!ms.length) continue;
    const rounds = Math.max(...snapshot.matches.filter(m => m.bracket === kind).map(m => m.round)) + 1;
    lines.push('', kind === 'championship' ? 'Championship' : 'Consolation');
    for (const m of ms.sort((a, b) => a.round - b.round || a.slot - b.slot)) {
      lines.push(`${roundName(rounds, m.round, kind)}: ${m.name1} vs ${m.name2} — Winner: ${m.winnerName}${m.scores ? ' — ' + m.scores : ''}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function matchesCsv(snapshot) {
  const rows = [['Bracket', 'Round', 'Match', 'Player 1', 'Player 2', 'Winner', 'Game scores', 'Table', 'Status']];
  for (const m of normalizeSnapshotMatches(snapshot).sort((a, b) => a.bracket.localeCompare(b.bracket) || a.round - b.round || a.slot - b.slot)) {
    rows.push([m.bracket, m.round + 1, m.code, m.name1 ?? '', m.name2 ?? '', m.winnerName ?? '', m.scores, m.table ?? '', m.status]);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
