/**
 * Owner-local, target-specific composer for the one-time staff-scoring-permissions installation.
 * It never connects to a database and does not replace the generic hosted-migration deny in
 * tools/supabase_v3_preflight.py. The migration carries no private data, so the combined transaction is:
 *   begin; exact-history guard; reviewed migration body; one history row (version + name only); commit;
 *
 * usage: node tools/ops/compose_scoring_install.mjs <combined-output>      (path must be under /private/tmp)
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

export const PROJECT_REF = 'copmkalfkkrkzheohwuc';
export const NEW_VERSION = '20261108150000';
export const NEW_NAME = 'staff_scoring_permissions';
// The eight versions recorded on the target before this installation (the showcase reset is the last).
export const EXPECTED_HISTORY = [
  '20261008183821', '20261008183851', '20261008195706', '20261008201142',
  '20261009044012', '20261013101523', '20261108101146', '20261108114950',
];
// md5(pg_get_functiondef(...)) of the four replaced functions BEFORE and AFTER the migration.
export const FUNCTION_FINGERPRINTS = Object.freeze({
  'fftt_private.game_progress_save_v1(uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text)': {before: '3df36a95d474939018a02863e5be7388', after: '556a7111dccf1513212614c2d25bca8b'},
  'fftt_private.correct_result_v3(uuid,uuid,bigint,uuid,text,text)': {before: '84590563d2fc026e871750667475b026', after: '8b22b8caf9bfa783ec8d6abe1e7c1fff'},
  'public.fftt_correct_result_v3(uuid,uuid,bigint,uuid,text,text)': {before: 'bb83b39b6873b69e9bbc9138943cffef', after: '6398da7e961ba72499aa149bc8fa839e'},
  'fftt_private.record_doubles_result_v3(uuid,integer,text)': {before: '8d727d062f885a79455767efe90ca72a', after: 'e8b8df90af248ffc5640d8c4a7407ef5'},
});
const MIGRATION = new URL('../../supabase/migrations/20261108150000_staff_scoring_permissions.sql', import.meta.url);

export function compose(migrationSql) {
  const m = migrationSql.trim();
  if (!/^(--[^\n]*\n)*\s*begin;/i.test(m) || !/commit;\s*$/i.test(m)) throw Error('Reviewed migration must be one begin; ... commit; transaction');
  const body = m.replace(/^((?:--[^\n]*\n)*\s*)begin;/i, '$1').replace(/commit;\s*$/i, '');
  if (/(^|\n)\s*(begin|commit|rollback)\s*;/i.test(body.replace(/\$[a-z_]*\$[\s\S]*?\$[a-z_]*\$/gi, ''))) throw Error('Unexpected transaction control inside migration body');
  const history = EXPECTED_HISTORY.map(v => `'${v}'`).join(',');
  return `begin;
do $history_guard$
declare actual text[];
begin
  select array_agg(version order by version) into actual from supabase_migrations.schema_migrations;
  if actual is distinct from array[${history}]::text[] then
    raise exception 'scoring-install: hosted migration history differs from the reviewed eight entries';
  end if;
end $history_guard$;
${body}
insert into supabase_migrations.schema_migrations(version, name) values ('${NEW_VERSION}', '${NEW_NAME}');
commit;
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [outPath] = process.argv.slice(2);
  if (!outPath?.startsWith('/private/tmp/')) throw Error('Specify an output path under /private/tmp');
  const migration = fs.readFileSync(MIGRATION, 'utf8');
  const combined = compose(migration);
  fs.writeFileSync(outPath, combined, {mode: 0o600});
  fs.chmodSync(outPath, 0o600);
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  console.log(`Target project: ${PROJECT_REF}`);
  console.log(`Reviewed migration sha256: ${sha(migration)}`);
  console.log(`Combined transaction sha256: ${sha(combined)} (${combined.length} bytes, mode 600)`);
}
