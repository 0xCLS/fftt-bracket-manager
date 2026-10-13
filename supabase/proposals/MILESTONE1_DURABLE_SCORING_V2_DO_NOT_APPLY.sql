-- FFTT MILESTONE 1: ATOMIC TERMINAL SCORE DECISIONS + OWNER-SCOPED SNAPSHOT
-- REVIEW CANDIDATE ONLY. DO NOT APPLY TO ANY HOSTED SUPABASE PROJECT.
-- DO NOT RENAME INTO supabase/migrations WITHOUT SEPARATE EXPLICIT APPROVAL.
-- Depends on the already-recorded B1, B2a, B2b and B2d migrations.
-- Synthetic-only; no accounts created, data seeded, fixture reset, publication
-- or permission changes have been EXECUTED by keeping this file in proposals/.
--
-- Security review prerequisites: run locally on disposable PostgreSQL with
-- Supabase Auth roles/JWT context and independently signed HTTP concurrency.
-- Gate specifically includes revocation after a signed JWT, foreign-actor
-- receipt reads, accepted/rejected lost responses and v1->v2 cutover.
--
-- Terminal REJECTED means ONLY "stale-match-version" with a committed row.
-- Invalid inputs, revoked users, downstream conflicts and transient errors
-- raise without inventing a terminal decision. Missing means UNKNOWN.
--
-- All accepted scores, downstream bracket advancement, legacy accepted
-- submission receipt, audit row and v2 decision commit in one transaction.
-- Rejection commits only its private decision row, not a fictional score.
-- No browser role can read or write the private ledger table.

begin;

create table fftt_private.score_decisions_v2 (
  event_id uuid not null references fftt_private.events(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  submission_id uuid not null,
  match_id uuid not null,
  generation integer not null check (generation >= 0),
  expected_match_version bigint not null check (expected_match_version >= 0),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('accepted','rejected')),
  reason text,
  match_version bigint not null check (match_version >= 0),
  event_revision bigint not null check (event_revision >= 0),
  decided_at timestamptz not null default now(),
  primary key (event_id,actor_id,submission_id),
  foreign key (event_id,match_id) references fftt_private.matches(event_id,id),
  check ((status='accepted' and reason is null)
      or (status='rejected' and reason='stale-match-version'))
);
alter table fftt_private.score_decisions_v2 enable row level security;
revoke all on fftt_private.score_decisions_v2 from public,anon,authenticated;
create trigger fftt_decisions_v2_append_only before update or delete
on fftt_private.score_decisions_v2 for each row
execute function fftt_private.reject_audit_mutation();

create function fftt_private.submit_match_result_v2(
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
as $v2$
declare
  v_actor uuid;
  v_event fftt_private.events%rowtype;
  v_match fftt_private.matches%rowtype;
  v_previous fftt_private.result_submissions%rowtype;
  v_decision fftt_private.score_decisions_v2%rowtype;
  v_fingerprint text;
  v_accepted jsonb;
  v_status text;
  v_reason text := null;
  v_match_version bigint;
  v_event_revision bigint;
begin
  if p_event_id is null or p_match_id is null or p_submission_id is null
     or p_winner_id is null or p_bracket_generation is null
     or p_expected_match_version is null or p_expected_match_version < 0
     or p_game_scores is null or length(p_game_scores) > 128
     or p_table_number is null then
    raise exception 'fftt_validation_error' using errcode='22023';
  end if;

  -- Lock BEFORE checking grant and decision. Serializes this request with
  -- B2d revocations and the existing v1 score transaction.
  select * into v_event from fftt_private.events
    where id=p_event_id and synthetic_only=true for update;
  if not found then
    raise exception 'fftt_not_found' using errcode='22023';
  end if;
  perform fftt_private.staff_role_for_event(p_event_id);
  v_actor := auth.uid();

  -- Identical canonical fingerprint to existing B2b accepted receipts.
  -- Stable across v1->v2 transition; a reused submission cannot change scores.
  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(
        p_event_id,p_match_id,p_bracket_generation,
        p_expected_match_version,p_winner_id,p_game_scores,p_table_number
      )::text,'UTF8')),'hex');

  select * into v_decision from fftt_private.score_decisions_v2
   where event_id=p_event_id and actor_id=v_actor
     and submission_id=p_submission_id;
  if found then
    if v_decision.request_fingerprint <> v_fingerprint then
      raise exception 'fftt_submission_id_reused' using errcode='23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'submission_id',v_decision.submission_id,'status',v_decision.status,
      'match_id',v_decision.match_id,'match_version',v_decision.match_version,
      'event_revision',v_decision.event_revision,
      'generation',v_decision.generation,'reason',v_decision.reason);
  end if;

  -- Preserve accepted B2b receipts, including the already-consumed fixture.
  -- This is lazy projection of an existing accepted decision, not re-scoring.
  select * into v_previous from fftt_private.result_submissions
   where event_id=p_event_id and actor_id=v_actor
     and submission_id=p_submission_id;
  if found then
    if v_previous.request_fingerprint <> v_fingerprint
       or v_previous.response ->> 'status' is distinct from 'accepted'
       or v_previous.response ->> 'match_id' is distinct from p_match_id::text
       or v_previous.generation <> p_bracket_generation then
      raise exception 'fftt_invalid_legacy_receipt' using errcode='22023';
    end if;
    v_match_version := (v_previous.response ->> 'match_version')::bigint;
    v_event_revision := (v_previous.response ->> 'event_revision')::bigint;
    if v_match_version is null or v_match_version < 0
       or v_event_revision is null or v_event_revision < 0
       or v_event_revision > v_event.revision then
      raise exception 'fftt_invalid_legacy_receipt' using errcode='22023';
    end if;
    v_status := 'accepted';
  else
    if v_event.lifecycle <> 'active'
       or v_event.bracket_generation <> p_bracket_generation then
      raise exception 'fftt_stale_generation_or_state' using errcode='P0001';
    end if;
    if p_table_number not between 1 and v_event.table_count then
      raise exception 'fftt_validation_error' using errcode='22023';
    end if;
    select * into v_match from fftt_private.matches
      where event_id=p_event_id and id=p_match_id
        and generation=p_bracket_generation for update;
    if not found then
      raise exception 'fftt_not_found' using errcode='22023';
    end if;
    if v_match.player_1_id is null or v_match.player_2_id is null
       or p_winner_id not in (v_match.player_1_id,v_match.player_2_id) then
      raise exception 'fftt_validation_error' using errcode='22023';
    end if;

    -- A stale outcome is DURABLE only when we can prove its exact
    -- terminal category under the same event lock. No blanket catch of v1
    -- exceptions: a downstream conflict / bad score is NOT "rejected".
    if v_match.status='complete'
       or v_match.match_version <> p_expected_match_version then
      v_status := 'rejected';
      v_reason := 'stale-match-version';
      v_match_version := v_match.match_version;
      v_event_revision := v_event.revision;
    elsif v_match.status <> 'pending' then
      raise exception 'fftt_conflict' using errcode='P0001';
    else
      -- The existing verified score engine owns validation, match advances,
      -- consolation eligibility, revision and append-only accepted audit.
      -- Its accepted result and this v2 ledger row share one transaction.
      v_accepted := fftt_private.submit_match_result_v1(
        p_event_id,p_match_id,p_bracket_generation,
        p_expected_match_version,p_submission_id,
        p_winner_id,p_game_scores,p_table_number);
      if v_accepted ->> 'status' is distinct from 'accepted'
         or v_accepted ->> 'match_id' is distinct from p_match_id::text then
        raise exception 'fftt_invalid_accepted_response' using errcode='22023';
      end if;
      v_status := 'accepted';
      v_match_version := (v_accepted ->> 'match_version')::bigint;
      v_event_revision := (v_accepted ->> 'event_revision')::bigint;
    end if;
  end if;

  -- All paths converge on the SAME atomic append-only private decision.
  -- No rejection audit or public publication is fabricated.
  insert into fftt_private.score_decisions_v2(
    event_id,actor_id,submission_id,match_id,generation,
    expected_match_version,request_fingerprint,status,reason,
    match_version,event_revision)
  values (p_event_id,v_actor,p_submission_id,p_match_id,p_bracket_generation,
          p_expected_match_version,v_fingerprint,v_status,v_reason,
          v_match_version,v_event_revision);
  return pg_catalog.jsonb_build_object(
    'submission_id',p_submission_id,'status',v_status,
    'match_id',p_match_id,'match_version',v_match_version,
    'event_revision',v_event_revision,
    'generation',p_bracket_generation,'reason',v_reason);
end;
$v2$;

-- Authenticated staff only, no raw table grant. No access through anon/PUBLIC.
revoke all on function fftt_private.submit_match_result_v2(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function fftt_private.submit_match_result_v2(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer) to authenticated;

create function public.fftt_submit_match_result_v2(
  p_event_id uuid,p_match_id uuid,p_bracket_generation integer,
  p_expected_match_version bigint,p_submission_id uuid,p_winner_id uuid,
  p_game_scores text,p_table_number integer
)
returns jsonb language sql volatile security invoker set search_path=''
as $v2$
  select fftt_private.submit_match_result_v2(
    p_event_id,p_match_id,p_bracket_generation,p_expected_match_version,
    p_submission_id,p_winner_id,p_game_scores,p_table_number);
$v2$;
revoke all on function public.fftt_submit_match_result_v2(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.fftt_submit_match_result_v2(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer) to authenticated;

-- One trusted read gives a consistent event revision plus only the caller's
-- accepted/rejected decision. Event FOR SHARE conflicts with writer FOR UPDATE.
-- It also serializes with B2d staff revocations that lock this event first.
create function fftt_private.score_decision_snapshot_v2(
  p_event_id uuid,p_submission_id uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path=''
as $v2$
declare
  v_actor uuid;
  v_event fftt_private.events%rowtype;
  v_decision fftt_private.score_decisions_v2%rowtype;
  v_result jsonb := null;
begin
  if p_event_id is null then
    raise exception 'fftt_validation_error' using errcode='22023';
  end if;
  select * into v_event from fftt_private.events
    where id=p_event_id and synthetic_only=true for share;
  if not found then
    raise exception 'fftt_not_found' using errcode='22023';
  end if;
  perform fftt_private.staff_role_for_event(p_event_id);
  v_actor := auth.uid();

  if p_submission_id is not null then
    select * into v_decision from fftt_private.score_decisions_v2
      where event_id=p_event_id and actor_id=v_actor
        and submission_id=p_submission_id;
    if found then
      if v_decision.event_revision > v_event.revision
         or v_decision.generation > v_event.bracket_generation then
        raise exception 'fftt_invalid_decision' using errcode='22023';
      end if;
      v_result := pg_catalog.jsonb_build_object(
        'id',v_decision.submission_id,'status',v_decision.status,
        'match_id',v_decision.match_id,'match_version',v_decision.match_version,
        'event_revision',v_decision.event_revision,
        'generation',v_decision.generation,'reason',v_decision.reason);
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'event_id',p_event_id,'revision',v_event.revision,
    'generation',v_event.bracket_generation,'lifecycle',v_event.lifecycle,
    'submission_id',p_submission_id,'decision',v_result);
end;
$v2$;
revoke all on function fftt_private.score_decision_snapshot_v2(uuid,uuid)
  from public,anon,authenticated;
grant execute on function fftt_private.score_decision_snapshot_v2(uuid,uuid)
  to authenticated;

create function public.fftt_score_decision_snapshot_v2(
  p_event_id uuid,p_submission_id uuid default null
)
returns jsonb language sql volatile security invoker set search_path=''
as $v2$
  select fftt_private.score_decision_snapshot_v2(p_event_id,p_submission_id);
$v2$;
revoke all on function public.fftt_score_decision_snapshot_v2(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.fftt_score_decision_snapshot_v2(uuid,uuid)
  to authenticated;

-- ATOMIC API CUTOVER: the legacy v1 score route MUST stop accepting bypass
-- writes before v2 becomes available. Existing accepted receipts stay intact.
revoke execute on function public.fftt_submit_match_result_v1(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer) from public,anon,authenticated;
revoke execute on function fftt_private.submit_match_result_v1(
  uuid,uuid,integer,bigint,uuid,uuid,text,integer) from public,anon,authenticated;

commit;
