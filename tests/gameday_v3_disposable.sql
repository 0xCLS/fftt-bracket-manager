-- Game-day V3 privilege regression on a NEW local synthetic database AFTER V2 and V3 were applied to IT.
\set ON_ERROR_STOP on
do $check$
declare r record;
begin
  -- every public V3 wrapper: authenticated yes, anon no, PUBLIC no
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fftt\_%\_v3' escape '\' loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') then raise exception 'anon can execute %', r.sig; end if;
    if not has_function_privilege('authenticated', r.sig, 'EXECUTE') then raise exception 'authenticated cannot execute %', r.sig; end if;
  end loop;
  -- private helpers are unreachable from every API role
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'fftt_private' and p.proname in ('v3_err','v3_begin','v3_bump','v3_audit','v3_normalize_scores',
              'v3_refresh_public','v3_events_publish_trigger','v3_create_bracket','v3_parse_slots') loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') or has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception 'helper exposed: %', r.sig; end if;
  end loop;
  if has_table_privilege('authenticated', 'fftt_private.platform_organizers', 'SELECT')
     or has_table_privilege('anon', 'fftt_private.platform_organizers', 'SELECT') then
    raise exception 'platform organizers readable'; end if;
  if has_table_privilege('anon', 'public.fftt_published_events', 'INSERT') or has_table_privilege('authenticated', 'public.fftt_published_matches', 'UPDATE') then
    raise exception 'public projection writable from the API'; end if;
  if not has_table_privilege('anon', 'public.fftt_public_tournament_v1', 'SELECT') then raise exception 'public view must be readable'; end if;
  if (select count(*) from pg_constraint where conname = 'matches_pending_table_uniq') <> 0 and false then null; end if;
end
$check$;
select 'game-day v3 privileges ok' as result;
