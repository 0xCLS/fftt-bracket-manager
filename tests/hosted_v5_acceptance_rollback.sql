-- Hosted V5 SYNTHETIC acceptance script (October 27, 2026). Run in the SQL editor of the SYNTHETIC project (fftt-bracket-manager-dev)
-- AFTER GAMEDAY_TOURNAMENT_V5_STAGING.sql. Same safety design as the V4 script: ONE transaction, existing accounts by role/claim
-- switching (no passwords, no accounts created), clearly named disposable fictional events, and it ALWAYS ends by raising an
-- exception carrying the report, so everything rolls back. Verify the counts afterwards.
begin;
create function pg_temp.as_q(p_uid uuid, p_sql text, p_anon boolean default false) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', case when p_anon then '{"role":"anon"}' else json_build_object('sub',p_uid,'role','authenticated','aud','authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  execute case when p_anon then 'set local role anon' else 'set local role authenticated' end;
  execute p_sql into r;
  execute 'reset role';
  return r;
exception when others then
  execute 'reset role';
  raise;
end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text, p_anon boolean default false) returns text language plpgsql as $f$
declare d text;
begin
  perform pg_temp.as_q(p_uid, p_sql, p_anon);
  return 'OK';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return sqlstate || '/' || sqlerrm || '/' || coalesce(d,'');
end $f$;
create function pg_temp.ck(p_label text, p_ok boolean) returns text language sql as $f$ select E'\n' || case when coalesce(p_ok,false) then 'PASS ' else 'FAIL ' end || p_label $f$;
do $acc$
declare
  org uuid; sk uuid; outsider uuid; rep text := ''; t text; r jsonb; E uuid; E2 uuid; skmail text; ev_before int; src_before int; audit_before int;
  SH constant text := 'SYNTHETIC_SHEET_A_0123456789abcdef'; SH2 constant text := 'SYNTHETIC_SHEET_B_0123456789abcdef';
begin
  select user_id into org from fftt_private.platform_organizers limit 1;
  select s.user_id into sk from fftt_private.event_staff s where s.role = 'scorekeeper' and s.active and s.user_id <> org limit 1;
  select u.id into outsider from auth.users u where u.id <> org and u.id <> sk and not exists (select 1 from fftt_private.event_staff s where s.user_id = u.id) and not exists (select 1 from fftt_private.platform_organizers p where p.user_id = u.id) limit 1;
  select email into skmail from auth.users where id = sk;
  select count(*) into ev_before from fftt_private.events; select count(*) into src_before from fftt_private.registration_sources; select count(*) into audit_before from fftt_private.audit_events;
  rep := rep || pg_temp.ck('actors found (platform organizer, scorekeeper)', org is not null and sk is not null);
  rep := rep || pg_temp.ck('V5 objects exist and anon cannot execute any of them', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fftt\_%registration%\_v5' escape '\') = 4
    and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fftt\_%registration%\_v5' escape '\' and has_function_privilege('anon', p.oid, 'EXECUTE')));
  rep := rep || pg_temp.ck('the source table is private (RLS on, no API grants)', (select relrowsecurity from pg_class where oid = 'fftt_private.registration_sources'::regclass) and not has_table_privilege('authenticated', 'fftt_private.registration_sources', 'select') and not has_table_privilege('anon', 'fftt_private.registration_sources', 'select'));
  r := pg_temp.as_q(org, $q$select public.fftt_create_event_v3('V5 ACCEPTANCE DISPOSABLE A (fictional, rolled back)','2026-12-31',2)$q$); E := (r->>'event_id')::uuid;
  r := pg_temp.as_q(org, $q$select public.fftt_create_event_v3('V5 ACCEPTANCE DISPOSABLE B (fictional, rolled back)','2026-12-30',2)$q$); E2 := (r->>'event_id')::uuid;
  perform pg_temp.as_q(org, format($q$select public.fftt_set_staff_v3(%L,%L,'grant','scorekeeper')$q$, E, skmail));
  rep := rep || pg_temp.ck('a new event has no source (unconfigured, synthetic)', (pg_temp.as_q(org, format($q$select public.fftt_registration_source_v5(%L)$q$, E)) ->> 'configured')::boolean = false and (pg_temp.as_q(org, format($q$select public.fftt_registration_source_v5(%L)$q$, E)) ->> 'event_synthetic')::boolean);
  -- event-specific: two different sheets for two events
  r := pg_temp.as_q(org, format($q$select public.fftt_set_registration_source_v5(%L, %L::jsonb)$q$, E, json_build_object('kind','google-sheets','spreadsheet_id',SH,'spreadsheet_title','Sign-ups A','worksheet','Form responses 1','column_map',json_build_object('name','Participant'),'enabled',false)::text));
  rep := rep || pg_temp.ck('event A saved its Google source (disabled)', r->>'status' = 'saved');
  r := pg_temp.as_q(org, format($q$select public.fftt_set_registration_source_v5(%L, %L::jsonb)$q$, E2, json_build_object('kind','google-sheets','spreadsheet_id',SH2,'worksheet','Other tab','column_map','{}'::json)::text));
  rep := rep || pg_temp.ck('event B saved a DIFFERENT sheet and tab', r->>'status' = 'saved');
  rep := rep || pg_temp.ck('each event reads back its own sheet', (pg_temp.as_q(org, format($q$select public.fftt_registration_source_v5(%L)$q$, E)) ->> 'spreadsheet_id') = SH and (pg_temp.as_q(org, format($q$select public.fftt_registration_source_v5(%L)$q$, E2)) ->> 'spreadsheet_id') = SH2);
  -- access control
  t := pg_temp.try_as(sk, format($q$select public.fftt_registration_source_v5(%L)$q$, E));
  rep := rep || pg_temp.ck('a scorekeeper cannot read the source ('||left(t,24)||')', t like '42501%');
  t := pg_temp.try_as(sk, format($q$select public.fftt_set_registration_source_v5(%L,'{"kind":"fixture"}'::jsonb)$q$, E));
  rep := rep || pg_temp.ck('a scorekeeper cannot change it', t like '42501%');
  if outsider is not null then
    t := pg_temp.try_as(outsider, format($q$select public.fftt_registration_source_v5(%L)$q$, E));
    rep := rep || pg_temp.ck('an account with no grant cannot read it', t like '42501%');
  end if;
  t := pg_temp.try_as(null, format($q$select public.fftt_registration_source_v5(%L)$q$, E), true);
  rep := rep || pg_temp.ck('anonymous cannot call it', t like '42501%');
  t := pg_temp.try_as(sk, format($q$select public.fftt_record_registration_check_v5(%L,'ready',null,1)$q$, E));
  rep := rep || pg_temp.ck('a scorekeeper cannot record a test outcome', t like '42501%');
  -- validation and the synthetic rule
  t := pg_temp.try_as(org, format($q$select public.fftt_set_registration_source_v5(%L, %L::jsonb)$q$, E, json_build_object('kind','google-sheets','spreadsheet_id',SH,'worksheet','Form responses 1','enabled',true)::text));
  rep := rep || pg_temp.ck('a live Google source cannot be ENABLED on a synthetic event ('||left(t,40)||')', t like 'P0001%' and t like '%google-not-allowed-synthetic%');
  t := pg_temp.try_as(org, format($q$select public.fftt_set_registration_source_v5(%L, %L::jsonb)$q$, E, json_build_object('kind','google-sheets','spreadsheet_id','https://docs.google.com/spreadsheets/d/'||SH,'worksheet','x')::text));
  rep := rep || pg_temp.ck('a URL is refused (only the id is stored)', t like '22023%');
  t := pg_temp.try_as(org, format($q$select public.fftt_set_registration_source_v5(%L, %L::jsonb)$q$, E, json_build_object('kind','google-sheets','spreadsheet_id',SH,'worksheet','x','private_key','-----BEGIN PRIVATE KEY-----')::text));
  rep := rep || pg_temp.ck('a credential cannot be smuggled in', t like '22023%');
  t := pg_temp.try_as(org, format($q$select public.fftt_set_registration_source_v5(%L, %L::jsonb)$q$, E, json_build_object('kind','google-sheets','spreadsheet_id',SH,'worksheet','x','column_map',json_build_object('evil','x'))::text));
  rep := rep || pg_temp.ck('an unknown mapping field is refused', t like '22023%');
  -- status handling
  r := pg_temp.as_q(org, format($q$select public.fftt_record_registration_check_v5(%L,'ready',null,21)$q$, E));
  rep := rep || pg_temp.ck('a test outcome is recorded (status, count only)', r->>'status' = 'recorded' and (pg_temp.as_q(org, format($q$select public.fftt_registration_source_v5(%L)$q$, E)) ->> 'last_response_count')::int = 21);
  perform pg_temp.as_q(org, format($q$select public.fftt_set_registration_source_v5(%L, %L::jsonb)$q$, E, json_build_object('kind','google-sheets','spreadsheet_id',SH2,'worksheet','Form responses 1')::text));
  rep := rep || pg_temp.ck('changing the sheet forgets the old test result', (pg_temp.as_q(org, format($q$select public.fftt_registration_source_v5(%L)$q$, E)) ->> 'status') = 'untested');
  perform pg_temp.as_q(org, format($q$select public.fftt_set_registration_source_v5(%L,'{"kind":"fixture"}'::jsonb)$q$, E));
  rep := rep || pg_temp.ck('the fictional-demo source is allowed on a synthetic event', (pg_temp.as_q(org, format($q$select public.fftt_registration_source_v5(%L)$q$, E)) ->> 'kind') = 'fixture');
  rep := rep || pg_temp.ck('changes are audited without the spreadsheet id', (select count(*) from fftt_private.audit_events where event_id = E and operation = 'registration_source_changed') >= 3
    and not exists (select 1 from fftt_private.audit_events where event_id in (E,E2) and (before_state::text like '%SYNTHETIC_SHEET%' or after_state::text like '%SYNTHETIC_SHEET%')));
  rep := rep || pg_temp.ck('clearing works and is idempotent', (pg_temp.as_q(org, format($q$select public.fftt_clear_registration_source_v5(%L)$q$, E)) ->> 'status') = 'cleared' and (pg_temp.as_q(org, format($q$select public.fftt_clear_registration_source_v5(%L)$q$, E)) ->> 'status') = 'unchanged');
  -- deleting an empty draft removes its source
  r := pg_temp.as_q(org, format($q$select public.fftt_delete_event_v4(%L,'V5 ACCEPTANCE DISPOSABLE B (fictional, rolled back)')$q$, E2));
  rep := rep || pg_temp.ck('deleting an empty draft removes its source (cascade)', r->>'status' = 'deleted' and not exists (select 1 from fftt_private.registration_sources where event_id = E2));
  rep := rep || pg_temp.ck('the real events and their sources are untouched inside the script', (select count(*) from fftt_private.registration_sources where event_id not in (E,E2)) = src_before);
  raise exception E'ACCEPTANCE REPORT (this transaction is rolled back; nothing persists)%\nPASSED=% FAILED=%', rep, (length(rep) - length(replace(rep,'PASS ','')))/5, (length(rep) - length(replace(rep,'FAIL ','')))/5;
end
$acc$;
