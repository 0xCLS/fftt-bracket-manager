-- FFTT B2b synthetic atomic-score integration test.
-- All fixtures are transaction-rolled-back. JWT settings are SIMULATED here;
-- actual Supabase signed tokens and device concurrency require separate tests.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select has_function('public','fftt_submit_match_result_v1',
  array['uuid','uuid','integer','bigint','uuid','uuid','text','smallint'],
  'score RPC exists');
select ok(not has_function_privilege('anon',
  'public.fftt_submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,smallint)','EXECUTE'),
  'anonymous cannot invoke score RPC');
select ok(has_function_privilege('authenticated',
  'public.fftt_submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,smallint)','EXECUTE'),
  'authenticated may invoke score RPC but must pass DB authorization');
select ok((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='fftt_submit_match_result_v1'),
  'exposed wrapper remains invoker-privileged');

insert into auth.users(id,email,instance_id,aud,role,created_at,updated_at) values
('00000000-0000-4000-8000-000000000021','b2b-synthetic-staff@invalid.test',
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now()),
('00000000-0000-4000-8000-000000000022','b2b-synthetic-outsider@invalid.test',
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now());
insert into fftt_private.events(id,public_id,event_name,event_date,lifecycle,bracket_generation)
 values ('11111111-0000-4000-8000-000000000021','11111111-0000-4000-8000-000000000022',
 'Synthetic B2b Games','2099-01-02','active',1);
insert into fftt_private.event_staff(event_id,user_id,role)
 values ('11111111-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000021','scorekeeper');
insert into fftt_private.players(id,event_id,display_name,rating,rating_status,checked_in)
values
('22222222-0000-4000-8000-000000000021','11111111-0000-4000-8000-000000000021','Synthetic Ada',5,'provisional',true),
('22222222-0000-4000-8000-000000000022','11111111-0000-4000-8000-000000000021','Synthetic Ben',2,'established',true),
('22222222-0000-4000-8000-000000000023','11111111-0000-4000-8000-000000000021','Synthetic Cara',4,'provisional',true),
('22222222-0000-4000-8000-000000000024','11111111-0000-4000-8000-000000000021','Synthetic Dax',3,'established',true);
insert into fftt_private.brackets(id,event_id,generation,kind)
 values ('33333333-0000-4000-8000-000000000021','11111111-0000-4000-8000-000000000021',1,'championship');
insert into fftt_private.matches
(id,event_id,bracket_id,generation,match_code,round_number,slot,
 player_1_id,player_2_id,is_championship_final,next_match_id,next_match_slot)
values
('44444444-0000-4000-8000-000000000021','11111111-0000-4000-8000-000000000021',
 '33333333-0000-4000-8000-000000000021',1,'C-0-0',0,0,
 '22222222-0000-4000-8000-000000000021','22222222-0000-4000-8000-000000000022',
 false,'44444444-0000-4000-8000-000000000023',1),
('44444444-0000-4000-8000-000000000022','11111111-0000-4000-8000-000000000021',
 '33333333-0000-4000-8000-000000000021',1,'C-0-1',0,1,
 '22222222-0000-4000-8000-000000000023','22222222-0000-4000-8000-000000000024',
 false,'44444444-0000-4000-8000-000000000023',2),
('44444444-0000-4000-8000-000000000023','11111111-0000-4000-8000-000000000021',
 '33333333-0000-4000-8000-000000000021',1,'C-1-0',1,0,
 null,null,true,null,null);

create temp table fftt_b2b_outcomes (label text primary key, result text) on commit drop;
create procedure pg_temp.fftt_attempt(
  p_label text,p_actor uuid,p_role text,p_mid uuid,p_ver bigint,p_sub uuid,
  p_winner uuid,p_scores text,p_generation integer default 1)
language plpgsql
as $test$
declare
  v_result text;
  v_answer jsonb;
begin
  perform set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub',p_actor::text,'role',p_role)::text,true);
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  execute 'set local role authenticated';
  begin
    select public.fftt_submit_match_result_v1(
      '11111111-0000-4000-8000-000000000021',p_mid,p_generation,p_ver,p_sub,
      p_winner,p_scores,1) into v_answer;
    v_result:=v_answer::text;
  exception when others then v_result:='error:'||SQLERRM;
  end;
  execute 'reset role';
  insert into pg_temp.fftt_b2b_outcomes values(p_label,v_result);
end;
$test$;

call pg_temp.fftt_attempt('bad_score','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000001',
  '22222222-0000-4000-8000-000000000021','11-10, 11-8');
call pg_temp.fftt_attempt('bad_winner','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000002',
  '22222222-0000-4000-8000-000000000023','');
call pg_temp.fftt_attempt('stale_generation','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000003',
  '22222222-0000-4000-8000-000000000021','',0);
call pg_temp.fftt_attempt('first','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000004',
  '22222222-0000-4000-8000-000000000021','11-8, 8-11, 12-10');
call pg_temp.fftt_attempt('retry','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000004',
  '22222222-0000-4000-8000-000000000021','11-8, 8-11, 12-10');
call pg_temp.fftt_attempt('tampered_retry','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000004',
  '22222222-0000-4000-8000-000000000022','');
call pg_temp.fftt_attempt('stale_version','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000005',
  '22222222-0000-4000-8000-000000000022','');
call pg_temp.fftt_attempt('second','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000022',0,
  '55555555-0000-4000-8000-000000000006',
  '22222222-0000-4000-8000-000000000023','');
call pg_temp.fftt_attempt('final_short','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000023',2,
  '55555555-0000-4000-8000-000000000007',
  '22222222-0000-4000-8000-000000000021','11-6, 11-6');
call pg_temp.fftt_attempt('final','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000023',2,
  '55555555-0000-4000-8000-000000000008',
  '22222222-0000-4000-8000-000000000021','11-6, 8-11, 11-8, 11-9');
-- A replay must NOT bypass revocation, even when a receipt exists.
update fftt_private.event_staff set active=false,revoked_at=now()
 where event_id='11111111-0000-4000-8000-000000000021';
call pg_temp.fftt_attempt('revoked_retry','00000000-0000-4000-8000-000000000021',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000004',
  '22222222-0000-4000-8000-000000000021','11-8, 8-11, 12-10');
call pg_temp.fftt_attempt('outsider','00000000-0000-4000-8000-000000000022',
  'authenticated','44444444-0000-4000-8000-000000000021',0,
  '55555555-0000-4000-8000-000000000009',
  '22222222-0000-4000-8000-000000000021','');

select like((select result from fftt_b2b_outcomes where label='bad_score'),
 'error:fftt_validation_error%', '11-10 game rejected');
select like((select result from fftt_b2b_outcomes where label='bad_winner'),
 'error:fftt_validation_error%', 'nonparticipant winner rejected');
select like((select result from fftt_b2b_outcomes where label='stale_generation'),
 'error:fftt_stale_generation%', 'generation checked before write');
select is((select result::jsonb->>'status' from fftt_b2b_outcomes where label='first'),
 'accepted', 'first match accepted');
select is((select result from fftt_b2b_outcomes where label='retry'),
 (select result from fftt_b2b_outcomes where label='first'), 'identical retry returns prior receipt');
select like((select result from fftt_b2b_outcomes where label='tampered_retry'),
 'error:fftt_submission_id_reused%', 'tampered retry denied');
select like((select result from fftt_b2b_outcomes where label='stale_version'),
 'error:fftt_conflict%', 'second submitted result rejected');
select is((select result::jsonb->>'status' from fftt_b2b_outcomes where label='second'),
 'accepted', 'second match accepted without score string');
select like((select result from fftt_b2b_outcomes where label='final_short'),
 'error:fftt_validation_error%', 'best-of-five final needs 3 game wins');
select is((select result::jsonb->>'status' from fftt_b2b_outcomes where label='final'),
 'accepted', 'four-game best-of-five final accepted');
select like((select result from fftt_b2b_outcomes where label='revoked_retry'),
 'error:forbidden%', 'revocation checked before receipt replay');
select like((select result from fftt_b2b_outcomes where label='outsider'),
 'error:forbidden%', 'unaffiliated caller denied');
select is((select revision from fftt_private.events
 where id='11111111-0000-4000-8000-000000000021'), 3::bigint,
 'only three accepted score writes increment revision');
select is((select count(*) from fftt_private.audit_events
 where event_id='11111111-0000-4000-8000-000000000021'),3::bigint,
 'only three accepted writes create append-only audit entries');
select is((select count(*) from fftt_private.result_submissions
 where event_id='11111111-0000-4000-8000-000000000021'),3::bigint,
 'only three receipts saved; no receipts for rejected writes');
select is((select match_version from fftt_private.matches
 where id='44444444-0000-4000-8000-000000000023'),3::bigint,
 'final match advanced twice and completed once');
select is((select status from fftt_private.brackets
 where id='33333333-0000-4000-8000-000000000021'),'complete',
 'championship bracket marked complete');
select is((select count(*) from fftt_private.consolation_reviews
 where event_id='11111111-0000-4000-8000-000000000021'),2::bigint,
 'exactly two first-real-match losers become reviewed consolation candidates');
select ok(not (select first_champ_loss from fftt_private.players
 where id='22222222-0000-4000-8000-000000000023'),
 'championship final loser who won earlier is not in consolation');
select is((select count(*) from public.fftt_published_events),0::bigint,
 'public projection remains empty until trusted publication milestone');
select * from finish();
rollback;
