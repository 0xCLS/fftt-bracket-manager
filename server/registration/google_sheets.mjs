/** Read-only Google Sheets reader for the organizer's PRIVATE registration sheet. SERVER-SIDE ONLY.
 *
 * The service-account private key exists only in the server environment (a Cloudflare Pages Function secret).
 * It is never sent to a browser, never logged, never part of any static bundle (the build refuses `server/`
 * and `functions/` in a browser export, and a test checks every shipped file for key material).
 *
 * Authorization: OAuth2 JWT-bearer grant with the single scope `spreadsheets.readonly`. The only requests this
 * module can make are (1) POST the signed assertion to Google's token endpoint and (2) GET one range of values
 * from one spreadsheet. Hosts are pinned; there is no write call anywhere in this file.
 */
export class RegistrationSourceError extends Error {
  constructor(kind, {retryAfterSeconds = null} = {}) {
    super('Registration source ' + kind);
    this.name = 'RegistrationSourceError';
    this.kind = ['not-configured', 'unauthorized', 'not-found', 'busy', 'unavailable', 'malformed'].includes(kind) ? kind : 'unavailable';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_ORIGIN = 'https://sheets.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEET_ID = /^[A-Za-z0-9_-]{20,100}$/;
const RANGE = /^[A-Za-z0-9 _.'!:$-]{1,100}$/;
const SA_EMAIL = /^[a-z0-9-]{6,30}@[a-z0-9-]{6,30}\.iam\.gserviceaccount\.com$/;
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textB64url = t => b64url(new TextEncoder().encode(t));

function pemToDer(pem) {
  const body = String(pem).replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  if (!/^[A-Za-z0-9+/=]{200,}$/.test(body)) throw new RegistrationSourceError('not-configured');
  const bin = atob(body);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function createGoogleSheetsReader({serviceAccountEmail, privateKeyPem, sheetId, range, fetchImpl, now = () => Date.now()} = {}) {
  if (!SA_EMAIL.test(serviceAccountEmail ?? '') || !SHEET_ID.test(sheetId ?? '') || !RANGE.test(range ?? '')
    || typeof fetchImpl !== 'function' || typeof privateKeyPem !== 'string' || !privateKeyPem.includes('BEGIN PRIVATE KEY')) {
    throw new RegistrationSourceError('not-configured');
  }
  let keyPromise = null, cached = null;
  const key = () => keyPromise ??= crypto.subtle.importKey('pkcs8', pemToDer(privateKeyPem),
    {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']).catch(() => { keyPromise = null; throw new RegistrationSourceError('not-configured'); });

  async function accessToken() {
    if (cached && cached.expiresAt - now() > 60_000) return cached.token;
    const iat = Math.floor(now() / 1000);
    const head = textB64url(JSON.stringify({alg: 'RS256', typ: 'JWT'}));
    const claims = textB64url(JSON.stringify({iss: serviceAccountEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3000}));
    const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await key(), new TextEncoder().encode(`${head}.${claims}`)));
    let res;
    try {
      res = await fetchImpl(TOKEN_URL, {method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}`}).toString()});
    } catch { throw new RegistrationSourceError('unavailable'); }
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new RegistrationSourceError('unauthorized');
    if (res.status === 429) throw new RegistrationSourceError('busy', {retryAfterSeconds: 30});
    if (res.status !== 200) throw new RegistrationSourceError('unavailable');
    let j;
    try { j = await res.json(); } catch { throw new RegistrationSourceError('malformed'); }
    if (typeof j?.access_token !== 'string' || j.token_type !== 'Bearer' || !Number.isFinite(j.expires_in)) throw new RegistrationSourceError('malformed');
    cached = {token: j.access_token, expiresAt: now() + Math.min(3000, j.expires_in) * 1000};
    return cached.token;
  }

  return Object.freeze({
    /** One GET of the configured range; returns rows (arrays of strings), header row first. */
    async readRows() {
      const token = await accessToken();
      const url = `${SHEETS_ORIGIN}/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
      let res;
      try { res = await fetchImpl(url, {method: 'GET', redirect: 'error', headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'}}); }
      catch { throw new RegistrationSourceError('unavailable'); }
      if (res.status === 401) { cached = null; throw new RegistrationSourceError('unauthorized'); }
      if (res.status === 403) throw new RegistrationSourceError('unauthorized');   // the sheet is not shared with the service account
      if (res.status === 404 || res.status === 400) throw new RegistrationSourceError('not-found');
      if (res.status === 429) throw new RegistrationSourceError('busy', {retryAfterSeconds: 30});
      if (res.status !== 200) throw new RegistrationSourceError('unavailable');
      let j;
      try { j = await res.json(); } catch { throw new RegistrationSourceError('malformed'); }
      if (!Array.isArray(j?.values) || j.values.length > 5000 || !j.values.every(r => Array.isArray(r) && r.length <= 60)) throw new RegistrationSourceError('malformed');
      return j.values.map(r => r.map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')));
    },
  });
}

/** Opaque, stable, non-reversible reference for one registration row (HMAC-SHA256, keyed with a server secret). */
export function createRefMaker(secret, scope) {
  if (typeof secret !== 'string' || secret.length < 32) throw new RegistrationSourceError('not-configured');
  const keyP = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return async identity => b64url(await crypto.subtle.sign('HMAC', await keyP, new TextEncoder().encode(`fftt-reg-v1|${scope}|${identity}`))).slice(0, 32);
}
