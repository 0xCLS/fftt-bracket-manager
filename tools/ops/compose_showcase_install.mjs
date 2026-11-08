/**
 * Owner-local, target-specific composer for the one-time showcase reset installation.
 * It never connects to a database, never prints fixture contents, and does not replace the
 * generic hosted-migration deny in tools/supabase_v3_preflight.py (that gate stays closed).
 *
 * usage: node tools/ops/compose_showcase_install.mjs <installer-fragment> <combined-output>
 * Both paths must be under /private/tmp; the output is written mode 600.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

export const PROJECT_REF = 'copmkalfkkrkzheohwuc';
export const NEW_VERSION = '20261108114950';
export const NEW_NAME = 'showcase_reset';
// The seven versions recorded on the target before this installation (V6 is the last).
export const EXPECTED_HISTORY = [
  '20261008183821', '20261008183851', '20261008195706', '20261008201142',
  '20261009044012', '20261013101523', '20261108101146',
];
const MIGRATION = new URL('../../supabase/migrations/20261108114950_showcase_reset.sql', import.meta.url);

export function compose(migrationSql, fragmentSql) {
  const m = migrationSql.trim();
  if (!/^(--[^\n]*\n)*\s*begin;/i.test(m) || !/commit;\s*$/i.test(m)) {
    throw Error('Reviewed migration must be one begin; ... commit; transaction');
  }
  const body = m.replace(/^((?:--[^\n]*\n)*\s*)begin;/i, '$1').replace(/commit;\s*$/i, '');
  if (/\b(begin|commit|rollback)\s*;/i.test(body.replace(/\$[a-z_]*\$[\s\S]*?\$[a-z_]*\$/gi, ''))) {
    throw Error('Unexpected transaction control inside migration body');
  }
  if (/\b(begin|commit|rollback)\s*;\s*$/im.test(fragmentSql)) throw Error('Fragment must not control transactions');
  const history = EXPECTED_HISTORY.map(v => `'${v}'`).join(',');
  return `begin;
do $history_guard$
declare actual text[];
begin
  select array_agg(version order by version) into actual from supabase_migrations.schema_migrations;
  if actual is distinct from array[${history}]::text[] then
    raise exception 'showcase-install: hosted migration history differs from the reviewed seven entries';
  end if;
end $history_guard$;
${body}
${fragmentSql.trim()}
insert into supabase_migrations.schema_migrations(version, name) values ('${NEW_VERSION}', '${NEW_NAME}');
commit;
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fragmentPath, outPath] = process.argv.slice(2);
  if (!fragmentPath?.startsWith('/private/tmp/') || !outPath?.startsWith('/private/tmp/')) {
    throw Error('Specify the fragment and output paths under /private/tmp');
  }
  if ((fs.statSync(fragmentPath).mode & 0o077) !== 0) throw Error('Fragment must be mode 600');
  const migration = fs.readFileSync(MIGRATION, 'utf8');
  const combined = compose(migration, fs.readFileSync(fragmentPath, 'utf8'));
  fs.writeFileSync(outPath, combined, {mode: 0o600});
  fs.chmodSync(outPath, 0o600);
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  console.log(`Target project: ${PROJECT_REF}`);
  console.log(`Reviewed migration sha256: ${sha(migration)}`);
  console.log(`Combined transaction sha256: ${sha(combined)} (${combined.length} bytes, mode 600; contents not printed)`);
}
