/** Cloudflare Pages Function: POST /api/registrations (organizer-only, read-only registration retrieval).
 *
 * Deployed ONLY with the STAFF Pages project. It answers 503 `registration-not-configured` until the owner sets
 * the secrets listed in docs/REGISTRATION_INTEGRATION_2026-10-26.md, and it refuses any origin other than the
 * configured staff origin, so the same code on the spectator project (which has no such settings) is inert.
 * All behavior lives in server/registration/handler.mjs, which is unit-tested without a network. */
import {createRegistrationHandler, createHandlerState} from '../../server/registration/handler.mjs';

const state = createHandlerState();   // shared by every request this isolate serves (rate counters, short cache)

export async function onRequest({request, env}) {
  return createRegistrationHandler({env, fetchImpl: fetch, state})(request);
}
