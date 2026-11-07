-- FFTT3 event-day delegation candidate · 2026-11-05
-- DO NOT APPLY TO HOSTED SUPABASE without explicit release approval, a fresh private backup
-- with disposable restore evidence, and signed-user permission / rollback verification.
-- Layer on top of FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql.
-- Existing Organizer rights stay unchanged; Scorekeeper rights stay unchanged.
-- Manager can check in EXISTING roster entries before bracket lock, create safe walk-ins,
-- adjudicate no-shows, correct results (reason/audit), change one unplayed match format,
-- and mark an actually finished event complete. No registration source, contacts, staff,
-- visibility, archive, deletion, or bracket rebuild privileges are added.
begin;
-- Event-day role extension: set_checkin_v3
create or replace function fftt_private.set_checkin_v3(p_event_id uuid, p_player_id uuid, p_checked_in boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_rev bigint; v_old boolean;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['draft','active']);
  if fftt_private.staff_role_for_event(p_event_id) = 'bracket_manager' and exists (
       select 1 from fftt_private.brackets where event_id = p_event_id
     ) then perform fftt_private.v3_err('conflict','bracket-locked'); end if;
  if p_checked_in is null then perform fftt_private.v3_err('validation','checkin'); end if;
  select checked_in into v_old from fftt_private.players where event_id = p_event_id and id = p_player_id for update;
  if not found then perform fftt_private.v3_err('notfound','player'); end if;
  if v_old = p_checked_in then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
  end if;
  if not p_checked_in and exists (
       select 1 from fftt_private.matches where event_id = p_event_id and generation = v_event.bracket_generation
          and (player_1_id = p_player_id or player_2_id = p_player_id)) then
    perform fftt_private.v3_err('conflict','player-in-bracket');
  end if;
  update fftt_private.players set checked_in = p_checked_in where event_id = p_event_id and id = p_player_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'checkin_changed', null,
    pg_catalog.jsonb_build_object('checked_in', v_old), pg_catalog.jsonb_build_object('checked_in', p_checked_in), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','event_revision', v_rev);
end;
$f$;

-- Event-day role extension: forfeit_match_v3
create or replace function fftt_private.forfeit_match_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint,
                                              p_absent_player_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_winner uuid;
  v_reason text := pg_catalog.btrim(coalesce(p_reason,'')); v_resp jsonb; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['active']);
  if length(v_reason) not between 3 and 300 or v_reason ~ '[[:cntrl:]]' then perform fftt_private.v3_err('validation','reason'); end if;
  select * into v_match from fftt_private.matches
   where event_id = p_event_id and id = p_match_id and generation = v_event.bracket_generation for update;
  if not found then perform fftt_private.v3_err('notfound','match'); end if;
  if v_match.status <> 'pending' or v_match.match_version <> p_expected_match_version
     or v_match.player_1_id is null or v_match.player_2_id is null then
    perform fftt_private.v3_err('conflict','match-not-playable');
  end if;
  if p_absent_player_id not in (v_match.player_1_id, v_match.player_2_id) then perform fftt_private.v3_err('validation','absent-player'); end if;
  v_winner := case when p_absent_player_id = v_match.player_1_id then v_match.player_2_id else v_match.player_1_id end;
  v_resp := fftt_private.submit_match_result_v1(p_event_id, p_match_id, v_event.bracket_generation,
      p_expected_match_version, gen_random_uuid(), v_winner, '', coalesce(v_match.table_number, 1)::integer);
  update fftt_private.matches set game_scores = 'W/O', table_number = null where event_id = p_event_id and id = p_match_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'match_forfeited', p_match_id,
    pg_catalog.jsonb_build_object('absent_player_id', p_absent_player_id),
    pg_catalog.jsonb_build_object('winner_id', v_winner), v_reason, v_rev);
  return pg_catalog.jsonb_build_object('status','accepted','match_id', p_match_id,
    'match_version', (v_resp ->> 'match_version')::bigint, 'event_revision', v_rev);
end;
$f$;

-- Event-day role extension: correct_result_v3
create or replace function fftt_private.correct_result_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint,
                                                          p_winner_id uuid, p_game_scores text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_next fftt_private.matches%rowtype;
  v_bracket fftt_private.brackets%rowtype; v_reason text := pg_catalog.btrim(coalesce(p_reason,''));
  v_scores text; v_best integer; v_points integer; v_old_winner uuid; v_new_loser uuid; v_changed boolean; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['active','complete']);
  if length(v_reason) not between 3 and 300 or v_reason ~ '[[:cntrl:]]' then perform fftt_private.v3_err('validation','reason'); end if;
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

-- Event-day role extension: set_match_format_v4
create or replace function fftt_private.set_match_format_v4(p_event_id uuid, p_match_id uuid, p_best_of integer, p_points integer)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_cur record; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['active']);
  if p_best_of is null or p_best_of not in (1,3) or p_points is null or p_points not in (11,21) then
    perform fftt_private.v3_err('validation','format-value');
  end if;
  select * into v_match from fftt_private.matches
   where event_id = p_event_id and id = p_match_id and generation = v_event.bracket_generation for update;
  if not found then perform fftt_private.v3_err('notfound','match'); end if;
  if v_match.status <> 'pending' then perform fftt_private.v3_err('conflict','format-locked'); end if;
  select f.best_of, f.points into v_cur from fftt_private.v4_match_format(p_event_id, p_match_id) f;
  if v_cur.best_of = p_best_of and v_cur.points = p_points and v_match.best_of is not null then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
  end if;
  update fftt_private.matches set best_of = p_best_of, points_to_win = p_points, updated_at = now()
   where event_id = p_event_id and id = p_match_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'format_changed', p_match_id,
    pg_catalog.jsonb_build_object('best_of', v_cur.best_of, 'points', v_cur.points),
    pg_catalog.jsonb_build_object('best_of', p_best_of, 'points', p_points), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','event_revision', v_rev);
end;
$f$;

-- Event-day role extension: set_lifecycle_v3
create or replace function fftt_private.set_lifecycle_v3(p_event_id uuid, p_lifecycle text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['draft','active','complete']);
  if fftt_private.staff_role_for_event(p_event_id) = 'bracket_manager' then
    if p_lifecycle is distinct from 'complete' or v_event.lifecycle <> 'active'
      then perform fftt_private.v3_err('forbidden'); end if;
    if exists (select 1 from fftt_private.brackets b
        where b.event_id = p_event_id and b.generation = v_event.bracket_generation and b.status <> 'complete')
      then perform fftt_private.v3_err('conflict','brackets-incomplete'); end if;
    if exists (select 1 from fftt_private.doubles_finale d
        where d.event_id = p_event_id and d.consolation_partner_1 is not null and d.winner_team is null)
      then perform fftt_private.v3_err('conflict','doubles-incomplete'); end if;
  end if;
  if p_lifecycle not in ('active','complete','archived') then perform fftt_private.v3_err('validation','lifecycle'); end if;
  if p_lifecycle = v_event.lifecycle then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
  end if;
  if p_lifecycle = 'active' and (v_event.bracket_generation = 0) then perform fftt_private.v3_err('conflict','no-bracket'); end if;
  if p_lifecycle = 'complete' and not exists (
       select 1 from fftt_private.brackets where event_id = p_event_id and generation = v_event.bracket_generation
          and kind = 'championship' and status = 'complete') then
    perform fftt_private.v3_err('conflict','championship-incomplete');
  end if;
  if p_lifecycle = 'archived' then
    update fftt_private.events set public_visible = false, archived_from = v_event.lifecycle where id = p_event_id;
  end if;
  update fftt_private.events set lifecycle = p_lifecycle where id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'lifecycle_changed', null,
    pg_catalog.jsonb_build_object('lifecycle', v_event.lifecycle),
    pg_catalog.jsonb_build_object('lifecycle', p_lifecycle), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','lifecycle', p_lifecycle, 'event_revision', v_rev);
end;
$f$;
-- Narrow walk-in creation: creates one checked-in player only; cannot edit/delete players or read source data.
create or replace function fftt_private.event_day_walkin_v1(p_event_id uuid, p_name text, p_rating integer)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_name text; v_player uuid; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['bracket_manager'], array['draft','active']);
  if exists (select 1 from fftt_private.brackets where event_id = p_event_id)
    then perform fftt_private.v3_err('conflict','bracket-locked'); end if;
  v_name := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name,''), '[[:space:]]+', ' ', 'g'));
  if pg_catalog.length(v_name) not between 3 and 80 or pg_catalog.strpos(v_name,' ') = 0
      or v_name ~ '[[:cntrl:]]' or v_name ~ '@'
      or v_name ~ '[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9]'
    then perform fftt_private.v3_err('validation','player-name'); end if;
  if p_rating is null or p_rating not between 1 and 5
    then perform fftt_private.v3_err('validation','player-rating'); end if;
  if (select pg_catalog.count(*) from fftt_private.players where event_id = p_event_id) >= 64
    then perform fftt_private.v3_err('conflict','roster-full'); end if;
  if exists (select 1 from fftt_private.players where event_id = p_event_id and pg_catalog.lower(display_name) = pg_catalog.lower(v_name))
    then perform fftt_private.v3_err('conflict','duplicate-name'); end if;
  insert into fftt_private.players(event_id, display_name, rating, rating_status, checked_in, source, rating_confirmed)
    values (p_event_id, v_name, p_rating, 'provisional', true, 'walk_in', false)
    returning id into v_player;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'registration_checkin', null, null,
    pg_catalog.jsonb_build_object('source','walk_in','player_id',v_player,'checked_in',true), null, v_rev);
  return pg_catalog.jsonb_build_object('status','saved','player_id',v_player,'event_revision',v_rev);
end;
$f$;

create or replace function public.fftt_event_day_walkin_v1(p_event_id uuid, p_name text, p_rating integer)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.event_day_walkin_v1(p_event_id,p_name,p_rating); $f$;
revoke all on function fftt_private.event_day_walkin_v1(uuid,text,integer) from public,anon,authenticated;
grant execute on function fftt_private.event_day_walkin_v1(uuid,text,integer) to authenticated;
revoke all on function public.fftt_event_day_walkin_v1(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.fftt_event_day_walkin_v1(uuid,text,integer) to authenticated;

commit;
