-- FFTT3 Bracket Manager (2026-10-30) — reviewed SOURCE CANDIDATE, DO NOT APPLY without populated DB restore rehearsal.
-- Apply only to existing mixed-mode Supabase project after full signed-user and denial tests.
-- No accounts or grants are created; all actions remain event-scoped and audited.
begin;
do $check$
declare n text; count_found integer;
begin
  select count(*), min(c.conname) into count_found, n
    from pg_catalog.pg_constraint c
   where c.conrelid = 'fftt_private.event_staff'::regclass and c.contype='c'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%organizer%'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%scorekeeper%';
  if count_found <> 1 then raise exception 'unexpected event_staff role constraint: %', count_found; end if;
  execute pg_catalog.format('alter table fftt_private.event_staff drop constraint %I', n);
  alter table fftt_private.event_staff add constraint event_staff_role_check
    check (role in ('organizer','scorekeeper','bracket_manager'));
end;
$check$;


create or replace function fftt_private.set_staff_v3(p_event_id uuid, p_email text, p_action text, p_role text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_actor uuid; v_uid uuid; v_old fftt_private.event_staff%rowtype;
  v_has boolean; v_rev bigint; v_email text := lower(pg_catalog.btrim(coalesce(p_email,'')));
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active','complete']);
  v_actor := auth.uid();
  if p_action not in ('grant','revoke') or (p_action = 'grant' and p_role not in ('organizer','scorekeeper','bracket_manager')) then
    perform fftt_private.v3_err('validation','staff');
  end if;
  if length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@<>]{1,64}@[^[:space:]@<>]{1,190}$' then
    perform fftt_private.v3_err('validation','email');
  end if;
  select id into v_uid from auth.users where lower(email) = v_email and is_anonymous = false and deleted_at is null;
  if v_uid is null then raise exception 'fftt_ineligible_staff_target' using errcode = '22023'; end if;
  if v_uid = v_actor then raise exception 'fftt_forbidden_self_change' using errcode = '42501'; end if;
  if p_action = 'grant' and not exists (
       select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
          and (u.banned_until is null or u.banned_until <= now())) then
    raise exception 'fftt_ineligible_staff_target' using errcode = '22023';
  end if;
  select * into v_old from fftt_private.event_staff where event_id = p_event_id and user_id = v_uid for update;
  v_has := found;
  if p_action = 'grant' then
    if v_has and v_old.active and v_old.revoked_at is null and v_old.role = p_role then
      return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
    end if;
    insert into fftt_private.event_staff(event_id, user_id, role, active, granted_by, granted_at, revoked_at)
    values (p_event_id, v_uid, p_role, true, v_actor, now(), null)
    on conflict (event_id, user_id) do update set role = excluded.role, active = true,
      granted_by = excluded.granted_by, granted_at = excluded.granted_at, revoked_at = null;
  else
    if not v_has or not v_old.active then
      return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
    end if;
    update fftt_private.event_staff set active = false, revoked_at = now() where event_id = p_event_id and user_id = v_uid;
  end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'staff_grant_changed', null,
    case when v_has then pg_catalog.jsonb_build_object('user_id', v_uid, 'role', v_old.role, 'active', v_old.active) end,
    pg_catalog.jsonb_build_object('user_id', v_uid, 'role', coalesce(p_role, v_old.role), 'active', p_action = 'grant'), null, v_rev);
  return pg_catalog.jsonb_build_object('status', case when p_action = 'grant' then 'granted' else 'revoked' end, 'event_revision', v_rev);
end;
$f$;

create or replace function fftt_private.build_championship_v3(p_event_id uuid, p_slots jsonb,
                                                   p_expected_generation integer, p_confirm boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_slots uuid[]; v_allowed uuid[]; v_gen integer;
  v_rebuild boolean; v_done integer; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['draft','active']);
  if p_expected_generation is null or p_expected_generation <> v_event.bracket_generation then
    perform fftt_private.v3_err('stale','generation');
  end if;
  select pg_catalog.array_agg(id) into v_allowed from fftt_private.players where event_id = p_event_id and checked_in;
  v_slots := fftt_private.v3_parse_slots(p_slots, coalesce(v_allowed, '{}'), true);
  v_rebuild := v_event.bracket_generation > 0;
  if v_rebuild and fftt_private.staff_role_for_event(p_event_id) = 'bracket_manager' then
    perform fftt_private.v3_err('forbidden'); -- only owner may replace an existing championship
  end if;
  if v_rebuild then
    select pg_catalog.count(*) into v_done from fftt_private.matches
     where event_id = p_event_id and generation = v_event.bracket_generation and status = 'complete';
    if p_confirm is not true then perform fftt_private.v3_err('conflict','rebuild-requires-confirmation'); end if;
    update fftt_private.brackets set status = 'superseded' where event_id = p_event_id and generation = v_event.bracket_generation;
    update fftt_private.players set first_champ_loss = false where event_id = p_event_id;
    delete from fftt_private.consolation_reviews where event_id = p_event_id;
    delete from fftt_private.doubles_finale where event_id = p_event_id;
  end if;
  v_gen := v_event.bracket_generation + 1;
  perform fftt_private.v3_create_bracket(p_event_id, v_gen, 'championship', v_slots);
  update fftt_private.events set bracket_generation = v_gen, lifecycle = 'active' where id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, case when v_rebuild then 'bracket_rebuilt' else 'bracket_built' end, null,
    case when v_rebuild then pg_catalog.jsonb_build_object('generation', v_event.bracket_generation, 'completed_matches', v_done) end,
    pg_catalog.jsonb_build_object('generation', v_gen, 'players', pg_catalog.cardinality(v_allowed)), null, v_rev);
  return pg_catalog.jsonb_build_object('status', case when v_rebuild then 'rebuilt' else 'built' end,
    'generation', v_gen, 'event_revision', v_rev);
end;
$f$;

create or replace function fftt_private.build_consolation_v3(p_event_id uuid, p_slots jsonb,
                                                  p_expected_generation integer, p_confirm boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_slots uuid[]; v_allowed uuid[]; v_champ uuid; v_old uuid;
  v_pending integer; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['active']);
  if p_expected_generation is null or p_expected_generation <> v_event.bracket_generation or v_event.bracket_generation = 0 then
    perform fftt_private.v3_err('stale','generation');
  end if;
  select id into v_champ from fftt_private.brackets
   where event_id = p_event_id and generation = v_event.bracket_generation and kind = 'championship' and status in ('active','complete');
  if v_champ is null then perform fftt_private.v3_err('conflict','no-championship'); end if;
  -- Every player must have played a real championship match before consolation is built.
  select pg_catalog.count(*) into v_pending from (
    select p.id from (
      select player_1_id as id from fftt_private.matches where bracket_id = v_champ and player_1_id is not null
      union select player_2_id from fftt_private.matches where bracket_id = v_champ and player_2_id is not null
    ) p
    where not exists (select 1 from fftt_private.matches c where c.bracket_id = v_champ and c.status = 'complete'
                        and (c.player_1_id = p.id or c.player_2_id = p.id))) q;
  if v_pending > 0 then perform fftt_private.v3_err('conflict','first-matches-pending'); end if;
  select pg_catalog.array_agg(player_id) into v_allowed from fftt_private.consolation_reviews
   where event_id = p_event_id and review_state in ('eligible','reviewed','placed');
  v_slots := fftt_private.v3_parse_slots(p_slots, coalesce(v_allowed, '{}'), false);
  select id into v_old from fftt_private.brackets
   where event_id = p_event_id and generation = v_event.bracket_generation and kind = 'consolation';
  if v_old is not null and fftt_private.staff_role_for_event(p_event_id) = 'bracket_manager' then
    perform fftt_private.v3_err('forbidden'); -- only owner may rebuild consolation
  end if;
  if v_old is not null then
    if exists (select 1 from fftt_private.matches where bracket_id = v_old and status = 'complete')
       or exists (select 1 from fftt_private.score_decisions_v2 d join fftt_private.matches m
                    on m.event_id = d.event_id and m.id = d.match_id where m.bracket_id = v_old)
       or exists (select 1 from fftt_private.result_submissions r join fftt_private.matches m
                    on m.event_id = r.event_id and m.id = r.match_id where m.bracket_id = v_old) then
      perform fftt_private.v3_err('conflict','consolation-has-results');
    end if;
    if p_confirm is not true then perform fftt_private.v3_err('conflict','rebuild-requires-confirmation'); end if;
    update fftt_private.consolation_reviews set review_state = 'reviewed' where event_id = p_event_id and review_state = 'placed';
    delete from fftt_private.brackets where id = v_old;
  end if;
  perform fftt_private.v3_create_bracket(p_event_id, v_event.bracket_generation, 'consolation', v_slots);
  update fftt_private.consolation_reviews set review_state = 'placed', reviewed_by = auth.uid(), reviewed_at = now()
   where event_id = p_event_id and player_id = any(v_slots);
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'consolation_reviewed', null, null,
    pg_catalog.jsonb_build_object('generation', v_event.bracket_generation,
      'entrants', (select pg_catalog.count(*) from pg_catalog.unnest(v_slots) x where x is not null)), null, v_rev);
  return pg_catalog.jsonb_build_object('status', case when v_old is null then 'built' else 'rebuilt' end,
    'generation', v_event.bracket_generation, 'event_revision', v_rev);
end;
$f$;

create or replace function fftt_private.assign_table_v3(p_event_id uuid, p_match_id uuid, p_table_number integer)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','scorekeeper','bracket_manager'], array['active']);
  select * into v_match from fftt_private.matches
   where event_id = p_event_id and id = p_match_id and generation = v_event.bracket_generation for update;
  if not found then perform fftt_private.v3_err('notfound','match'); end if;
  if v_match.status <> 'pending' or v_match.player_1_id is null or v_match.player_2_id is null then
    perform fftt_private.v3_err('conflict','match-not-playable');
  end if;
  if p_table_number is not null and p_table_number not between 1 and v_event.table_count then
    perform fftt_private.v3_err('validation','table');
  end if;
  if v_match.table_number is not distinct from p_table_number::smallint then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
  end if;
  if p_table_number is not null and exists (
       select 1 from fftt_private.matches where event_id = p_event_id and generation = v_event.bracket_generation
          and status = 'pending' and table_number = p_table_number and id <> p_match_id) then
    perform fftt_private.v3_err('conflict','table-in-use');
  end if;
  -- match_version is deliberately NOT changed: a table move must never invalidate a scorer's version.
  update fftt_private.matches set table_number = p_table_number::smallint, updated_at = now()
   where event_id = p_event_id and id = p_match_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'table_assigned', p_match_id,
    pg_catalog.jsonb_build_object('table', v_match.table_number), pg_catalog.jsonb_build_object('table', p_table_number), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','event_revision', v_rev);
end;
$f$;

create or replace function fftt_private.set_doubles_teams_v3(p_event_id uuid, p_partner_1 uuid, p_partner_2 uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_final fftt_private.matches%rowtype; v_has_consolation boolean; v_rev bigint;
  v_existing fftt_private.doubles_finale%rowtype;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','bracket_manager'], array['active']);
  select m.* into v_final from fftt_private.matches m join fftt_private.brackets b on b.id = m.bracket_id
   where m.event_id = p_event_id and m.generation = v_event.bracket_generation and b.kind = 'championship'
     and m.is_championship_final and m.status = 'complete';
  if not found then perform fftt_private.v3_err('conflict','championship-incomplete'); end if;
  if p_partner_1 is null or p_partner_2 is null or p_partner_1 = p_partner_2
     or p_partner_1 in (v_final.player_1_id, v_final.player_2_id) or p_partner_2 in (v_final.player_1_id, v_final.player_2_id) then
    perform fftt_private.v3_err('validation','partners');
  end if;
  select exists (select 1 from fftt_private.brackets where event_id = p_event_id and generation = v_event.bracket_generation
                  and kind = 'consolation') into v_has_consolation;
  if (select pg_catalog.count(*) from fftt_private.players where event_id = p_event_id and checked_in
        and id in (p_partner_1, p_partner_2)) <> 2 then
    perform fftt_private.v3_err('validation','partners');
  end if;
  if v_has_consolation and (select pg_catalog.count(*) from fftt_private.consolation_reviews
        where event_id = p_event_id and review_state = 'placed' and player_id in (p_partner_1, p_partner_2)) <> 2 then
    perform fftt_private.v3_err('validation','partners-not-in-consolation');
  end if;
  select * into v_existing from fftt_private.doubles_finale where event_id = p_event_id for update;
  if found and v_existing.winner_team is not null then perform fftt_private.v3_err('conflict','doubles-complete'); end if;
  insert into fftt_private.doubles_finale(event_id, championship_finalist_1, championship_finalist_2,
                                          consolation_partner_1, consolation_partner_2)
  values (p_event_id, v_final.player_1_id, v_final.player_2_id, p_partner_1, p_partner_2)
  on conflict (event_id) do update set championship_finalist_1 = excluded.championship_finalist_1,
    championship_finalist_2 = excluded.championship_finalist_2, consolation_partner_1 = excluded.consolation_partner_1,
    consolation_partner_2 = excluded.consolation_partner_2, updated_at = now();
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'doubles_updated', null, null,
    pg_catalog.jsonb_build_object('partners_selected', 2), null, v_rev);
  return pg_catalog.jsonb_build_object('status','saved','event_revision', v_rev);
end;
$f$;

create or replace function fftt_private.record_doubles_result_v3(p_event_id uuid, p_winner_team integer, p_game_scores text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; d fftt_private.doubles_finale%rowtype; v_scores text; v_role text; v_rev bigint;
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
    if v_role <> 'organizer' then perform fftt_private.v3_err('forbidden'); end if;
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

create or replace function fftt_private.bracket_manager_snapshot_v1(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $f$
declare e fftt_private.events%rowtype;
begin
  select * into e from fftt_private.events where id = p_event_id ;
  if fftt_private.staff_role_for_event(p_event_id) <> 'bracket_manager' then perform fftt_private.v3_err('forbidden'); end if;
  return pg_catalog.jsonb_build_object(
    'event', pg_catalog.jsonb_build_object('event_id', e.id, 'name', e.event_name, 'date', e.event_date,
       'lifecycle', e.lifecycle, 'tables', e.table_count, 'generation', e.bracket_generation,
       'revision', e.revision, 'public_visible', e.public_visible,
       'formats', pg_catalog.jsonb_build_object(
         'champ', pg_catalog.jsonb_build_object('best_of', e.champ_best_of, 'points', e.champ_points),
         'champ_final', pg_catalog.jsonb_build_object('best_of', e.champ_final_best_of, 'points', e.champ_final_points),
         'cons', pg_catalog.jsonb_build_object('best_of', e.cons_best_of, 'points', e.cons_points),
         'cons_final', pg_catalog.jsonb_build_object('best_of', e.cons_final_best_of, 'points', e.cons_final_points),
         'doubles', pg_catalog.jsonb_build_object('best_of', e.doubles_best_of, 'points', e.doubles_points))),
    'players', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'name', p.display_name, 'rating', p.rating, 'rating_status', p.rating_status,
        'checked_in', p.checked_in, 'first_champ_loss', p.first_champ_loss,
        'registration_refs', '[]'::jsonb,
        'source', p.source, 'rating_confirmed', p.rating_confirmed)
        order by lower(p.display_name))
        from fftt_private.players p where p.event_id = e.id), '[]'::jsonb),
    'brackets', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'kind', b.kind, 'status', b.status) order by b.kind)
        from fftt_private.brackets b where b.event_id = e.id and b.generation = e.bracket_generation
         and b.status in ('active','complete')), '[]'::jsonb),
    'matches', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', m.id, 'bracket', b.kind, 'code', m.match_code, 'round', m.round_number, 'slot', m.slot,
        'player_1_id', m.player_1_id, 'player_2_id', m.player_2_id, 'winner_id', m.winner_id,
        'status', m.status, 'game_scores', m.game_scores, 'table', m.table_number,
        'version', m.match_version, 'is_final', m.is_championship_final, 'next_match_id', m.next_match_id,
        'best_of', f.best_of, 'points', f.points, 'format_legacy', f.legacy)
        order by b.kind, m.round_number, m.slot)
        from fftt_private.matches m join fftt_private.brackets b on b.id = m.bracket_id
        cross join lateral fftt_private.v4_match_format(m.event_id, m.id) f
        where m.event_id = e.id and m.generation = e.bracket_generation and b.status in ('active','complete')), '[]'::jsonb),
    'consolation_candidates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'player_id', r.player_id, 'state', r.review_state, 'first_loss_match_id', r.first_loss_match_id))
        from fftt_private.consolation_reviews r where r.event_id = e.id), '[]'::jsonb),
    'doubles', (select pg_catalog.jsonb_build_object(
        'finalist_1', d.championship_finalist_1, 'finalist_2', d.championship_finalist_2,
        'partner_1', d.consolation_partner_1, 'partner_2', d.consolation_partner_2,
        'winner_team', d.winner_team, 'game_scores', d.game_scores)
        from fftt_private.doubles_finale d where d.event_id = e.id),
    'staff', '[]'::jsonb);
end;
$f$;

create or replace function public.fftt_bracket_manager_snapshot_v1(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $f$ select fftt_private.bracket_manager_snapshot_v1(p_event_id); $f$;
revoke all on function fftt_private.bracket_manager_snapshot_v1(uuid) from public,anon,authenticated;
grant execute on function fftt_private.bracket_manager_snapshot_v1(uuid) to authenticated;
revoke all on function public.fftt_bracket_manager_snapshot_v1(uuid) from public,anon,authenticated;
grant execute on function public.fftt_bracket_manager_snapshot_v1(uuid) to authenticated;
commit;
