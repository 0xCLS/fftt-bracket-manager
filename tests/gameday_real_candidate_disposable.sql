-- Real-event candidate verification against independent local PostgreSQL.
-- All identities are fictional .invalid addresses. One transaction, always ROLLBACK.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email,role,aud,instance_id,is_anonymous,email_confirmed_at)
values
('a0000000-0000-4000-8000-000000000001','organizer@fftt-ci.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now()),
('a0000000-0000-4000-8000-000000000002','scorer@fftt-ci.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now()),
('a0000000-0000-4000-8000-000000000003','outsider@fftt-ci.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now());

insert into fftt_private.platform_organizers(user_id)
values ('a0000000-0000-4000-8000-000000000001');

do $preflight$
begin
  if has_schema_privilege('anon','fftt_private','USAGE') then raise exception 'anon private schema access'; end if;
  if has_function_privilege('anon','public.fftt_create_event_v3(text,date,integer)','EXECUTE')
     then raise exception 'anon create-event RPC access'; end if;
  if has_table_privilege('anon','fftt_private.registration_sources','SELECT')
     then raise exception 'anon registration config table access'; end if;
  if not (select relrowsecurity from pg_class where oid='fftt_private.registration_sources'::regclass)
     then raise exception 'registration source RLS missing'; end if;
end
$preflight$;

set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',
 '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',true);

select (public.fftt_create_event_v3('FICTIONAL REAL-MODE CI','2026-11-22',2)->>'event_id') as event_id \gset
select set_config('fftt.candidate_event_id', :'event_id', true);

do $real$
begin
  if public.fftt_my_events_v4()::text not like '%FICTIONAL REAL-MODE CI%' then
    -- Not an authorization failure; the listing must find an event created by the organizer.
    raise exception 'organizer event discovery failed';
  end if;
end
$real$;

-- Service credentials and actual Sheets rows are never accessed. The ID below is fictional.
select public.fftt_set_registration_source_v5(
 current_setting('fftt.candidate_event_id')::uuid,
 jsonb_build_object('kind','google-sheets','spreadsheet_id','FAKE_FFTT_CI_SHEET_ID_123456789',
 'spreadsheet_title','Fictional sheet','worksheet','Form Responses 1','column_map','{}'::jsonb,'enabled',true));

do $source$
declare v jsonb;
begin
  v:=public.fftt_registration_source_v5(current_setting('fftt.candidate_event_id')::uuid);
  if v->>'event_synthetic' <> 'false' or v->>'enabled' <> 'true'
     or v->>'kind' <> 'google-sheets' then
    raise exception 'real-only Google source configuration unavailable';
  end if;
  begin
    perform public.fftt_set_registration_source_v5(current_setting('fftt.candidate_event_id')::uuid,
        '{"kind":"fixture","enabled":true}'::jsonb);
    raise exception 'synthetic fixture incorrectly enabled';
  exception when others then
    if sqlerrm='synthetic fixture incorrectly enabled' then raise; end if;
  end;
end
$source$;

-- Auth/scorer role segregation; event-scoped access must fail for an outsider.
select public.fftt_set_staff_v3(current_setting('fftt.candidate_event_id')::uuid,'scorer@fftt-ci.invalid','grant','scorekeeper');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims',
 '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","aud":"authenticated"}',true);

do $outsider$
begin
  if public.fftt_my_events_v4() <> '[]'::jsonb then
    raise exception 'outsider discovered protected event';
  end if;
  begin
    perform public.fftt_registration_source_v5(current_setting('fftt.candidate_event_id')::uuid);
    raise exception 'outsider read registration settings';
  exception when others then
    if sqlerrm='outsider read registration settings' then raise; end if;
  end;
end
$outsider$;

-- Return to organizer and revoke scorer; revocation must take effect without token renewal.
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',
 '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',true);
select public.fftt_set_staff_v3(current_setting('fftt.candidate_event_id')::uuid,'scorer@fftt-ci.invalid','revoke',null);

select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims',
 '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","aud":"authenticated"}',true);

do $revoked$
begin
  if public.fftt_my_events_v4() <> '[]'::jsonb then
    raise exception 'revoked scorer discovered protected event';
  end if;
  begin
    perform * from public.fftt_matchdesk_v2(current_setting('fftt.candidate_event_id')::uuid);
    raise exception 'revoked scorer accessed Match Desk';
  exception when others then
    if sqlerrm='revoked scorer accessed Match Desk' then raise; end if;
  end;
end
$revoked$;

reset role;
do $postflight$
declare c boolean;
begin
  select synthetic_only into c from fftt_private.events where id=current_setting('fftt.candidate_event_id')::uuid;
  if c is distinct from false then raise exception 'real-only event flag not enforced'; end if;
  if exists (select 1 from public.fftt_published_events)
     then raise exception 'unapproved public event projection'; end if;
  if exists (select 1 from information_schema.columns
      where table_schema='fftt_private' and table_name='registration_sources'
      and column_name ~* 'mail|phone|contact|secret|key|token|password|credential|row')
      then raise exception 'registration source stores private contact/credential field'; end if;
end
$postflight$;

rollback;
select 'PASS: independent PostgreSQL real-only candidate, staff roles, source settings and private projection' as result;
