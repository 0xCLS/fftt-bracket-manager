/**
 * Owner-local, read-only-source composer for ONE targeted PR #80 database installation.
 * Never connects to Supabase and cannot deploy. This script does NOT authorize release.
 * Requires a current complete verified private backup, owner approval, and successful
 * exact-head comprehensive CI before any separately authorized hosted operation.
 *
 * Usage (macOS): node tools/ops/compose_walkover_install.mjs /private/tmp/<private-name>.sql
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

export const PROJECT_REF = 'copmkalfkkrkzheohwuc';
export const NEW_VERSION = '20261109170000';
export const NEW_NAME = 'fftt_rehearsal_walkover_withdrawal';
export const EXPECTED_HISTORY = Object.freeze([
  '20261008183821','20261008183851','20261008195706',
  '20261008201142','20261009044012','20261013101523',
  '20261108101146','20261108114950','20261108150000'
]);
export const PINNED_PROPOSAL_GIT_BLOB = '1d545444bf4aa2c8f737f6c632bc599812b8fe27';
const SOURCE = new URL('../../supabase/proposals/FFTT3_REHEARSAL_WALKOVER_WITHDRAWAL_20261109_DO_NOT_APPLY.sql',import.meta.url);
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const gitBlob = s => crypto.createHash('sha1').update('blob '+Buffer.byteLength(s)+'\\0'+s).digest('hex');

export function compose(proposal) {
  if (gitBlob(proposal) !== PINNED_PROPOSAL_GIT_BLOB)
    throw Error('Refusing changed or unreviewed walkover source body');
  const m = proposal.trim();
  if (!/^(?:--[^\\n]*\\n)*\\s*begin;/i.test(m) || !/commit;\\s*$/i.test(m))
    throw Error('Expected one reviewed begin/commit transaction');
  const body = m.replace(/^((?:--[^\\n]*\\n)*\\s*)begin;/i,'$1').replace(/commit;\\s*$/i,'');
  const withoutFunctions = body.replace(/\\$[a-z_]*\\$[\\s\\S]*?\\$[a-z_]*\\$/gi,'');
  if (/(^|\\n)\\s*(begin|commit|rollback)\\s*;/i.test(withoutFunctions))
    throw Error('Unexpected nested transaction control');
  const expected = EXPECTED_HISTORY.map(x=>"'"+x+"'").join(',');
  return `begin;
do $history_guard$
declare actual text[];
begin
  select array_agg(version order by version) into actual
  from supabase_migrations.schema_migrations;
  if actual is distinct from array[${expected}]::text[] then
    raise exception 'walkover-install: hosted migration history differs from reviewed nine entries';
  end if;
end $history_guard$;
${body}
insert into supabase_migrations.schema_migrations(version,name)
values ('${NEW_VERSION}','${NEW_NAME}');
commit;
`;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const out = process.argv[2];
  if (!out?.startsWith('/private/tmp/') || process.argv.length !== 3)
    throw Error('Output must be a single file path under /private/tmp');
  const proposal = fs.readFileSync(SOURCE,'utf8');
  const combined = compose(proposal);
  const fd = fs.openSync(out,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try {fs.writeFileSync(fd,combined);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  console.log('Target project: '+PROJECT_REF+' (informational; confirm the connection separately)');
  console.log('Reviewed proposal SHA-256: '+sha256(proposal));
  console.log('Composed SQL SHA-256: '+sha256(combined)+'; bytes='+Buffer.byteLength(combined));
  console.log('Private output mode: 600. Does not execute SQL or authorize a hosted write.');
}
