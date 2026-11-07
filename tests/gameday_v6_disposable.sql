-- GAME-BY-GAME V6: LOCAL POSTGRESQL ASSERTIONS (fictional / no hosted connection).
begin;
do $assert$
declare
  v text;
begin
  if not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n
    on n.oid=c.relnamespace where n.nspname='fftt_private'
      and c.relname='match_game_progress' and c.relrowsecurity) then
    raise exception 'Private score progress table must be RLS-enabled';
  end if;
  if not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n
    on n.oid=c.relnamespace where n.nspname='fftt_private'
      and c.relname='game_progress_decisions' and c.relrowsecurity) then
    raise exception 'Private game decision table must be RLS-enabled';
  end if;
  if pg_catalog.has_table_privilege('anon', 'fftt_private.match_game_progress', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'fftt_private.match_game_progress', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'fftt_private.game_progress_decisions', 'UPDATE')
    or pg_catalog.has_table_privilege('anon', 'public.fftt_published_matches', 'UPDATE') then
    raise exception 'Private table or public cache write leaked to browser role';
  end if;
  if pg_catalog.has_function_privilege('anon','public.fftt_game_progress_v1(uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','public.fftt_game_progress_decision_v1(uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'public.fftt_save_completed_game_v1(uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text)',
      'EXECUTE') then
    raise exception 'Anonymous can invoke game-progress staff RPC';
  end if;
  if not pg_catalog.has_function_privilege('authenticated','public.fftt_game_progress_v1(uuid,uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',
      'public.fftt_save_completed_game_v1(uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text)',
      'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','public.fftt_game_progress_decision_v1(uuid,uuid)','EXECUTE') then
    raise exception 'Authenticated staff cannot reach guarded wrappers';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgname='fftt_v6_match_guard' and not tgisinternal)
    or not exists (select 1 from pg_catalog.pg_trigger where tgname='fftt_v6_invalidate_progress' and not tgisinternal)
    or not exists (select 1 from pg_catalog.pg_trigger where tgname='zz_fftt_events_publish_game_progress_v6' and not tgisinternal) then
    raise exception 'Game progress atomicity triggers missing';
  end if;
  v := pg_catalog.pg_get_viewdef('public.fftt_public_tournament_v1'::regclass, true);
  if v not ilike '%game_progress%' or v ilike '%rating_status%' or v ilike '%actor_id%'
    or v ilike '%submission_id%' or v ilike '%email%' then
    raise exception 'Anonymous tournament view allowlist missing or expanded';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute a where
    a.attrelid='fftt_private.matches'::regclass and a.attname='game_progress_epoch'
      and not a.attisdropped) then raise exception 'Match epoch missing'; end if;
end;
$assert$;
rollback;
