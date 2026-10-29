-- Milestone 1 disposable PostgreSQL transaction and authorization regression.
-- Run ONLY against a NEW local synthetic Supabase DB AFTER v2 proposal is applied
-- TO THAT LOCAL INSTANCE. NEVER AGAINST HOSTED, REAL DATA, OR CONSUMED B2i.
-- Auth JWT context is simulated; independently signed GoTrue remains a later gate.
\set ON_ERROR_STOP on
begin;

-- Validate the API cutover in this disposable instance.
do $check$
begin
 if has_function_privilege('authenticated',
    'public.fftt_submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,integer)','EXECUTE') then
   raise exception 'Legacy v1 score wrapper must be revoked during v2 cutover';
 end if;
 if not has_function_privilege('authenticated',
    'public.fftt_submit_match_result_v2(uuid,uuid,integer,bigint,uuid,uuid,text,integer)','EXECUTE') then
   raise exception 'v2 score wrapper must be callable with active signed Auth';
 end if;
 if has_function_privilege('anon',
    'public.fftt_submit_match_result_v2(uuid,uuid,integer,bigint,uuid,uuid,text,integer)','EXECUTE') then
   raise exception 'Anonymous score function privilege exposed';
 end if;
 if has_function_privilege('anon',
    'public.fftt_score_decision_snapshot_v2(uuid,uuid)','EXECUTE') then
   raise exception 'Anonymous private snapshot exposed';
 end if;
 if has_table_privilege('authenticated','fftt_private.score_decisions_v2','SELECT')
    or has_table_privilege('authenticated','fftt_private.score_decisions_v2','INSERT') then
   raise exception 'Raw private ledger privilege leaked';
 end if;
end;
$check$;

insert into auth.users(id,email,instance_id,aud,role,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000061','fftt-synthetic-61@invalid.test',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now()),
 ('00000000-0000-4000-8000-000000000062','fftt-synthetic-62@invalid.test',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now()),
 ('00000000-0000-4000-8000-000000000063','fftt-synthetic-63@invalid.test',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now());

insert into fftt_private.events(id,public_id,event_name,event_date,lifecycle,bracket_generation)
 values ('11111111-0000-4000-8000-000000000061',
         '11111111-0000-4000-8000-000000000062',
         'Disposable 2099 FFTT scoring','2099-02-01','active',1);
insert into fftt_private.event_staff(event_id,user_id,role) values
 ('11111111-0000-4000-8000-000000000061',
  '00000000-0000-4000-8000-000000000061','scorekeeper'),
 ('11111111-0000-4000-8000-000000000061',
  '00000000-0000-4000-8000-000000000062','scorekeeper');

insert into fftt_private.players(id,event_id,display_name,rating,rating_status,checked_in) values
 ('22222222-0000-4000-8000-000000000061',
  '11111111-0000-4000-8000-000000000061','Fictional One',3,'provisional',true),
 ('22222222-0000-4000-8000-000000000062',
  '11111111-0000-4000-8000-000000000061','Fictional Two',2,'provisional',true);
insert into fftt_private.brackets(id,event_id,generation,kind) values
 ('33333333-0000-4000-8000-000000000061',
  '11111111-0000-4000-8000-000000000061',1,'championship');
insert into fftt_private.matches
 (id,event_id,bracket_id,generation,match_code,round_number,slot,
  player_1_id,player_2_id,is_championship_final)
values
 ('44444444-0000-4000-8000-000000000061',
  '11111111-0000-4000-8000-000000000061',
  '33333333-0000-4000-8000-000000000061',
  1,'C-0-0',0,0,
  '22222222-0000-4000-8000-000000000061',
  '22222222-0000-4000-8000-000000000062',true);

create temp table v2_outcomes(
 label text primary key,
 answer jsonb,
 error_code text
) on commit drop;
create temp table v2_snapshots(
 label text primary key,
 answer jsonb,
 error_code text
) on commit drop;

create procedure pg_temp.v2_score(
 p_label text,p_actor uuid,p_submission uuid,p_winner uuid
)
language plpgsql as $p$
declare
 v_response jsonb;
 v_error text;
begin
 perform set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub',p_actor::text,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 execute 'set local role authenticated';
 begin
   select public.fftt_submit_match_result_v2(
    '11111111-0000-4000-8000-000000000061',
    '44444444-0000-4000-8000-000000000061',
    1,0,p_submission,p_winner,'',1)
   into v_response;
 exception when others then
   v_error:=SQLSTATE||': '||SQLERRM;
 end;
 execute 'reset role';
 insert into pg_temp.v2_outcomes(label,answer,error_code)
 values(p_label,v_response,v_error);
end;
$p$;

create procedure pg_temp.v2_snapshot(
 p_label text,p_actor uuid,p_submission uuid
)
language plpgsql as $p$
declare
 v_response jsonb;
 v_error text;
begin
 perform set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub',p_actor::text,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 execute 'set local role authenticated';
 begin
   select public.fftt_score_decision_snapshot_v2(
    '11111111-0000-4000-8000-000000000061',p_submission)
   into v_response;
 exception when others then
   v_error:=SQLSTATE||': '||SQLERRM;
 end;
 execute 'reset role';
 insert into pg_temp.v2_snapshots(label,answer,error_code)
 values(p_label,v_response,v_error);
end;
$p$;

-- One actual accepted score plus one serialized stale terminal rejection.
call pg_temp.v2_score('first_accepted',
 '00000000-0000-4000-8000-000000000061',
 '55555555-0000-4000-8000-000000000061',
 '22222222-0000-4000-8000-000000000061');
call pg_temp.v2_score('second_stale',
 '00000000-0000-4000-8000-000000000062',
 '55555555-0000-4000-8000-000000000062',
 '22222222-0000-4000-8000-000000000062');
-- Same actor/submission/payload is exactly-once; altered payload is refused.
call pg_temp.v2_score('same_receipt_replay',
 '00000000-0000-4000-8000-000000000061',
 '55555555-0000-4000-8000-000000000061',
 '22222222-0000-4000-8000-000000000061');
call pg_temp.v2_score('tampered_replay',
 '00000000-0000-4000-8000-000000000061',
 '55555555-0000-4000-8000-000000000061',
 '22222222-0000-4000-8000-000000000062');
-- Authenticated outsider has no staff grant.
call pg_temp.v2_score('outsider_denied',
 '00000000-0000-4000-8000-000000000063',
 '55555555-0000-4000-8000-000000000063',
 '22222222-0000-4000-8000-000000000061');

-- Own accepted/rejected decisions, no cross-user receipt leakage.
call pg_temp.v2_snapshot('own_accepted',
 '00000000-0000-4000-8000-000000000061',
 '55555555-0000-4000-8000-000000000061');
call pg_temp.v2_snapshot('own_rejected',
 '00000000-0000-4000-8000-000000000062',
 '55555555-0000-4000-8000-000000000062');
call pg_temp.v2_snapshot('other_actor_missing',
 '00000000-0000-4000-8000-000000000062',
 '55555555-0000-4000-8000-000000000061');
call pg_temp.v2_snapshot('outsider_snapshot_denied',
 '00000000-0000-4000-8000-000000000063',
 '55555555-0000-4000-8000-000000000061');

-- Simulated revocation must override a previously accepted request ID.
update fftt_private.event_staff
 set active=false,revoked_at=now()
 where event_id='11111111-0000-4000-8000-000000000061'
   and user_id='00000000-0000-4000-8000-000000000061';
call pg_temp.v2_snapshot('revoked_snapshot_denied',
 '00000000-0000-4000-8000-000000000061',
 '55555555-0000-4000-8000-000000000061');
call pg_temp.v2_score('revoked_replay_denied',
 '00000000-0000-4000-8000-000000000061',
 '55555555-0000-4000-8000-000000000061',
 '22222222-0000-4000-8000-000000000061');

-- Assert real durable Postgres state and scoped response data.
do $check$
declare
 v jsonb;
begin
 select answer into v from pg_temp.v2_outcomes where label='first_accepted';
 if v ->> 'status' is distinct from 'accepted' then
   raise exception 'First authorized score was not accepted: %',
    (select error_code from pg_temp.v2_outcomes where label='first_accepted');
 end if;
 select answer into v from pg_temp.v2_outcomes where label='second_stale';
 if v ->> 'status' is distinct from 'rejected'
    or v ->> 'reason' is distinct from 'stale-match-version' then
   raise exception 'Contested score not durably rejected: %',
    (select error_code from pg_temp.v2_outcomes where label='second_stale');
 end if;
 if (select answer from pg_temp.v2_outcomes where label='same_receipt_replay')
    is distinct from
    (select answer from pg_temp.v2_outcomes where label='first_accepted') then
   raise exception 'Identical retry did not return the same accepted decision';
 end if;
 if (select error_code from pg_temp.v2_outcomes where label='tampered_replay') is null
    or (select error_code from pg_temp.v2_outcomes where label='outsider_denied') is null
    or (select error_code from pg_temp.v2_outcomes where label='revoked_replay_denied') is null then
   raise exception 'Tampered/outsider/revoked score was not denied';
 end if;

 if (select count(*) from fftt_private.score_decisions_v2
     where event_id='11111111-0000-4000-8000-000000000061')<>2
    or (select count(*) from fftt_private.score_decisions_v2
     where event_id='11111111-0000-4000-8000-000000000061'
       and status='accepted')<>1
    or (select count(*) from fftt_private.score_decisions_v2
     where event_id='11111111-0000-4000-8000-000000000061'
       and status='rejected')<>1 then
   raise exception 'Durable accepted/rejected decision count incorrect';
 end if;
 if (select count(*) from fftt_private.result_submissions
     where event_id='11111111-0000-4000-8000-000000000061')<>1
    or (select count(*) from fftt_private.audit_events
     where event_id='11111111-0000-4000-8000-000000000061'
       and operation='result_accepted')<>1
    or (select revision from fftt_private.events
     where id='11111111-0000-4000-8000-000000000061')<>1 then
    raise exception 'Score wrote/advanced more than once';
 end if;
 if (select winner_id from fftt_private.matches
     where id='44444444-0000-4000-8000-000000000061')
    is distinct from '22222222-0000-4000-8000-000000000061'::uuid then
   raise exception 'Stored match winner incorrect';
 end if;

 select answer into v from pg_temp.v2_snapshots where label='own_accepted';
 if v #>> '{decision,status}' is distinct from 'accepted' then
   raise exception 'Actor A own accepted receipt unavailable';
 end if;
 select answer into v from pg_temp.v2_snapshots where label='own_rejected';
 if v #>> '{decision,status}' is distinct from 'rejected' then
   raise exception 'Actor B own rejected receipt unavailable';
 end if;
 select answer into v from pg_temp.v2_snapshots where label='other_actor_missing';
 if v -> 'decision' is distinct from 'null'::jsonb then
   raise exception 'Actor B could read Actor A private decision';
 end if;
 if (select error_code from pg_temp.v2_snapshots where label='outsider_snapshot_denied') is null
    or (select error_code from pg_temp.v2_snapshots where label='revoked_snapshot_denied') is null then
   raise exception 'Outsider or revoked reader obtained private snapshot';
 end if;
 if exists (
    select 1 from pg_temp.v2_snapshots
     where answer::text ~* '(email|rating|game_scores|phone|staff_list)'
 ) then
    raise exception 'Private fields leaked through snapshot';
 end if;
end;
$check$;

\echo 'PASS: disposable V2 accepted, rejected, idempotent, owner-scoped, unauthorized and revoked tests'
rollback;
