-- B2d: privilege boundary and exposed function security checks.
-- Runs against isolated synthetic Supabase Postgres; no accounts or fixtures.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_function('public','fftt_manage_staff_v1',
 array['uuid','uuid','text','text'], 'staff manager API exists');
select ok(not has_function_privilege('anon',
 'public.fftt_manage_staff_v1(uuid,uuid,text,text)','EXECUTE'),
 'anonymous cannot call staff manager');
select ok(has_function_privilege('authenticated',
 'public.fftt_manage_staff_v1(uuid,uuid,text,text)','EXECUTE'),
 'signed-in users may call the wrapper, subject to organizer authorization');
select ok(not has_function_privilege('anon',
 'fftt_private.manage_staff_v1(uuid,uuid,text,text)','EXECUTE'),
 'anonymous cannot directly call private manager');
select ok(has_function_privilege('authenticated',
 'fftt_private.manage_staff_v1(uuid,uuid,text,text)','EXECUTE'),
 'only narrowly granted private function may be resolved');
select ok(
 (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='fftt_manage_staff_v1'),
 'public API wrapper uses security invoker');
select ok(
 (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='fftt_private' and p.proname='manage_staff_v1'),
 'trusted private manager uses security definer');
select ok(not has_table_privilege('authenticated',
 'fftt_private.event_staff','UPDATE'), 'no direct authenticated staff updates');
select ok(not has_table_privilege('authenticated',
 'fftt_private.event_staff','INSERT'), 'no direct authenticated staff inserts');
select ok(not has_table_privilege('authenticated',
 'fftt_private.audit_events','INSERT'), 'no direct authenticated audit insertion');
select ok(not has_table_privilege('anon',
 'fftt_private.event_staff','SELECT'), 'no anonymous private staff access');

select * from finish();
rollback;
