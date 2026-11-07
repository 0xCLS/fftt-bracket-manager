/** Short-lived proofs that the Pages Function (and nothing else) read a registration, verified by the database.
 *
 * A Bracket Manager's browser holds only their own Supabase token. The two database functions that serve registration
 * lookup and check-in to a Bracket Manager (fftt_bm_registration_lookup_v1 / fftt_bm_registration_checkin_v1) therefore also
 * require an HMAC-SHA256 proof, made here with the shared secret REGISTRATION_GATE_SECRET, which the database holds too
 * (fftt_private.registration_gate). A proof binds: the purpose, the event, the CURRENT signed-in user, a 45-second expiry
 * and, for a check-in, the source's fingerprint plus exactly the name, level and opaque reference the Function read from the
 * event's own saved sheet. The browser never sees a proof, so it cannot invent a registration, swap a name or a level, or
 * replay another user's request; and the database cannot be called with a registration the sheet does not hold.
 *
 * The byte layout below is mirrored by supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_*_DO_NOT_APPLY.sql; change both
 * together (tests/registration_gate.test.mjs and tests/e2e/bm_registration_lookup.test.mjs pin them against each other). */
const SEP = '\u001f';
export const GATE_SECRET_MIN = 32;
export const GATE_LIFETIME_SECONDS = 45;
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** 'fixture' for the fictional source, otherwise sha256(kind | spreadsheet id | worksheet), as fftt_private.registration_source_fp. */
export async function sourceFingerprint(src) {
  if (!src?.configured || src.kind === 'fixture') return 'fixture';
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(['google-sheets', src.spreadsheetId, src.worksheet].join(SEP))));
}

/** The purpose-specific fields of a check-in proof: the source fingerprint, then each item's ref, same_as_ref, name, rating. */
export const checkinFields = (fingerprint, items) =>
  fingerprint + items.map(i => `${SEP}${i.ref}${SEP}${i.same_as_ref ?? ''}${SEP}${i.name}${SEP}${i.rating}`).join('');

export function createGate(secret, {now = () => Date.now()} = {}) {
  if (typeof secret !== 'string' || secret.length < GATE_SECRET_MIN || secret.length > 200) return null;
  const keyP = crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return Object.freeze({
    /** @returns {Promise<{exp: number, proof: string}>} */
    async sign(purpose, eventId, userId, fields = '') {
      const exp = Math.floor(now() / 1000) + GATE_LIFETIME_SECONDS;
      const message = ['fftt-reg-gate-v1', purpose, eventId.toLowerCase(), userId.toLowerCase(), String(exp), fields].join(SEP);
      return {exp, proof: hex(await crypto.subtle.sign('HMAC', await keyP, enc.encode(message)))};
    },
  });
}
