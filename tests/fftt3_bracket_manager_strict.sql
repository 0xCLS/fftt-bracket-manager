-- Strict Bracket Manager verification for a DISPOSABLE PostgreSQL copy only (never the hosted project).
-- Every denial is asserted by exact SQLSTATE and message, so a typo or unrelated failure cannot masquerade as a
-- successful denial. All data is fictional; the whole script runs in one transaction and rolls back.
-- Requires: the schema after the Bracket Manager proposal, and one platform organizer (any existing or fixture user).
\set ON_ERROR_STOP on
begin;
create schema fftt_t;
grant usage on schema fftt_t to authenticated, anon;

create function fftt_t.as_user(p_uid uuid, p_role text default 'authenticated', p_extra jsonb default '{}') returns void
language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', (jsonb_build_object('sub', p_uid, 'role', p_role) || p_extra)::text, true);
end $f$;

create function fftt_t.g(p_key text) returns uuid language sql stable as $f$ select current_setting('t.' || p_key)::uuid $f$;

-- Runs p_sql and requires it to fail with exactly this SQLSTATE and message pattern.
create function fftt_t.expect(p_label text, p_sql text, p_state text, p_msg text) returns void
language plpgsql as $f$
declare s text; m text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics s = returned_sqlstate, m = message_text;
    if s = p_state and m like p_msg then return; end if;
    raise exception 'WRONG DENIAL [%]: got % / % ; wanted % / %', p_label, s, m, p_state, p_msg;
  end;
  raise exception 'NOT DENIED [%]', p_label;
end $f$;

create function fftt_t.forbidden(p_label text, p_sql text) returns void language sql as
$f$ select fftt_t.expect(p_label, p_sql, '42501', 'forbidden') $f$;

-- Plays every pending, fully-seeded match (player 1 wins) visible on the match desk and returns how many.
create function fftt_t.play(p_event uuid, p_bracket text default null) returns integer
language plpgsql as $f$
declare r record; n integer := 0; need integer; sc text;
begin
  loop
    select * into r from public.fftt_matchdesk_v2(p_event) d
     where p_bracket is null or d.bracket = p_bracket order by d.round_number, d.slot limit 1;
    exit when not found;
    need := (r.best_of + 1) / 2;
    select string_agg(r.points_to_win::text || '-0', ',') into sc from generate_series(1, need);
    perform public.fftt_submit_match_result_v2(p_event, r.match_id, r.bracket_generation, r.match_version,
      gen_random_uuid(), r.player_1_id, sc, 1);
    n := n + 1;
    exit when n > 40;
  end loop;
  return n;
end $f$;
grant execute on all functions in schema fftt_t to authenticated, anon;

insert into auth.users(id,email,role,aud,instance_id,is_anonymous,email_confirmed_at,banned_until) values
 ('b0000000-0000-4000-8000-000000000011','manager@fftt-role-test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now(),null),
 ('b0000000-0000-4000-8000-000000000012','scorer@fftt-role-test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now(),null),
 ('b0000000-0000-4000-8000-000000000013','unconfirmed@fftt-role-test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,null,null),
 ('b0000000-0000-4000-8000-000000000014','banned@fftt-role-test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now(),now() + interval '1 day'),
 ('b0000000-0000-4000-8000-000000000015','stranger@fftt-role-test.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now(),null);
select set_config('t.org', (select user_id::text from fftt_private.platform_organizers order by user_id limit 1), true);
select set_config('t.mgr', 'b0000000-0000-4000-8000-000000000011', true);
select set_config('t.sk', 'b0000000-0000-4000-8000-000000000012', true);
select set_config('t.stranger', 'b0000000-0000-4000-8000-000000000015', true);

set local role authenticated;

-- ===== 1. Organizer prepares three fictional events (E: manager+scorer, F: nobody, G: scorer only) =====
select fftt_t.as_user(fftt_t.g('org'));
select set_config('t.e', (public.fftt_create_event_v3('FICTIONAL BM STRICT E','2026-11-08',4)->>'event_id'), true);
select set_config('t.f', (public.fftt_create_event_v3('FICTIONAL BM STRICT F','2026-11-08',2)->>'event_id'), true);
select set_config('t.g', (public.fftt_create_event_v3('FICTIONAL BM STRICT G','2026-11-08',4)->>'event_id'), true);
select public.fftt_upsert_players_v3(e, '[{"name":"Fictional Strict A","rating":4,"rating_status":"provisional"},{"name":"Fictional Strict B","rating":3,"rating_status":"provisional"},{"name":"Fictional Strict C","rating":2,"rating_status":"provisional"},{"name":"Fictional Strict D","rating":1,"rating_status":"provisional"}]'::jsonb)
  from (select fftt_t.g('e') e union all select fftt_t.g('f') union all select fftt_t.g('g')) x;
select public.fftt_set_checkin_bulk_v3(e, null, true) from (select fftt_t.g('e') e union all select fftt_t.g('f') union all select fftt_t.g('g')) x;
select public.fftt_set_staff_v3(fftt_t.g('e'), 'manager@fftt-role-test.invalid', 'grant', 'bracket_manager');
select public.fftt_set_staff_v3(fftt_t.g('e'), 'scorer@fftt-role-test.invalid', 'grant', 'scorekeeper');
select public.fftt_set_staff_v3(fftt_t.g('g'), 'scorer@fftt-role-test.invalid', 'grant', 'scorekeeper');

-- Grant eligibility is unchanged for the new role: unconfirmed, banned and unknown identities are refused.
select fftt_t.expect('grant unconfirmed', format($q$select public.fftt_set_staff_v3(%L,'unconfirmed@fftt-role-test.invalid','grant','bracket_manager')$q$, fftt_t.g('e')), '22023', 'fftt_ineligible_staff_target');
select fftt_t.expect('grant banned', format($q$select public.fftt_set_staff_v3(%L,'banned@fftt-role-test.invalid','grant','bracket_manager')$q$, fftt_t.g('e')), '22023', 'fftt_ineligible_staff_target');
select fftt_t.expect('grant unknown identity', format($q$select public.fftt_set_staff_v3(%L,'nobody@fftt-role-test.invalid','grant','bracket_manager')$q$, fftt_t.g('e')), '22023', 'fftt_ineligible_staff_target');
select fftt_t.expect('grant invalid role', format($q$select public.fftt_set_staff_v3(%L,'stranger@fftt-role-test.invalid','grant','superuser')$q$, fftt_t.g('e')), '22023', 'fftt_validation_error');
select fftt_t.expect('legacy manage_staff cannot mint the new role', format($q$select public.fftt_manage_staff_v1(%L,%L,'grant','bracket_manager')$q$, fftt_t.g('e'), fftt_t.g('stranger')), '22023', '%');

-- ===== 2. Manager: scope, sanitized snapshot, first-time build, table, scoring, consolation, doubles =====
select fftt_t.as_user(fftt_t.g('mgr'));
do $mgr$
declare e uuid := fftt_t.g('e'); snap jsonb; ids jsonb; mid uuid; txt text; n integer; r jsonb; dsc text;
begin
  if jsonb_array_length(public.fftt_my_events_v4()) <> 1 then raise exception 'manager sees wrong number of events'; end if;
  if public.fftt_my_events_v4() -> 0 ->> 'role' <> 'bracket_manager' then raise exception 'manager role label wrong'; end if;
  if public.fftt_my_events_v4() -> 0 -> 'players' <> 'null'::jsonb then raise exception 'manager sees organizer-only player count'; end if;
  if public.fftt_my_events_v4() -> 0 ->> 'deletable' <> 'false' then raise exception 'manager sees deletable event'; end if;
  if public.fftt_staff_role_v1(e) <> 'bracket_manager' then raise exception 'role endpoint wrong'; end if;
  snap := public.fftt_bracket_manager_snapshot_v1(e);
  txt := snap::text;
  if snap -> 'staff' <> '[]'::jsonb then raise exception 'manager snapshot leaks staff'; end if;
  if txt like '%@%' or txt ~* 'fftt-role-test' then raise exception 'manager snapshot leaks an email identity'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(snap) k) <> array['brackets','consolation_candidates','doubles','event','matches','players','staff'] then
    raise exception 'unexpected snapshot keys %', (select array_agg(k order by k) from jsonb_object_keys(snap) k);
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(snap -> 'players' -> 0) k) <>
     array['checked_in','first_champ_loss','id','name','rating','rating_confirmed','rating_status','registration_refs','source'] then
    raise exception 'unexpected player keys';
  end if;
  if exists (select 1 from jsonb_array_elements(snap -> 'players') p where p -> 'registration_refs' <> '[]'::jsonb) then raise exception 'registration refs leaked'; end if;
  select jsonb_agg(p -> 'id' order by p ->> 'name') into ids from jsonb_array_elements(snap -> 'players') p;
  r := public.fftt_build_championship_v3(e, ids, 0, false);
  if r ->> 'status' <> 'built' then raise exception 'manager build failed %', r; end if;
  -- idempotent first-build: a second identical build must not silently rebuild
  perform fftt_t.forbidden('manager second championship build', format($q$select public.fftt_build_championship_v3(%L,%L::jsonb,1,true)$q$, e, ids));
  perform fftt_t.forbidden('manager unconfirmed rebuild', format($q$select public.fftt_build_championship_v3(%L,%L::jsonb,1,false)$q$, e, ids));
  select (m ->> 'id')::uuid into mid from jsonb_array_elements(public.fftt_bracket_manager_snapshot_v1(e) -> 'matches') m
   where m ->> 'status' = 'pending' order by (m ->> 'round')::int, (m ->> 'slot')::int limit 1;
  perform public.fftt_assign_table_v3(e, mid, 2);
  if (select table_number from public.fftt_matchdesk_v2(e) where match_id = mid) <> 2 then raise exception 'table not assigned'; end if;
  -- the other staff roles' read APIs remain usable by a manager
  perform public.fftt_event_brief_v3(e);
  perform public.fftt_score_decision_snapshot_v2(e, null);
  n := fftt_t.play(e, 'championship');
  if n <> 3 then raise exception 'manager scored % championship matches, expected 3', n; end if;
  -- consolation: first-time build allowed, then play it
  snap := public.fftt_bracket_manager_snapshot_v1(e);
  select jsonb_agg(c ->> 'player_id') into ids from jsonb_array_elements(snap -> 'consolation_candidates') c where c ->> 'state' in ('eligible','reviewed','placed');
  if jsonb_array_length(ids) <> 2 then raise exception 'expected 2 consolation candidates, got %', ids; end if;
  r := public.fftt_build_consolation_v3(e, ids, 1, false);
  if r ->> 'status' <> 'built' then raise exception 'manager consolation build failed %', r; end if;
  perform fftt_t.forbidden('manager consolation rebuild', format($q$select public.fftt_build_consolation_v3(%L,%L::jsonb,1,true)$q$, e, ids));
  if fftt_t.play(e, 'consolation') <> 1 then raise exception 'consolation not scored'; end if;
  -- doubles
  perform public.fftt_set_doubles_teams_v3(e, (ids ->> 0)::uuid, (ids ->> 1)::uuid);
  select string_agg((snap -> 'event' -> 'formats' -> 'doubles' ->> 'points') || '-0', ',') into dsc
    from generate_series(1, ((snap -> 'event' -> 'formats' -> 'doubles' ->> 'best_of')::int + 1) / 2);
  r := public.fftt_record_doubles_result_v3(e, 1, dsc);
  if r ->> 'status' <> 'recorded' then raise exception 'doubles not recorded %', r; end if;
  perform fftt_t.forbidden('manager changes a recorded doubles result', format($q$select public.fftt_record_doubles_result_v3(%L,2,'0-11,0-11')$q$, e));
end $mgr$;

-- ===== 3. Manager: every organizer-only or foreign-event operation is refused with the exact error =====
do $deny$
declare e uuid := fftt_t.g('e'); f uuid := fftt_t.g('f'); x uuid := gen_random_uuid(); p uuid := gen_random_uuid();
begin
  perform fftt_t.forbidden('organizer_snapshot', format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, e));
  perform fftt_t.forbidden('audit_log', format($q$select public.fftt_audit_log_v3(%L,50)$q$, e));
  perform fftt_t.forbidden('export_event', format($q$select public.fftt_export_event_v3(%L)$q$, e));
  perform fftt_t.forbidden('registration_source read', format($q$select public.fftt_registration_source_v5(%L)$q$, e));
  perform fftt_t.forbidden('registration_source set', format($q$select public.fftt_set_registration_source_v5(%L,'{"kind":"fixture","enabled":false}'::jsonb)$q$, e));
  perform fftt_t.forbidden('registration_source clear', format($q$select public.fftt_clear_registration_source_v5(%L)$q$, e));
  perform fftt_t.forbidden('registration check', format($q$select public.fftt_record_registration_check_v5(%L,'ok',null,0)$q$, e));
  perform fftt_t.forbidden('checkin_registrants', format($q$select public.fftt_checkin_registrants_v4(%L,'[]'::jsonb,true)$q$, e));
  perform fftt_t.forbidden('set_checkin', format($q$select public.fftt_set_checkin_v3(%L,%L,false)$q$, e, p));
  perform fftt_t.forbidden('set_checkin_bulk', format($q$select public.fftt_set_checkin_bulk_v3(%L,null,false)$q$, e));
  perform fftt_t.forbidden('upsert_players', format($q$select public.fftt_upsert_players_v3(%L,'[{"name":"Intruder","rating":1,"rating_status":"provisional"}]'::jsonb)$q$, e));
  perform fftt_t.forbidden('remove_player', format($q$select public.fftt_remove_player_v3(%L,%L)$q$, e, p));
  perform fftt_t.forbidden('confirm_ratings', format($q$select public.fftt_confirm_ratings_v4(%L,'[]'::jsonb)$q$, e));
  perform fftt_t.forbidden('update_event', format($q$select public.fftt_update_event_v3(%L,'Renamed','2026-11-09',4)$q$, e));
  perform fftt_t.forbidden('set_formats', format($q$select public.fftt_set_formats_v4(%L,'{}'::jsonb)$q$, e));
  perform fftt_t.forbidden('set_match_format', format($q$select public.fftt_set_match_format_v4(%L,%L,3,11)$q$, e, x));
  perform fftt_t.forbidden('set_lifecycle', format($q$select public.fftt_set_lifecycle_v3(%L,'archived')$q$, e));
  perform fftt_t.forbidden('set_visibility publish', format($q$select public.fftt_set_visibility_v3(%L,true)$q$, e));
  perform fftt_t.forbidden('correct_result', format($q$select public.fftt_correct_result_v3(%L,%L,1,%L,'11-0,11-0','x')$q$, e, x, p));
  perform fftt_t.forbidden('forfeit', format($q$select public.fftt_forfeit_match_v3(%L,%L,1,%L,'x')$q$, e, x, p));
  perform fftt_t.forbidden('set_staff grant', format($q$select public.fftt_set_staff_v3(%L,'stranger@fftt-role-test.invalid','grant','organizer')$q$, e));
  perform fftt_t.forbidden('set_staff self-escalate', format($q$select public.fftt_set_staff_v3(%L,'manager@fftt-role-test.invalid','grant','organizer')$q$, e));
  perform fftt_t.forbidden('manage_staff', format($q$select public.fftt_manage_staff_v1(%L,%L,'grant','scorekeeper')$q$, e, fftt_t.g('stranger')));
  perform fftt_t.forbidden('delete_event', format($q$select public.fftt_delete_event_v4(%L,'FICTIONAL BM STRICT E')$q$, e));
  perform fftt_t.forbidden('restore_event', format($q$select public.fftt_restore_event_v4(%L)$q$, e));
  perform fftt_t.expect('create_event (not a platform organizer)', $q$select public.fftt_create_event_v3('FICTIONAL MGR EVENT','2026-11-08',2)$q$, '42501', 'forbidden');
  -- a different event the manager holds no grant on
  perform fftt_t.forbidden('foreign snapshot', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, f));
  perform fftt_t.forbidden('foreign brief', format($q$select public.fftt_event_brief_v3(%L)$q$, f));
  perform fftt_t.forbidden('foreign matchdesk', format($q$select * from public.fftt_matchdesk_v2(%L)$q$, f));
  perform fftt_t.forbidden('foreign build', format($q$select public.fftt_build_championship_v3(%L,'[]'::jsonb,0,false)$q$, f));
  perform fftt_t.forbidden('foreign table', format($q$select public.fftt_assign_table_v3(%L,%L,1)$q$, f, x));
  perform fftt_t.forbidden('foreign score', format($q$select public.fftt_submit_match_result_v2(%L,%L,0,0,%L,%L,'11-0,11-0',1)$q$, f, x, x, x));
  perform fftt_t.forbidden('foreign doubles', format($q$select public.fftt_record_doubles_result_v3(%L,1,'11-0,11-0')$q$, f));
  perform fftt_t.forbidden('nonexistent event', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, x));
  -- base tables and private functions are not reachable through the API role
  perform fftt_t.expect('direct select events', $q$select * from fftt_private.events$q$, '42501', 'permission denied%');
  perform fftt_t.expect('direct insert event_staff', format($q$insert into fftt_private.event_staff(event_id,user_id,role) values (%L,%L,'organizer')$q$, f, fftt_t.g('mgr')), '42501', 'permission denied%');
  -- private functions are directly executable by the API role (the public wrappers are SECURITY INVOKER) but are role-gated themselves
  perform fftt_t.forbidden('direct private organizer snapshot', format($q$select fftt_private.organizer_snapshot_v3(%L)$q$, e));
  perform fftt_t.forbidden('direct private manager snapshot, foreign event', format($q$select fftt_private.bracket_manager_snapshot_v1(%L)$q$, f));
end $deny$;

-- ===== 4. Identity and claim hardening =====
do $claims$
declare e uuid := fftt_t.g('e'); mgr uuid := fftt_t.g('mgr');
begin
  -- browser-supplied metadata cannot promote the manager
  perform fftt_t.as_user(mgr, 'authenticated', '{"user_metadata":{"role":"organizer"},"app_metadata":{"role":"organizer","fftt_role":"organizer"},"fftt_role":"organizer"}'::jsonb);
  perform fftt_t.forbidden('metadata promotion', format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, e));
  if public.fftt_staff_role_v1(e) <> 'bracket_manager' then raise exception 'role changed by metadata'; end if;
  -- a non-authenticated JWT role never resolves a staff role, even with a real staff subject
  perform fftt_t.as_user(mgr, 'anon');
  perform fftt_t.forbidden('anon-role jwt', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, e));
  perform fftt_t.as_user(mgr, 'service_role');
  perform fftt_t.forbidden('service-role jwt', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, e));
  -- an authenticated user with no grant sees nothing
  perform fftt_t.as_user(fftt_t.g('stranger'));
  perform fftt_t.forbidden('stranger snapshot', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, e));
  if public.fftt_my_events_v4() <> '[]'::jsonb then raise exception 'stranger discovers events'; end if;
  -- no subject at all
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  perform fftt_t.forbidden('no-subject jwt', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, e));
end $claims$;

-- ===== 5. Existing Scorekeeper and Organizer behaviour is unchanged =====
select fftt_t.as_user(fftt_t.g('org'));
do $org$
declare g uuid := fftt_t.g('g'); e uuid := fftt_t.g('e'); snap jsonb; ids jsonb; r jsonb; mid uuid;
begin
  -- organizer is NOT implicitly a bracket manager
  perform fftt_t.forbidden('organizer on manager snapshot', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, g));
  snap := public.fftt_organizer_snapshot_v3(g);
  select jsonb_agg(p -> 'id' order by p ->> 'name') into ids from jsonb_array_elements(snap -> 'players') p;
  r := public.fftt_build_championship_v3(g, ids, 0, false);
  if r ->> 'status' <> 'built' then raise exception 'organizer build failed'; end if;
  -- organizer retains the staff list and sees the manager grant on E
  snap := public.fftt_organizer_snapshot_v3(e);
  if not exists (select 1 from jsonb_array_elements(snap -> 'staff') s where s ->> 'role' = 'bracket_manager' and (s ->> 'active')::boolean) then raise exception 'organizer cannot see manager grant'; end if;
end $org$;

select fftt_t.as_user(fftt_t.g('sk'));
do $sk$
declare g uuid := fftt_t.g('g'); e uuid := fftt_t.g('e'); mid uuid; ids jsonb; x uuid := gen_random_uuid();
begin
  if (select count(*) from jsonb_array_elements(public.fftt_my_events_v4())) <> 2 then raise exception 'scorekeeper scope changed'; end if;
  perform fftt_t.forbidden('scorekeeper on manager snapshot', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, g));
  perform fftt_t.forbidden('scorekeeper on organizer snapshot', format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, g));
  perform fftt_t.forbidden('scorekeeper build', format($q$select public.fftt_build_championship_v3(%L,'[]'::jsonb,1,true)$q$, g));
  perform fftt_t.forbidden('scorekeeper consolation', format($q$select public.fftt_build_consolation_v3(%L,'[]'::jsonb,1,false)$q$, g));
  perform fftt_t.forbidden('scorekeeper doubles teams', format($q$select public.fftt_set_doubles_teams_v3(%L,%L,%L)$q$, g, x, x));
  perform fftt_t.forbidden('scorekeeper checkin', format($q$select public.fftt_set_checkin_bulk_v3(%L,null,false)$q$, g));
  select match_id into mid from public.fftt_matchdesk_v2(g) order by round_number, slot limit 1;
  perform public.fftt_assign_table_v3(g, mid, 3);
  if fftt_t.play(g, 'championship') <> 3 then raise exception 'scorekeeper could not score'; end if;
  -- doubles cannot be recorded before the organizer chooses teams (a conflict, not a permission error)
  perform fftt_t.expect('scorekeeper before teams', format($q$select public.fftt_record_doubles_result_v3(%L,1,'11-0,11-0')$q$, g), 'P0001', 'fftt_conflict');
end $sk$;

-- ===== 6. Revocation, role change and re-grant take effect on the very next call =====
select fftt_t.as_user(fftt_t.g('org'));
select public.fftt_set_staff_v3(fftt_t.g('e'), 'manager@fftt-role-test.invalid', 'revoke', null);
select fftt_t.as_user(fftt_t.g('mgr'));
do $rev$
declare e uuid := fftt_t.g('e'); x uuid := gen_random_uuid();
begin
  perform fftt_t.forbidden('revoked snapshot', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, e));
  perform fftt_t.forbidden('revoked brief', format($q$select public.fftt_event_brief_v3(%L)$q$, e));
  perform fftt_t.forbidden('revoked matchdesk', format($q$select * from public.fftt_matchdesk_v2(%L)$q$, e));
  perform fftt_t.forbidden('revoked table', format($q$select public.fftt_assign_table_v3(%L,%L,1)$q$, e, x));
  perform fftt_t.forbidden('revoked score', format($q$select public.fftt_submit_match_result_v2(%L,%L,1,0,%L,%L,'11-0,11-0',1)$q$, e, x, x, x));
  perform fftt_t.forbidden('revoked role endpoint', format($q$select public.fftt_staff_role_v1(%L)$q$, e));
  if public.fftt_my_events_v4() <> '[]'::jsonb then raise exception 'revoked manager still discovers event'; end if;
end $rev$;
select fftt_t.as_user(fftt_t.g('org'));
select public.fftt_set_staff_v3(fftt_t.g('e'), 'manager@fftt-role-test.invalid', 'grant', 'scorekeeper');
select fftt_t.as_user(fftt_t.g('mgr'));
select fftt_t.forbidden('downgraded to scorekeeper loses manager snapshot', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, fftt_t.g('e')));
select public.fftt_event_brief_v3(fftt_t.g('e'));
select fftt_t.as_user(fftt_t.g('org'));
select public.fftt_set_staff_v3(fftt_t.g('e'), 'manager@fftt-role-test.invalid', 'grant', 'bracket_manager');
select fftt_t.as_user(fftt_t.g('mgr'));
select jsonb_array_length(public.fftt_bracket_manager_snapshot_v1(fftt_t.g('e')) -> 'players') as regranted_manager_players;

-- ===== 7. Grants/ACLs and constraint =====
reset role;
do $acl$
declare fn text;
begin
  foreach fn in array array['public.fftt_bracket_manager_snapshot_v1(uuid)','fftt_private.bracket_manager_snapshot_v1(uuid)'] loop
    if has_function_privilege('anon', fn, 'execute') then raise exception 'anon can execute %', fn; end if;
    if has_function_privilege('public', fn, 'execute') then raise exception 'PUBLIC can execute %', fn; end if;
    if not has_function_privilege('authenticated', fn, 'execute') then raise exception 'authenticated cannot execute %', fn; end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid = 'fftt_private.event_staff'::regclass and conname = 'event_staff_role_check'
        and pg_get_constraintdef(oid) like '%bracket_manager%organizer%' or pg_get_constraintdef(oid) like '%organizer%bracket_manager%') <> 1 then
    raise exception 'role constraint not widened exactly';
  end if;
  begin
    insert into fftt_private.event_staff(event_id,user_id,role) values (fftt_t.g('f'), fftt_t.g('stranger'), 'superuser');
    raise exception 'invalid role accepted by table';
  exception when check_violation then null; end;
end $acl$;
set local role anon;
select fftt_t.expect('anon function', format($q$select public.fftt_bracket_manager_snapshot_v1(%L)$q$, fftt_t.g('e')), '42501', 'permission denied for function%');
select fftt_t.expect('anon table', $q$select * from fftt_private.events$q$, '42501', 'permission denied%');
reset role;

-- ===== 8. Audit trail identifies the manager and records only the allowed operations =====
do $audit$
declare ops text[];
begin
  select array_agg(distinct operation order by operation) into ops from fftt_private.audit_events where actor_id = fftt_t.g('mgr');
  if not (ops @> array['bracket_built','table_assigned','consolation_reviewed','doubles_updated','doubles_result']) then raise exception 'manager audit trail incomplete: %', ops; end if;
  if ops && array['staff_grant_changed','result_corrected','forfeit','event_published','event_deleted'] then raise exception 'manager audit trail contains organizer-only operations: %', ops; end if;
end $audit$;

select 'PASS: strict Bracket Manager suite — scope, sanitized snapshot, first-time bracket/table/score/consolation/doubles, exact denials, claim hardening, Organizer/Scorekeeper regression, revocation, ACLs' as result;
rollback;
