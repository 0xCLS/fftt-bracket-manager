/** Test-only: evaluates the tournament engine EXACTLY as shipped in the approved single-file app
 * (index.html), so the cloud build can be compared with the approved UI's behavior. Zero network. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadApprovedEngine() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('const STORAGE_KEY=');
  const end = html.indexOf('function bracketRoundName');
  if (start < 0 || end < 0 || end < start) throw new Error('approved engine markers not found in index.html');
  const code = html.slice(start, end);
  const noop = () => {};
  const ctx = vm.createContext({
    localStorage: {getItem: () => null, setItem: noop},
    document: {querySelector: () => ({textContent: '', innerHTML: '', value: ''}), querySelectorAll: () => []},
    alert: noop, confirm: () => true, console,
  });
  vm.runInContext(code + `
    globalThis.__engine = {
      setPlayers(ps){ state.players = ps.map(p=>({id:p.id,name:p.name,rating:p.rating,ratingStatus:p.ratingStatus,checkedIn:true})); },
      createBracket, setupInitialSlots, feedWinner, autoAdvanceByes, matchCountForPlayer,
      get state(){ return state; }, pById, firstChampLossEligible, pendingFirstMatches,
      setBracket(type,b){ state[type]=b; },
    };`, ctx);
  return ctx.__engine;
}
