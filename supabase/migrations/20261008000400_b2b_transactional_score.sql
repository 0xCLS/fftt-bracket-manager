-- FFTT Phase 1B B2b: server-authoritative result acceptance.
-- Synthetic prototype only. Not a cloud adapter, bracket builder, score correction,
-- public publisher, or production migration. Advancing prebuilt byes remains
-- a bracket-build invariant; this command never fabricates consolation placement.
begin;

create function fftt_private.submit_match_result_v1(
  p_event_id uuid,
  p_match_id uuid,
  p_bracket_generation integer,
  p_expected_match_version bigint,
  p_submission_id uuid,
  p_winner_id uuid,
  p_game_scores text,
  p_table_number integer
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_event fftt_private.events%rowtype;
  v_match fftt_private.matches%rowtype;
  v_bracket fftt_private.brackets%rowtype;
  v_next fftt_private.matches%rowtype;
  v_receipt fftt_private.result_submissions%rowtype;
  v_fingerprint text;
  v_loser uuid;
  v_needed integer;
  v_best integer;
  v_games text[];
  v_game text;
  v_pair text[];
  v_a integer;
  v_b integer;
  v_wins1 integer := 0;
  v_wins2 integer := 0;
  v_score text := '';
  v_response jsonb;
  v_revision bigint;
  v_prior_real_match boolean;
  v_i integer;
begin
  -- Serialize score commands for the entire event before reading receipts.
  -- This guarantees one winner per unresolved version across competing devices.
  if p_event_id is null or p_match_id is null or p_submission_id is null
     or p_winner_id is null or p_bracket_generation is null
     or p_expected_match_version is null or p_game_scores is null
     or p_table_number is null then
    raise exception 'fftt_validation_error' using errcode = '22023';
  end if;

  select * into v_event from fftt_private.events
   where id=p_event_id and synthetic_only=true for update;
  if not found then
    raise exception 'fftt_not_found' using errcode = '22023';
  end if;

  -- A currently active DB grant is required BEFORE idempotent replay.
  -- The function does not trust client roles, editable user_metadata, or a
  -- previously approved submission ID. Auth JWTs are gateway-verified.
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
    raise exception 'fftt_validation_error' using errcode = '22023';
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

  v_best := case when v_bracket.kind='championship' and v_match.is_championship_final
                 then v_event.championship_final_best_of
                 else v_event.regular_best_of end;
  v_needed := (v_best+1)/2;

  if btrim(p_game_scores) <> '' then
    v_games := pg_catalog.string_to_array(p_game_scores, ',');
    if pg_catalog.array_length(v_games,1) not between v_needed and v_best then
      raise exception 'fftt_validation_error' using errcode = '22023';
    end if;
    for v_i in 1..pg_catalog.array_length(v_games,1) loop
      v_game := pg_catalog.btrim(v_games[v_i]);
      v_pair := pg_catalog.regexp_match(v_game,
        '^([0-9]+)[[:space:]]*[-–—][[:space:]]*([0-9]+)$');
      if v_pair is null then
        raise exception 'fftt_validation_error' using errcode = '22023';
      end if;
      v_a := v_pair[1]::integer;
      v_b := v_pair[2]::integer;
      if greatest(v_a,v_b) < 11
         or pg_catalog.abs(v_a-v_b) < 2
         or (greatest(v_a,v_b)>11 and pg_catalog.abs(v_a-v_b)<>2) then
        raise exception 'fftt_validation_error' using errcode = '22023';
      end if;
      if v_a>v_b then v_wins1:=v_wins1+1; else v_wins2:=v_wins2+1; end if;
      if v_i < pg_catalog.array_length(v_games,1)
         and greatest(v_wins1,v_wins2)>=v_needed then
        raise exception 'fftt_validation_error' using errcode = '22023';
      end if;
      if v_i>1 then v_score:=v_score||', '; end if;
      v_score:=v_score||v_a||'-'||v_b;
    end loop;
    if (p_winner_id=v_match.player_1_id and v_wins1<>v_needed)
      or (p_winner_id=v_match.player_2_id and v_wins2<>v_needed)
      or (p_winner_id=v_match.player_1_id and v_wins2>=v_needed)
      or (p_winner_id=v_match.player_2_id and v_wins1>=v_needed) then
      raise exception 'fftt_validation_error' using errcode = '22023';
    end if;
  end if;

  v_loser := case when p_winner_id=v_match.player_1_id then
                   v_match.player_2_id else v_match.player_1_id end;

  -- A consolation entrant must have lost their FIRST ACTUAL championship
  -- match. Winning a previous actual championship match disqualifies them.
  if v_bracket.kind='championship' then
    select exists(
      select 1 from fftt_private.matches prior
      join fftt_private.brackets pb on pb.id=prior.bracket_id
        and pb.event_id=prior.event_id and pb.generation=prior.generation
      where prior.event_id=p_event_id
        and prior.generation=p_bracket_generation
        and prior.id<>v_match.id and prior.status='complete'
        and pb.kind='championship'
        and (prior.player_1_id=v_loser or prior.player_2_id=v_loser)
    ) into v_prior_real_match;
  else
    v_prior_real_match:=true;
  end if;

  -- Check downstream slot BEFORE updating this match; any later failure
  -- rolls back all changes, audit, and idempotency receipt in one transaction.
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
    -- A missing successor link must not prematurely finish a malformed bracket.
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
      'table_number',p_table_number),v_revision);
  insert into fftt_private.result_submissions(
    event_id,actor_id,submission_id,match_id,generation,expected_match_version,
    request_fingerprint,response)
  values (p_event_id,v_actor,p_submission_id,p_match_id,p_bracket_generation,
    p_expected_match_version,v_fingerprint,v_response);
  return v_response;
end;
$fn$;

revoke all on function fftt_private.submit_match_result_v1(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer)
  from public,anon,authenticated;
grant execute on function fftt_private.submit_match_result_v1(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer) to authenticated;

create function public.fftt_submit_match_result_v1(
  p_event_id uuid, p_match_id uuid, p_bracket_generation integer,
  p_expected_match_version bigint, p_submission_id uuid,
  p_winner_id uuid, p_game_scores text, p_table_number integer
)
returns jsonb
language sql volatile security invoker set search_path = ''
as $fn$
 select fftt_private.submit_match_result_v1(
   p_event_id,p_match_id,p_bracket_generation,p_expected_match_version,
   p_submission_id,p_winner_id,p_game_scores,p_table_number);
$fn$;

revoke all on function public.fftt_submit_match_result_v1(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer)
  from public,anon,authenticated;
grant execute on function public.fftt_submit_match_result_v1(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer) to authenticated;

comment on function public.fftt_submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,integer)
is 'Synthetic-only transactional score submission. Requires active event-scoped organizer/scorekeeper grant; no cloud client enabled.';

commit;
