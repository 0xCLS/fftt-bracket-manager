-- Completed-event administrative rename: EXPLICIT proposal, NOT an automatic bootstrap migration.
-- Forward-only and additive: it creates ONE new function pair and changes NO existing function, table or row.
-- Install only after separate Organizer authorization, a current protected backup and the guarded-deployment
-- steps in docs/COMPLETED_EVENT_RENAME_RELEASE.md. Until then server authority is unchanged.
--
-- Behavior: an Organizer of the event may change ONLY the display name of an event whose lifecycle is exactly
-- 'complete'. The lifecycle stays 'complete'; players, brackets, matches, scores, standings, visibility,
-- date and table count are untouched. The old name, new name, actor and timestamp are written to the audit log.
begin;
do $guard$
begin
  -- A real-mode hosted install must match these exact read-only inspected helper bodies (hosted, 2026-11-09).
  -- Disposable synthetic fixtures keep the structural guard below.
  if exists (select 1 from fftt_private.events where synthetic_only = false) and (
       pg_catalog.md5(pg_catalog.pg_get_functiondef('fftt_private.v3_begin(uuid,text[],text[])'::regprocedure)) <> 'a7061f99d79968d48fdec8ff9af670ab'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef('fftt_private.v3_bump(uuid)'::regprocedure)) <> '9e8f28db66107c8d0a7e628aad850cd2'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef('fftt_private.v3_audit(uuid,text,uuid,jsonb,jsonb,text,bigint)'::regprocedure)) <> '81a8b66934bc556a0f8517ad24bc746c'
    or pg_catalog.md5(pg_catalog.pg_get_functiondef('fftt_private.v3_err(text,text)'::regprocedure)) <> '3f6144b0c5d60393f14839c9e4950e33'
  ) then
    raise exception 'FFTT completed-event rename: hosted helper fingerprints differ from reviewed source';
  end if;
  if to_regprocedure('fftt_private.v3_begin(uuid,text[],text[])') is null
     or to_regprocedure('fftt_private.v3_bump(uuid)') is null
     or to_regprocedure('fftt_private.v3_audit(uuid,text,uuid,jsonb,jsonb,text,bigint)') is null
     or to_regprocedure('fftt_private.v3_err(text,text)') is null then
    raise exception 'FFTT completed-event rename: required event helpers are missing';
  end if;
  -- Fail closed on replay: the new function must not already exist.
  if to_regprocedure('fftt_private.rename_completed_event_v1(uuid,text,text)') is not null
     or to_regprocedure('public.fftt_rename_completed_event_v1(uuid,text,text)') is not null then
    raise exception 'FFTT completed-event rename: already installed';
  end if;
end;
$guard$;

create function fftt_private.rename_completed_event_v1(p_event_id uuid, p_expected_name text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype;
  v_name text := pg_catalog.btrim(coalesce(p_name,''));
  v_expected text := pg_catalog.btrim(coalesce(p_expected_name,''));
  v_rev bigint;
begin
  -- Row lock (FOR UPDATE), Organizer-only, and lifecycle must be exactly 'complete': a draft/active event is
  -- edited through the ordinary event-setup path, an archived event must be restored first.
  e := fftt_private.v3_begin(p_event_id, array['organizer'], array['complete']);
  if pg_catalog.length(v_name) not between 1 and 120 or v_name ~ '[[:cntrl:]]'
     or pg_catalog.length(v_expected) not between 1 and 120 then
    perform fftt_private.v3_err('validation','event-name');
  end if;
  -- Optimistic concurrency: the caller names the name it saw. A concurrent rename is a conflict, never overwritten.
  if pg_catalog.btrim(e.event_name) <> v_expected then
    perform fftt_private.v3_err('conflict','name-changed');
  end if;
  if v_name = pg_catalog.btrim(e.event_name) then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision',e.revision);
  end if;
  update fftt_private.events set event_name = v_name where id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  -- Audit row carries actor_id (auth.uid()) and created_at (table default), plus old and new names. The existing
  -- 'event_updated' operation is reused (audit_events_operation_check is NOT altered); 'completed_rename' marks it.
  perform fftt_private.v3_audit(p_event_id, 'event_updated', null,
    pg_catalog.jsonb_build_object('name', e.event_name, 'date', e.event_date, 'tables', e.table_count),
    pg_catalog.jsonb_build_object('name', v_name, 'date', e.event_date, 'tables', e.table_count, 'completed_rename', true),
    null, v_rev);
  return pg_catalog.jsonb_build_object('status','renamed','event_revision',v_rev);
end;
$f$;

-- Authenticated API adapter; no anonymous access, no direct table access.
create function public.fftt_rename_completed_event_v1(p_event_id uuid, p_expected_name text, p_name text)
returns jsonb language sql security invoker set search_path = ''
as $f$ select fftt_private.rename_completed_event_v1(p_event_id, p_expected_name, p_name); $f$;
revoke all on function public.fftt_rename_completed_event_v1(uuid,text,text) from public, anon;
grant execute on function public.fftt_rename_completed_event_v1(uuid,text,text) to authenticated;
revoke all on function fftt_private.rename_completed_event_v1(uuid,text,text) from public, anon;
grant execute on function fftt_private.rename_completed_event_v1(uuid,text,text) to authenticated;

commit;
