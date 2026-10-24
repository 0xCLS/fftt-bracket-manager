/** Test-only: real Chrome contexts (one per "device") served from the repository over FAKE HTTPS origins,
 * with the Supabase host answered by the fake backend over the real SQL. Nothing leaves this machine.
 * The page origin policy, CSP and every client module run exactly as shipped. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {createFakeSupabase, PROJECT} from './fake_supabase.mjs';
import {roster} from './helpers.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const STAFF = 'https://fftt-staff-test.pages.dev';
export const SPECT = 'https://fftt-spectator-test.pages.dev';
const TYPES = {'.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp'};
const SEC = {'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store'};

export async function launch() {
  const opts = process.env.FFTT_CHROME_CHANNEL === 'none' ? {} : {channel: process.env.FFTT_CHROME_CHANNEL ?? 'chrome'};
  try { return await chromium.launch({...opts, args: ['--disable-features=PrivateNetworkAccessChecks']}); }
  catch { return chromium.launch(); }
}

export async function createBrowserWorld({ttlSeconds = 3600, players = 0} = {}) {
  const fake = await createFakeSupabase({ttlSeconds});
  const accounts = {
    org: ['organizer@fftt-staging.invalid', 'org-' + Math.random().toString(36).slice(2) + 'Aa1!'],
    a: ['scorekeeper-a@fftt-staging.invalid', 'a-' + Math.random().toString(36).slice(2) + 'Aa1!'],
    b: ['scorekeeper-b@fftt-staging.invalid', 'b-' + Math.random().toString(36).slice(2) + 'Aa1!'],
    out: ['outsider@fftt-staging.invalid', 'o-' + Math.random().toString(36).slice(2) + 'Aa1!'],
  };
  const ids = {};
  for (const [k, [email, pw]] of Object.entries(accounts)) ids[k] = await fake.addAccount(email, pw, {platformOrganizer: k === 'org'});
  const [ev] = await fake.local.admin(`insert into fftt_private.events(event_name,event_date,table_count,created_by)
     values ('Synthetic Rehearsal Games','2026-11-22',3,$1) returning id`, [ids.org]);
  await fake.local.admin(`insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer'),($1,$3,'scorekeeper'),($1,$4,'scorekeeper')`,
    [ev.id, ids.org, ids.a, ids.b]);
  if (players) await fake.local.rpc(ids.org, 'fftt_upsert_players_v3', {p_event_id: ev.id, p_players: roster(players)});
  const browser = await launch();
  const world = {fake, accounts, ids, eventId: ev.id, browser, contexts: [], consoleErrors: [], pageErrors: [], requests: []};

  function headersFor(origin, file) {
    const connect = "connect-src 'self' " + PROJECT;
    return {...SEC, 'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self'; ${connect}; img-src 'self'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
      'strict-transport-security': 'max-age=31536000', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', 'x-robots-tag': 'noindex, nofollow'};
  }
  const profile = JSON.stringify({environment: 'staging', approvedPublicStaticOrigins: [{origin: STAFF, environment: 'staging', dedicatedOrigin: true}],
    approvedHttpsOrigins: [], spectatorOrigin: SPECT});

  /** A device = an isolated browser context (own storage, own network identity). */
  world.device = async (name, {viewport = {width: 1280, height: 900}, mobile = false, who = null} = {}) => {
    const context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1});
    const dev = {name, context, who, page: null, offline: false, log: []};
    await context.route('**/*', async route => {
      const req = route.request(); const url = new URL(req.url());
      if (url.origin === PROJECT) {
        const cors = {'access-control-allow-origin': req.headers().origin ?? STAFF, 'access-control-allow-headers': 'authorization, apikey, content-type, accept, x-client-info',
          'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'retry-after', vary: 'Origin'};
        if (req.method() === 'OPTIONS') return route.fulfill({status: 204, headers: cors});
        if (fake.hooks.offline.has(name)) return route.abort('internetdisconnected');
        world.requests.push({device: name, method: req.method(), path: url.pathname, auth: !!req.headers().authorization, at: Date.now()});
        const d = await fake.dispatch(name, req.url(), {method: req.method(), headers: req.headers(), body: req.postData()});
        if (d.abort) return route.abort('connectionreset');
        return route.fulfill({status: d.out.status, headers: {...cors, 'content-type': 'application/json', ...d.out.headers},
          body: d.out.body === null ? '' : JSON.stringify(d.out.body)});
      }
      if (url.origin === STAFF || url.origin === SPECT) {
        let p = url.pathname;
        if (p === '/' && url.origin === SPECT) p = '/app/spectator.html'; // production: a _redirects rewrite (200)
        if (p === '/') return route.fulfill({status: 404, body: 'the staff root redirects to /app/staff.html in production'});
        if (p === '/app/origin-profile.json') return route.fulfill({status: 200, headers: {...SEC, 'content-type': 'application/json'}, body: profile});
        const file = path.join(ROOT, p);
        if (!file.startsWith(ROOT) || !/^\/(app|contracts)\//.test(p) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status: 404, body: 'not found'});
        return route.fulfill({status: 200, headers: {...headersFor(url.origin), 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream'}, body: fs.readFileSync(file)});
      }
      return route.abort('blockedbyclient'); // nothing else on the internet may be reached
    });
    dev.open = async (url) => {
      dev.page = await context.newPage();
      dev.page.on('console', m => { if (['error', 'warning'].includes(m.type())) world.consoleErrors.push(`[${name}] ${m.type()}: ${m.text()}`); });
      dev.page.on('pageerror', e => world.pageErrors.push(`[${name}] ${e.message}`));
      await dev.page.goto(url);
      return dev.page;
    };
    dev.signIn = async (who, {event = ev.id, keep = false} = {}) => {
      const page = dev.page ?? await dev.open(STAFF + '/app/staff.html');
      await page.waitForSelector('#signIn:not([disabled])');
      await page.fill('#email', accounts[who][0]);
      await page.fill('#password', accounts[who][1]);
      await page.fill('#eventId', event);
      if (keep) await page.check('#keepSignedIn');
      await page.click('#signIn');
    };
    world.contexts.push(dev);
    return dev;
  };
  world.close = async () => { await browser.close(); };
  return world;
}
