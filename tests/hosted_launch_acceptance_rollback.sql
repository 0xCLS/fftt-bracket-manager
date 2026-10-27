-- FFTT3 hosted LAUNCH acceptance (run in the Supabase SQL editor of fftt-bracket-manager-dev AFTER the in-place upgrade and after the real
-- event exists). ONE transaction that ALWAYS ends by raising an exception carrying the report, so nothing persists. It uses existing
-- accounts by role/claim switching only (no passwords, no accounts created) and never writes a player, source or grant into the REAL event:
-- every write happens in a clearly named disposable fictional event (real mode) that is rolled back with the transaction.
-- Set REAL_EVENT below to the real FFTT3 event id before running.
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
  REAL_EVENT constant uuid := 'e81a2f62-84e6-4338-9847-d437897110c2';
  org uuid; sk uuid; sk2 uuid; outsider uuid; rep text := ''; t text; r jsonb; D uuid; skmail text; sk2mail text;
  ev_before int; players_before int; staff_before int; audit_real_before int; src_before int;
  pids jsonb; m jsonb; n int;
begin
  select user_id into org from fftt_private.platform_organizers limit 1;
  -- two existing fictional scorekeepers that hold grants on OTHER (fictional) events only
  select s.user_id into sk from fftt_private.event_staff s where s.role = 'scorekeeper' and s.active and s.user_id <> org
    and not exists (select 1 from fftt_private.event_staff x where x.event_id = REAL_EVENT and x.user_id = s.user_id) order by s.user_id limit 1;
  select s.user_id into sk2 from fftt_private.event_staff s where s.role = 'scorekeeper' and s.active and s.user_id <> org and s.user_id <> sk
    and not exists (select 1 from fftt_private.event_staff x where x.event_id = REAL_EVENT and x.user_id = s.user_id) order by s.user_id limit 1;
  select u.id into outsider from auth.users u where u.id <> org and not exists (select 1 from fftt_private.event_staff s where s.user_id = u.id)
    and not exists (select 1 from fftt_private.platform_organizers p where p.user_id = u.id) limit 1;
  select email into skmail from auth.users where id = sk; select email into sk2mail from auth.users where id = sk2;
  select count(*) into ev_before from fftt_private.events;
  select count(*) into players_before from fftt_private.players where event_id = REAL_EVENT;
  select count(*) into staff_before from fftt_private.event_staff where event_id = REAL_EVENT;
  select count(*) into audit_real_before from fftt_private.audit_events where event_id = REAL_EVENT;
  select count(*) into src_before from fftt_private.registration_sources where event_id = REAL_EVENT;

  -- A. the real event and the upgrade
  rep := rep || pg_temp.ck('real event is real-mode, draft, NOT public, 0 players, 1 staff (the Organizer), no source yet',
    (select not synthetic_only and lifecycle = 'draft' and not public_visible from fftt_private.events where id = REAL_EVENT)
    and players_before = 0 and staff_before = 1 and src_before = 0);
  rep := rep || pg_temp.ck('exactly one real event and four fictional events exist', (select count(*) from fftt_private.events where not synthetic_only) = 1 and (select count(*) from fftt_private.events where synthetic_only) = 4);
  rep := rep || pg_temp.ck('event mode is immutable (trigger present, old CHECK gone)', (select count(*) from pg_trigger where tgname = 'fftt_events_event_mode_immutable' and not tgisinternal) = 1
    and not exists (select 1 from pg_constraint where conname = 'events_synthetic_only_check'));
  rep := rep || pg_temp.ck('actors found (organizer, 2 fictional scorekeepers without a grant on the real event)', org is not null and sk is not null and sk2 is not null);

  -- B. who may see the real event
  r := pg_temp.as_q(org, 'select public.fftt_my_events_v4()');
  rep := rep || pg_temp.ck('the Organizer lists the real event (and the 4 fictional ones)', jsonb_array_length(r) = 5 and exists (select 1 from jsonb_array_elements(r) e where e->>'event_id' = REAL_EVENT::text));
  r := pg_temp.as_q(org, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, REAL_EVENT));
  rep := rep || pg_temp.ck('the Organizer reads the real event snapshot (0 players, 0 matches)', jsonb_array_length(r->'players') = 0 and jsonb_array_length(r->'matches') = 0);
  t := pg_temp.try_as(sk, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, REAL_EVENT));
  rep := rep || pg_temp.ck('a fictional scorekeeper (other events) cannot read the real roster ('||left(t,18)||')', t like '42501%');
  t := pg_temp.try_as(sk, format($q$select to_jsonb(m) from public.fftt_matchdesk_v2(%L) m limit 1$q$, REAL_EVENT));
  rep := rep || pg_temp.ck('...nor open its Match Desk ('||left(t,18)||')', t like '42501%');
  t := pg_temp.try_as(sk, format($q$select public.fftt_registration_source_v5(%L)$q$, REAL_EVENT));
  rep := rep || pg_temp.ck('...nor read the registration source', t like '42501%');
  if outsider is not null then   -- only if the project holds an account with no grant at all
    t := pg_temp.try_as(outsider, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, REAL_EVENT));
    rep := rep || pg_temp.ck('an account with no grant cannot read the real event', t like '42501%');
  end if;
  t := pg_temp.try_as(null, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, REAL_EVENT), true);
  rep := rep || pg_temp.ck('anonymous cannot call organizer functions', t like '42501%');
  rep := rep || pg_temp.ck('nothing from the real event is public (view empty for anon)',
    (select count(*) from fftt_private.events where public_visible) = 0 and (pg_temp.as_q(null, 'select count(*)::int::text::jsonb from public.fftt_public_tournament_v1', true))::int = 0);

  -- C. Google registration source rules on the REAL event (written and rolled back)
  t := pg_temp.try_as(org, format($q$select public.fftt_set_registration_source_v5(%L,'{"kind":"fixture","enabled":true}'::jsonb)$q$, REAL_EVENT));
  rep := rep || pg_temp.ck('the fictional demo source is refused on the real event ('||left(t,40)||')', t like 'P0001%' or t like '22023%');
  r := pg_temp.as_q(org, format($q$select public.fftt_set_registration_source_v5(%L, %L::jsonb)$q$, REAL_EVENT,
    json_build_object('kind','google-sheets','spreadsheet_id','SYNTHETIC_ACCEPTANCE_SHEET_0123456789','worksheet','Form Responses 1','column_map','{}'::json,'enabled',true)::text));
  rep := rep || pg_temp.ck('the Organizer may save AND enable a Google source on the real event', r->>'status' = 'saved' and (pg_temp.as_q(org, format($q$select public.fftt_registration_source_v5(%L)$q$, REAL_EVENT)) ->> 'enabled')::boolean);
  t := pg_temp.try_as(sk, format($q$select public.fftt_set_registration_source_v5(%L,'{"kind":"google-sheets","spreadsheet_id":"X","worksheet":"Y"}'::jsonb)$q$, REAL_EVENT));
  rep := rep || pg_temp.ck('a scorekeeper cannot change the source', t like '42501%');
  rep := rep || pg_temp.ck('source rows hold no answers or contacts (column list is fixed)', (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'fftt_private.registration_sources'::regclass and attnum > 0 and not attisdropped)
    = 'event_id,kind,spreadsheet_id,spreadsheet_title,worksheet,column_map,enabled,status,last_error,last_checked_at,last_ok_at,last_response_count,updated_by,updated_at');

  -- D. real-mode scoring, isolation and revoke on a DISPOSABLE event (never the real one)
  r := pg_temp.as_q(org, $q$select public.fftt_create_event_v3('LAUNCH ACCEPTANCE DISPOSABLE (fictional, rolled back)','2026-12-31',2)$q$); D := (r->>'event_id')::uuid;
  rep := rep || pg_temp.ck('a new event is real-mode', not (select synthetic_only from fftt_private.events where id = D));
  perform pg_temp.as_q(org, format($q$select public.fftt_set_staff_v3(%L,%L,'grant','scorekeeper')$q$, D, skmail));
  perform pg_temp.as_q(org, format($q$select public.fftt_set_staff_v3(%L,%L,'grant','scorekeeper')$q$, D, sk2mail));
  perform pg_temp.as_q(org, format($q$select public.fftt_upsert_players_v3(%L,%L::jsonb)$q$, D, '[{"name":"Fictional Ada Quill","rating":3,"rating_status":"provisional"},{"name":"Fictional Ben Marlow","rating":2,"rating_status":"provisional"}]'));
  perform pg_temp.as_q(org, format($q$select public.fftt_set_checkin_bulk_v3(%L,null,true)$q$, D));
  pids := (pg_temp.as_q(org, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, D))) -> 'players';
  rep := rep || pg_temp.ck('full names are stored as given', (select string_agg(p->>'name', '|' order by p->>'name') from jsonb_array_elements(pids) p) = 'Fictional Ada Quill|Fictional Ben Marlow');
  perform pg_temp.as_q(org, format($q$select public.fftt_build_championship_v3(%L,%L::jsonb,0,false)$q$, D, (select jsonb_agg(p->>'id') from jsonb_array_elements(pids) p)::text));
  m := pg_temp.as_q(sk, format($q$select to_jsonb(m) from public.fftt_matchdesk_v2(%L) m limit 1$q$, D));
  rep := rep || pg_temp.ck('scorekeeper A sees the ready match', m is not null);
  perform pg_temp.as_q(sk, format($q$select public.fftt_assign_table_v3(%L,%L,1)$q$, D, m->>'match_id'));
  r := pg_temp.as_q(sk, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,%L,%L,'11-6, 11-8',1)$q$, D, m->>'match_id', m->>'bracket_generation', m->>'match_version', gen_random_uuid(), m->>'player_1_id'));
  rep := rep || pg_temp.ck('scorekeeper A result is ACCEPTED', r->>'status' = 'accepted');
  r := pg_temp.as_q(sk2, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,%L,%L,'11-9, 11-7',1)$q$, D, m->>'match_id', m->>'bracket_generation', m->>'match_version', gen_random_uuid(), m->>'player_2_id'));
  rep := rep || pg_temp.ck('scorekeeper B stale second result is REJECTED (one result only)', r->>'status' = 'rejected');
  perform pg_temp.as_q(org, format($q$select public.fftt_set_staff_v3(%L,%L,'revoke',null)$q$, D, sk2mail));
  t := pg_temp.try_as(sk2, format($q$select to_jsonb(m) from public.fftt_matchdesk_v2(%L) m limit 1$q$, D));
  rep := rep || pg_temp.ck('a revoked scorekeeper is denied immediately ('||left(t,18)||')', t like '42501%');
  t := pg_temp.try_as(sk, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, REAL_EVENT));
  rep := rep || pg_temp.ck('the disposable grants gave no access to the real event', t like '42501%');
  rep := rep || pg_temp.ck('the real event is untouched inside the script (players, grants, staff)', (select count(*) from fftt_private.players where event_id = REAL_EVENT) = players_before
    and (select count(*) from fftt_private.event_staff where event_id = REAL_EVENT) = staff_before);
  rep := rep || pg_temp.ck('audit entries carry no spreadsheet id, e-mail or phone', not exists (select 1 from fftt_private.audit_events where event_id in (REAL_EVENT, D) and (before_state::text ~* '(@|SYNTHETIC_ACCEPTANCE_SHEET)' or after_state::text ~* '(@|SYNTHETIC_ACCEPTANCE_SHEET)')));
  raise exception E'LAUNCH ACCEPTANCE REPORT (this transaction is rolled back; nothing persists)%\nPASSED=% FAILED=%', rep, (length(rep) - length(replace(rep,'PASS ','')))/5, (length(rep) - length(replace(rep,'FAIL ','')))/5;
end
$acc$;
