-- CI fixture, fully fictional and confined to disposable local PostgreSQL.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,role,aud,instance_id,is_anonymous,email_confirmed_at)
values
('a0000000-0000-4000-8000-000000000001','organizer@fftt-ci.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now()),
('a0000000-0000-4000-8000-000000000002','scorer@fftt-ci.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now()),
('a0000000-0000-4000-8000-000000000003','outsider@fftt-ci.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now());
insert into fftt_private.platform_organizers(user_id) values ('a0000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',true);
select public.fftt_create_event_v3('FFTT PRE-EXISTING FICTIONAL EVENT','2026-11-08',2);
select (select id from fftt_private.events where event_name='FFTT PRE-EXISTING FICTIONAL EVENT') as before_event \gset
select public.fftt_upsert_players_v3(:'before_event'::uuid, '[{"name":"Ada Quillfeather","rating":3,"rating_status":"provisional"},{"name":"Ben Marlowe","rating":2,"rating_status":"provisional"}]'::jsonb);
reset role;
commit;
do $seed_check$
begin
 if (select count(*) from fftt_private.events where synthetic_only) <> 1 then
  raise exception 'synthetic fixture seed missing';
 end if;
 if (select count(*) from fftt_private.players) <> 2 then raise exception 'fixture roster seed missing'; end if;
end
$seed_check$;
