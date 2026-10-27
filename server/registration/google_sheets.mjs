/** Read-only Google Sheets reader for ANY spreadsheet an organizer has shared with the service account. SERVER-SIDE ONLY.
 *
 * The service-account private key exists only in the server environment (Cloudflare Pages Function secrets). It is never
 * sent to a browser, never logged, never part of any static bundle (the export builder refuses `server/` and `functions/`
 * and a test scans every shipped file for key material).
 *
 * The spreadsheet and worksheet are PARAMETERS of each call (they come from the event's saved registration source, read
 * from the database under the caller's own token), not deployment settings, so each tournament can use its own sheet
 * without redeploying. Authorization: OAuth2 JWT-bearer grant with the single scope `spreadsheets.readonly`; a sheet is
 * readable only if it was explicitly shared with the service account. The only requests this module can make are
 * (1) POST the signed assertion to Google's token endpoint and (2) GET spreadsheet metadata / one range of values. Hosts
 * are pinned by edge_fetch; there is no write call anywhere in this file. */
import {SPREADSHEET_ID, parseSpreadsheetRef, validWorksheetTitle} from '../../contracts/registration_source.mjs';
export {SPREADSHEET_ID, parseSpreadsheetRef, validWorksheetTitle};
export class RegistrationSourceError extends Error {
  constructor(kind, {retryAfterSeconds = null} = {}) {
    super('Registration source ' + kind);
    this.name = 'RegistrationSourceError';
    this.kind = ['not-configured', 'unauthorized', 'not-found', 'worksheet-not-found', 'busy', 'unavailable', 'malformed', 'invalid-source', 'columns', 'google-auth', 'disabled', 'not-allowed', 'event-not-enabled'].includes(kind) ? kind : 'unavailable';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_ORIGIN = 'https://sheets.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SA_EMAIL = /^[a-z0-9-]{6,30}@[a-z0-9-]{6,30}\.iam\.gserviceaccount\.com$/;
const MAX_ROWS = 5000, MAX_COLS = 60;
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textB64url = t => b64url(new TextEncoder().encode(t));
/** A1 notation for a whole-tab range: the tab name is quoted and its apostrophes doubled. */
export const tabRange = (title, a1) => `'${title.replaceAll("'", "''")}'!${a1}`;

function pemToDer(pem) {
  const body = String(pem).replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  if (!/^[A-Za-z0-9+/=]{200,}$/.test(body)) throw new RegistrationSourceError('not-configured');
  return Uint8Array.from(atob(body), c => c.charCodeAt(0));
}

export function createGoogleSheetsReader({serviceAccountEmail, privateKeyPem, fetchImpl, now = () => Date.now()} = {}) {
  if (!SA_EMAIL.test(serviceAccountEmail ?? '') || typeof fetchImpl !== 'function' || typeof privateKeyPem !== 'string' || !privateKeyPem.includes('BEGIN PRIVATE KEY')) {
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
      res = await fetchImpl(TOKEN_URL, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}`}).toString()});
    } catch { throw new RegistrationSourceError('unavailable'); }
    // the connection account itself could not sign in (bad/revoked key, disabled account): not a sharing problem
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new RegistrationSourceError('google-auth');
    if (res.status === 429) throw new RegistrationSourceError('busy', {retryAfterSeconds: 30});
    if (res.status !== 200) throw new RegistrationSourceError('unavailable');
    let j;
    try { j = await res.json(); } catch { throw new RegistrationSourceError('malformed'); }
    if (typeof j?.access_token !== 'string' || j.token_type !== 'Bearer' || !Number.isFinite(j.expires_in)) throw new RegistrationSourceError('malformed');
    cached = {token: j.access_token, expiresAt: now() + Math.min(3000, j.expires_in) * 1000};
    return cached.token;
  }

  async function get(path, {worksheetRange = false} = {}) {
    const token = await accessToken();
    let res;
    try { res = await fetchImpl(SHEETS_ORIGIN + path, {method: 'GET', headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'}}); }
    catch { throw new RegistrationSourceError('unavailable'); }
    if (res.status === 401) { cached = null; throw new RegistrationSourceError('unauthorized'); }
    if (res.status === 403) throw new RegistrationSourceError('unauthorized');           // not shared with the service account
    if (res.status === 404) throw new RegistrationSourceError('not-found');
    if (res.status === 400) throw new RegistrationSourceError(worksheetRange ? 'worksheet-not-found' : 'not-found');
    if (res.status === 429) throw new RegistrationSourceError('busy', {retryAfterSeconds: 30});
    if (res.status !== 200) throw new RegistrationSourceError('unavailable');
    try { return await res.json(); } catch { throw new RegistrationSourceError('malformed'); }
  }
  const idOrThrow = id => { if (typeof id !== 'string' || !SPREADSHEET_ID.test(id)) throw new RegistrationSourceError('invalid-source'); return id; };
  const cells = r => r.map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''));

  return Object.freeze({
    serviceAccountEmail,
    /** Signs in to Google (cached): the first step of the connection test. */
    async authenticate() { await accessToken(); return true; },
    /** Spreadsheet title and worksheet (tab) titles: metadata only, no cell values. */
    async info(spreadsheetId) {
      const id = idOrThrow(spreadsheetId);
      const j = await get(`/v4/spreadsheets/${encodeURIComponent(id)}?fields=${encodeURIComponent('properties.title,sheets.properties(sheetId,title,hidden)')}`);
      if (typeof j?.properties?.title !== 'string' || !Array.isArray(j.sheets) || j.sheets.length > 200) throw new RegistrationSourceError('malformed');
      const worksheets = j.sheets.map(s => s?.properties).filter(p => p && validWorksheetTitle(p.title)).map(p => Object.freeze({title: p.title, hidden: p.hidden === true}));
      return Object.freeze({title: j.properties.title.slice(0, 200), worksheets: Object.freeze(worksheets)});
    },
    /** Rows of one worksheet (arrays of strings, header row first). `headerOnly` reads just row 1. */
    async readRows(spreadsheetId, worksheet, {headerOnly = false} = {}) {
      const id = idOrThrow(spreadsheetId);
      if (!validWorksheetTitle(worksheet)) throw new RegistrationSourceError('invalid-source');
      const range = tabRange(worksheet, headerOnly ? 'A1:BH1' : `A1:BH${MAX_ROWS}`);
      const j = await get(`/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, {worksheetRange: true});
      if (!Array.isArray(j?.values) || j.values.length > MAX_ROWS || !j.values.every(r => Array.isArray(r) && r.length <= MAX_COLS)) throw new RegistrationSourceError('malformed');
      return j.values.map(cells);
    },
    /** Number of non-empty cells in column A below the header (the timestamp column of a Google Form): a response count
     * without reading any answer. */
    async countResponses(spreadsheetId, worksheet) {
      const id = idOrThrow(spreadsheetId);
      if (!validWorksheetTitle(worksheet)) throw new RegistrationSourceError('invalid-source');
      const j = await get(`/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(tabRange(worksheet, `A2:A${MAX_ROWS}`))}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`, {worksheetRange: true});
      const col = Array.isArray(j?.values) ? j.values[0] : [];
      if (col !== undefined && !Array.isArray(col)) throw new RegistrationSourceError('malformed');
      return (col ?? []).filter(c => c !== '' && c !== null && c !== undefined).length;
    },
  });
}

/** Opaque, stable, non-reversible reference for one registration row (HMAC-SHA256, keyed with a server secret).
 * `scope` MUST contain the event AND the spreadsheet, so the same person in two events or two sheets never collides. */
export function createRefMaker(secret, scope) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof scope !== 'string' || scope.length < 3) throw new RegistrationSourceError('not-configured');
  const keyP = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return async identity => b64url(await crypto.subtle.sign('HMAC', await keyP, new TextEncoder().encode(`fftt-reg-v2|${scope}|${identity}`))).slice(0, 32);
}
