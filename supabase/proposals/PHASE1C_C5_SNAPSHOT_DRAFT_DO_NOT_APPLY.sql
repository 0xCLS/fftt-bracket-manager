-- PHASE 1C C5 SECURITY REVIEW PROPOSAL — DO NOT APPLY TO HOSTED/PRODUCTION.
--
-- This is a DRAFT contract only. Deployment requires review + explicit scope
-- approval; C3 deliberately has NO route to call this nonexistent RPC.
--
-- Threat model: authorized signed users only; never return another scorekeeper's
-- receipts, any staff record, contact detail, player rating, audit history,
-- game scores or the event's private player data. A missing request receipt
-- is UNKNOWN, not "rejected". No replay, corrective write or score mutation.
--
-- Existing schema inspected October 9: events(revision bigint,
-- bracket_generation int, lifecycle text, synthetic_only boolean);
-- result_submissions PK(event_id,actor_id,submission_id) and response JSONB
-- only persists ACCEPTED submissions. Already-used helper
-- fftt_private.staff_role_for_event(uuid) validates current signed-in user,
-- synthetic event and active staff grant (including revoked_at is null).
--
-- IMPORTANT: Definer owner/grants, JWT behavior, PostgREST exposure, privilege
-- isolation, RLS and transaction consistency MUST be integration tested in an
-- ephemeral PostgreSQL deployment before applying on hosted Supabase.

begin;

create or replace function fftt_private.event_snapshot_for_staff_v1(
    p_event_id uuid,
    p_submission_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $c5$
declare
  v_role text;
  v_user uuid;
  v_revision bigint;
  v_generation integer;
  v_lifecycle text;
  v_receipt_response jsonb;
  v_receipt_match_id uuid;
  v_receipt_generation integer;
  v_receipt_event_revision bigint;
  v_receipt_match_version bigint;
  v_status text;
  v_receipt jsonb := null;
begin
  -- Existing centralized role helper rejects an anonymous, outsider, stale
  -- staff grant, forged role claim, or an event not synthetic_only.
  v_role := fftt_private.staff_role_for_event(p_event_id);
  if v_role not in ('organizer', 'scorekeeper') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_user := auth.uid();

  select e.revision, e.bracket_generation, e.lifecycle
    into v_revision, v_generation, v_lifecycle
    from fftt_private.events as e
   where e.id = p_event_id and e.synthetic_only = true;

  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_submission_id is not null then
    -- Strict ownership: the selected actor is ALWAYS the authenticated user.
    -- Neither a caller-supplied actor ID nor another scorekeeper's receipt
    -- may be queried. The row PK bounds lookup to at most one accepted result.
    select s.response, s.match_id, s.generation
      into v_receipt_response, v_receipt_match_id, v_receipt_generation
      from fftt_private.result_submissions as s
     where s.event_id = p_event_id
       and s.actor_id = v_user
       and s.submission_id = p_submission_id;

    if found then
      v_status := v_receipt_response ->> 'status';
      if v_status is distinct from 'accepted' then
        -- Unexpected stored receipt shape is an incident, not "rejected".
        raise exception 'invalid result receipt' using errcode = '22023';
      end if;

      v_receipt_event_revision :=
        (v_receipt_response ->> 'event_revision')::bigint;
      v_receipt_match_version :=
        (v_receipt_response ->> 'match_version')::bigint;
      if v_receipt_event_revision is null
         or v_receipt_event_revision > v_revision
         or v_receipt_event_revision < 0
         or v_receipt_match_version is null
         or v_receipt_match_version < 0
         or v_receipt_generation is null
         or v_receipt_generation > v_generation
         or v_receipt_generation < 0
         or v_receipt_response ->> 'match_id' is distinct from v_receipt_match_id::text
      then
        raise exception 'invalid result receipt' using errcode = '22023';
      end if;

      v_receipt := jsonb_build_object(
        'id', p_submission_id,
        'status', 'accepted',
        'match_id', v_receipt_match_id,
        'match_version', v_receipt_match_version,
        'event_revision', v_receipt_event_revision,
        'generation', v_receipt_generation
      );
    end if;
  end if;

  -- Missing accepted receipt => null. Never invent "rejected"/"failed":
  -- result_submissions does not persist most unsuccessful attempts.
  return jsonb_build_object(
    'event_id', p_event_id,
    'revision', v_revision,
    'generation', v_generation,
    'lifecycle', v_lifecycle,
    'resolved_submission', v_receipt
  );
end;
$c5$;

create or replace function public.fftt_event_snapshot_v1(
    p_event_id uuid,
    p_submission_id uuid default null
)
returns jsonb
language sql
stable
set search_path to ''
as $c5$
  select fftt_private.event_snapshot_for_staff_v1(
    p_event_id, p_submission_id
  );
$c5$;

-- No anonymous/PUBLIC execute; explicit scope-limited Auth role grants only.
revoke all on function fftt_private.event_snapshot_for_staff_v1(uuid,uuid)
  from public, anon;
revoke all on function public.fftt_event_snapshot_v1(uuid,uuid)
  from public, anon;
grant execute on function fftt_private.event_snapshot_for_staff_v1(uuid,uuid)
  to authenticated;
grant execute on function public.fftt_event_snapshot_v1(uuid,uuid)
  to authenticated;

commit;
