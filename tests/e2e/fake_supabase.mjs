/** Test-only fake Supabase: GoTrue-shaped auth endpoints + PostgREST-shaped RPC/view endpoints over the REAL
 * FFTT SQL running in PGlite (see localdb.mjs). Exposes a fetch-compatible function so the real client code
 * (transports, session, core, spectator) runs unmodified. Fictional accounts only; never a network service.
 *
 * Auth model (what the clients rely on): password grant, rotating single-use refresh tokens (reuse kills the
 * family), /user, logout scopes, global sign-out, disabled users, per-sign-in rate limit, e-mail OTP codes.
 * Fault injection: per-client offline switch, one-shot forced status per path, added latency, and a
 * "swallow response" mode that executes a request on the server but loses the reply (a lost acknowledgment).
 */
import {createLocalDb, RpcError} from './localdb.mjs';

export const PROJECT = 'https://copmkalfkkrkzheohwuc.supabase.co';
export const PUBLISHABLE = 'sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0';
const TABLE_FUNCTIONS = new Set(['fftt_matchdesk_v1', 'fftt_matchdesk_v2']);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

export async function createFakeSupabase({ttlSeconds = 3600, now = () => Date.now(), upgraded = undefined} = {}) {
  const local = await createLocalDb(upgraded === undefined ? {} : {upgraded});
  const accounts = new Map();   // email -> {id, password, disabled, signedOutBefore}
  const byId = new Map();
  const families = new Map();   // familyId -> {userId, current, revoked, created}
  const accessTokens = new Map(); // token -> {userId, family, exp}
  const codes = new Map();      // email -> code
  const log = [];
  const hooks = {offline: new Set(), forced: new Map(), delayMs: 0, swallow: new Map(), signInAttempts: new Map()};
  let seq = 0;

  const json = (status, body, headers = {}) => ({status, headers, body});
  const issue = (userId, family) => {
    const fam = families.get(family);
    const exp = Math.floor(now() / 1000) + ttlSeconds;
    const access = `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub: userId, role: 'authenticated', exp, sid: family, n: ++seq})}.${b64({s: seq})}`;
    const refresh = `r${family}-${++seq}-${Math.random().toString(36).slice(2, 10)}`;
    fam.current = refresh;
    accessTokens.set(access, {userId, family, exp});
    return {access_token: access, token_type: 'bearer', expires_in: ttlSeconds, refresh_token: refresh, user: {id: userId}};
  };
  const userFromBearer = req => {
    const auth = req.headers.authorization ?? req.headers.Authorization ?? '';
    if (!auth.startsWith('Bearer ')) return null;
    const tok = auth.slice(7);
    if (tok === PUBLISHABLE) return null;
    const a = accessTokens.get(tok);
    if (!a || a.exp * 1000 <= now()) return undefined; // present but invalid
    const fam = families.get(a.family);
    const acct = byId.get(a.userId);
    if (!fam || fam.revoked || !acct || acct.disabled) return undefined;
    if (fam.created < acct.signedOutBefore) return undefined;
    return a.userId;
  };

  async function handle(clientId, url, init = {}) {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const req = {headers};
    const body = init.body ? JSON.parse(init.body) : null;
    const key = u.pathname + (u.search.startsWith('?grant_type') || u.search.startsWith('?scope') ? u.search : '');
    log.push({client: clientId, method, path: u.pathname, search: u.search, at: now()});
    if (u.origin !== PROJECT) return json(404, {message: 'unknown host'});
    if (headers.apikey !== PUBLISHABLE) return json(401, {message: 'No API key found in request'});
    const forced = hooks.forced.get(clientId + '|' + u.pathname);
    if (forced) { hooks.forced.delete(clientId + '|' + u.pathname); return json(forced.status, forced.body ?? {}, forced.headers ?? {}); }

    // ---------------- GoTrue
    if (u.pathname === '/auth/v1/token' && u.search === '?grant_type=password') {
      const n = (hooks.signInAttempts.get(clientId) ?? 0) + 1;
      hooks.signInAttempts.set(clientId, n);
      if (n > 30) return json(429, {message: 'rate limited'}, {'retry-after': '30'});
      const a = accounts.get(String(body?.email ?? '').toLowerCase());
      if (!a || a.disabled || a.password !== body?.password) return json(400, {error: 'invalid_grant'});
      hooks.signInAttempts.set(clientId, 0);
      const family = 'f' + (++seq);
      families.set(family, {userId: a.id, current: null, revoked: false, created: now(), used: new Set()});
      return json(200, issue(a.id, family));
    }
    if (u.pathname === '/auth/v1/token' && u.search === '?grant_type=refresh_token') {
      for (const [id, f] of families) {
        if (f.current === body?.refresh_token && !f.revoked) {
          const acct = byId.get(f.userId);
          if (acct.disabled || f.created < acct.signedOutBefore) return json(400, {error: 'invalid_grant'});
          f.used.add(body.refresh_token);
          return json(200, issue(f.userId, id));
        }
        if (f.used.has(body?.refresh_token)) { f.revoked = true; return json(400, {error: 'invalid_grant'}); }
      }
      return json(400, {error: 'invalid_grant'});
    }
    if (u.pathname === '/auth/v1/user') {
      const id = userFromBearer(req);
      if (!id) return json(401, {message: 'invalid JWT'});
      return json(200, {id, aud: 'authenticated', role: 'authenticated', is_anonymous: false});
    }
    if (u.pathname === '/auth/v1/logout') {
      const tok = (headers.authorization ?? '').slice(7);
      const a = accessTokens.get(tok);
      if (!a) return json(401, {message: 'invalid JWT'});
      if (u.searchParams.get('scope') === 'global') { for (const f of families.values()) if (f.userId === a.userId) f.revoked = true; }
      else families.get(a.family).revoked = true;
      return {status: 204, headers: {}, body: null};
    }
    if (u.pathname === '/auth/v1/otp') {
      const email = String(body?.email ?? '').toLowerCase();
      if (accounts.has(email) && !accounts.get(email).disabled) codes.set(email, String(100000 + Math.floor(Math.random() * 899999)));
      return json(200, {});
    }
    if (u.pathname === '/auth/v1/verify') {
      const email = String(body?.email ?? '').toLowerCase();
      if (codes.get(email) && codes.get(email) === body?.token) {
        codes.delete(email);
        const a = accounts.get(email);
        const family = 'f' + (++seq);
        families.set(family, {userId: a.id, current: null, revoked: false, created: now(), used: new Set()});
        return json(200, issue(a.id, family));
      }
      return json(400, {error: 'invalid_grant'});
    }

    // ---------------- PostgREST
    if (u.pathname === '/rest/v1/fftt_public_tournament_v1' && method === 'GET') {
      const rows = await local.publicTournaments();
      return json(200, JSON.parse(JSON.stringify(rows, (k, v) => typeof v === 'bigint' ? Number(v) : v)));
    }
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
    if (m && method === 'POST') {
      const userId = userFromBearer(req);
      if (userId === undefined) return json(401, {message: 'JWT expired', code: 'PGRST301'});
      if (userId === null) return json(401, {message: 'permission denied for function', code: '42501'});
      try {
        const fn = m[1];
        const result = await local.rpc(userId, fn, body ?? {}, {rows: TABLE_FUNCTIONS.has(fn)});
        return json(200, JSON.parse(JSON.stringify(result, (k, v) => typeof v === 'bigint' ? Number(v) : v)));
      } catch (e) {
        if (e instanceof RpcError) {
          const status = e.code === '42501' ? 403 : e.code === '42883' ? 404 : 400;
          return json(status, {code: e.code, message: e.message, details: e.detail || null, hint: null});
        }
        return json(500, {message: 'internal error'});
      }
    }
    return json(404, {message: 'not found'});
  }

  /** Fault-injecting dispatch shared by the headless fetch and the browser route handler.
   * Returns {abort:true} when the network should fail, else {out}. */
  async function dispatch(clientId, url, init = {}) {
    if (hooks.offline.has(clientId)) return {abort: true};
    if (hooks.delayMs) await new Promise(r => setTimeout(r, hooks.delayMs));
    const out = await handle(clientId, String(url), init);
    // a lost acknowledgment: the server did the work, the reply never arrives
    const swallow = hooks.swallow.get(clientId);
    if (swallow && new URL(String(url)).pathname.endsWith(swallow.path)) {
      if (--swallow.count <= 0) hooks.swallow.delete(clientId);
      return {abort: true, executed: true};
    }
    return {out};
  }
  function clientFetch(clientId = 'anon') {
    return async (url, init = {}) => {
      const d = await dispatch(clientId, url, init);
      if (d.abort) throw new TypeError('Failed to fetch');
      const out = d.out;
      return {
        status: out.status, ok: out.status >= 200 && out.status < 300,
        headers: {get: k => out.headers[String(k).toLowerCase()] ?? null},
        json: async () => { if (out.body === null) throw new SyntaxError('no body'); return out.body; },
      };
    };
  }

  return {
    local, log, hooks, handle, dispatch, clientFetch,
    PROJECT, PUBLISHABLE,
    /** Trusted administrative creation (what the owner does in the dashboard / SQL editor). */
    async addAccount(email, password, {platformOrganizer = false} = {}) {
      const id = await local.addUser(email, {platformOrganizer});
      const a = {id, password, disabled: false, signedOutBefore: 0};
      accounts.set(email.toLowerCase(), a); byId.set(id, a);
      return id;
    },
    disableAccount(email) { accounts.get(email.toLowerCase()).disabled = true; },
    revokeSessions(email) { accounts.get(email.toLowerCase()).signedOutBefore = now() + 1; },
    setOffline(clientId, v) { v ? hooks.offline.add(clientId) : hooks.offline.delete(clientId); },
    failNext(clientId, path, status, body, headers) { hooks.forced.set(clientId + '|' + path, {status, body, headers}); },
    loseNextReply(clientId, path, count = 1) { hooks.swallow.set(clientId, {path, count}); },
    emailedCode: email => codes.get(email.toLowerCase()) ?? null,
    requests: (clientId, path) => log.filter(l => l.client === clientId && (!path || l.path === path)).length,
  };
}
