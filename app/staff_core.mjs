/** FFTT Bracket Manager (staging) — staff application core. No DOM, so it is tested headlessly.
 *
 * One signed-in person, one event at a time. Reads poll a cheap server "pulse" and fetch the full
 * organizer snapshot / Match Desk only when something changed. Every write goes through
 * `session.authorized` (fresh identity + current event role) and the audited server RPCs; the server
 * is the only authority. Writes are refused locally whenever the connection is not confirmed live.
 * Scores use the single-use, receipt-recovering score session: an unknown outcome is never resent
 * automatically, and the incident is recorded durably BEFORE the one-shot send.
 */
import {GamedayApiError} from '../contracts/gameday_api.mjs';
import {StaffSignInError} from '../contracts/milestone1_password_transport.mjs';
import {createMilestone1ScoreSession} from '../contracts/milestone1_score_session.mjs';
import {seedSlots, enginePlayers, normalizeGameScores, bestOf} from '../contracts/gameday_engine.mjs';

export const POLL_MS = 7000;
export const STALE_AFTER_MS = 25000;
const FULL_REFRESH_MS = 45000;
const UNRESOLVED = new Set(['prepared', 'sending', 'needs-own-receipt', 'unknown', 'checking-receipt',
  'confirmed-accepted', 'confirmed-rejected']);

// ---------------------------------------------------------------- plain-language errors
const DETAIL = Object.freeze({
  'rebuild-requires-confirmation': 'This replaces the existing bracket. Confirm the rebuild to continue.',
  'first-matches-pending': 'Every player must play a first championship match before the consolation bracket is built.',
  'consolation-has-results': 'The consolation bracket already has results, so it cannot be rebuilt.',
  'downstream-complete': 'The winner already played the next round, so this result can no longer be changed here.',
  'consolation-built': 'The consolation bracket is built from these results, so a winner cannot be changed now.',
  'table-in-use': 'That table already has a match on it.',
  'match-not-playable': 'That match is not ready to play, or was just completed.',
  'match-version': 'The match changed since you opened it. Refresh and try again.',
  'player-in-bracket': 'That player is already in the bracket.',
  'lifecycle': 'The event is not in the right state for that.',
  'no-bracket': 'Build the championship bracket first.',
  'championship-incomplete': 'The championship final has not been played yet.',
  'roster-full': 'The roster is full (64 players).',
  'event-limit': 'The limit on open events has been reached. Archive an old event first.',
  'doubles-complete': 'The doubles finale already has a result.',
  'teams-not-set': 'Choose the two doubles teams first.',
  'duplicate-name': 'Two players cannot share the same name. Add a last initial.',
  'player-name': 'Player names cannot contain e-mail addresses or phone numbers.',
  'player-rating': 'Ratings are 1 to 5.',
  'reason': 'A short reason (3 to 300 characters) is required.',
  'slots-incomplete': 'Every checked-in player must be in the bracket.',
  'slots-ineligible': 'Only checked-in players can be placed.',
  'slots-players': 'At least two players are needed.',
  'partners': 'Choose two different partners who are not the finalists.',
  'partners-not-in-consolation': 'Doubles partners come from the consolation bracket.',
  'scores': 'Check the game scores.', 'scores-count': 'Enter the full set of games for this match.',
  'scores-game': 'Each game goes to 11 and is won by 2.', 'scores-winner': 'The scores do not match the winner.',
  'scores-extra-games': 'Games were entered after the match was already won.', 'scores-format': 'Use scores like 11-8.',
  'table': 'That table number is not available.', 'email': 'Enter a valid e-mail address.',
});
export function describeError(e) {
  if (e instanceof GamedayApiError) {
    if (e.outcomeUnknown) return 'The connection dropped before the server answered. This change may or may not have been saved. Refresh and check before trying again.';
    switch (e.kind) {
      case 'validation': case 'conflict': return DETAIL[e.detail] ?? (e.kind === 'conflict' ? 'The event changed. Refresh and try again.' : 'Please check the details and try again.');
      case 'stale': return 'The bracket was rebuilt while you were working. The screen has been refreshed.';
      case 'not-found': return 'That item no longer exists. The screen has been refreshed.';
      case 'forbidden': return 'Your account is not allowed to do that.';
      case 'ineligible': return 'No active account with that e-mail address exists. Ask the administrator to create it first.';
      case 'access-rejected': return 'Your sign-in expired. Sign in again.';
      case 'rate-limited': return 'Too many requests. Wait a moment.';
      case 'network': return 'You appear to be offline. Nothing was sent.';
      case 'malformed': return 'The server sent an unexpected answer. Nothing was changed on this screen.';
      default: return 'The service is temporarily unavailable. Try again shortly.';
    }
  }
  if (e instanceof StaffSignInError) {
    return ({expired: 'Your session ended. Sign in again.', revoked: 'Your access ended. Sign in again if you should still have access.',
      network: 'You appear to be offline. Nothing was sent.', locked: 'The page is paused. Try again.',
      busy: 'One moment, then try again.', 'rate-limited': 'Too many requests. Wait a moment.',
      'not-authorized': 'This account is not authorised for that event.'})[e.kind] ?? 'The service is temporarily unavailable. Try again shortly.';
  }
  return 'Something went wrong. Nothing was changed on this screen.';
}
const isSessionEnded = e => e instanceof StaffSignInError && ['expired', 'revoked'].includes(e.kind);

// ---------------------------------------------------------------- durable incident record (no secrets, no names)
export function createPendingLedger(storage) {
  const key = id => 'fftt.gameday.pending.v1.' + id;
  const ok = r => r && typeof r === 'object' && r.v === 1 && typeof r.submissionId === 'string' && typeof r.matchId === 'string'
    && typeof r.code === 'string' && typeof r.scores === 'string' && Number.isSafeInteger(r.at);
  return Object.freeze({
    read(eventId) { try { const r = JSON.parse(storage.getItem(key(eventId)) ?? 'null'); return ok(r) ? r : null; } catch { return null; } },
    write(eventId, rec) { try { storage.setItem(key(eventId), JSON.stringify({v: 1, ...rec})); return storage.getItem(key(eventId)) !== null; } catch { return false; } },
    clear(eventId) { try { storage.removeItem(key(eventId)); } catch { /* nothing stored */ } },
  });
}

export function createStaffCore({session, api, scoreTransport, ledger, now = () => Date.now(),
  randomId = () => crypto.randomUUID(), isOnline = () => true, onChange = () => {}} = {}) {
  const s = {
    signedIn: false, role: null, eventId: null, events: [], snapshot: null, brief: null, pulse: null,
    desk: [], deskStatus: 'idle', score: {status: 'idle', pendingSubmissionId: null}, pending: null,
    lastGoodAt: 0, lastError: null, busy: false, paused: false, endedReason: null, audit: null,
    lastScoreMessage: null,
  };
  let scoreSession = null, scope = null, rawDesk = new Map(), refreshing = false, queuedForce = false, lastFullAt = 0;
  const emit = () => { try { onChange(); } catch { /* a view error must not stop the core */ } };

  // ---------------------------------------------------------------- score session wiring
  function newScoreSession(eventId) {
    scoreSession?.dispose();
    rawDesk = new Map();
    scoreSession = createMilestone1ScoreSession({
      eventId,
      readRole: async () => { if (!scope) throw new Error('no scope'); return scope.role; },
      readMatchdesk: async () => {
        if (!scope) throw new Error('no scope');
        const rows = await scoreTransport.readMatchdesk(scope.token, {eventId});
        rawDesk = new Map(rows.map(r => [r.match_id, r]));
        return rows;
      },
      readOwnSnapshot: async ({submissionId = null} = {}) => {
        if (!scope) throw new Error('no scope');
        return scoreTransport.readOwnSnapshot(scope.token, {eventId, submissionId});
      },
      sendScore: async intent => { if (!scope) throw new Error('no scope'); return scoreTransport.submitScore(scope.token, intent); },
      getSubmissionId: randomId,
      isAuthenticated: () => s.signedIn && !s.paused && session.status.canRead,
      allowApprovedHostedSyntheticFixture: true,
    });
  }
  const inScope = (ctx, fn) => { scope = ctx; return Promise.resolve().then(fn).finally(() => { scope = null; }); };
  const syncScoreView = () => {
    const v = scoreSession?.view;
    s.score = {status: v?.status ?? 'idle', pendingSubmissionId: v?.pendingSubmissionId ?? null, decision: v?.decision ?? null};
  };
  const mergeDesk = () => {
    const rows = scoreSession?.view?.status === 'ready' ? scoreSession.view.matches : null;
    if (!rows) return;
    s.desk = rows.map(m => {
      const raw = rawDesk.get(m.matchId);
      return Object.freeze({matchId: m.matchId, version: m.matchVersion, code: m.code, bracket: raw?.bracket ?? 'championship',
        round: raw?.round_number ?? 0, slot: raw?.slot ?? 0, isFinal: raw?.is_championship_final === true,
        table: raw?.table_number ?? null, generation: raw?.bracket_generation ?? 0,
        players: m.players.map(p => ({id: p.id, name: p.name}))});
    });
  };

  // ---------------------------------------------------------------- connection
  const connection = () => {
    if (!s.signedIn) return 'signed-out';
    if (s.paused) return 'paused';
    if (!isOnline()) return 'offline';
    return now() - s.lastGoodAt > STALE_AFTER_MS ? 'stale' : 'live';
  };
  const canWrite = () => s.signedIn && !s.busy && connection() === 'live';

  function clearPrivate(reason = null) {
    s.snapshot = null; s.brief = null; s.pulse = null; s.desk = []; s.deskStatus = 'idle'; s.audit = null;
    rawDesk = new Map(); lastFullAt = 0;
    if (reason) s.endedReason = reason;
  }
  function endSession(kind) {
    s.signedIn = false; s.role = null; s.eventId = null; s.events = [];
    clearPrivate(kind === 'revoked' ? 'Your access ended. Sign in again if you should still have access.' : 'Your session ended. Sign in again.');
    scoreSession?.dispose(); scoreSession = null; syncScoreView();
    emit();
  }

  // ---------------------------------------------------------------- reading
  async function refresh({force = false} = {}) {
    if (!s.signedIn || s.paused) return false;
    if (refreshing) { queuedForce = queuedForce || force; return false; }
    refreshing = true;
    try {
      const out = await session.authorized(async ctx => {
        const pulse = await scoreTransport.readPulse(ctx.token, {eventId: ctx.eventId});
        const same = s.pulse && pulse.revision === s.pulse.revision && pulse.generation === s.pulse.generation
          && pulse.lifecycle === s.pulse.lifecycle;
        const needSnapshot = ctx.role === 'organizer' && !s.snapshot;
        const needDesk = pulse.lifecycle === 'active' && scoreSession && !UNRESOLVED.has(scoreSession.view.status)
          && scoreSession.view.status !== 'ready';
        if (!force && same && !needSnapshot && !needDesk && now() - lastFullAt < FULL_REFRESH_MS) return {pulse, unchanged: true, role: ctx.role};
        const res = {pulse, role: ctx.role};
        if (ctx.role === 'organizer') res.snapshot = await api.organizerSnapshot(ctx.token, {p_event_id: ctx.eventId});
        else res.brief = await api.eventBrief(ctx.token, {p_event_id: ctx.eventId});
        if (pulse.lifecycle === 'active') {
          if (scoreSession && !UNRESOLVED.has(scoreSession.view.status)) {
            await inScope(ctx, () => scoreSession.load());
            res.deskLoaded = true;
          }
        } else res.notActive = true;
        return res;
      }, {wait: false});
      s.lastGoodAt = now(); s.lastError = null; s.endedReason = null;
      s.pulse = out.pulse; s.role = out.role;
      if (!out.unchanged) {
        lastFullAt = now();
        if (out.snapshot) s.snapshot = out.snapshot;
        if (out.brief) s.brief = out.brief;
        if (out.notActive) { s.desk = []; s.deskStatus = 'not-active'; }
        else if (out.deskLoaded) {
          syncScoreView();
          if (scoreSession.view.status === 'ready') { mergeDesk(); s.deskStatus = 'ready'; }
          else s.deskStatus = 'denied';
        }
      }
      syncScoreView();
      emit();
      return true;
    } catch (e) {
      if (isSessionEnded(e)) { endSession(e.kind); return false; }
      if (e instanceof StaffSignInError && ['busy', 'locked'].includes(e.kind)) return false; // skipped tick
      s.lastError = describeError(e);
      emit();
      return false;
    } finally {
      refreshing = false;
      if (queuedForce) { queuedForce = false; void refresh({force: true}); }
    }
  }

  // ---------------------------------------------------------------- lifecycle
  async function started({role, eventId}) {
    s.signedIn = true; s.role = role; s.eventId = eventId; s.endedReason = null; s.paused = false;
    clearPrivate(); newScoreSession(eventId);
    s.pending = ledger.read(eventId);
    syncScoreView(); emit();
    await Promise.all([refresh({force: true}), loadEvents()]);
  }
  async function loadEvents() {
    try { s.events = await session.authorized(ctx => api.myEvents(ctx.token, {}), {wait: true}); emit(); }
    catch (e) { if (isSessionEnded(e)) endSession(e.kind); }
  }
  async function selectEvent(eventId) {
    try {
      const r = await session.selectEvent(eventId);
      s.eventId = r.eventId; s.role = r.role; clearPrivate(); newScoreSession(r.eventId);
      s.pending = ledger.read(r.eventId); syncScoreView(); emit();
      await refresh({force: true});
      return {ok: true};
    } catch (e) { if (isSessionEnded(e)) endSession(e.kind); return {ok: false, message: describeError(e)}; }
  }
  function pause() { s.paused = true; clearPrivate(); syncScoreView(); emit(); }
  async function resume() {
    if (!s.signedIn) return {ok: false};
    try { await session.resume(); } catch (e) {
      if (isSessionEnded(e)) { endSession(e.kind); return {ok: false}; }
      s.lastError = describeError(e); emit(); return {ok: false, retry: true};
    }
    s.paused = false; s.lastGoodAt = 0;
    await refresh({force: true});
    return {ok: true};
  }
  function signedOut() {
    s.signedIn = false; s.role = null; s.eventId = null; s.events = []; clearPrivate(); s.pending = null;
    scoreSession?.dispose(); scoreSession = null; syncScoreView(); emit();
  }

  // ---------------------------------------------------------------- guarded writes
  async function act(fn, {refreshAfter = true} = {}) {
    if (!canWrite()) {
      return {ok: false, message: connection() === 'live' ? 'One moment — another change is being saved.'
        : 'The connection is not confirmed, so changes are paused. Check the connection, or use the organizer fallback.'};
    }
    s.busy = true; emit();
    try {
      const res = await session.authorized(ctx => fn(ctx));
      if (refreshAfter) await refresh({force: true});
      return {ok: true, res};
    } catch (e) {
      if (isSessionEnded(e)) { endSession(e.kind); return {ok: false, message: describeError(e)}; }
      if (e instanceof GamedayApiError && (e.outcomeUnknown || e.kind === 'stale' || e.kind === 'not-found')) await refresh({force: true});
      return {ok: false, message: describeError(e), kind: e.kind ?? null, detail: e.detail ?? null};
    } finally { s.busy = false; emit(); }
  }
  const E = () => s.eventId;
  const organizerOnly = () => s.role === 'organizer';
  const actions = {
    updateEvent: (name, date, tables) => act(ctx => api.updateEvent(ctx.token, {p_event_id: E(), p_name: name, p_date: date, p_table_count: tables})),
    createEvent: async (name, date, tables) => {
      const r = await act(ctx => api.createEvent(ctx.token, {p_name: name, p_date: date, p_table_count: tables}), {refreshAfter: false});
      if (!r.ok) return r;
      await loadEvents();
      const sel = await selectEvent(r.res.event_id);
      return sel.ok ? {ok: true, res: r.res} : sel;
    },
    addPlayers: players => act(ctx => api.upsertPlayers(ctx.token, {p_event_id: E(), p_players: players})),
    updatePlayer: p => act(ctx => api.upsertPlayers(ctx.token, {p_event_id: E(), p_players: [{id: p.id, name: p.name, rating: p.rating, rating_status: p.ratingStatus}]})),
    removePlayer: id => act(ctx => api.removePlayer(ctx.token, {p_event_id: E(), p_player_id: id})),
    setCheckin: (id, v) => act(ctx => api.setCheckin(ctx.token, {p_event_id: E(), p_player_id: id, p_checked_in: v})),
    setCheckinAll: v => act(ctx => api.setCheckinBulk(ctx.token, {p_event_id: E(), p_player_ids: null, p_checked_in: v})),
    buildChampionship: ({confirm = false} = {}) => {
      const snap = s.snapshot;
      if (!snap) return Promise.resolve({ok: false, message: 'Still loading. Try again in a moment.'});
      const field = snap.players.filter(p => p.checkedIn);
      if (field.length < 2) return Promise.resolve({ok: false, message: 'Check in at least two players first.'});
      const slots = seedSlots(enginePlayers(snap.players.filter(p => p.checkedIn).map(p => ({id: p.id, name: p.name, rating: p.rating, rating_status: p.ratingStatus}))));
      return act(ctx => api.buildChampionship(ctx.token, {p_event_id: E(), p_slots: slots, p_expected_generation: snap.event.generation, p_confirm: confirm}));
    },
    buildConsolation: ({entrantIds = null, confirm = false} = {}) => {
      const snap = s.snapshot;
      if (!snap) return Promise.resolve({ok: false, message: 'Still loading. Try again in a moment.'});
      const ids = entrantIds ?? snap.candidates.map(c => c.playerId);
      if (ids.length < 2) return Promise.resolve({ok: false, message: 'At least two first-match losers are needed.'});
      const byId = new Map(snap.players.map(p => [p.id, p]));
      const slots = seedSlots(enginePlayers(ids.map(id => byId.get(id)).filter(Boolean).map(p => ({id: p.id, name: p.name, rating: p.rating, rating_status: p.ratingStatus}))));
      return act(ctx => api.buildConsolation(ctx.token, {p_event_id: E(), p_slots: slots, p_expected_generation: snap.event.generation, p_confirm: confirm}));
    },
    assignTable: (matchId, table) => act(ctx => api.assignTable(ctx.token, {p_event_id: E(), p_match_id: matchId, p_table_number: table})),
    forfeit: (matchId, version, absentId, reason) => act(ctx => api.forfeitMatch(ctx.token, {p_event_id: E(), p_match_id: matchId, p_expected_match_version: version, p_absent_player_id: absentId, p_reason: reason})),
    correct: (matchId, version, winnerId, scores, reason) => act(ctx => api.correctResult(ctx.token, {p_event_id: E(), p_match_id: matchId, p_expected_match_version: version, p_winner_id: winnerId, p_game_scores: scores, p_reason: reason})),
    setDoublesTeams: (p1, p2) => act(ctx => api.setDoublesTeams(ctx.token, {p_event_id: E(), p_partner_1: p1, p_partner_2: p2})),
    recordDoubles: (team, scores) => act(ctx => api.recordDoublesResult(ctx.token, {p_event_id: E(), p_winner_team: team, p_game_scores: scores})),
    setVisibility: v => act(ctx => api.setVisibility(ctx.token, {p_event_id: E(), p_visible: v})),
    setLifecycle: l => act(ctx => api.setLifecycle(ctx.token, {p_event_id: E(), p_lifecycle: l})),
    setStaff: (email, action, role) => act(ctx => api.setStaff(ctx.token, {p_event_id: E(), p_email: email, p_action: action, p_role: action === 'revoke' ? null : role})),
    async loadAudit() { const r = await act(async ctx => { s.audit = await api.auditLog(ctx.token, {p_event_id: E(), p_limit: 100}); }, {refreshAfter: false}); emit(); return r; },
    async exportEvent() {
      if (!isOnline()) return {ok: false, message: 'You appear to be offline. Nothing was sent.'};
      try { return {ok: true, data: await session.authorized(ctx => api.exportEvent(ctx.token, {p_event_id: E()}))}; }
      catch (e) { if (isSessionEnded(e)) endSession(e.kind); return {ok: false, message: describeError(e)}; }
    },
  };

  // ---------------------------------------------------------------- scoring
  /** Validate and stage a score. Nothing is sent until confirmScore(). */
  function prepareScore({matchId, winnerId, games, table}) {
    if (!canWrite()) return {ok: false, message: 'The connection is not confirmed, so scoring is paused.'};
    if (!scoreSession || scoreSession.view.status !== 'ready') return {ok: false, message: 'The Match Desk is refreshing. Try again in a moment.'};
    const row = s.desk.find(m => m.matchId === matchId);
    if (!row) return {ok: false, message: 'That match is no longer waiting for a result.'};
    const best = bestOf(row.bracket, row.isFinal, {regular_best_of: 3, final_best_of: 5});
    const p1Won = winnerId === row.players[0].id;
    const norm = normalizeGameScores(games, best, p1Won);
    if (!norm.ok) return {ok: false, message: norm.error};
    if (norm.text === '') return {ok: false, message: 'Enter the game scores so the result can be checked.'};
    const tableNumber = Number(table ?? row.table ?? 1);
    if (!Number.isSafeInteger(tableNumber) || tableNumber < 1 || tableNumber > (s.snapshot?.event.tables ?? s.brief?.tables ?? 12)) {
      return {ok: false, message: 'Choose a valid table.'};
    }
    try {
      const prepared = scoreSession.prepareScore({matchId, winnerId, gameScores: norm.text, tableNumber});
      syncScoreView(); emit();
      return {ok: true, submissionId: prepared.submissionId, text: norm.text, row, tableNumber, winnerId};
    } catch { return {ok: false, message: 'That score could not be staged. Refresh and try again.'}; }
  }
  function cancelPreparedScore() {
    if (scoreSession?.view.status === 'prepared') { try { scoreSession.discardPrepared(); } catch { /* nothing staged */ } }
    syncScoreView(); emit();
    void refresh({force: true});
  }
  /** The deliberate confirmation: record the incident durably, send ONCE, then look the decision up. */
  async function confirmScore({submissionId, row, text, tableNumber, winnerId}) {
    if (!scoreSession || scoreSession.view.status !== 'prepared') return {ok: false, message: 'Nothing is staged to send.'};
    const rec = {submissionId, matchId: row.matchId, code: row.code, scores: text, table: tableNumber, winnerId,
      generation: row.generation, expectedVersion: row.version, at: now()};
    if (!ledger.write(s.eventId, rec)) {
      cancelPreparedScore();
      return {ok: false, message: 'This device cannot keep a safety record of the score, so it was not sent. Use a different browser or ask the organizer.'};
    }
    s.pending = rec; s.busy = true; emit();
    try {
      try {
        await session.authorized(ctx => inScope(ctx, () => scoreSession.submitPrepared({submissionId, manualIncidentLogConfirmed: true})));
      } catch (e) { if (isSessionEnded(e)) { endSession(e.kind); return {ok: false, unknown: true, message: 'Your session ended while sending. Sign in and check the score before entering it again.'}; } }
      syncScoreView();
      return await resolveScoreOutcome();
    } finally { s.busy = false; emit(); }
  }
  async function resolveScoreOutcome() {
    const st = scoreSession?.view.status;
    if (st === 'needs-own-receipt' || st === 'unknown') {
      try { await session.authorized(ctx => inScope(ctx, () => scoreSession.inspectOwnDecision())); }
      catch (e) { if (isSessionEnded(e)) { endSession(e.kind); return {ok: false, unknown: true, message: 'Your session ended. Sign in and check the score before entering it again.'}; } }
      syncScoreView();
    }
    const view = scoreSession?.view;
    if (view?.status === 'confirmed-accepted' || view?.status === 'confirmed-rejected') {
      const accepted = view.status === 'confirmed-accepted';
      scoreSession.acknowledgeAndReset(); ledger.clear(s.eventId); s.pending = null; syncScoreView();
      s.lastScoreMessage = accepted ? 'Score saved.' : 'Someone else had already recorded that match, so your score was NOT used. The Match Desk now shows the current state.';
      await refresh({force: true});
      return {ok: accepted, rejected: !accepted, message: s.lastScoreMessage};
    }
    emit();
    return {ok: false, unknown: true, message: 'We could not confirm what the server recorded. Do not enter it again yet — press "Check what the server recorded".'};
  }
  /** Look up the server's own record of the unresolved score (works after a reload too). */
  async function checkPendingScore() {
    const rec = s.pending;
    if (!rec) return {ok: true, message: 'Nothing is waiting to be checked.'};
    if (scoreSession && scoreSession.view.pendingSubmissionId === rec.submissionId && UNRESOLVED.has(scoreSession.view.status)) {
      s.busy = true; emit();
      try { return await resolveScoreOutcome(); } finally { s.busy = false; emit(); }
    }
    // after a reload the in-memory score session is gone: ask the server for this exact receipt
    try {
      const snap = await session.authorized(ctx => scoreTransport.readOwnSnapshot(ctx.token, {eventId: s.eventId, submissionId: rec.submissionId}));
      const d = snap.decision;
      if (d && d.matchId === rec.matchId && d.id === rec.submissionId) {
        ledger.clear(s.eventId); s.pending = null; emit();
        await refresh({force: true});
        return d.status === 'accepted' ? {ok: true, message: 'The server did record that score.'}
          : {ok: false, rejected: true, message: 'The server rejected it — someone else had already recorded that match.'};
      }
      return {ok: false, unknown: true, message: 'The server has no record of that score yet. If it was sent only moments ago, wait a minute and check again. If you are sure it was never sent, dismiss this notice and enter it again.'};
    } catch (e) {
      if (isSessionEnded(e)) endSession(e.kind);
      return {ok: false, unknown: true, message: describeError(e)};
    }
  }
  /** The person has verified with the organizer; forget the incident (the server's expected-version check
   * still prevents a double application if the old request ever lands). */
  function dismissPendingScore() {
    ledger.clear(s.eventId); s.pending = null;
    if (s.eventId) newScoreSession(s.eventId);
    syncScoreView(); emit();
    void refresh({force: true});
  }

  return Object.freeze({
    get state() { return s; },
    connection, canWrite, refresh, started, selectEvent, loadEvents, pause, resume, signedOut, endSession,
    actions, prepareScore, cancelPreparedScore, confirmScore, checkPendingScore, dismissPendingScore,
    organizerOnly,
  });
}
