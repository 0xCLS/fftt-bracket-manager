/** Test-only: a fake Google (OAuth token endpoint + Sheets API, read-only) so the registration adapter's Google paths run in
 * browser and integration tests with NO network and NO real credentials. The key pair is generated per run and verifies the
 * adapter's signed assertion. Fictional spreadsheets only. It throws on the fetch options the Cloudflare runtime rejects. */
import crypto from 'node:crypto';

const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
export const FAKE_SA = 'fftt-reader@fftt-synthetic-project.iam.gserviceaccount.com';
export const fakeGoogleEnv = Object.freeze({GOOGLE_SA_EMAIL: FAKE_SA, GOOGLE_SA_PRIVATE_KEY: privateKey});
export const GOOGLE_HOSTS = ['oauth2.googleapis.com', 'sheets.googleapis.com'];

/** sheets: {spreadsheetId: {title, tabs: {tabName: rows[][]}, shared: boolean}} */
export function createFakeGoogle({sheets}) {
  const calls = [];
  let issued = 0;
  const res = (status, body) => ({status, headers: {get: () => null}, json: async () => body});
  async function fetch(url, init = {}) {
    const u = new URL(url), method = init.method ?? 'GET';
    calls.push({method, host: u.host, path: decodeURIComponent(u.pathname)});
    if (init.redirect === 'error' || 'cache' in init) throw new TypeError('option not supported by this runtime');
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      const form = new URLSearchParams(init.body);
      const [h, c, s] = String(form.get('assertion')).split('.');
      if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s ?? '', 'base64url'))) return res(400, {});
      issued++;
      return res(200, {access_token: 'ya29.fake-' + issued, token_type: 'Bearer', expires_in: 3600});
    }
    if (u.host !== 'sheets.googleapis.com' || method !== 'GET') throw new Error('unexpected Google request ' + method + ' ' + url);
    if (!String(init.headers?.Authorization).startsWith('Bearer ya29.fake-')) return res(401, {});
    const m = /^\/v4\/spreadsheets\/([^/]+)(?:\/values\/(.+))?$/.exec(u.pathname);
    const sheet = sheets[m?.[1]];
    if (!sheet) return res(404, {});
    if (!sheet.shared) return res(403, {error: {message: 'The caller does not have permission'}});
    if (!m[2]) return res(200, {properties: {title: sheet.title}, sheets: Object.keys(sheet.tabs).map((t, i) => ({properties: {sheetId: i, title: t}}))});
    const tab = /^'((?:[^']|'')+)'!(.+)$/.exec(decodeURIComponent(m[2]));
    const rows = sheet.tabs[tab?.[1].replaceAll("''", "'")];
    if (!rows) return res(400, {error: {message: 'Unable to parse range'}});
    if (tab[2] === 'A1:BH1') return res(200, {values: rows.slice(0, 1)});
    if (tab[2].startsWith('A2:A')) return res(200, {values: [rows.slice(1).map(r => r[0]).filter(x => x !== '')]});
    return res(200, {values: rows});
  }
  return {fetch, calls, sheets};
}
