/** The invitation page must tell an expired/used Supabase link apart from a malformed callback, never leave token
 *  material in the address bar, and never show the password form without a well-formed invitation token.
 *  Fictional fragments only; no hosted system is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld, STAFF} from './browser_world.mjs';

const T = 20000;
const FAKE_JWT = 'aaaa.bbbb.cccc';

test('invitation page: expired link, malformed callbacks and an unapproved host', {timeout: 120000}, async () => {
  const w = await createBrowserWorld();
  try {
    const cases = [
      ['Supabase reports an expired or already-used link (fragment)', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', /expired or was already used.*new invitation/s, false],
      ['Supabase reports an expired link (query string)', '?error=access_denied&error_code=otp_expired', /expired or was already used/, false],
      ['no callback data at all', '', /This invitation is invalid\./, false],
      ['wrong link type', `#access_token=${FAKE_JWT}&type=recovery`, /This invitation is invalid\./, false],
      ['malformed token', '#access_token=not-a-jwt&type=invite', /This invitation is invalid\./, false],
      // The harness origin is deliberately not on the page's approved-host list, so even a well-formed callback is refused there.
      ['well-formed callback on a host that is not approved', `#access_token=${FAKE_JWT}&type=invite&refresh_token=zzz`, /This invitation is invalid\./, false],
    ];
    for (const [label, suffix, message, formShown] of cases) {
      const d = await w.device('invite-' + cases.findIndex(c => c[0] === label), {viewport: {width: 390, height: 800}});
      const page = await d.open(STAFF + '/app/staff-invite.html' + suffix);
      await page.waitForFunction(() => document.querySelector('#status')?.textContent !== 'Checking your invitation…', null, {timeout: T});
      assert.match(await page.locator('#status').innerText(), message, label);
      assert.equal(await page.locator('#finish').isVisible(), formShown, `${label}: password form visibility`);
      const url = new URL(page.url());
      assert.equal(url.hash, '', `${label}: no token or error material is left in the address bar`);
      assert.equal(url.search, '', `${label}: no query material is left in the address bar`);
      await d.context.close();
    }
    assert.deepEqual(w.pageErrors, []);
  } finally { await w.close(); }
});
