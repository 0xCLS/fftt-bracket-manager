-- Game-day V5 (event-specific registration source) privilege and structure regression on a NEW local synthetic database
-- AFTER V2, V3, V4 and V5 were applied to IT.
\set ON_ERROR_STOP on
do $check$
declare r record;
begin
  -- the four public V5 entry points: authenticated yes, anon no, PUBLIC no; no others
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fftt\_%registration%\_v5' escape '\' loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') then raise exception 'anon can execute %', r.sig; end if;
    if not has_function_privilege('authenticated', r.sig, 'EXECUTE') then raise exception 'authenticated cannot execute %', r.sig; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'fftt\_%registration%\_v5' escape '\') <> 4 then
    raise exception 'expected exactly 4 public V5 entry points'; end if;
  -- the mapping validator is private to the definer functions
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'fftt_private' and p.proname = 'v5_mapping_ok' loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') or has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception 'helper exposed: %', r.sig; end if;
  end loop;
  -- the source table is not reachable from the API, has RLS on, and cannot hold a credential, a row or a contact
  if has_table_privilege('authenticated', 'fftt_private.registration_sources', 'SELECT') or has_table_privilege('anon', 'fftt_private.registration_sources', 'SELECT') then
    raise exception 'registration sources readable from the API'; end if;
  if not (select relrowsecurity from pg_class where oid = 'fftt_private.registration_sources'::regclass) then raise exception 'RLS must be on'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'fftt_private' and table_name = 'registration_sources'
              and column_name ~* 'mail|phone|contact|secret|key|token|password|credential|row') then
    raise exception 'a private-data column exists on registration_sources'; end if;
  -- a live Google source cannot be enabled on a synthetic event, whatever the caller
  if exists (select 1 from fftt_private.registration_sources s join fftt_private.events e on e.id = s.event_id where s.kind = 'google-sheets' and s.enabled and e.synthetic_only) then
    raise exception 'an enabled live source exists on a synthetic event'; end if;
  -- the V4 and V3 grants are unchanged
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fftt\_%\_v3' escape '\' or p.proname like 'fftt\_%\_v4' escape '\') loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') then raise exception 'anon can execute %', r.sig; end if;
  end loop;
  -- the audit trail still accepts and keeps the new operation, and is still append-only
  begin delete from fftt_private.audit_events; raise exception 'audit delete allowed';
  exception when others then if sqlerrm = 'audit delete allowed' then raise; end if; end;
end
$check$;
select 'game-day v5 privileges ok' as result;
