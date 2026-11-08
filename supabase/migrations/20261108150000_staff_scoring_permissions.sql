-- Staff scoring permissions (additive; replaces four function bodies, adds nullable columns and four functions,
-- and rewrites no existing row's values).
--
-- Saved-game corrections (while the match is open): organizer, bracket_manager and scorekeeper.
-- Finalized-result corrections: organizer and bracket_manager only (unchanged; a scorekeeper is refused by the
-- database). A written reason is OPTIONAL for both and is never required by the database. Every correction still
-- writes an append-only audit row with the actor, time, event, match, and the original and corrected values, and
-- all existing guards stay: event-scoped staff access, open/finalized status rules, game-score validation,
-- revision and epoch checks, stale-submission rejection, idempotent receipts, and bracket-advancement protections.
--
--
-- Mixed-Skill Doubles: the doubles finale gets the same game-by-game scoring as singles matches. Saved games live in
-- nullable columns of the existing doubles_finale row (so no new private table; older backups still restore) and
-- receipts reuse the append-only game_progress_decisions table, keyed by the event ID. Scorekeepers, bracket managers
-- and organizers may record games and correct saved games before finalization; only the organizer or a bracket manager
-- may change a finalized doubles result; partner selection stays organizer/bracket manager only (unchanged).
-- Nothing is published: the public finale still comes from winner_team/game_scores only.
--
-- Fail-closed precondition: the three functions must be byte-for-byte the reviewed currently installed versions
-- (the V6 save function as replaced by 20261108114950_showcase_reset.sql, and the delegation-layer result
-- correction with its public wrapper). Any other state aborts the whole transaction.
begin;
do $guard$
begin
  if pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'fftt_private.game_progress_save_v1(uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text)'::pg_catalog.regprocedure))
       <> '3df36a95d474939018a02863e5be7388'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'fftt_private.correct_result_v3(uuid,uuid,bigint,uuid,text,text)'::pg_catalog.regprocedure))
       <> '84590563d2fc026e871750667475b026'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'public.fftt_correct_result_v3(uuid,uuid,bigint,uuid,text,text)'::pg_catalog.regprocedure))
       <> 'bb83b39b6873b69e9bbc9138943cffef'
     or pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'fftt_private.record_doubles_result_v3(uuid,integer,text)'::pg_catalog.regprocedure))
       <> '8d727d062f885a79455767efe90ca72a' then
    raise exception 'staff-correction-permissions: installed function bodies differ from the reviewed versions';
  end if;
end
$guard$;

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
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason,'')),'');
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
      p_game_index,p_player_1_score,p_player_2_score,
      case when v_reason is null then null else p_reason end)::text,'UTF8')),'hex');
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
    -- Any event-scoped staff role may correct a saved game while the match is open (finalized
    -- matches were rejected above as not playable). The reason is optional; the audit row below
    -- always records the actor, time, match and the original and corrected scores.
    if v_role is null or v_role not in ('organizer','bracket_manager','scorekeeper') then
      perform fftt_private.v3_err('forbidden','correction');
    end if;
    if v_reason is not null and length(v_reason) > 500 then
      perform fftt_private.v3_err('validation','reason');
    end if;
    v_games := pg_catalog.jsonb_set(v_games,array[(p_game_index-1)::text],
      pg_catalog.jsonb_build_array(p_player_1_score,p_player_2_score),false);
  else
    if v_reason is not null then perform fftt_private.v3_err('validation','reason'); end if;
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
    v_reason,v_revision);
  v_response := pg_catalog.jsonb_build_object('submission_id',p_submission_id,'status','accepted',
    'reason',null,'match_id',m.id,'revision',v_new_version,'event_revision',v_revision);
  insert into fftt_private.game_progress_decisions(event_id,actor_id,submission_id,match_id,request_fingerprint,response)
    values (e.id,v_actor,p_submission_id,m.id,v_fingerprint,v_response);
  return v_response;
end;
$f$;

create or replace function fftt_private.correct_result_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint,
                                                          p_winner_id uuid, p_game_scores text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_next fftt_private.matches%rowtype;
  v_bracket fftt_private.brackets%rowtype; v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason,'')),'');
  v_scores text; v_best integer; v_points integer; v_old_winner uuid; v_new_loser uuid; v_changed boolean; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['active','complete']);
  -- The reason is optional. Only organizers and bracket managers reach this point (a scorekeeper is
  -- refused by v3_begin above); the audit row below records actor, time, match, before and after.
  if v_reason is not null and (length(v_reason) > 300 or v_reason ~ '[[:cntrl:]]') then perform fftt_private.v3_err('validation','reason'); end if;
  select * into v_match from fftt_private.matches
   where event_id = p_event_id and id = p_match_id and generation = v_event.bracket_generation for update;
  if not found then perform fftt_private.v3_err('notfound','match'); end if;
  if v_match.status <> 'complete' or v_match.match_version <> p_expected_match_version then
    perform fftt_private.v3_err('conflict','match-version');
  end if;
  if p_winner_id is null or p_winner_id not in (v_match.player_1_id, v_match.player_2_id) then perform fftt_private.v3_err('validation','winner'); end if;
  select * into v_bracket from fftt_private.brackets where id = v_match.bracket_id;
  -- historical matches are corrected under the format they were played under
  select f.best_of, f.points into v_best, v_points from fftt_private.v4_match_format(p_event_id, p_match_id) f;
  v_scores := fftt_private.v4_normalize_scores(p_game_scores, v_best, v_points, p_winner_id = v_match.player_1_id);
  v_old_winner := v_match.winner_id;
  v_changed := p_winner_id <> v_old_winner;

  if v_changed then
    if v_bracket.kind = 'championship' and exists (
         select 1 from fftt_private.brackets where event_id = p_event_id and generation = v_event.bracket_generation
            and kind = 'consolation') then
      perform fftt_private.v3_err('conflict','consolation-built');
    end if;
    if v_match.next_match_id is not null then
      select * into v_next from fftt_private.matches where event_id = p_event_id and id = v_match.next_match_id for update;
      if v_next.status <> 'pending' then perform fftt_private.v3_err('conflict','downstream-complete'); end if;
      update fftt_private.matches set
        player_1_id = case when v_match.next_match_slot = 1 then p_winner_id else player_1_id end,
        player_2_id = case when v_match.next_match_slot = 2 then p_winner_id else player_2_id end,
        match_version = match_version + 1, updated_at = now()
       where event_id = p_event_id and id = v_match.next_match_id;
    end if;
    if v_bracket.kind = 'championship' then
      delete from fftt_private.consolation_reviews where event_id = p_event_id and player_id = p_winner_id
         and first_loss_match_id = p_match_id;
      update fftt_private.players set first_champ_loss = false
       where event_id = p_event_id and id = p_winner_id
         and not exists (select 1 from fftt_private.consolation_reviews r where r.event_id = p_event_id and r.player_id = p_winner_id);
      v_new_loser := v_old_winner;
      if not exists (select 1 from fftt_private.matches c where c.bracket_id = v_match.bracket_id and c.status = 'complete'
                       and c.id <> v_match.id and (c.player_1_id = v_new_loser or c.player_2_id = v_new_loser)) then
        update fftt_private.players set first_champ_loss = true where event_id = p_event_id and id = v_new_loser;
        insert into fftt_private.consolation_reviews(event_id, player_id, first_loss_match_id, review_state)
        values (p_event_id, v_new_loser, v_match.id, 'eligible') on conflict (event_id, player_id) do nothing;
      end if;
    end if;
  end if;

  update fftt_private.matches set winner_id = p_winner_id, game_scores = v_scores,
         match_version = match_version + 1, updated_at = now()
   where event_id = p_event_id and id = p_match_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'result_corrected', p_match_id,
    pg_catalog.jsonb_build_object('winner_id', v_old_winner, 'game_scores', v_match.game_scores, 'match_version', v_match.match_version),
    pg_catalog.jsonb_build_object('winner_id', p_winner_id, 'game_scores', v_scores, 'match_version', v_match.match_version + 1),
    v_reason, v_rev);
  return pg_catalog.jsonb_build_object('status','corrected','match_id', p_match_id,
    'match_version', v_match.match_version + 1, 'event_revision', v_rev);
end;
$f$;

-- The optional reason may be omitted by a direct API caller (PostgREST named arguments).
create or replace function public.fftt_correct_result_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint, p_winner_id uuid, p_game_scores text, p_reason text default null)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.correct_result_v3(p_event_id, p_match_id, p_expected_match_version, p_winner_id, p_game_scores, p_reason); $f$;

-- ---------------------------------------------------------------- Mixed-Skill Doubles game-by-game scoring
alter table fftt_private.doubles_finale
  add column progress_games jsonb check (progress_games is null
    or (pg_catalog.jsonb_typeof(progress_games) = 'array' and pg_catalog.jsonb_array_length(progress_games) <= 5)),
  add column progress_version bigint check (progress_version is null or progress_version >= 0),
  add column progress_key text,
  add column progress_epoch uuid default gen_random_uuid(),
  add column progress_updated_at timestamptz,
  add column progress_updated_by uuid references auth.users(id) on delete set null;

alter table fftt_private.audit_events drop constraint audit_events_operation_check;
alter table fftt_private.audit_events add constraint audit_events_operation_check check (operation in (
 'result_accepted','result_corrected','bracket_built','bracket_rebuilt','consolation_reviewed',
 'staff_grant_changed','event_created','event_updated','player_changed','checkin_changed',
 'table_assigned','match_forfeited','doubles_updated','doubles_result','lifecycle_changed',
 'visibility_changed','format_changed','registration_checkin','rating_confirmed','event_restored',
 'registration_source_changed','game_saved','game_corrected','showcase_reset',
 'doubles_game_saved','doubles_game_corrected','doubles_result_corrected'));

-- Staff read: the two teams (names only; no ratings or contacts), format, saved games and revision.
create function fftt_private.doubles_desk_v1(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype; d fftt_private.doubles_finale%rowtype; v_key text; v_games jsonb;
begin
  perform fftt_private.staff_role_for_event(p_event_id);
  select * into e from fftt_private.events where id = p_event_id;
  select * into d from fftt_private.doubles_finale where event_id = p_event_id;
  if not found or d.consolation_partner_1 is null or d.consolation_partner_2 is null then
    return pg_catalog.jsonb_build_object('event_id', p_event_id, 'status', 'no-teams', 'event_revision', e.revision);
  end if;
  v_key := pg_catalog.md5(coalesce(d.progress_epoch::text,'')||d.championship_finalist_1::text||d.championship_finalist_2::text
                          ||d.consolation_partner_1::text||d.consolation_partner_2::text);
  v_games := case when d.progress_key is not distinct from v_key then coalesce(d.progress_games,'[]'::jsonb) else '[]'::jsonb end;
  return pg_catalog.jsonb_build_object(
    'event_id', p_event_id, 'status', case when d.winner_team is null then 'ready' else 'complete' end,
    'lifecycle', e.lifecycle, 'team_key', v_key, 'best_of', e.doubles_best_of, 'points_to_win', e.doubles_points,
    'teams', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_array(
        (select display_name from fftt_private.players where event_id = p_event_id and id = d.championship_finalist_1),
        (select display_name from fftt_private.players where event_id = p_event_id and id = d.consolation_partner_1)),
      pg_catalog.jsonb_build_array(
        (select display_name from fftt_private.players where event_id = p_event_id and id = d.championship_finalist_2),
        (select display_name from fftt_private.players where event_id = p_event_id and id = d.consolation_partner_2))),
    'revision', coalesce(d.progress_version, 0), 'games', v_games,
    'winner_team', d.winner_team, 'game_scores', d.game_scores, 'event_revision', e.revision);
end;
$f$;

-- One completed doubles game, with the same protections as singles: idempotent receipt, optimistic revision and team
-- checks, stale-write rejection, score validation, event-scoped staff, append-only audit with before/after values.
create function fftt_private.doubles_game_save_v1(
  p_event_id uuid, p_expected_team_key text, p_expected_progress_version bigint, p_expected_best_of integer,
  p_expected_points_to_win integer, p_submission_id uuid, p_game_index integer,
  p_team_1_score integer, p_team_2_score integer, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype; d fftt_private.doubles_finale%rowtype; dec fftt_private.game_progress_decisions%rowtype;
  v_actor uuid; v_role text; v_fp text; v_key text; v_base bigint; v_games jsonb; v_total integer; v_pair jsonb;
  v_a integer; v_b integer; v_w1 integer := 0; v_w2 integer := 0; v_needed integer; v_i integer; v_new bigint;
  v_rev bigint; v_response jsonb; v_is_correction boolean;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason,'')),'');
begin
  if p_event_id is null or p_expected_team_key is null or p_expected_progress_version is null
     or p_expected_best_of is null or p_expected_points_to_win is null or p_submission_id is null
     or p_game_index is null or p_team_1_score is null or p_team_2_score is null then
    perform fftt_private.v3_err('validation','required');
  end if;
  e := fftt_private.v3_begin(p_event_id, array['organizer','scorekeeper','bracket_manager'], array['active']);
  v_actor := auth.uid();
  v_role := fftt_private.staff_role_for_event(p_event_id);
  v_fp := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    'doubles', p_event_id, p_expected_team_key, p_expected_progress_version, p_expected_best_of, p_expected_points_to_win,
    p_game_index, p_team_1_score, p_team_2_score, case when v_reason is null then null else p_reason end)::text,'UTF8')),'hex');
  select * into dec from fftt_private.game_progress_decisions
    where event_id = p_event_id and actor_id = v_actor and submission_id = p_submission_id;
  if found then
    if dec.request_fingerprint <> v_fp or dec.match_id <> p_event_id then
      perform fftt_private.v3_err('conflict','submission-id-reused');
    end if;
    return dec.response;
  end if;
  select * into d from fftt_private.doubles_finale where event_id = p_event_id for update;
  if not found or d.consolation_partner_1 is null or d.consolation_partner_2 is null then
    perform fftt_private.v3_err('conflict','teams-not-set');
  end if;
  if d.winner_team is not null then perform fftt_private.v3_err('conflict','doubles-complete'); end if;
  v_key := pg_catalog.md5(coalesce(d.progress_epoch::text,'')||d.championship_finalist_1::text||d.championship_finalist_2::text
                          ||d.consolation_partner_1::text||d.consolation_partner_2::text);
  v_base := coalesce(d.progress_version, 0);
  if p_expected_team_key <> v_key or p_expected_progress_version <> v_base
     or p_expected_best_of <> e.doubles_best_of or p_expected_points_to_win <> e.doubles_points then
    v_response := pg_catalog.jsonb_build_object('submission_id', p_submission_id, 'status', 'rejected',
      'reason', 'stale-progress', 'match_id', p_event_id, 'revision', v_base, 'event_revision', e.revision);
    insert into fftt_private.game_progress_decisions(event_id, actor_id, submission_id, match_id, request_fingerprint, response)
      values (e.id, v_actor, p_submission_id, p_event_id, v_fp, v_response);
    return v_response;
  end if;
  if e.doubles_best_of not in (1,3,5) or e.doubles_points not in (11,21)
     or p_game_index not between 1 and e.doubles_best_of
     or p_team_1_score not between 0 and 99 or p_team_2_score not between 0 and 99
     or greatest(p_team_1_score, p_team_2_score) < e.doubles_points
     or abs(p_team_1_score - p_team_2_score) < 2
     or (greatest(p_team_1_score, p_team_2_score) > e.doubles_points and abs(p_team_1_score - p_team_2_score) <> 2) then
    perform fftt_private.v3_err('validation','scores-game');
  end if;
  v_games := case when d.progress_key is not distinct from v_key then coalesce(d.progress_games,'[]'::jsonb) else '[]'::jsonb end;
  v_total := pg_catalog.jsonb_array_length(v_games);
  if p_game_index > v_total + 1 then perform fftt_private.v3_err('validation','game-order'); end if;
  v_is_correction := p_game_index <= v_total;
  if v_is_correction then
    if v_role is null or v_role not in ('organizer','bracket_manager','scorekeeper') then
      perform fftt_private.v3_err('forbidden','correction');
    end if;
    if v_reason is not null and length(v_reason) > 500 then perform fftt_private.v3_err('validation','reason'); end if;
    v_games := pg_catalog.jsonb_set(v_games, array[(p_game_index-1)::text],
      pg_catalog.jsonb_build_array(p_team_1_score, p_team_2_score), false);
  else
    if v_reason is not null then perform fftt_private.v3_err('validation','reason'); end if;
    v_games := v_games || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(p_team_1_score, p_team_2_score));
  end if;
  v_total := pg_catalog.jsonb_array_length(v_games);
  v_needed := (e.doubles_best_of + 1) / 2;
  for v_i in 0..v_total-1 loop
    v_pair := v_games->v_i;
    v_a := (v_pair->>0)::integer; v_b := (v_pair->>1)::integer;
    if v_a > v_b then v_w1 := v_w1 + 1; else v_w2 := v_w2 + 1; end if;
    if v_i < v_total-1 and greatest(v_w1, v_w2) >= v_needed then perform fftt_private.v3_err('validation','scores-extra-games'); end if;
  end loop;
  v_new := v_base + 1;
  update fftt_private.doubles_finale set progress_games = v_games, progress_version = v_new, progress_key = v_key,
         progress_updated_at = now(), progress_updated_by = v_actor where event_id = p_event_id;
  v_rev := fftt_private.v3_bump(e.id);
  perform fftt_private.v3_audit(e.id, case when v_is_correction then 'doubles_game_corrected' else 'doubles_game_saved' end, null,
    case when v_is_correction then pg_catalog.jsonb_build_object('game', p_game_index, 'score', d.progress_games->(p_game_index-1)) else null end,
    pg_catalog.jsonb_build_object('game', p_game_index, 'score', v_games->(p_game_index-1),
      'progress_version', v_new, 'games_won', pg_catalog.jsonb_build_array(v_w1, v_w2)),
    v_reason, v_rev);
  v_response := pg_catalog.jsonb_build_object('submission_id', p_submission_id, 'status', 'accepted', 'reason', null,
    'match_id', p_event_id, 'revision', v_new, 'event_revision', v_rev);
  insert into fftt_private.game_progress_decisions(event_id, actor_id, submission_id, match_id, request_fingerprint, response)
    values (e.id, v_actor, p_submission_id, p_event_id, v_fp, v_response);
  return v_response;
end;
$f$;

-- Correct a FINALIZED doubles result: organizer or bracket manager only; the reason is optional.
create function fftt_private.correct_doubles_result_v1(
  p_event_id uuid, p_expected_winner_team integer, p_expected_game_scores text,
  p_winner_team integer, p_game_scores text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; d fftt_private.doubles_finale%rowtype; v_scores text; v_rev bigint;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason,'')),'');
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['active','complete']);
  if v_reason is not null and (length(v_reason) > 300 or v_reason ~ '[[:cntrl:]]') then
    perform fftt_private.v3_err('validation','reason');
  end if;
  select * into d from fftt_private.doubles_finale where event_id = p_event_id for update;
  if not found or d.winner_team is null then perform fftt_private.v3_err('conflict','doubles-not-complete'); end if;
  if p_expected_winner_team is null or p_expected_game_scores is null
     or d.winner_team <> p_expected_winner_team or d.game_scores <> p_expected_game_scores then
    perform fftt_private.v3_err('conflict','result-changed');
  end if;
  if p_winner_team not in (1,2) then perform fftt_private.v3_err('validation','winner-team'); end if;
  v_scores := fftt_private.v4_normalize_scores(p_game_scores, v_event.doubles_best_of, v_event.doubles_points, p_winner_team = 1);
  if d.winner_team = p_winner_team and d.game_scores = v_scores then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
  end if;
  update fftt_private.doubles_finale set winner_team = p_winner_team, game_scores = v_scores, updated_at = now()
   where event_id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'doubles_result_corrected', null,
    pg_catalog.jsonb_build_object('winner_team', d.winner_team, 'game_scores', d.game_scores),
    pg_catalog.jsonb_build_object('winner_team', p_winner_team, 'game_scores', v_scores,
      'best_of', v_event.doubles_best_of, 'points_to_win', v_event.doubles_points), v_reason, v_rev);
  return pg_catalog.jsonb_build_object('status','corrected','event_revision', v_rev);
end;
$f$;

-- Existing behaviour kept: first recording by organizer/bracket manager/scorekeeper; a finalized result may now also be
-- changed by a bracket manager (never by a scorekeeper); with saved games the official result must equal those games.
create or replace function fftt_private.record_doubles_result_v3(p_event_id uuid, p_winner_team integer, p_game_scores text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; d fftt_private.doubles_finale%rowtype; v_scores text; v_role text; v_rev bigint;
  v_key text; v_saved text;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','scorekeeper','bracket_manager'], array['active','complete']);
  v_role := fftt_private.staff_role_for_event(p_event_id);
  select * into d from fftt_private.doubles_finale where event_id = p_event_id for update;
  if not found or d.consolation_partner_1 is null or d.consolation_partner_2 is null then perform fftt_private.v3_err('conflict','teams-not-set'); end if;
  if p_winner_team not in (1,2) then perform fftt_private.v3_err('validation','winner-team'); end if;
  v_scores := fftt_private.v4_normalize_scores(p_game_scores, v_event.doubles_best_of, v_event.doubles_points, p_winner_team = 1);
  if d.winner_team is not null then
    if d.winner_team = p_winner_team and d.game_scores = v_scores then
      return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
    end if;
    -- A finalized result may be changed by the organizer or a bracket manager, never by a scorekeeper.
    if v_role not in ('organizer','bracket_manager') then perform fftt_private.v3_err('forbidden'); end if;
  else
    -- Game-by-game scoring: when games were saved for the current teams, the official result must be exactly
    -- those games (and enough of them to decide the match). With no saved games the direct entry still works.
    v_key := pg_catalog.md5(coalesce(d.progress_epoch::text,'')||d.championship_finalist_1::text||d.championship_finalist_2::text
                            ||d.consolation_partner_1::text||d.consolation_partner_2::text);
    if d.progress_key is not distinct from v_key and pg_catalog.jsonb_array_length(coalesce(d.progress_games,'[]'::jsonb)) > 0 then
      select pg_catalog.string_agg((g.score->>0)||'-'||(g.score->>1), ', ' order by g.ordinality) into v_saved
        from pg_catalog.jsonb_array_elements(d.progress_games) with ordinality as g(score,ordinality);
      if v_scores is distinct from v_saved
         or pg_catalog.jsonb_array_length(d.progress_games) < (v_event.doubles_best_of + 1) / 2 then
        perform fftt_private.v3_err('conflict','game-progress-mismatch');
      end if;
    end if;
  end if;
  update fftt_private.doubles_finale set winner_team = p_winner_team, game_scores = v_scores,
         completed_at = now(), completed_by = auth.uid(), updated_at = now() where event_id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'doubles_result', null,
    case when d.winner_team is not null then pg_catalog.jsonb_build_object('winner_team', d.winner_team, 'game_scores', d.game_scores) end,
    pg_catalog.jsonb_build_object('winner_team', p_winner_team, 'game_scores', v_scores,
      'best_of', v_event.doubles_best_of, 'points_to_win', v_event.doubles_points), null, v_rev);
  return pg_catalog.jsonb_build_object('status','recorded','event_revision', v_rev);
end;
$f$;

revoke all on function fftt_private.doubles_desk_v1(uuid) from public, anon, authenticated;
revoke all on function fftt_private.doubles_game_save_v1(uuid,text,bigint,integer,integer,uuid,integer,integer,integer,text) from public, anon, authenticated;
revoke all on function fftt_private.correct_doubles_result_v1(uuid,integer,text,integer,text,text) from public, anon, authenticated;
grant execute on function fftt_private.doubles_desk_v1(uuid) to authenticated;
grant execute on function fftt_private.doubles_game_save_v1(uuid,text,bigint,integer,integer,uuid,integer,integer,integer,text) to authenticated;
grant execute on function fftt_private.correct_doubles_result_v1(uuid,integer,text,integer,text,text) to authenticated;

create function public.fftt_doubles_desk_v1(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.doubles_desk_v1(p_event_id); $f$;
create function public.fftt_save_doubles_game_v1(
  p_event_id uuid, p_expected_team_key text, p_expected_progress_version bigint, p_expected_best_of integer,
  p_expected_points_to_win integer, p_submission_id uuid, p_game_index integer,
  p_team_1_score integer, p_team_2_score integer, p_reason text default null)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.doubles_game_save_v1(p_event_id, p_expected_team_key, p_expected_progress_version,
  p_expected_best_of, p_expected_points_to_win, p_submission_id, p_game_index, p_team_1_score, p_team_2_score, p_reason); $f$;
create function public.fftt_correct_doubles_result_v1(
  p_event_id uuid, p_expected_winner_team integer, p_expected_game_scores text,
  p_winner_team integer, p_game_scores text, p_reason text default null)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.correct_doubles_result_v1(p_event_id, p_expected_winner_team, p_expected_game_scores,
  p_winner_team, p_game_scores, p_reason); $f$;
revoke all on function public.fftt_doubles_desk_v1(uuid) from public, anon, authenticated;
revoke all on function public.fftt_save_doubles_game_v1(uuid,text,bigint,integer,integer,uuid,integer,integer,integer,text) from public, anon, authenticated;
revoke all on function public.fftt_correct_doubles_result_v1(uuid,integer,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.fftt_doubles_desk_v1(uuid) to authenticated;
grant execute on function public.fftt_save_doubles_game_v1(uuid,text,bigint,integer,integer,uuid,integer,integer,integer,text) to authenticated;
grant execute on function public.fftt_correct_doubles_result_v1(uuid,integer,text,integer,text,text) to authenticated;

-- create or replace keeps every existing grant on the four replaced functions; no existing privilege is widened.
commit;
