-- Disposable PostgreSQL role boundaries (never the hosted Supabase project).
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select (public.fftt_create_event_v3('FICTIONAL BRACKET MANAGER ROLE CI','2026-11-08',2)->>'event_id') as role_event \gset
select (x->>'event_id') as other_event from pg_catalog.jsonb_array_elements(public.fftt_my_events_v4()) x
  where x->>'name'='FFTT PRE-EXISTING FICTIONAL EVENT' \gset
select public.fftt_upsert_players_v3(:'role_event'::uuid, '[{"name":"Fictional Role Test A","rating":3,"rating_status":"provisional"},{"name":"Fictional Role Test B","rating":2,"rating_status":"provisional"}]'::jsonb);
select public.fftt_set_checkin_bulk_v3(:'role_event'::uuid,null,true);
select set_config('fftt.manager_test_event', :'role_event',true);
select set_config('fftt.manager_other_event', :'other_event',true);
select public.fftt_set_staff_v3(:'role_event'::uuid,'outsider@fftt-ci.invalid','grant','bracket_manager');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $boundary$
declare snap jsonb; ids jsonb; match_id uuid; e uuid := current_setting('fftt.manager_test_event')::uuid;
begin
 if pg_catalog.jsonb_array_length(public.fftt_my_events_v4()) <> 1 then raise exception 'manager event scope wrong'; end if;
 if (public.fftt_my_events_v4() -> 0 ->> 'role') <> 'bracket_manager' then raise exception 'manager role not discoverable'; end if;
 snap := public.fftt_bracket_manager_snapshot_v1(e);
 if snap -> 'staff' <> '[]'::jsonb then raise exception 'manager leaked staff'; end if;
 if pg_catalog.jsonb_array_length(snap -> 'players') <> 2 then raise exception 'manager snapshot missing fictional players'; end if;
 if snap -> 'players' -> 0 -> 'registration_refs' <> '[]'::jsonb then raise exception 'manager leaked registration links'; end if;
 select pg_catalog.jsonb_agg(p->'id' order by p->>'name') into ids from pg_catalog.jsonb_array_elements(snap->'players') p;
 perform public.fftt_build_championship_v3(e,ids,0,false);
 snap := public.fftt_bracket_manager_snapshot_v1(e);
 match_id := (snap->'matches'->0->>'id')::uuid;
 if match_id is null then raise exception 'manager failed to build championship'; end if;
 perform public.fftt_assign_table_v3(e,match_id,1);
 begin
   perform public.fftt_build_championship_v3(e,ids,1,true);
   raise exception 'manager rebuilt existing championship';
 exception when others then if sqlerrm='manager rebuilt existing championship' then raise; end if; end;
 begin
   perform public.fftt_organizer_snapshot_v3(e);
   raise exception 'manager read organizer snapshot';
 exception when others then if sqlerrm='manager read organizer snapshot' then raise; end if; end;
 begin
   perform public.fftt_bracket_manager_snapshot_v1(current_setting('fftt.manager_other_event')::uuid);
   raise exception 'manager read foreign event';
 exception when others then if sqlerrm='manager read foreign event' then raise; end if; end;
 begin
   perform public.fftt_set_visibility_v3(e,true);
   raise exception 'manager published event';
 exception when others then if sqlerrm='manager published event' then raise; end if; end;
 begin
   perform public.fftt_set_staff_v3(e,'organizer@fftt-ci.invalid','grant','organizer');
   raise exception 'manager granted staff';
 exception when others then if sqlerrm='manager granted staff' then raise; end if; end;
 begin
   perform public.fftt_set_registration_source_v5(e, '{"kind":"fixture","enabled":false}'::jsonb);
   raise exception 'manager changed registration source';
 exception when others then if sqlerrm='manager changed registration source' then raise; end if; end;
end;
$boundary$;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.fftt_set_staff_v3(current_setting('fftt.manager_test_event')::uuid,'outsider@fftt-ci.invalid','revoke',null);
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $revoked$
begin
 if public.fftt_my_events_v4() <> '[]'::jsonb then raise exception 'revoked manager still discovers event'; end if;
 begin
   perform public.fftt_bracket_manager_snapshot_v1(current_setting('fftt.manager_test_event')::uuid);
   raise exception 'revoked manager still reads private snapshot';
 exception when others then if sqlerrm='revoked manager still reads private snapshot' then raise; end if; end;
end;
$revoked$;
rollback;
select 'PASS: disposable bracket manager role grant, scoped snapshot, denials and revocation' as result;
