-- Test *in-place* launch migration on a populated disposable PostgreSQL database,
-- with Auth JWT stubs only. This is NOT the hosted Supabase DB.
\set ON_ERROR_STOP on
begin;
do $preflight$
begin
 if (select count(*) from fftt_private.events where synthetic_only) <> 1 then
  raise exception 'existing synthetic fixture lost';
 end if;
 if (select count(*) from fftt_private.players where display_name in ('Ada Quillfeather','Ben Marlowe')) <> 2 then
  raise exception 'old roster lost or renamed';
 end if;
 if exists (select 1 from fftt_private.events where not synthetic_only) then
  raise exception 'no real event should exist before promotion test';
 end if;
 if (select count(*) from pg_trigger where tgrelid='fftt_private.events'::regclass and tgname='fftt_events_event_mode_immutable' and not tgisinternal) <> 1 then
  raise exception 'immutability trigger absent';
 end if;
 if has_schema_privilege('anon','fftt_private','USAGE') then raise exception 'anonymous private schema access'; end if;
 if has_table_privilege('authenticated','fftt_private.registration_sources','SELECT') then raise exception 'public registration source access'; end if;
end
$preflight$;

set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',true);
select (select id from fftt_private.events where event_name='FFTT PRE-EXISTING FICTIONAL EVENT') as old_event \gset
select (public.fftt_create_event_v3('FICTIONAL REAL-MODE LAUNCH CI','2026-11-22',2)->>'event_id') as new_event \gset
select set_config('fftt.before_event', :'old_event',true);
select set_config('fftt.after_event', :'new_event',true);

do $event_modes$
declare s jsonb; r jsonb;
begin
 if (select count(*) from fftt_private.events) <> 2 then raise exception 'event count changed incorrectly'; end if;
 if (select count(*) from fftt_private.events where synthetic_only) <> 1 then raise exception 'synthetic event changed'; end if;
 if (select count(*) from fftt_private.events where not synthetic_only) <> 1 then raise exception 'real event not created'; end if;
 s := public.fftt_export_event_v3(current_setting('fftt.before_event')::uuid);
 r := public.fftt_export_event_v3(current_setting('fftt.after_event')::uuid);
 if s->>'synthetic_only' <> 'true' or r->>'synthetic_only' <> 'false' then
  raise exception 'event mode export mismatch';
 end if;
 if public.fftt_my_events_v4()::text not like '%FICTIONAL REAL-MODE LAUNCH CI%' then
  raise exception 'new event not visible to organizer';
 end if;
end
$event_modes$;

select public.fftt_set_registration_source_v5(current_setting('fftt.after_event')::uuid,
 jsonb_build_object('kind','google-sheets','spreadsheet_id','FAKE_FFTT_CI_SHEET_ID_123456789',
 'worksheet','Form Responses 1','column_map','{}'::jsonb,'enabled',true));
do $google_guard$
declare src jsonb;
begin
 src := public.fftt_registration_source_v5(current_setting('fftt.after_event')::uuid);
 if src->>'enabled' <> 'true' or src->>'event_synthetic' <> 'false' then
  raise exception 'real-event registration settings not enabled correctly';
 end if;
 begin
  perform public.fftt_set_registration_source_v5(current_setting('fftt.before_event')::uuid,
  jsonb_build_object('kind','google-sheets','spreadsheet_id','FAKE_FFTT_CI_SHEET_ID_123456789',
  'worksheet','Form Responses 1','column_map','{}'::jsonb,'enabled',true));
  raise exception 'synthetic event wrongly accepted enabled real sheet';
 exception when others then if sqlerrm='synthetic event wrongly accepted enabled real sheet' then raise; end if; end;
 begin
  perform public.fftt_set_registration_source_v5(current_setting('fftt.after_event')::uuid,
  '{"kind":"fixture","enabled":true}'::jsonb);
  raise exception 'real event wrongly accepted fixture';
 exception when others then if sqlerrm='real event wrongly accepted fixture' then raise; end if; end;
end
$google_guard$;

select public.fftt_set_staff_v3(current_setting('fftt.after_event')::uuid,'scorer@fftt-ci.invalid','grant','scorekeeper');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","aud":"authenticated"}',true);
do $outsider$
begin
 begin
  perform public.fftt_registration_source_v5(current_setting('fftt.after_event')::uuid);
  raise exception 'outsider read source';
 exception when others then if sqlerrm='outsider read source' then raise; end if; end;
 if public.fftt_my_events_v4() <> '[]'::jsonb then
  raise exception 'outsider discovered events';
 end if;
end
$outsider$;

select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',true);
select public.fftt_set_staff_v3(current_setting('fftt.after_event')::uuid,'scorer@fftt-ci.invalid','revoke',null);
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","aud":"authenticated"}',true);
do $revoked$
begin
 begin
  perform public.fftt_registration_source_v5(current_setting('fftt.after_event')::uuid);
  raise exception 'revoked scorekeeper read source';
 exception when others then if sqlerrm='revoked scorekeeper read source' then raise; end if; end;
 if public.fftt_my_events_v4() <> '[]'::jsonb then
  raise exception 'revoked scorekeeper discovered events';
 end if;
end
$revoked$;
reset role;
do $immutable$
begin
 begin
  update fftt_private.events set synthetic_only=false where event_name='FFTT PRE-EXISTING FICTIONAL EVENT';
  raise exception 'synthetic history was reclassified';
 exception when others then if sqlerrm='synthetic history was reclassified' then raise; end if; end;
 if exists (select 1 from public.fftt_published_events) then
  raise exception 'event published without approval';
 end if;
end
$immutable$;
rollback;
select 'PASS: in-place PostgreSQL promotion, old event preservation, event modes, private Google source and denied roles' as result;
