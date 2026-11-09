/** SQL changes already deployed in the hosted FFTT project before V6.\n * Disposed PGlite clone only. Never connect or write to hosted Supabase. */
export const APPLIED_PRE_V6_LAYERS = [
  'supabase/proposals/FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql',
  'supabase/proposals/FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql',
  'supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql',
];


/**
 * Reconstruct PostgreSQL ICU en-US's jsonb_agg(j ORDER BY j::text) fingerprint.
 *
 * The hosted FFTT database uses the en-US ICU default collation, while the
 * isolated PGlite clone sorts text bytewise. An identical multiset can thus
 * have a different historical aggregate MD5; registration_links exposed this
 * on the November 9 owner-held export. This is NOT a checksum bypass:
 * compute the *same* original MD5 over fully restored JSONB records, in the
 * server's original locale order. Any altered/omitted value still fails.
 *
 * Input records are read ONLY from a disposable clone and NEVER logged.
 * If the ICU runtime does not reproduce the source fingerprint, verification
 * remains failed. Future exports should use an explicitly pinned collation.
 */
export async function hostedIcuFingerprint(db, table) {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) throw Error('Invalid verified table identifier');
  const records = await db.admin('select to_jsonb(x)::text as j from fftt_private.' + table + ' x');
  const collator = new Intl.Collator('en-US', {
    usage: 'sort', sensitivity: 'variant', numeric: false, ignorePunctuation: false,
  });
  const jsonRows = records.map(r => r.j);
  jsonRows.sort((a, b) => collator.compare(a, b));
  const [res] = await db.admin('select md5($1::jsonb::text) as fp', [
    '[' + jsonRows.join(',') + ']',
  ]);
  return res.fp;
}
