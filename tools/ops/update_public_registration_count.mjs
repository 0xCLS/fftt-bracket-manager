/**
 * Hourly, read-only publisher: private FFTT3 Google Sheet -> public count-only JSON.
 * Never log or write registration names or answers.
 */
import {sign} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const EVENT_DATE = '2026-11-22';
const SNAPSHOT = 'public-site/data/registration-count.json';
const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ').replace(/[’']/g,'');
export function canonicalName(value) {
  const name = normalize(value);
  if (name === 'michael a smith') return 'michael smith';
  if (name === 'machai brown') return 'mekhai brown';
  return name;
}
export function countUniqueRegistrations(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || rows[0]?.[0] !== 'Timestamp' || rows[0]?.[1] !== 'Full Name') {
    throw new Error('Unexpected registration sheet headings');
  }
  const unique = new Set();
  for (const row of rows.slice(1)) {
    const name = canonicalName(row?.[1]);
    if (name) unique.add(name);
  }
  if (unique.size < 1 || unique.size > 2000) throw new Error('Registration count outside safe bounds');
  return unique.size;
}
export function localVerifiedDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const p = Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return p.year+'-'+p.month+'-'+p.day;
}
const b64 = data => Buffer.from(JSON.stringify(data)).toString('base64url');
async function tokenFor(serviceAccount) {
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) throw new Error('Invalid service account configuration');
  const t = Math.floor(Date.now()/1000);
  const unsigned = b64({alg:'RS256',typ:'JWT'})+'.'+b64({
    iss:serviceAccount.client_email,
    aud:'https://oauth2.googleapis.com/token',
    scope:'https://www.googleapis.com/auth/spreadsheets.readonly',iat:t,exp:t+600
  });
  const jwt = unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),serviceAccount.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}),signal:AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error('Google service-account authentication failed ('+r.status+')');
  const token=(await r.json()).access_token;
  if (!token) throw new Error('No Google token returned');
  return token;
}
async function sourceRows(spreadsheetId,token) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) throw new Error('Invalid private spreadsheet identifier');
  const range=encodeURIComponent("'Form Responses 1'!A1:B");
  const url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheetId+'/values/'+range;
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error('Private registration read failed ('+r.status+')');
  return (await r.json()).values;
}
export async function publish() {
  const raw=process.env.FFTT_COUNT_SERVICE_ACCOUNT_JSON;
  const id=process.env.FFTT_COUNT_SPREADSHEET_ID;
  if (!raw || !id) throw new Error('Required repository secrets not configured');
  if (localVerifiedDate() > '2026-11-23') {
    console.log('Event concluded; counter refresh disabled');
    return;
  }
  const token=await tokenFor(JSON.parse(raw));
  const count=countUniqueRegistrations(await sourceRows(id,token));
  const next={eventDate:EVENT_DATE,count,verifiedDate:localVerifiedDate()};
  const previous=JSON.parse(await readFile(SNAPSHOT,'utf8'));
  if (previous.eventDate !== EVENT_DATE) throw new Error('Public snapshot event mismatch');
  if (next.count === previous.count && next.verifiedDate === previous.verifiedDate) {
    console.log('Verified count unchanged');
    return;
  }
  await writeFile(SNAPSHOT,JSON.stringify(next,null,2)+'\n');
  console.log('Updated public count-only snapshot');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  publish().catch(e=>{console.error('Count refresh failed:',e.message);process.exitCode=1});
}
