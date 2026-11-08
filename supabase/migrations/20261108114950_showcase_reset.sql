-- Exact showcase only. The baseline is installed separately from the verified local archive;
-- absent baseline makes the reset fail closed. No production data is embedded in this migration.
begin;
create table fftt_private.showcase_reset_baseline (
  singleton boolean primary key default true check (singleton),
  fixture jsonb not null,
  archive_sha256 text not null check (archive_sha256 = 'c16a477419af1f277792665a0e9ca94bd513effc66de1c7639dab51da84a0c44'),
  installed_at timestamptz not null default now()
);
alter table fftt_private.showcase_reset_baseline enable row level security;
revoke all on fftt_private.showcase_reset_baseline from public, anon, authenticated;
create trigger showcase_baseline_immutable before update or delete on fftt_private.showcase_reset_baseline
 for each row execute function fftt_private.reject_audit_mutation();

create table fftt_private.showcase_reset_decisions (
  actor_id uuid not null references auth.users(id), request_id uuid not null,
  event_revision bigint not null, decided_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
alter table fftt_private.showcase_reset_decisions enable row level security;
revoke all on fftt_private.showcase_reset_decisions from public, anon, authenticated;
create trigger showcase_decisions_immutable before update or delete on fftt_private.showcase_reset_decisions
 for each row execute function fftt_private.reject_audit_mutation();

alter table fftt_private.audit_events drop constraint audit_events_operation_check;
alter table fftt_private.audit_events add constraint audit_events_operation_check check (operation in (
 'result_accepted','result_corrected','bracket_built','bracket_rebuilt','consolation_reviewed',
 'staff_grant_changed','event_created','event_updated','player_changed','checkin_changed',
 'table_assigned','match_forfeited','doubles_updated','doubles_result','lifecycle_changed',
 'visibility_changed','format_changed','registration_checkin','rating_confirmed','event_restored',
 'registration_source_changed','game_saved','game_corrected','showcase_reset'));

-- The watermark carries saved-game revisions across the empty state. Replacements are
-- permitted only when the installed V6 definitions match the exact reviewed functions.
do $check$ begin
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fftt_private' and p.proname='game_progress_read_v1') is distinct from '529b3b011de709d58405117303ac517b'
 or (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fftt_private' and p.proname='game_progress_save_v1') is distinct from '331a72ed99f8bea4ea1bf9e6f80bcc94' then
  raise exception 'V6 function definitions differ from reviewed versions';
 end if;
end $check$;
create table fftt_private.showcase_progress_watermarks (match_id uuid primary key, revision bigint not null check(revision >= 0));
alter table fftt_private.showcase_progress_watermarks enable row level security;
revoke all on fftt_private.showcase_progress_watermarks from public,anon,authenticated;
create function fftt_private.showcase_progress_watermark_trigger() returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if new.event_id='e6bd40cf-4107-43ea-8c87-057dc38ef31b'::uuid then
  insert into fftt_private.showcase_progress_watermarks(match_id,revision) values(new.match_id,new.progress_version)
  on conflict(match_id) do update set revision=greatest(fftt_private.showcase_progress_watermarks.revision,excluded.revision);
 end if;
 return null;
end $f$;
revoke all on function fftt_private.showcase_progress_watermark_trigger() from public,anon,authenticated;
create trigger showcase_progress_watermark after insert or update on fftt_private.match_game_progress for each row execute function fftt_private.showcase_progress_watermark_trigger();

create or replace function fftt_private.game_progress_read_v1(p_event_id uuid, p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype; m fftt_private.matches%rowtype;
  p fftt_private.match_game_progress%rowtype; f record;
begin
  perform fftt_private.staff_role_for_event(p_event_id);
  select * into e from fftt_private.events where id=p_event_id;
  select * into m from fftt_private.matches where event_id=p_event_id and id=p_match_id
    and generation=e.bracket_generation;
  if not found then perform fftt_private.v3_err('notfound','match'); end if;
  select * into f from fftt_private.v4_match_format(p_event_id,p_match_id);
  select * into p from fftt_private.match_game_progress where event_id=p_event_id and match_id=p_match_id
    and generation=m.generation and match_version=m.match_version and match_epoch=m.game_progress_epoch
    and best_of=f.best_of and points_to_win=f.points;
  return pg_catalog.jsonb_build_object(
    'event_id',p_event_id,'match_id',p_match_id,'generation',m.generation,
    'match_version',m.match_version,'epoch',m.game_progress_epoch,
    'best_of',f.best_of,'points_to_win',f.points,'match_status',m.status,
    'revision',coalesce(p.progress_version,(select w.revision from fftt_private.showcase_progress_watermarks w where w.match_id=p_match_id and p_event_id='e6bd40cf-4107-43ea-8c87-057dc38ef31b'::uuid),0),'games',coalesce(p.games,'[]'::jsonb),
    'updated_at',p.updated_at,'event_revision',e.revision);
end;
$f$;

create or replace function fftt_private.game_progress_save_v1(
  p_event_id uuid,p_match_id uuid,p_generation integer,p_expected_match_version bigint,
  p_expected_epoch bigint,p_expected_progress_version bigint,p_expected_best_of integer,
  p_expected_points_to_win integer,p_submission_id uuid,p_game_index integer,
  p_player_1_score integer,p_player_2_score integer,p_reason text default null
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype; m fftt_private.matches%rowtype;
  p fftt_private.match_game_progress%rowtype; d fftt_private.game_progress_decisions%rowtype;
  f record; v_actor uuid; v_role text; v_fingerprint text; v_response jsonb;
  v_games jsonb; v_pair jsonb; v_total integer; v_a integer; v_b integer;
  v_w1 integer := 0; v_w2 integer := 0; v_needed integer; v_i integer;
  v_revision bigint; v_new_version bigint; v_is_correction boolean; v_progress_found boolean; v_progress_base bigint;
begin
  if p_event_id is null or p_match_id is null or p_generation is null
    or p_expected_match_version is null or p_expected_epoch is null or p_expected_progress_version is null
    or p_expected_best_of is null or p_expected_points_to_win is null or p_submission_id is null
    or p_game_index is null or p_player_1_score is null or p_player_2_score is null then
    perform fftt_private.v3_err('validation','required');
  end if;
  e := fftt_private.v3_begin(p_event_id,array['organizer','scorekeeper','bracket_manager'],array['active']);
  v_actor := auth.uid();
  v_role := fftt_private.staff_role_for_event(p_event_id);
  v_fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(p_event_id,p_match_id,p_generation,p_expected_match_version,
      p_expected_epoch,p_expected_progress_version,p_expected_best_of,p_expected_points_to_win,
      p_game_index,p_player_1_score,p_player_2_score,p_reason)::text,'UTF8')),'hex');
  select * into d from fftt_private.game_progress_decisions
    where event_id=p_event_id and actor_id=v_actor and submission_id=p_submission_id;
  if found then
    if d.request_fingerprint <> v_fingerprint or d.match_id <> p_match_id then
      perform fftt_private.v3_err('conflict','submission-id-reused');
    end if;
    return d.response;
  end if;
  select * into m from fftt_private.matches where event_id=p_event_id and id=p_match_id
    and generation=e.bracket_generation for update;
  if not found then perform fftt_private.v3_err('notfound','match'); end if;
  if m.status <> 'pending' or m.player_1_id is null or m.player_2_id is null
    or m.table_number is null then
    perform fftt_private.v3_err('conflict','match-not-playable');
  end if;
  if not exists (select 1 from fftt_private.brackets b where b.id=m.bracket_id and b.event_id=e.id
    and b.generation=e.bracket_generation and b.status='active') then
    perform fftt_private.v3_err('conflict','bracket');
  end if;
  select * into f from fftt_private.v4_match_format(p_event_id,p_match_id);
  select * into p from fftt_private.match_game_progress where event_id=p_event_id and match_id=p_match_id for update;
  v_progress_found := found;
  v_progress_base := coalesce(p.progress_version,(select w.revision from fftt_private.showcase_progress_watermarks w where w.match_id=p_match_id and p_event_id='e6bd40cf-4107-43ea-8c87-057dc38ef31b'::uuid),0);
  if p_generation <> e.bracket_generation or p_expected_match_version <> m.match_version
    or p_expected_epoch <> m.game_progress_epoch
    or p_expected_best_of <> f.best_of or p_expected_points_to_win <> f.points
    or p_expected_progress_version <> v_progress_base
    or (v_progress_found and (p.generation <> m.generation or p.match_version <> m.match_version
      or p.match_epoch <> m.game_progress_epoch or p.best_of <> f.best_of or p.points_to_win <> f.points)) then
    v_response := pg_catalog.jsonb_build_object('submission_id',p_submission_id,'status','rejected',
      'reason','stale-progress','match_id',p_match_id,'revision',v_progress_base,
      'event_revision',e.revision);
    insert into fftt_private.game_progress_decisions(event_id,actor_id,submission_id,match_id,request_fingerprint,response)
      values (e.id,v_actor,p_submission_id,p_match_id,v_fingerprint,v_response);
    return v_response;
  end if;
  if f.best_of not in (1,3,5) or f.points not in (11,21)
    or p_game_index not between 1 and f.best_of
    or p_player_1_score not between 0 and 99 or p_player_2_score not between 0 and 99
    or greatest(p_player_1_score,p_player_2_score) < f.points
    or abs(p_player_1_score-p_player_2_score) < 2
    or (greatest(p_player_1_score,p_player_2_score)>f.points and abs(p_player_1_score-p_player_2_score)<>2) then
    perform fftt_private.v3_err('validation','scores-game');
  end if;
  v_games := coalesce(p.games,'[]'::jsonb);
  v_total := pg_catalog.jsonb_array_length(v_games);
  if p_game_index > v_total + 1 then perform fftt_private.v3_err('validation','game-order'); end if;
  v_is_correction := p_game_index <= v_total;
  if v_is_correction then
    if v_role <> 'organizer' then perform fftt_private.v3_err('forbidden','correction'); end if;
    if p_reason is null or length(btrim(p_reason)) not between 10 and 500 then
      perform fftt_private.v3_err('validation','correction-reason');
    end if;
    v_games := pg_catalog.jsonb_set(v_games,array[(p_game_index-1)::text],
      pg_catalog.jsonb_build_array(p_player_1_score,p_player_2_score),false);
  else
    if p_reason is not null then perform fftt_private.v3_err('validation','reason'); end if;
    v_games := v_games || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(p_player_1_score,p_player_2_score));
  end if;
  v_total := pg_catalog.jsonb_array_length(v_games);
  v_needed := (f.best_of+1)/2;
  for v_i in 0..v_total-1 loop
    v_pair := v_games->v_i;
    v_a := (v_pair->>0)::integer; v_b := (v_pair->>1)::integer;
    if v_a>v_b then v_w1:=v_w1+1; else v_w2:=v_w2+1; end if;
    if v_i<v_total-1 and greatest(v_w1,v_w2)>=v_needed then
      perform fftt_private.v3_err('validation','scores-extra-games');
    end if;
  end loop;
  v_new_version := v_progress_base+1;
  insert into fftt_private.match_game_progress(
    event_id,match_id,generation,match_version,match_epoch,best_of,points_to_win,
    games,progress_version,updated_at,updated_by)
  values (e.id,m.id,m.generation,m.match_version,m.game_progress_epoch,f.best_of,f.points,
    v_games,v_new_version,now(),v_actor)
  on conflict (event_id,match_id) do update set games=excluded.games,
    progress_version=excluded.progress_version,updated_at=excluded.updated_at,updated_by=excluded.updated_by,
    generation=excluded.generation,match_version=excluded.match_version,match_epoch=excluded.match_epoch,
    best_of=excluded.best_of,points_to_win=excluded.points_to_win;
  v_revision := fftt_private.v3_bump(e.id);
  perform fftt_private.v3_audit(e.id,case when v_is_correction then 'game_corrected' else 'game_saved' end,m.id,
    case when v_is_correction then pg_catalog.jsonb_build_object('game',p_game_index,'score',p.games->(p_game_index-1)) else null end,
    pg_catalog.jsonb_build_object('game',p_game_index,'score',v_games->(p_game_index-1),
      'progress_version',v_new_version,'games_won',pg_catalog.jsonb_build_array(v_w1,v_w2)),
    p_reason,v_revision);
  v_response := pg_catalog.jsonb_build_object('submission_id',p_submission_id,'status','accepted',
    'reason',null,'match_id',m.id,'revision',v_new_version,'event_revision',v_revision);
  insert into fftt_private.game_progress_decisions(event_id,actor_id,submission_id,match_id,request_fingerprint,response)
    values (e.id,v_actor,p_submission_id,m.id,v_fingerprint,v_response);
  return v_response;
end;
$f$;


create function fftt_private.reset_showcase_v1(p_confirmation text, p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $f$
declare
 eid constant uuid := 'e6bd40cf-4107-43ea-8c87-057dc38ef31b';
 pub constant uuid := '9c25613c-6543-4d6c-84cf-97ba49017509';
 fixture jsonb; e fftt_private.events%rowtype; rev bigint; previous bigint;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'role','') <> 'authenticated'
   or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
   or not exists(select 1 from auth.users u where u.id=auth.uid() and not u.is_anonymous
                 and u.deleted_at is null and (u.banned_until is null or u.banned_until < now()))
   or fftt_private.staff_role_for_event(eid) <> 'organizer' then
   perform fftt_private.v3_err('forbidden');
 end if;
 if p_confirmation is distinct from 'RESET SHOWCASE' or p_request_id is null then
   perform fftt_private.v3_err('validation','confirmation');
 end if;
 select * into e from fftt_private.events where id=eid and public_id=pub and synthetic_only is true for update;
 if not found then perform fftt_private.v3_err('conflict','showcase-identity'); end if;
 select event_revision into previous from fftt_private.showcase_reset_decisions where actor_id=auth.uid() and request_id=p_request_id;
 if found then return jsonb_build_object('status','reset','revision',previous,'request_id',p_request_id); end if;
 select b.fixture into fixture from fftt_private.showcase_reset_baseline b where singleton;
 if fixture is null then perform fftt_private.v3_err('conflict','showcase-baseline'); end if;
 -- Refuse structural drift rather than deleting newly created records or evidence.
 if e.bracket_generation <> 1
   or (select count(*) from fftt_private.players p where p.event_id=eid) <> 20
   or (select count(*) from fftt_private.brackets b where b.event_id=eid) <> 2
   or (select count(*) from fftt_private.matches m where m.event_id=eid) <> 46
   or (select count(*) from fftt_private.consolation_reviews r where r.event_id=eid) <> jsonb_array_length(fixture->'reviews')
   or exists (select 1 from jsonb_array_elements(fixture->'reviews') x where not exists
       (select 1 from fftt_private.consolation_reviews r where r.event_id=eid and r.player_id=(x->>'player_id')::uuid))
   or exists (select 1 from jsonb_array_elements(fixture->'players') x where not exists
       (select 1 from fftt_private.players p where p.event_id=eid and p.id=(x->>'id')::uuid))
   or exists (select 1 from jsonb_array_elements(fixture->'brackets') x where not exists
       (select 1 from fftt_private.brackets b where b.event_id=eid and b.id=(x->>'id')::uuid and b.generation=1))
   or exists (select 1 from jsonb_array_elements(fixture->'matches') x where not exists
       (select 1 from fftt_private.matches m where m.event_id=eid and m.id=(x->>'id')::uuid and m.generation=1)) then
   perform fftt_private.v3_err('conflict','showcase-structure');
 end if;
 -- Clearing only ephemeral progress first prevents the final-score consistency guard
 -- from interpreting restoration of a historical result as a new score submission.
 insert into fftt_private.showcase_progress_watermarks(match_id,revision)
 select m.id,coalesce(p.progress_version,0)+1 from fftt_private.matches m
 left join fftt_private.match_game_progress p on p.event_id=m.event_id and p.match_id=m.id where m.event_id=eid
 on conflict(match_id) do update set revision=greatest(fftt_private.showcase_progress_watermarks.revision,excluded.revision-1)+1;
 delete from fftt_private.match_game_progress where event_id=eid;
 -- Release any current pending-table assignments before restoring original tables;
 -- otherwise the immediate uniqueness constraint can reject a legitimate reset.
 update fftt_private.matches set table_number=null
 where event_id=eid and status='pending' and table_number is not null;
 update fftt_private.players p set display_name=x.display_name,rating=x.rating,rating_status=x.rating_status,
   checked_in=x.checked_in,first_champ_loss=x.first_champ_loss,seed_order=x.seed_order,
   source=x.source,rating_confirmed=x.rating_confirmed
 from jsonb_populate_recordset(null::fftt_private.players,fixture->'players') x where p.event_id=eid and p.id=x.id;
 update fftt_private.brackets b set status=x.status,consolation_review_completed=x.consolation_review_completed
 from jsonb_populate_recordset(null::fftt_private.brackets,fixture->'brackets') x where b.event_id=eid and b.id=x.id;
 update fftt_private.matches m set player_1_id=x.player_1_id,player_2_id=x.player_2_id,winner_id=x.winner_id,
   game_scores=x.game_scores,table_number=x.table_number,status=x.status,best_of=x.best_of,points_to_win=x.points_to_win,
   next_match_id=x.next_match_id,next_match_slot=x.next_match_slot,
   match_version=m.match_version+1,updated_at=now()
 from jsonb_populate_recordset(null::fftt_private.matches,fixture->'matches') x where m.event_id=eid and m.id=x.id;
 delete from fftt_private.doubles_finale where event_id=eid;
 update fftt_private.consolation_reviews r set first_loss_match_id=x.first_loss_match_id,review_state=x.review_state
 from jsonb_populate_recordset(null::fftt_private.consolation_reviews,fixture->'reviews') x
 where r.event_id=eid and r.player_id=x.player_id;
 update fftt_private.events set event_name=fixture->'event'->>'event_name',
   event_date=(fixture->'event'->>'event_date')::date,lifecycle=fixture->'event'->>'lifecycle',
   table_count=(fixture->'event'->>'table_count')::smallint,public_visible=(fixture->'event'->>'public_visible')::boolean,
   champ_best_of=(fixture->'event'->>'champ_best_of')::smallint,champ_points=(fixture->'event'->>'champ_points')::smallint,
   champ_final_best_of=(fixture->'event'->>'champ_final_best_of')::smallint,champ_final_points=(fixture->'event'->>'champ_final_points')::smallint,
   cons_best_of=(fixture->'event'->>'cons_best_of')::smallint,cons_points=(fixture->'event'->>'cons_points')::smallint,
   cons_final_best_of=(fixture->'event'->>'cons_final_best_of')::smallint,cons_final_points=(fixture->'event'->>'cons_final_points')::smallint,
   doubles_best_of=(fixture->'event'->>'doubles_best_of')::smallint,doubles_points=(fixture->'event'->>'doubles_points')::smallint,
   archived_from=null,revision=revision+1,updated_at=now() where id=eid returning revision into rev;
 perform fftt_private.v3_audit(eid,'showcase_reset',null,null,jsonb_build_object('request_id',p_request_id),'Reset fictional showcase',rev);
 insert into fftt_private.showcase_reset_decisions(actor_id,request_id,event_revision) values(auth.uid(),p_request_id,rev);
 return jsonb_build_object('status','reset','revision',rev,'request_id',p_request_id);
end;
$f$;
revoke all on function fftt_private.reset_showcase_v1(text,uuid) from public,anon,authenticated;
grant execute on function fftt_private.reset_showcase_v1(text,uuid) to authenticated;
create function public.fftt_reset_showcase_v1(p_confirmation text,p_request_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $f$
 select fftt_private.reset_showcase_v1(p_confirmation,p_request_id);
$f$;
revoke all on function public.fftt_reset_showcase_v1(text,uuid) from public,anon,authenticated;
grant execute on function public.fftt_reset_showcase_v1(text,uuid) to authenticated;
commit;
