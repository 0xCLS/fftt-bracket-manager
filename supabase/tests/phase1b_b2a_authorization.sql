-- Phase 1B B2a synthetic PostgreSQL authorization regression.
-- Uses TRANSACTION-ROLLED-BACK synthetic auth.users fixtures and SIMULATED JWT
-- database settings. This is NOT a proof of a real signed Supabase Auth token.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function('public', 'fftt_staff_role_v1', array['uuid'], 'role RPC exists');
select has_function('public', 'fftt_matchdesk_v1', array['uuid'], 'matchdesk RPC exists');
select ok(not has_function_privilege('anon', 'public.fftt_staff_role_v1(uuid)', 'EXECUTE'), 'anonymous cannot call role RPC');
select ok(not has_function_privilege('anon', 'public.fftt_matchdesk_v1(uuid)', 'EXECUTE'), 'anonymous cannot call matchdesk RPC');
select ok(has_function_privilege('authenticated', 'public.fftt_staff_role_v1(uuid)', 'EXECUTE'), 'authenticated can call role RPC');
select ok(has_function_privilege('authenticated', 'public.fftt_matchdesk_v1(uuid)', 'EXECUTE'), 'authenticated can call matchdesk RPC');
select ok(has_schema_privilege('authenticated','fftt_private','USAGE'), 'authenticated can resolve allowlisted private helpers');
select ok(not has_table_privilege('authenticated','fftt_private.players','SELECT'), 'authenticated cannot directly read private players');
select ok(not has_table_privilege('authenticated','fftt_private.event_staff','SELECT'), 'authenticated cannot read staff grants');
select ok(not has_table_privilege('authenticated','fftt_private.matches','UPDATE'), 'authenticated cannot directly mutate matches');
select ok((
 select not p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='fftt_staff_role_v1'
), 'exposed role RPC uses security invoker');
select ok((
 select not p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='fftt_matchdesk_v1'
), 'exposed matchdesk RPC uses security invoker');

insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at) values
('00000000-0000-4000-8000-000000000011','synthetic-volunteer@invalid.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now()),
('00000000-0000-4000-8000-000000000012','synthetic-organizer@invalid.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now()),
('00000000-0000-4000-8000-000000000013','synthetic-outsider@invalid.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now());

insert into fftt_private.events (id,public_id,event_name,event_date,lifecycle,bracket_generation)
values ('11111111-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000002','Synthetic B2a Games','2099-01-01','active',1),
('11111111-0000-4000-8000-000000000003','11111111-0000-4000-8000-000000000004','Synthetic Other Event','2099-02-01','active',1);

insert into fftt_private.event_staff(event_id,user_id,role) values
('11111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','scorekeeper'),
('11111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012','organizer');

insert into fftt_private.players(id,event_id,display_name,rating,rating_status,checked_in) values
('22222222-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001','Synthetic Ada',5,'provisional',true),
('22222222-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000001','Synthetic Ben',1,'established',true);
insert into fftt_private.brackets(id,event_id,generation,kind,status) values
('33333333-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',1,'championship','active');
insert into fftt_private.matches(id,event_id,bracket_id,generation,match_code,round_number,slot,player_1_id,player_2_id)
values ('44444444-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001','33333333-0000-4000-8000-000000000001',1,'C-0-0',0,0,
'22222222-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000002');

create temp table fftt_b2a_assertions (label text primary key, value text) on commit drop;
do $test$
declare
  v text;
  v_count integer;
begin
  -- A real HTTP caller cannot set these values; PostgREST supplies them from
  -- a verified JWT. Here they are synthetic test fixtures only.
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
  execute 'set local role authenticated';
  begin select public.fftt_staff_role_v1('11111111-0000-4000-8000-000000000001') into v;
    exception when others then v:='error:'||SQLSTATE; end;
  execute 'reset role';
  insert into fftt_b2a_assertions values ('volunteer_role',v);

  execute 'set local role authenticated';
  begin select count(*) into v_count from public.fftt_matchdesk_v1('11111111-0000-4000-8000-000000000001');
        v:=v_count::text;
    exception when others then v:='error:'||SQLSTATE; end;
  execute 'reset role';
  insert into fftt_b2a_assertions values ('volunteer_desk',v);

  execute 'set local role authenticated';
  begin perform * from fftt_private.players limit 1; v:='leaked';
    exception when insufficient_privilege then v:='denied'; when others then v:='error:'||SQLSTATE; end;
  execute 'reset role';
  insert into fftt_b2a_assertions values ('direct_private',v);

  execute 'set local role authenticated';
  begin select public.fftt_staff_role_v1('11111111-0000-4000-8000-000000000003') into v;
    exception when insufficient_privilege then v:='denied'; when others then v:='error:'||SQLSTATE; end;
  execute 'reset role';
  insert into fftt_b2a_assertions values ('other_event',v);

  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000013',true);
  execute 'set local role authenticated';
  begin select public.fftt_staff_role_v1('11111111-0000-4000-8000-000000000001') into v;
    exception when insufficient_privilege then v:='denied'; when others then v:='error:'||SQLSTATE; end;
  execute 'reset role';
  insert into fftt_b2a_assertions values ('outsider',v);

  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated","user_metadata":{"role":"organizer"}}',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
  execute 'set local role authenticated';
  begin select public.fftt_staff_role_v1('11111111-0000-4000-8000-000000000001') into v;
    exception when others then v:='error:'||SQLSTATE; end;
  execute 'reset role';
  insert into fftt_b2a_assertions values ('organizer_role',v);

  update fftt_private.event_staff
     set active=false,revoked_at=now()
   where event_id='11111111-0000-4000-8000-000000000001'
     and user_id='00000000-0000-4000-8000-000000000011';
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
  execute 'set local role authenticated';
  begin select public.fftt_staff_role_v1('11111111-0000-4000-8000-000000000001') into v;
    exception when insufficient_privilege then v:='denied'; when others then v:='error:'||SQLSTATE; end;
  execute 'reset role';
  insert into fftt_b2a_assertions values ('revoked',v);

  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011","role":"anon"}',true);
  execute 'set local role authenticated';
  begin select public.fftt_staff_role_v1('11111111-0000-4000-8000-000000000001') into v;
    exception when insufficient_privilege then v:='denied'; when others then v:='error:'||SQLSTATE; end;
  execute 'reset role';
  insert into fftt_b2a_assertions values ('forged_anon_role',v);
end;
$test$;
select is((select value from fftt_b2a_assertions where label='volunteer_role'), 'scorekeeper', 'scorekeeper grant resolves per event');
select is((select value from fftt_b2a_assertions where label='volunteer_desk'), '1', 'authorized user sees one playable match');
select is((select value from fftt_b2a_assertions where label='direct_private'), 'denied', 'role cannot bypass private table grants');
select is((select value from fftt_b2a_assertions where label='other_event'), 'denied', 'grant cannot cross event boundary');
select is((select value from fftt_b2a_assertions where label='outsider'), 'denied', 'unaffiliated authenticated caller is denied');
select is((select value from fftt_b2a_assertions where label='organizer_role'), 'organizer', 'organizer grant resolves from DB, not JWT metadata');
select is((select value from fftt_b2a_assertions where label='revoked'), 'denied', 'revocation takes effect on next call');
select is((select value from fftt_b2a_assertions where label='forged_anon_role'), 'denied', 'anonymous JWT claim denied even with authenticated SQL role');
select * from finish();
rollback;
