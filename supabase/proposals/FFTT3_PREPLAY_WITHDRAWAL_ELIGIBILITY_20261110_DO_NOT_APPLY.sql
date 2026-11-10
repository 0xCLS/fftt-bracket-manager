-- Pre-play withdrawal eligibility (read-only): EXPLICIT proposal, NOT an automatic bootstrap migration.
-- Additive and read-only: creates ONE function pair, changes no existing function, table or row, writes nothing.
-- Install only after separate Organizer authorization and the guarded steps in docs/COMPLETED_EVENT_RENAME_RELEASE.md.
-- Requires the already-installed withdraw_preplay_v7 (migration 20261109170000).
--
-- Purpose: let Staff show "Withdraw before play" only when the SERVER says it would be accepted. The checks mirror
-- fftt_private.withdraw_preplay_v7 exactly (event-wide, including superseded bracket generations), so the control can
-- never be offered because of a client-side guess such as "zero completed matches".
begin;
do $guard$
begin
  if exists (select 1 from fftt_private.events where synthetic_only = false) and (
       pg_catalog.md5(pg_catalog.pg_get_functiondef('fftt_private.v3_err(text,text)'::regprocedure)) <> '3f6144b0c5d60393f14839c9e4950e33'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef('fftt_private.staff_role_for_event(uuid)'::regprocedure)) <> '607abbb3ad92526134f820eee3e1e7ec'
  ) then
    raise exception 'FFTT withdrawal eligibility: hosted helper fingerprints differ from reviewed source';
  end if;
  if to_regprocedure('fftt_private.v3_err(text,text)') is null
     or to_regprocedure('fftt_private.staff_role_for_event(uuid)') is null
     or to_regprocedure('fftt_private.withdraw_preplay_v7(uuid,uuid,integer,jsonb,text)') is null
     or to_regclass('fftt_private.match_game_progress') is null
     or to_regclass('fftt_private.game_progress_decisions') is null
     or to_regclass('fftt_private.score_decisions_v2') is null
     or to_regclass('fftt_private.result_submissions') is null
     or to_regclass('fftt_private.doubles_finale') is null then
    raise exception 'FFTT withdrawal eligibility: required withdrawal function or tables are missing';
  end if;
  if to_regprocedure('fftt_private.preplay_withdrawal_eligibility_v1(uuid)') is not null
     or to_regprocedure('public.fftt_preplay_withdrawal_eligibility_v1(uuid)') is not null then
    raise exception 'FFTT withdrawal eligibility: already installed';
  end if;
end;
$guard$;

create function fftt_private.preplay_withdrawal_eligibility_v1(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype;
  v_role text;
  v_reason text := null;
begin
  if p_event_id is null then perform fftt_private.v3_err('validation','event'); end if;
  v_role := fftt_private.staff_role_for_event(p_event_id);
  -- Same people who may withdraw: Organizer and Bracket Manager of THIS event. Everyone else is refused.
  if v_role is null or v_role not in ('organizer','bracket_manager') then perform fftt_private.v3_err('forbidden'); end if;
  select * into e from fftt_private.events where id = p_event_id;
  if not found then perform fftt_private.v3_err('notfound'); end if;

  if e.lifecycle <> 'active' then v_reason := 'lifecycle';
  elsif e.bracket_generation < 1 or not exists (select 1 from fftt_private.brackets b
        where b.event_id = p_event_id and b.generation = e.bracket_generation
          and b.kind = 'championship' and b.status = 'active') then v_reason := 'no-active-championship';
  -- Event-wide on purpose: superseded generations count, exactly like withdraw_preplay_v7.
  elsif exists (select 1 from fftt_private.matches m where m.event_id = p_event_id and m.status = 'complete')
     or exists (select 1 from fftt_private.result_submissions r where r.event_id = p_event_id)
     or exists (select 1 from fftt_private.score_decisions_v2 d where d.event_id = p_event_id) then v_reason := 'results-exist';
  elsif exists (select 1 from fftt_private.match_game_progress g where g.event_id = p_event_id)
     or exists (select 1 from fftt_private.game_progress_decisions d where d.event_id = p_event_id) then v_reason := 'saved-games-exist';
  elsif exists (select 1 from fftt_private.brackets b where b.event_id = p_event_id
        and b.generation = e.bracket_generation and b.kind = 'consolation') then v_reason := 'consolation-exists';
  elsif exists (select 1 from fftt_private.doubles_finale d where d.event_id = p_event_id) then v_reason := 'doubles-exists';
  -- withdraw_preplay_v7 needs at least two checked-in players to remain.
  elsif (select pg_catalog.count(*) from fftt_private.players p where p.event_id = p_event_id and p.checked_in) < 3 then
    v_reason := 'not-enough-players';
  end if;

  return pg_catalog.jsonb_build_object('event_id', p_event_id, 'eligible', v_reason is null, 'reason', v_reason,
    'generation', e.bracket_generation, 'revision', e.revision);
end;
$f$;

create function public.fftt_preplay_withdrawal_eligibility_v1(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.preplay_withdrawal_eligibility_v1(p_event_id); $f$;
revoke all on function public.fftt_preplay_withdrawal_eligibility_v1(uuid) from public, anon;
grant execute on function public.fftt_preplay_withdrawal_eligibility_v1(uuid) to authenticated;
revoke all on function fftt_private.preplay_withdrawal_eligibility_v1(uuid) from public, anon;
grant execute on function fftt_private.preplay_withdrawal_eligibility_v1(uuid) to authenticated;

commit;
