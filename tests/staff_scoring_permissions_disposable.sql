-- Structural and privilege assertions for 20261108150000_staff_scoring_permissions.sql on a disposable database.
-- Behavior (roles, reasons, audit values, stale/idempotent requests) is covered by tests/e2e/correction_permissions*.test.mjs
-- and tests/e2e/doubles_scoring.test.mjs against the same SQL; this file checks what only a real PostgreSQL can: grants.
do $assert$
declare f text; c int;
begin
  -- every new/replaced PUBLIC function: callable by signed-in users only, never by anon or public
  foreach f in array array[
    'public.fftt_doubles_desk_v1(uuid)',
    'public.fftt_save_doubles_game_v1(uuid,text,bigint,integer,integer,uuid,integer,integer,integer,text)',
    'public.fftt_correct_doubles_result_v1(uuid,integer,text,integer,text,text)',
    'public.fftt_correct_result_v3(uuid,uuid,bigint,uuid,text,text)',
    'public.fftt_record_doubles_result_v3(uuid,integer,text)'] loop
    if has_function_privilege('anon', f::regprocedure, 'execute') or has_function_privilege('public', f::regprocedure, 'execute') then
      raise exception 'anon/public may execute %', f; end if;
    if not has_function_privilege('authenticated', f::regprocedure, 'execute') then raise exception 'authenticated cannot execute %', f; end if;
  end loop;
  -- private helpers are never callable by anon
  foreach f in array array[
    'fftt_private.doubles_desk_v1(uuid)',
    'fftt_private.doubles_game_save_v1(uuid,text,bigint,integer,integer,uuid,integer,integer,integer,text)',
    'fftt_private.correct_doubles_result_v1(uuid,integer,text,integer,text,text)'] loop
    if has_function_privilege('anon', f::regprocedure, 'execute') or has_function_privilege('public', f::regprocedure, 'execute') then
      raise exception 'anon/public may execute %', f; end if;
  end loop;
  -- exactly one public overload of the corrected RPC (an optional reason must not create an ambiguous overload)
  select count(*) into c from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fftt_correct_result_v3';
  if c <> 1 then raise exception 'ambiguous fftt_correct_result_v3 overloads: %', c; end if;
  -- saved doubles games are nullable columns of the existing row and nothing new is exposed to API roles
  select count(*) into c from information_schema.columns where table_schema = 'fftt_private' and table_name = 'doubles_finale'
    and column_name in ('progress_games','progress_version','progress_key','progress_epoch','progress_updated_at','progress_updated_by');
  if c <> 6 then raise exception 'doubles progress columns missing: %', c; end if;
  if has_table_privilege('anon', 'fftt_private.doubles_finale', 'select') or has_table_privilege('authenticated', 'fftt_private.doubles_finale', 'select') then
    raise exception 'doubles_finale must stay private'; end if;
  -- the append-only receipt ledger is unchanged and the new audit operations are accepted by the constraint
  if not exists (select 1 from pg_trigger where tgrelid = 'fftt_private.game_progress_decisions'::regclass and not tgisinternal) then
    raise exception 'receipt ledger lost its append-only trigger'; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_events_operation_check')) not like '%doubles_game_corrected%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_events_operation_check')) not like '%doubles_result_corrected%' then
    raise exception 'audit operations not extended'; end if;
  raise notice 'scoring permissions: privileges and structure verified';
end
$assert$;
