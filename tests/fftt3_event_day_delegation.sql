-- Event-day Bracket Manager extension: run only on a disposable PostgreSQL database.
\set ON_ERROR_STOP on
begin;
create schema fftt_day;
grant usage on schema fftt_day to authenticated;
create function fftt_day.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role','authenticated')::text,true);
end $f$;
create function fftt_day.id(p_name text) returns uuid language sql stable as
$f$ select current_setting('fftt_day.' || p_name)::uuid $f$;
create function fftt_day.expect(p_label text,p_stmt text,p_state text,p_message text)
returns void language plpgsql as $f$
declare s text; msg text;
begin
  begin
    execute p_stmt;
  exception when others then
    get stacked diagnostics s=returned_sqlstate,msg=message_text;
    if s=p_state and msg=p_message then return; end if;
    raise exception 'WRONG DENIAL %: % % expected % %',p_label,s,msg,p_state,p_message;
  end;
  raise exception 'NOT DENIED %',p_label;
end $f$;
grant execute on all functions in schema fftt_day to authenticated;
insert into auth.users(id,email,role,aud,instance_id,is_anonymous,email_confirmed_at)
values
 ('c0000000-0000-4000-8000-000000000021','manager@fftt-day.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now()),
 ('c0000000-0000-4000-8000-000000000022','scorer@fftt-day.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now()),
 ('c0000000-0000-4000-8000-000000000023','stranger@fftt-day.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now());
select set_config('fftt_day.org',(select user_id::text from fftt_private.platform_organizers limit 1),true);
select set_config('fftt_day.mgr','c0000000-0000-4000-8000-000000000021',true);
select set_config('fftt_day.scorer','c0000000-0000-4000-8000-000000000022',true);
select set_config('fftt_day.stranger','c0000000-0000-4000-8000-000000000023',true);
set local role authenticated;
select fftt_day.as_user(fftt_day.id('org'));
select set_config('fftt_day.event',(public.fftt_create_event_v3('FICTIONAL EVENT DAY','2026-11-08',2)->>'event_id'),true);
select set_config('fftt_day.foreign',(public.fftt_create_event_v3('FICTIONAL FOREIGN EVENT','2026-11-08',2)->>'event_id'),true);
select public.fftt_upsert_players_v3(fftt_day.id('event'),
  '[{"name":"Fictional Alpha Player","rating":3,"rating_status":"provisional"},{"name":"Fictional Bravo Player","rating":2,"rating_status":"provisional"}]'::jsonb);
select public.fftt_set_staff_v3(fftt_day.id('event'),'manager@fftt-day.invalid','grant','bracket_manager');
select public.fftt_set_staff_v3(fftt_day.id('event'),'scorer@fftt-day.invalid','grant','scorekeeper');

-- The manager's own scope; check-in and one safe walk-in.
select fftt_day.as_user(fftt_day.id('mgr'));
do $run$
declare e uuid:=fftt_day.id('event'); sn jsonb; p uuid; ids jsonb;
begin
  sn := public.fftt_bracket_manager_snapshot_v1(e);
  if sn -> 'staff' <> '[]'::jsonb or sn::text like '%@fftt-day.invalid%' then raise exception 'private info leaked'; end if;
  if exists(select 1 from jsonb_array_elements(sn->'players') p where p->'registration_refs'<>'[]'::jsonb)
    then raise exception 'registration references leaked'; end if;
  for p in select (x->>'id')::uuid from jsonb_array_elements(sn->'players') x loop
    perform public.fftt_set_checkin_v3(e,p,true);
  end loop;
  if (public.fftt_event_day_walkin_v1(e,'Fictional Charlie Walkin',1))->>'status'<>'saved'
    then raise exception 'walk-in was not saved'; end if;
  perform fftt_day.expect('duplicate walkin',
    format($q$select public.fftt_event_day_walkin_v1(%L,'Fictional Charlie Walkin',1)$q$,e),
    'P0001','fftt_conflict');
  perform fftt_day.expect('walkin email',
    format($q$select public.fftt_event_day_walkin_v1(%L,'bad@example.com',1)$q$,e),
    '22023','fftt_validation_error');
  perform fftt_day.expect('walkin no level',
    format($q$select public.fftt_event_day_walkin_v1(%L,'Fictional Delta Walkin',0)$q$,e),
    '22023','fftt_validation_error');
  sn := public.fftt_bracket_manager_snapshot_v1(e);
  if jsonb_array_length(sn->'players')<>3 then raise exception 'walk-in count wrong'; end if;
  if (select count(*) from jsonb_array_elements(sn->'players') p where p->>'checked_in'='true')<>3
    then raise exception 'check-in count wrong'; end if;
  perform fftt_day.expect('organizer snapshot',
    format($q$select public.fftt_organizer_snapshot_v3(%L)$q$,e),'42501','forbidden');
  perform fftt_day.expect('staff grant',
    format($q$select public.fftt_set_staff_v3(%L,'stranger@fftt-day.invalid','grant','organizer')$q$,e),'42501','forbidden');
  perform fftt_day.expect('registration source',
    format($q$select public.fftt_registration_source_v5(%L)$q$,e),'42501','forbidden');
  perform fftt_day.expect('publication',
    format($q$select public.fftt_set_visibility_v3(%L,true)$q$,e),'42501','forbidden');
  perform fftt_day.expect('private export',
    format($q$select public.fftt_export_event_v3(%L)$q$,e),'42501','forbidden');
  perform fftt_day.expect('foreign check-in',
    format($q$select public.fftt_set_checkin_v3(%L,%L,true)$q$,fftt_day.id('foreign'),(sn->'players'->0->>'id')::uuid),
    '42501','forbidden');
  select jsonb_agg(p->'id' order by p->>'name') into ids from jsonb_array_elements(sn->'players') p;
  perform public.fftt_build_championship_v3(e,ids,0,false);
  perform fftt_day.expect('late walkin',format($q$select public.fftt_event_day_walkin_v1(%L,'Fictional Late Player',1)$q$,e),
    'P0001','fftt_conflict');
  perform fftt_day.expect('late checkin',format($q$select public.fftt_set_checkin_v3(%L,%L,false)$q$,e,(sn->'players'->0->>'id')::uuid),
    'P0001','fftt_conflict');
  perform fftt_day.expect('cannot complete early',format($q$select public.fftt_set_lifecycle_v3(%L,'complete')$q$,e),
    'P0001','fftt_conflict');
  perform fftt_day.expect('manager cannot archive',format($q$select public.fftt_set_lifecycle_v3(%L,'archived')$q$,e),
    '42501','forbidden');
end $run$;

-- Scorekeeper remains limited to the Match Desk, and outsider has no event.
select fftt_day.as_user(fftt_day.id('scorer'));
select fftt_day.expect('scorer walkin',
 format($q$select public.fftt_event_day_walkin_v1(%L,'Fictional Scorekeeper Entry',1)$q$,fftt_day.id('event')),
 '42501','forbidden');
select fftt_day.expect('scorer checkin',
 format($q$select public.fftt_set_checkin_v3(%L,%L,true)$q$,fftt_day.id('event'),gen_random_uuid()),
 '42501','forbidden');
select fftt_day.expect('scorer lifecycle',
 format($q$select public.fftt_set_lifecycle_v3(%L,'complete')$q$,fftt_day.id('event')),
 '42501','forbidden');
select fftt_day.as_user(fftt_day.id('stranger'));
select fftt_day.expect('outsider walkin',
 format($q$select public.fftt_event_day_walkin_v1(%L,'Fictional Outsider Entry',1)$q$,fftt_day.id('event')),
 '42501','forbidden');

-- Manager can change an unplayed match format, adjudicate no-show and correct an accepted result.
select fftt_day.as_user(fftt_day.id('mgr'));
do $play$
declare e uuid:=fftt_day.id('event'); r record; n integer:=0; sc text; m jsonb;
begin
  select * into r from public.fftt_matchdesk_v2(e) order by round_number,slot limit 1;
  if not found then raise exception 'no ready match'; end if;
  perform public.fftt_set_match_format_v4(e,r.match_id,1,21);
  perform public.fftt_forfeit_match_v3(e,r.match_id,r.match_version,r.player_2_id,'Did not arrive at table');
  -- Correct a completed result with a required reason and an expected version.
  -- The first completed match was a walkover. Test audited correction without changing the winner.
  select x into m from jsonb_array_elements(public.fftt_bracket_manager_snapshot_v1(e)->'matches') x
    where x->>'status'='complete' and x->>'game_scores'='W/O' limit 1;
  if m is null then raise exception 'no completed walkover to correct'; end if;
  perform public.fftt_correct_result_v3(e,(m->>'id')::uuid,(m->>'version')::bigint,
    (m->>'winner_id')::uuid,'21-0','Scorecard verified');
  loop
    select * into r from public.fftt_matchdesk_v2(e) order by round_number,slot limit 1;
    exit when not found;
    select string_agg(r.points_to_win::text || '-0',',') into sc
      from generate_series(1,((r.best_of + 1)/2));
    perform public.fftt_submit_match_result_v2(e,r.match_id,r.bracket_generation,r.match_version,
      gen_random_uuid(),r.player_1_id,sc,1);
    n:=n+1;
    if n>10 then raise exception 'unexpected match loop'; end if;
  end loop;
  if (public.fftt_bracket_manager_snapshot_v1(e)->'brackets'->0->>'status') is null
     then raise exception 'manager snapshot missing'; end if;
  perform fftt_day.expect('manager archive remains denied',
      format($q$select public.fftt_set_lifecycle_v3(%L,'archived')$q$,e),'42501','forbidden');
  perform public.fftt_set_lifecycle_v3(e,'complete');
  if not exists(select 1 from fftt_private.events where id=e and lifecycle='complete')
    then raise exception 'event not complete'; end if;
end $play$;
rollback;
select 'PASS: event-day delegate grants, denial, check-in, walk-ins and completion' as result;
