-- FFTT read-only schema fingerprint. Run unchanged on the hosted project (Supabase SQL editor) and on a restored/disposable
-- database; the two outputs must match line for line. Reads only catalogs: no row data, no secrets.
with fn as (
  select 'function' as k,
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') secdef=' || p.prosecdef::text
           || ' cfg=' || coalesce(p.proconfig::text, '-') || ' src=' || md5(p.prosrc)
           || ' exec_anon=' || has_function_privilege('anon', p.oid, 'execute')::text
           || ' exec_auth=' || has_function_privilege('authenticated', p.oid, 'execute')::text as line
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'fftt_private' or (n.nspname = 'public' and p.proname like 'fftt\_%')
), col as (
  select 'column', c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' notnull=' || a.attnotnull::text
           || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'fftt_private' and c.relkind = 'r'
), con as (
  select 'constraint', c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'fftt_private' and c.relkind = 'r' and k.contype <> 'f'
), trg as (
  select 'trigger', c.relname || ' ' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'fftt_private' and not t.tgisinternal
), rls as (
  select 'rls', c.relname || ' rls=' || c.relrowsecurity::text || ' policies=' || (select count(*) from pg_policy p where p.polrelid = c.oid)::text
           || ' api_select=' || (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fftt_private' and c.relkind = 'r'
), vw as (
  select 'view', c.relname || ' ' || md5(pg_get_viewdef(c.oid)) || ' anon=' || has_table_privilege('anon', c.oid, 'select')::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'fftt\_%'
), all_lines as (
  select * from fn union all select * from col union all select * from con union all select * from trg union all select * from rls union all select * from vw
)
select k as kind, count(*) as n, md5(string_agg(line, E'\n' order by line)) as fingerprint, string_agg(line, E'\n' order by line) as lines
from all_lines group by k order by k;
