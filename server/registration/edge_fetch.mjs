/** The ONLY way server-side registration code makes an outbound request.
 *
 * 1. Cloudflare Workers/Pages Functions run on workerd, which THROWS on `redirect: 'error'` ("won't be implemented")
 *    and on any `cache` option. The first deployed version used both, so every upstream call threw and registrations
 *    never loaded ("could not be read right now"); mocked tests could not see it. Only options that workerd accepts are
 *    passed here, redirects are never followed (`manual`; a 3xx is simply a failed call), and the test suite runs the
 *    server code against a double that throws exactly as workerd does (tests/workers_runtime_fetch.mjs).
 * 2. Controlled egress: https only, no credentials in the URL, no port, and a fixed host allowlist (the pinned Supabase
 *    project and the two Google API hosts). Nothing a request body can say makes the server contact another host. */
export const EDGE_HOSTS = Object.freeze(['copmkalfkkrkzheohwuc.supabase.co', 'oauth2.googleapis.com', 'sheets.googleapis.com']);

export class EgressBlockedError extends TypeError {
  constructor() { super('Outbound request blocked'); this.name = 'EgressBlockedError'; }
}

export function createEdgeFetch(fetchImpl, {hosts = EDGE_HOSTS} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch required');
  const allowed = new Set(hosts);
  return async function edgeFetch(url, init = {}) {
    let u;
    try { u = new URL(String(url)); } catch { throw new EgressBlockedError(); }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !allowed.has(u.hostname)) throw new EgressBlockedError();
    const safe = {method: init.method ?? 'GET', headers: init.headers ?? {}, redirect: 'manual'};
    if (init.body !== undefined) safe.body = init.body;
    return fetchImpl(u.href, safe);
  };
}
