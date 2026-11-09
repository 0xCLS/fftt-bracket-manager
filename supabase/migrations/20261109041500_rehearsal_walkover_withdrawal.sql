-- Nov 8 rehearsal follow-up: forward-only; never rewrites live event/score/eligibility rows.
-- Install only after an owner-authorized backup, restored disposable proof, focused tests
-- AND the separately approved exact-head full verification/release gate.
-- Server authority remains unchanged until that installation is authorized.
begin;
do $guard$
begin
  if pg_catalog.position('prior.status=''complete''' in pg_catalog.pg_get_functiondef(
    'fftt_private.submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,integer)'::regprocedure)) = 0
    or pg_catalog.position('v_prior_real_match' in pg_catalog.pg_get_functiondef(
    'fftt_private.submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,integer)'::regprocedure)) = 0
    or pg_catalog.position('first_loss_match_id' in pg_catalog.pg_get_functiondef(
    'fftt_private.correct_result_v3(uuid,uuid,bigint,uuid,text,text)'::regprocedure)) = 0
    or pg_catalog.position('submit_match_result_v1' in pg_catalog.pg_get_functiondef(
    'fftt_private.forfeit_match_v3(uuid,uuid,bigint,uuid,text)'::regprocedure)) = 0 then
    raise exception 'FFTT rehearsal fix: unexpected installed scorer definitions';
  end if;
end;
$guard$;

-- Ignore walkovers when looking for previous REAL played Championship matches.

CREATE OR REPLACE FUNCTION fftt_private.submit_match_result_v1(p_event_id uuid, p_match_id uuid, p_bracket_generation integer, p_expected_match_version bigint, p_submission_id uuid, p_winner_id uuid, p_game_scores text, p_table_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_event fftt_private.events%rowtype;
  v_match fftt_private.matches%rowtype;
  v_bracket fftt_private.brackets%rowtype;
  v_next fftt_private.matches%rowtype;
  v_receipt fftt_private.result_submissions%rowtype;
  v_fingerprint text;
  v_loser uuid;
  v_best integer;
  v_points integer;
  v_score text := '';
  v_response jsonb;
  v_revision bigint;
  v_prior_real_match boolean;
begin
  if p_event_id is null or p_match_id is null or p_submission_id is null
     or p_winner_id is null or p_bracket_generation is null
     or p_expected_match_version is null or p_game_scores is null
     or p_table_number is null then
    raise exception 'fftt_validation_error' using errcode = '22023';
  end if;

  select * into v_event from fftt_private.events
   where id=p_event_id for update;
  if not found then
    raise exception 'fftt_not_found' using errcode = '22023';
  end if;

  perform fftt_private.staff_role_for_event(p_event_id);
  v_actor := auth.uid();

  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(
        p_event_id, p_match_id, p_bracket_generation,
        p_expected_match_version, p_winner_id,
        p_game_scores, p_table_number
      )::text, 'UTF8')),
    'hex'
  );

  select * into v_receipt from fftt_private.result_submissions
   where event_id=p_event_id and actor_id=v_actor
     and submission_id=p_submission_id;
  if found then
    if v_receipt.request_fingerprint <> v_fingerprint then
      raise exception 'fftt_submission_id_reused' using errcode = '23505';
    end if;
    return v_receipt.response;
  end if;

  if v_event.lifecycle <> 'active' then
    raise exception 'fftt_conflict' using errcode = 'P0001';
  end if;
  if v_event.bracket_generation <> p_bracket_generation then
    raise exception 'fftt_stale_generation' using errcode = 'P0001';
  end if;
  if p_table_number < 1 or p_table_number > v_event.table_count then
    raise exception 'fftt_validation_error' using errcode = '22023', detail = 'table';
  end if;

  select * into v_match from fftt_private.matches
   where id=p_match_id and event_id=p_event_id
     and generation=p_bracket_generation for update;
  if not found then
    raise exception 'fftt_not_found' using errcode = '22023';
  end if;
  if v_match.status <> 'pending'
     or v_match.match_version <> p_expected_match_version then
    raise exception 'fftt_conflict' using errcode = 'P0001';
  end if;
  if v_match.player_1_id is null or v_match.player_2_id is null
     or p_winner_id not in (v_match.player_1_id, v_match.player_2_id) then
    raise exception 'fftt_validation_error' using errcode = '22023';
  end if;

  select * into v_bracket from fftt_private.brackets
   where id=v_match.bracket_id and event_id=p_event_id
     and generation=p_bracket_generation and status='active';
  if not found then
    raise exception 'fftt_conflict' using errcode = 'P0001';
  end if;

  -- The match's own format (stamped when the bracket was built, or the historical rule for older matches).
  select f.best_of, f.points into v_best, v_points from fftt_private.v4_match_format(p_event_id, p_match_id) f;
  v_score := fftt_private.v4_normalize_scores(p_game_scores, v_best, v_points, p_winner_id = v_match.player_1_id);

  v_loser := case when p_winner_id=v_match.player_1_id then
                   v_match.player_2_id else v_match.player_1_id end;

  if v_bracket.kind='championship' then
    select exists(
      select 1 from fftt_private.matches prior
      join fftt_private.brackets pb on pb.id=prior.bracket_id
        and pb.event_id=prior.event_id and pb.generation=prior.generation
      where prior.event_id=p_event_id
        and prior.generation=p_bracket_generation
        and prior.id<>v_match.id and prior.status='complete' and prior.game_scores <> 'W/O'
        and pb.kind='championship'
        and (prior.player_1_id=v_loser or prior.player_2_id=v_loser)
    ) into v_prior_real_match;
  else
    v_prior_real_match:=true;
  end if;

  if v_match.next_match_id is not null then
    select * into v_next from fftt_private.matches
      where id=v_match.next_match_id and event_id=p_event_id
        and generation=p_bracket_generation
        and bracket_id=v_match.bracket_id for update;
    if not found or v_next.status<>'pending'
       or (v_match.next_match_slot=1 and v_next.player_1_id is not null
           and v_next.player_1_id<>p_winner_id)
       or (v_match.next_match_slot=2 and v_next.player_2_id is not null
           and v_next.player_2_id<>p_winner_id) then
      raise exception 'fftt_conflict' using errcode = 'P0001';
    end if;
  end if;

  update fftt_private.matches
     set winner_id=p_winner_id,status='complete',game_scores=v_score,
         table_number=p_table_number,match_version=match_version+1,
         updated_at=now()
   where id=v_match.id and event_id=p_event_id;

  if v_match.next_match_id is not null then
    update fftt_private.matches
       set player_1_id=case when v_match.next_match_slot=1 then p_winner_id else player_1_id end,
           player_2_id=case when v_match.next_match_slot=2 then p_winner_id else player_2_id end,
           match_version=match_version+1,updated_at=now()
     where id=v_match.next_match_id and event_id=p_event_id
       and (case when v_match.next_match_slot=1 then player_1_id else player_2_id end) is null;
  else
    if v_match.round_number <> (
         select pg_catalog.max(round_number) from fftt_private.matches
          where event_id=p_event_id and bracket_id=v_match.bracket_id
       ) or exists (
         select 1 from fftt_private.matches
          where event_id=p_event_id and bracket_id=v_match.bracket_id
            and id<>v_match.id and status='pending'
       ) then
      raise exception 'fftt_conflict' using errcode = 'P0001';
    end if;
    update fftt_private.brackets set status='complete' where id=v_match.bracket_id;
  end if;

  if v_bracket.kind='championship' and not v_prior_real_match then
    update fftt_private.players set first_champ_loss=true
      where id=v_loser and event_id=p_event_id;
    insert into fftt_private.consolation_reviews(event_id,player_id,first_loss_match_id,review_state)
      values (p_event_id,v_loser,v_match.id,'eligible')
      on conflict (event_id,player_id) do nothing;
  end if;

  update fftt_private.events set revision=revision+1, updated_at=now()
    where id=p_event_id returning revision into v_revision;
  v_response:=pg_catalog.jsonb_build_object(
    'status','accepted','match_id',p_match_id,
    'match_version',v_match.match_version+1,
    'event_revision',v_revision
  );
  insert into fftt_private.audit_events(
    event_id,actor_id,operation,match_id,before_state,after_state,event_revision)
  values (p_event_id,v_actor,'result_accepted',v_match.id,
    pg_catalog.jsonb_build_object('winner_id',v_match.winner_id,'status',v_match.status,
      'match_version',v_match.match_version),
    pg_catalog.jsonb_build_object('winner_id',p_winner_id,'status','complete',
      'match_version',v_match.match_version+1,'game_scores',v_score,
      'table_number',p_table_number,'best_of',v_best,'points_to_win',v_points),v_revision);
  insert into fftt_private.result_submissions(
    event_id,actor_id,submission_id,match_id,generation,expected_match_version,
    request_fingerprint,response)
  values (p_event_id,v_actor,p_submission_id,p_match_id,p_bracket_generation,
    p_expected_match_version,v_fingerprint,v_response);
  return v_response;
end;
$function$
;

-- Preserve the same definition when correcting a finalized played result.

CREATE OR REPLACE FUNCTION fftt_private.correct_result_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint, p_winner_id uuid, p_game_scores text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                       and c.id <> v_match.id and c.game_scores <> 'W/O' and (c.player_1_id = v_new_loser or c.player_2_id = v_new_loser)) then
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
$function$
;

-- A walkover is a bracket resolution, never a first-played-match loss.

CREATE OR REPLACE FUNCTION fftt_private.forfeit_match_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint, p_absent_player_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- A saved, server-confirmed game cannot silently be replaced by a walkover.
  if exists (select 1 from fftt_private.match_game_progress g
             where g.event_id = p_event_id and g.match_id = p_match_id
               and pg_catalog.jsonb_array_length(g.games) > 0) then
    perform fftt_private.v3_err('conflict','game-already-saved');
  end if;
  v_winner := case when p_absent_player_id = v_match.player_1_id then v_match.player_2_id else v_match.player_1_id end;
  v_resp := fftt_private.submit_match_result_v1(p_event_id, p_match_id, v_event.bracket_generation,
      p_expected_match_version, gen_random_uuid(), v_winner, '', coalesce(v_match.table_number, 1)::integer);
  update fftt_private.matches set game_scores = 'W/O', table_number = null where event_id = p_event_id and id = p_match_id;
  -- The ordinary result function momentarily treated the forfeit as a played loss.
  -- Remove only a candidate created by THIS unplayed match; earlier real losses survive.
  if exists (select 1 from fftt_private.brackets b
             where b.id = v_match.bracket_id and b.kind = 'championship') then
    delete from fftt_private.consolation_reviews r
      where r.event_id = p_event_id and r.player_id = p_absent_player_id
        and r.first_loss_match_id = p_match_id;
    update fftt_private.players p set first_champ_loss = false
      where p.event_id = p_event_id and p.id = p_absent_player_id
        and not exists (select 1 from fftt_private.consolation_reviews r
                        where r.event_id = p_event_id and r.player_id = p.id);
  end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'match_forfeited', p_match_id,
    pg_catalog.jsonb_build_object('absent_player_id', p_absent_player_id),
    pg_catalog.jsonb_build_object('winner_id', v_winner), v_reason, v_rev);
  return pg_catalog.jsonb_build_object('status','accepted','match_id', p_match_id,
    'match_version', (v_resp ->> 'match_version')::bigint, 'event_revision', v_rev);
end;
$function$
;


-- A single atomic operation: check-in withdrawal and safe bracket regeneration.
-- Neither the player registration nor the superseded unplayed bracket is erased.
create or replace function fftt_private.withdraw_preplay_v7(
  p_event_id uuid, p_player_id uuid, p_expected_generation integer,
  p_slots jsonb, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype;
  v_old boolean; v_allowed uuid[]; v_slots uuid[];
  v_generation integer; v_revision bigint;
  v_reason text := pg_catalog.btrim(coalesce(p_reason,''));
begin
  e := fftt_private.v3_begin(p_event_id,array['organizer','bracket_manager'],array['active']);
  if e.bracket_generation < 1 or p_expected_generation is null
     or p_expected_generation <> e.bracket_generation then
    perform fftt_private.v3_err('stale','generation');
  end if;
  if length(v_reason) not between 3 and 300 or v_reason ~ '[[:cntrl:]]' then
    perform fftt_private.v3_err('validation','reason');
  end if;
  if not exists (select 1 from fftt_private.brackets b
                 where b.event_id = p_event_id and b.generation = e.bracket_generation
                   and b.kind = 'championship' and b.status = 'active') then
    perform fftt_private.v3_err('conflict','no-active-championship');
  end if;
  -- Fail closed for ANY prior played result, accepted submission, or saved game
  -- (including superseded generations). Do not destroy recorded rehearsal history.
  if exists (select 1 from fftt_private.matches m
             where m.event_id = p_event_id and m.status = 'complete')
     or exists (select 1 from fftt_private.result_submissions r where r.event_id = p_event_id)
     or exists (select 1 from fftt_private.score_decisions_v2 d where d.event_id = p_event_id)
     or exists (select 1 from fftt_private.match_game_progress g where g.event_id = p_event_id)
     or exists (select 1 from fftt_private.game_progress_decisions d where d.event_id = p_event_id)
     or exists (select 1 from fftt_private.brackets b where b.event_id = p_event_id
                   and b.generation = e.bracket_generation and b.kind = 'consolation')
     or exists (select 1 from fftt_private.doubles_finale d where d.event_id = p_event_id) then
    perform fftt_private.v3_err('conflict','preplay-results-exist');
  end if;
  select p.checked_in into v_old from fftt_private.players p
    where p.event_id = p_event_id and p.id = p_player_id for update;
  if not found then perform fftt_private.v3_err('notfound','player'); end if;
  if v_old is not true then perform fftt_private.v3_err('conflict','not-checked-in'); end if;
  if not exists (select 1 from fftt_private.matches m where m.event_id = p_event_id
                 and m.generation = e.bracket_generation
                 and (m.player_1_id = p_player_id or m.player_2_id = p_player_id)) then
    perform fftt_private.v3_err('conflict','player-not-in-bracket');
  end if;

  update fftt_private.players p set checked_in = false
    where p.event_id = p_event_id and p.id = p_player_id;
  select pg_catalog.array_agg(p.id) into v_allowed
    from fftt_private.players p where p.event_id = p_event_id and p.checked_in;
  if pg_catalog.cardinality(v_allowed) < 2 then
    perform fftt_private.v3_err('conflict','not-enough-players');
  end if;
  v_slots := fftt_private.v3_parse_slots(p_slots,v_allowed,true);
  update fftt_private.brackets set status='superseded'
    where event_id = p_event_id and generation = e.bracket_generation;
  update fftt_private.players set first_champ_loss=false where event_id=p_event_id;
  delete from fftt_private.consolation_reviews where event_id=p_event_id;
  v_generation := e.bracket_generation + 1;
  perform fftt_private.v3_create_bracket(p_event_id,v_generation,'championship',v_slots);
  update fftt_private.events set bracket_generation = v_generation where id = p_event_id;
  v_revision := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id,'checkin_changed',null,
    pg_catalog.jsonb_build_object('player_id',p_player_id,'checked_in',true),
    pg_catalog.jsonb_build_object('player_id',p_player_id,'checked_in',false,'withdrawn_preplay',true),
    v_reason,v_revision);
  perform fftt_private.v3_audit(p_event_id,'bracket_rebuilt',null,
    pg_catalog.jsonb_build_object('generation',e.bracket_generation,'completed_matches',0),
    pg_catalog.jsonb_build_object('generation',v_generation,
      'players',pg_catalog.cardinality(v_allowed),'withdrawn_player_id',p_player_id),
    v_reason,v_revision);
  return pg_catalog.jsonb_build_object('status','rebuilt','generation',v_generation,
    'event_revision',v_revision);
end;
$f$;

-- Authenticated API adapter; no anonymous access, no direct table access.
create or replace function public.fftt_withdraw_preplay_v7(
  p_event_id uuid,p_player_id uuid,p_expected_generation integer,
  p_slots jsonb,p_reason text)
returns jsonb language sql security invoker set search_path = ''
as $f$
  select fftt_private.withdraw_preplay_v7(
    p_event_id,p_player_id,p_expected_generation,p_slots,p_reason);
$f$;
revoke all on function public.fftt_withdraw_preplay_v7(uuid,uuid,integer,jsonb,text) from public,anon;
grant execute on function public.fftt_withdraw_preplay_v7(uuid,uuid,integer,jsonb,text) to authenticated;
revoke all on function fftt_private.withdraw_preplay_v7(uuid,uuid,integer,jsonb,text) from public,anon;
grant execute on function fftt_private.withdraw_preplay_v7(uuid,uuid,integer,jsonb,text) to authenticated;

commit;
