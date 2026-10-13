-- Phase 1B B1: run against a fresh Supabase LOCAL/DEV database with pgTAP.
-- Use "supabase test db" after "supabase db reset".
-- Do NOT run against production or any real participant data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select has_schema('fftt_private', 'Private FFTT schema exists');
select is((select count(*) from pg_catalog.pg_tables where schemaname = 'fftt_private'),
          9::bigint, 'Exactly nine private entity tables');
select is((
  select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'fftt_private' and c.relkind = 'r' and c.relrowsecurity
), 9::bigint, 'RLS enabled on all private tables');
select ok(not has_schema_privilege('anon', 'fftt_private', 'USAGE'),
          'Anonymous role cannot use private schema');
select ok(not has_table_privilege('authenticated', 'fftt_private.players', 'SELECT'),
          'Authenticated role cannot directly read private players (including B2)');
select ok(not has_table_privilege('anon', 'fftt_private.players', 'SELECT'),
          'Anonymous cannot read private players');
select ok(not has_table_privilege('authenticated', 'fftt_private.event_staff', 'SELECT'),
          'Signed-in users cannot directly read grants');
select ok(has_table_privilege('anon', 'public.fftt_published_events', 'SELECT'),
          'Anonymous can read published event rows');
select ok(has_table_privilege('anon', 'public.fftt_published_matches', 'SELECT'),
          'Anonymous can read published match rows');
select ok(has_table_privilege('anon', 'public.fftt_public_results_v1', 'SELECT'),
          'Anonymous can read allowlisted public view');
select ok(has_table_privilege('authenticated', 'public.fftt_public_results_v1', 'SELECT'),
          'Signed-in users can read allowlisted public view');
select ok(not has_table_privilege('anon', 'public.fftt_published_events', 'INSERT'),
          'Anonymous cannot publish an event');
select ok(not has_table_privilege('authenticated', 'public.fftt_published_events', 'INSERT'),
          'Authenticated user cannot publish an event');
select ok(not has_table_privilege('anon', 'public.fftt_published_matches', 'UPDATE'),
          'Anonymous cannot alter published scores');
select ok(not has_table_privilege('authenticated', 'public.fftt_published_matches', 'UPDATE'),
          'Authenticated user cannot alter published scores');
select ok(not has_table_privilege('anon', 'public.fftt_published_events', 'DELETE'),
          'Anonymous cannot delete published events');
select ok(not has_table_privilege('authenticated', 'public.fftt_published_matches', 'DELETE'),
          'Authenticated user cannot delete published matches');
select is((
 select count(*) from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
 and c.relname in ('fftt_published_events', 'fftt_published_matches')
 and c.relrowsecurity
), 2::bigint, 'Public materialization tables have RLS');
select is((
 select string_agg(column_name, ',' order by ordinal_position)
 from information_schema.columns
 where table_schema='public' and table_name='fftt_public_results_v1'
), 'event_id,event_name,event_date,status,brackets,updated_at',
   'Public view has exact Phase 1A event keys');
select is((
 select string_agg(column_name, ',' order by ordinal_position)
 from information_schema.columns
 where table_schema='public' and table_name='fftt_published_matches'
), 'event_id,match_id,bracket,round,slot,player_1_name,player_2_name,winner_name,game_scores,status',
   'Published match columns contain only public identifiers and score fields');
select ok((
 select 'security_invoker=true'=any(c.reloptions)
 from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='fftt_public_results_v1'
), 'Public view runs with caller privileges');
select is((select count(*) from public.fftt_published_events), 0::bigint,
          'No published events before trusted publication operation exists');
select is((select count(*) from public.fftt_published_matches), 0::bigint,
          'No published matches before trusted publication operation exists');
select ok(exists(
 select 1 from pg_catalog.pg_trigger t
 join pg_catalog.pg_class c on c.oid=t.tgrelid
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='fftt_private' and c.relname='audit_events'
 and t.tgname='fftt_audit_no_update_delete' and not t.tgisinternal
), 'Audit mutation blocking trigger is registered');
select ok(not exists(
 select 1 from information_schema.columns
 where table_schema='public' and table_name in
 ('fftt_published_events','fftt_published_matches','fftt_public_results_v1')
 and column_name in ('email','phone','rating','rating_status','checked_in',
                     'first_champ_loss','actor_id','submission_id','internal_player_id')
), 'No forbidden private columns are exposed in public projection');
select * from finish();
rollback;
