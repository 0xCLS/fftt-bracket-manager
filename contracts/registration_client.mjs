/** Browser client for the organizer-only registration adapter (POST /api/registrations on the SAME origin).
 * It sends the signed-in person's own access token and the event id, nothing else, and rebuilds the answer through
 * the strict registration contract: any field outside the allowlist (a contact detail, an unexpected key) makes the
 * whole answer invalid and nothing is shown. It holds no credential of any kind and cannot reach any other host. */
import {parseRegistrationPayload} from './registration_model.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
export const REGISTRATION_ERROR_KINDS = Object.freeze(['not-configured', 'not-enabled', 'forbidden', 'access-rejected', 'rate-limited',
  'source-unauthorized', 'source-not-found', 'source-busy', 'source-unavailable', 'network', 'malformed']);

export class RegistrationClientError extends Error {
  constructor(kind) {
    super('Registration request failed');
    this.name = 'RegistrationClientError';
    this.kind = REGISTRATION_ERROR_KINDS.includes(kind) ? kind : 'source-unavailable';
  }
}

export function createRegistrationClient({fetchImpl, endpoint = '/api/registrations'} = {}) {
  if (typeof fetchImpl !== 'function' || !/^\/[a-z0-9/_-]{1,60}$/.test(endpoint)) throw new RegistrationClientError('malformed');
  return Object.freeze({
    /** Read-only. Resolves with a validated payload or throws RegistrationClientError. */
    async load(token, {eventId} = {}) {
      if (typeof token !== 'string' || !JWT.test(token) || token.length > 10000) throw new RegistrationClientError('access-rejected');
      if (typeof eventId !== 'string' || !UUID.test(eventId)) throw new RegistrationClientError('malformed');
      let res;
      try {
        res = await fetchImpl(endpoint, {method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
          headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({event_id: eventId})});
      } catch { throw new RegistrationClientError('network'); }
      if (res?.status === 200) {
        try { return parseRegistrationPayload(await res.json()); } catch { throw new RegistrationClientError('malformed'); }
      }
      let code = null;
      try { code = (await res.json())?.error ?? null; } catch { /* generic */ }
      switch (res?.status) {
        case 401: throw new RegistrationClientError('access-rejected');
        case 403: throw new RegistrationClientError(code === 'event-not-enabled' ? 'not-enabled' : 'forbidden');
        case 404: case 405: throw new RegistrationClientError('not-configured');
        case 429: throw new RegistrationClientError('rate-limited');
        case 503: throw new RegistrationClientError(code === 'registration-not-configured' ? 'not-configured' : code === 'source-busy' ? 'source-busy' : 'source-unavailable');
        case 502: throw new RegistrationClientError(['source-unauthorized', 'source-not-found'].includes(code) ? code : 'source-unavailable');
        default: throw new RegistrationClientError('source-unavailable');
      }
    },
  });
}
