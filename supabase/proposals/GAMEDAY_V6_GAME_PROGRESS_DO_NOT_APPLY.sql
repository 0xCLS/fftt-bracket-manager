-- GAME-BY-GAME SCOREKEEPING V6 -- REVIEW CANDIDATE, DO NOT APPLY TO HOSTED DATABASE.
-- Depends on B1-B2d, Milestone 1 V2, game-day V3/V4/V5 (and the launch-mode override when applicable).
-- No mutation of existing results. All data and tests remain fictional until separate release authorization.
begin;

alter table fftt_private.audit_events drop constraint audit_events_operation_check;
alter table fftt_private.audit_events add constraint audit_events_operation_check check (operation in (
  'result_accepted','result_corrected','bracket_built','bracket_rebuilt','consolation_reviewed',
  'staff_grant_changed','event_created','event_updated','player_changed','checkin_changed',
  'table_assigned','match_forfeited','doubles_updated','doubles_result','lifecycle_changed',
  'visibility_changed','format_changed','registration_checkin','rating_confirmed','event_restored',
  'registration_source_changed','game_saved','game_corrected'));

-- Epoch guards against ABA: format/player reassignment then reversal cannot revive stale writes.
alter table fftt_private.matches add column game_progress_epoch bigint not null default 0
  check (game_progress_epoch >= 0);

create table fftt_private.match_game_progress (
  event_id uuid not null,
  match_id uuid not null,
  generation integer not null,
  match_version bigint not null,
  match_epoch bigint not null,
  best_of smallint not null check (best_of in (1,3,5)),
  points_to_win smallint not null check (points_to_win in (11,21)),
  games jsonb not null default '[]'::jsonb check (jsonb_typeof(games) = 'array' and jsonb_array_length(games) between 1 and 5),
  progress_version bigint not null check (progress_version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (event_id,match_id),
  foreign key (event_id,match_id) references fftt_private.matches(event_id,id) on delete cascade
);
alter table fftt_private.match_game_progress enable row level security;
revoke all on fftt_private.match_game_progress from public, anon, authenticated;

-- A submission ID is immutable, actor-owned, event-bound and has one terminal decision.
create table fftt_private.game_progress_decisions (
  event_id uuid not null references fftt_private.events(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  match_id uuid not null,
  request_fingerprint text not null check (length(request_fingerprint) = 64),
  response jsonb not null,
  decided_at timestamptz not null default now(),
  primary key (event_id,actor_id,submission_id)
);
alter table fftt_private.game_progress_decisions enable row level security;
revoke all on fftt_private.game_progress_decisions from public, anon, authenticated;
create trigger fftt_game_decisions_append_only before update or delete
  on fftt_private.game_progress_decisions for each row
  execute function fftt_private.reject_audit_mutation();

-- Validate official final result against any previously verified interim games.
-- Walkovers remain an explicitly audited organizer action; they are not gameplay submissions.
create function fftt_private.v6_match_guard() returns trigger
language plpgsql volatile security definer set search_path = ''
as $f$
declare p fftt_private.match_game_progress%rowtype; text_scores text; v_needed integer;
begin
  if old.player_1_id is distinct from new.player_1_id
    or old.player_2_id is distinct from new.player_2_id
    or old.best_of is distinct from new.best_of
    or old.points_to_win is distinct from new.points_to_win
    or old.generation is distinct from new.generation
    or old.status is distinct from new.status
    or old.match_version is distinct from new.match_version then
    new.game_progress_epoch := old.game_progress_epoch + 1;
  end if;
  if old.status = 'pending' and new.status = 'complete' and new.game_scores <> 'W/O' then
    select * into p from fftt_private.match_game_progress
      where event_id=old.event_id and match_id=old.id;
    if found then
      select pg_catalog.string_agg((g.score->>0)||'-'||(g.score->>1), ', ' order by g.ordinality)
        into text_scores from pg_catalog.jsonb_array_elements(p.games) with ordinality as g(score,ordinality);
      v_needed := (p.best_of + 1) / 2;
      if p.match_version <> old.match_version or p.match_epoch <> old.game_progress_epoch
         or pg_catalog.jsonb_array_length(p.games) < v_needed
         or new.game_scores <> text_scores then
        perform fftt_private.v3_err('conflict','game-progress-mismatch');
      end if;
    end if;
  end if;
  return new;
end;
$f$;
create trigger fftt_v6_match_guard before update on fftt_private.matches
  for each row execute function fftt_private.v6_match_guard();

create function fftt_private.v6_invalidate_progress() returns trigger
language plpgsql volatile security definer set search_path = ''
as $f$
begin
  if new.game_progress_epoch <> old.game_progress_epoch then
    delete from fftt_private.match_game_progress
      where event_id=new.event_id and match_id=new.id;
  end if;
  return null;
end;
$f$;
create trigger fftt_v6_invalidate_progress after update on fftt_private.matches
  for each row execute function fftt_private.v6_invalidate_progress();

-- Authenticated event-staff read: no contact data, internal ratings, or unrelated event data.
create function fftt_private.game_progress_read_v1(p_event_id uuid, p_match_id uuid)
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
    'revision',coalesce(p.progress_version,0),'games',coalesce(p.games,'[]'::jsonb),
    'updated_at',p.updated_at,'event_revision',e.revision);
end;
$f$;

create function fftt_private.game_progress_save_v1(
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
  v_revision bigint; v_new_version bigint; v_is_correction boolean;
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
  if p_generation <> e.bracket_generation or p_expected_match_version <> m.match_version
    or p_expected_epoch <> m.game_progress_epoch
    or p_expected_best_of <> f.best_of or p_expected_points_to_win <> f.points
    or p_expected_progress_version <> coalesce(p.progress_version,0)
    or (found and (p.generation <> m.generation or p.match_version <> m.match_version
      or p.match_epoch <> m.game_progress_epoch or p.best_of <> f.best_of or p.points_to_win <> f.points)) then
    v_response := pg_catalog.jsonb_build_object('submission_id',p_submission_id,'status','rejected',
      'reason','stale-progress','match_id',p_match_id,'revision',coalesce(p.progress_version,0),
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
  v_new_version := coalesce(p.progress_version,0)+1;
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

create function fftt_private.game_progress_decision_v1(p_event_id uuid,p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
declare d fftt_private.game_progress_decisions%rowtype;
begin
  perform fftt_private.staff_role_for_event(p_event_id);
  select * into d from fftt_private.game_progress_decisions
    where event_id=p_event_id and actor_id=auth.uid() and submission_id=p_submission_id;
  if found then return d.response; end if;
  return pg_catalog.jsonb_build_object('submission_id',p_submission_id,'status','unconfirmed');
end;
$f$;

-- The public cache is the only anonymous source. A second trigger runs AFTER the existing
-- v3 publish trigger (trigger-name order), in the SAME transaction as the event revision.
alter table public.fftt_published_matches add column game_progress jsonb;
create function fftt_private.v6_refresh_public_progress() returns trigger
language plpgsql volatile security definer set search_path = ''
as $f$
begin
  if new.public_visible and new.lifecycle in ('active','complete') then
    update public.fftt_published_matches pub set game_progress = (
      select pg_catalog.jsonb_build_object('games',p.games,'version',p.progress_version,
        'epoch',p.match_epoch,'updated_at',p.updated_at)
      from fftt_private.matches m
      join fftt_private.brackets b on b.id=m.bracket_id and b.event_id=m.event_id and b.generation=m.generation
      join fftt_private.match_game_progress p on p.event_id=m.event_id and p.match_id=m.id
      where m.event_id=new.id and m.generation=new.bracket_generation
        and m.status='pending' and pub.match_id=pg_catalog.lower(b.kind||'-'||m.match_code)
        and p.generation=m.generation and p.match_version=m.match_version
        and p.match_epoch=m.game_progress_epoch
        and p.best_of=coalesce(m.best_of,case when b.kind='championship' and m.is_championship_final
          then new.championship_final_best_of else new.regular_best_of end)
        and p.points_to_win=coalesce(m.points_to_win,11)
    ) where pub.event_id=new.public_id;
  end if;
  return null;
end;
$f$;
create trigger zz_fftt_events_publish_game_progress_v6 after update on fftt_private.events
  for each row execute function fftt_private.v6_refresh_public_progress();

create or replace view public.fftt_public_tournament_v1 with (security_invoker = true) as
select e.event_id, e.event_name, e.event_date, e.status, e.public_revision as revision,
       e.table_count as tables, e.updated_at, e.finale,
       coalesce((
         select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',g.bracket,'matches',g.matches) order by g.bracket)
         from (select m.bracket,
           pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'match_id',m.match_id,'bracket',m.bracket,'round',m.round,'slot',m.slot,
             'player_1_name',m.player_1_name,'player_2_name',m.player_2_name,
             'winner_name',m.winner_name,'game_scores',m.game_scores,'status',m.status,
             'table_number',m.table_number,'phase',m.phase,'best_of',m.best_of,
             'points_to_win',m.points_to_win,'game_progress',m.game_progress
           ) order by m.round,m.slot) as matches
           from public.fftt_published_matches m where m.event_id=e.event_id group by m.bracket) g
       ),'[]'::jsonb) as brackets
from public.fftt_published_events e;

-- No direct private table access; the only authenticated surfaces are narrow RPCs.
do $grant$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='fftt_private' and p.proname in
      ('v6_match_guard','v6_invalidate_progress','game_progress_read_v1',
       'game_progress_save_v1','game_progress_decision_v1','v6_refresh_public_progress')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',r.sig);
  end loop;
end;
$grant$;
grant execute on function fftt_private.game_progress_read_v1(uuid,uuid) to authenticated;
grant execute on function fftt_private.game_progress_save_v1(
  uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text) to authenticated;
grant execute on function fftt_private.game_progress_decision_v1(uuid,uuid) to authenticated;

create function public.fftt_game_progress_v1(p_event_id uuid,p_match_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.game_progress_read_v1(p_event_id,p_match_id); $f$;
create function public.fftt_save_completed_game_v1(
  p_event_id uuid,p_match_id uuid,p_generation integer,p_expected_match_version bigint,
  p_expected_epoch bigint,p_expected_progress_version bigint,p_expected_best_of integer,
  p_expected_points_to_win integer,p_submission_id uuid,p_game_index integer,
  p_player_1_score integer,p_player_2_score integer,p_reason text default null)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.game_progress_save_v1(
 p_event_id,p_match_id,p_generation,p_expected_match_version,p_expected_epoch,
 p_expected_progress_version,p_expected_best_of,p_expected_points_to_win,
 p_submission_id,p_game_index,p_player_1_score,p_player_2_score,p_reason); $f$;
create function public.fftt_game_progress_decision_v1(p_event_id uuid,p_submission_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.game_progress_decision_v1(p_event_id,p_submission_id); $f$;
revoke all on function public.fftt_game_progress_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.fftt_save_completed_game_v1(
 uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text)
 from public,anon,authenticated;
revoke all on function public.fftt_game_progress_decision_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fftt_game_progress_v1(uuid,uuid) to authenticated;
grant execute on function public.fftt_save_completed_game_v1(
 uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text) to authenticated;
grant execute on function public.fftt_game_progress_decision_v1(uuid,uuid) to authenticated;
commit;
