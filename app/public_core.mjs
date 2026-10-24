/** Shared wiring for the spectator page and the TV board: auto-start anonymous reads with honest freshness. */
import {createPublicReader, projectPublicTournaments} from '../contracts/gameday_public.mjs';
import {createMilestone1PublicDisplay} from '../contracts/milestone1_public_display.mjs';
import {PUBLISHABLE_KEY} from './config.mjs';

export function startPublicFeed({onUpdate, fetchImpl = (u, i) => fetch(u, i), now = () => Date.now(), intervalMs = 6000}) {
  const reader = createPublicReader({publishableKey: PUBLISHABLE_KEY, fetchImpl});
  const display = createMilestone1PublicDisplay({
    read: () => reader.read(), project: projectPublicTournaments,
    isInvalidData: e => e?.name === 'PublicProjectionError' || e?.name === 'AuthorityGateError',
    isAvailable: () => navigator.onLine, now, intervalMs, staleAfterMs: 20000, expireAfterMs: 120000,
  });
  display.start();
  const tick = () => onUpdate(display.view, display);
  const timer = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { display.refreshNow(); tick(); } });
  window.addEventListener('online', () => display.refreshNow());
  tick();
  return Object.freeze({display, stop() { clearInterval(timer); display.stop(); }});
}

/** Which event to show: ?e=<id>, else the most recently updated active event, else the latest complete. */
export function pickEvent(events, wanted) {
  if (wanted) { const e = events.find(x => x.id === wanted); if (e) return e; }
  const rank = e => (e.status === 'active' ? 1 : 0);
  return [...events].sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}
