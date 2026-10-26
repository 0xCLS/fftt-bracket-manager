-- Game-day V4 privilege and structure regression on a NEW local synthetic database AFTER V2, V3 and V4 were applied to IT.
\set ON_ERROR_STOP on
do $check$
declare r record;
begin
  -- every public V4 wrapper (and the formats Match Desk): authenticated yes, anon no, PUBLIC no
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'fftt\_%\_v4' escape '\' or p.proname = 'fftt_matchdesk_v2') loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') then raise exception 'anon can execute %', r.sig; end if;
    if not has_function_privilege('authenticated', r.sig, 'EXECUTE') then raise exception 'authenticated cannot execute %', r.sig; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname like 'fftt\_%\_v4' escape '\' or p.proname = 'fftt_matchdesk_v2')) <> 8 then
    raise exception 'expected exactly 8 public V4 entry points'; end if;
  -- the replaced V3 wrappers keep their grants (create or replace must not widen them)
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'fftt\_%\_v3' escape '\' loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') then raise exception 'anon can execute %', r.sig; end if;
  end loop;
  -- private helpers are unreachable from every API role
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'fftt_private' and p.proname in ('v4_match_format','v4_normalize_scores','v4_match_category','v4_event_deletable',
              'v3_create_bracket','v3_refresh_public','reject_audit_mutation') loop
    if has_function_privilege('anon', r.sig, 'EXECUTE') or has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception 'helper exposed: %', r.sig; end if;
  end loop;
  -- private tables are not reachable from the API at all
  if has_table_privilege('authenticated', 'fftt_private.registration_links', 'SELECT') or has_table_privilege('anon', 'fftt_private.registration_links', 'SELECT')
     or has_table_privilege('authenticated', 'fftt_private.deleted_events', 'SELECT') or has_table_privilege('anon', 'fftt_private.deleted_events', 'SELECT') then
    raise exception 'registration links or tombstones readable from the API'; end if;
  if not (select relrowsecurity from pg_class where oid = 'fftt_private.registration_links'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'fftt_private.deleted_events'::regclass) then
    raise exception 'row level security must be on for the V4 private tables'; end if;
  -- Best of 5 cannot be configured or stamped
  begin insert into fftt_private.events(event_name, event_date, champ_best_of) values ('x', '2026-12-01', 5); raise exception 'bo5 accepted';
  exception when check_violation then null; end;
  begin insert into fftt_private.events(event_name, event_date, cons_points) values ('x', '2026-12-01', 15); raise exception '15 points accepted';
  exception when check_violation then null; end;
  -- no contact column exists on the roster
  if exists (select 1 from information_schema.columns where table_schema = 'fftt_private' and table_name = 'players' and column_name ~* 'mail|phone|contact|tel') then
    raise exception 'a contact column exists'; end if;
  -- the public view exposes formats and nothing private
  if not exists (select 1 from pg_get_viewdef('public.fftt_public_tournament_v1'::regclass) v where v ~ 'points_to_win') then raise exception 'public view lacks formats'; end if;
  if pg_get_viewdef('public.fftt_public_tournament_v1'::regclass) ~* 'rating|registration|email|source' then raise exception 'public view leaks'; end if;
  if not has_table_privilege('anon', 'public.fftt_public_tournament_v1', 'SELECT') then raise exception 'public view must stay readable'; end if;
  -- the audit trail is still append-only
  begin delete from fftt_private.audit_events; raise exception 'audit delete allowed';
  exception when others then if sqlerrm = 'audit delete allowed' then raise; end if; end;
end
$check$;
select 'game-day v4 privileges ok' as result;
