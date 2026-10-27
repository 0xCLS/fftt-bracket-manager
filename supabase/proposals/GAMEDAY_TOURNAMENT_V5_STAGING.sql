-- FFTT GAME-DAY TOURNAMENT V5 (SYNTHETIC STAGING). Additive: applies AFTER B1-B2d, the V2 scoring file, V3 and V4.
-- REVIEW CANDIDATE. NOT APPLIED to any hosted project until the owner-approved release window.
-- Fictional data only: fftt_private.events.synthetic_only stays CHECKed true.
--
-- Event-specific REGISTRATION SOURCE. Replaces the deployment-wide "one sheet id + one range" settings with one saved
-- source per event, chosen by that event's organizer (no code change, no redeploy):
--   kind 'fixture'       fictional demo registrations (only meaningful on synthetic events)
--   kind 'google-sheets' a Google spreadsheet id + worksheet (tab) + an optional column mapping (field -> header text)
-- The table holds NO secret and NO registration data: not credentials, not rows, not contact details. Google
-- credentials live only as protected server-side secrets of the Cloudflare Function; this table only says WHICH
-- sheet an event may read. Every function below is organizer-only and event-scoped, so an organizer of event A can
-- neither read nor change event B's source. A source for a synthetic event can never be ENABLED as a live Google
-- source here: real-event activation belongs to a separate, isolated environment.
--
-- Nothing existing is rewritten: one CHECK constraint is widened (a new audit operation), one table and four
-- functions are added. Replaced objects: none.
begin;

alter table fftt_private.audit_events drop constraint audit_events_operation_check;
alter table fftt_private.audit_events add constraint audit_events_operation_check check (operation in (
  'result_accepted','result_corrected','bracket_built','bracket_rebuilt','consolation_reviewed',
  'staff_grant_changed','event_created','event_updated','player_changed','checkin_changed',
  'table_assigned','match_forfeited','doubles_updated','doubles_result','lifecycle_changed',
  'visibility_changed','format_changed','registration_checkin','rating_confirmed','event_restored',
  'registration_source_changed'));

create table fftt_private.registration_sources (
  event_id uuid primary key references fftt_private.events(id) on delete cascade,
  kind text not null check (kind in ('fixture','google-sheets')),
  spreadsheet_id text check (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  spreadsheet_title text check (char_length(spreadsheet_title) <= 200 and spreadsheet_title !~ '[[:cntrl:]]'),
  worksheet text check (char_length(worksheet) between 1 and 100 and worksheet !~ '[[:cntrl:]]'),
  column_map jsonb not null default '{}'::jsonb check (jsonb_typeof(column_map) = 'object'),
  enabled boolean not null default false,
  status text not null default 'untested' check (status in ('untested','ready','needs-attention','failed')),
  last_error text check (last_error in ('not-configured','unauthorized','not-found','worksheet-not-found','busy','unavailable','malformed','invalid-source','columns','google-auth')),
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_response_count integer check (last_response_count between 0 and 100000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint registration_sources_shape check (
    (kind = 'google-sheets') = (spreadsheet_id is not null and worksheet is not null))
);
alter table fftt_private.registration_sources enable row level security;
revoke all on fftt_private.registration_sources from public, anon, authenticated;

-- the fields a column mapping may name (the registration model's own vocabulary)
create function fftt_private.v5_mapping_ok(p_map jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $f$
declare k text; v jsonb;
begin
  if p_map is null or pg_catalog.jsonb_typeof(p_map) <> 'object' then return false; end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(p_map)) > 16 then return false; end if;
  for k, v in select key, value from pg_catalog.jsonb_each(p_map) loop
    if k not in ('name','firstName','lastName','timestamp','email','phone','frequency','experience','rallies','spin','attack','description','selfLevel') then return false; end if;
    if pg_catalog.jsonb_typeof(v) <> 'string' then return false; end if;
    if char_length(v #>> '{}') < 1 or char_length(v #>> '{}') > 120 or (v #>> '{}') ~ '[[:cntrl:]]' then return false; end if;
  end loop;
  return true;
end;
$f$;

-- ORGANIZER of this event only (a scorekeeper, an outsider, an unknown event and a revoked organizer are all 'forbidden').
create function fftt_private.registration_source_v5(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $f$
declare v_row fftt_private.registration_sources%rowtype; v_synth boolean;
begin
  if p_event_id is null or fftt_private.staff_role_for_event(p_event_id) is distinct from 'organizer' then
    perform fftt_private.v3_err('forbidden');
  end if;
  select synthetic_only into v_synth from fftt_private.events where id = p_event_id;
  select * into v_row from fftt_private.registration_sources where event_id = p_event_id;
  if v_row.event_id is null then
    return pg_catalog.jsonb_build_object('configured', false, 'event_synthetic', coalesce(v_synth, true));
  end if;
  return pg_catalog.jsonb_build_object(
    'configured', true, 'event_synthetic', coalesce(v_synth, true), 'kind', v_row.kind,
    'spreadsheet_id', v_row.spreadsheet_id, 'spreadsheet_title', v_row.spreadsheet_title, 'worksheet', v_row.worksheet,
    'column_map', v_row.column_map, 'enabled', v_row.enabled, 'status', v_row.status, 'last_error', v_row.last_error,
    'last_checked_at', v_row.last_checked_at, 'last_ok_at', v_row.last_ok_at, 'last_response_count', v_row.last_response_count,
    'updated_at', v_row.updated_at);
end;
$f$;

create function fftt_private.set_registration_source_v5(p_event_id uuid, p_source jsonb) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_kind text; v_id text; v_title text; v_ws text; v_map jsonb; v_enabled boolean;
  v_old jsonb; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if p_source is null or pg_catalog.jsonb_typeof(p_source) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_source) k
                 where k not in ('kind','spreadsheet_id','spreadsheet_title','worksheet','column_map','enabled')) then
    perform fftt_private.v3_err('validation','source');
  end if;
  v_kind := p_source ->> 'kind';
  if v_kind is null or v_kind not in ('fixture','google-sheets') then perform fftt_private.v3_err('validation','source-kind'); end if;
  v_map := coalesce(p_source -> 'column_map', '{}'::jsonb);
  if not fftt_private.v5_mapping_ok(v_map) then perform fftt_private.v3_err('validation','column-map'); end if;
  v_enabled := coalesce((p_source ->> 'enabled')::boolean, false);
  if v_kind = 'fixture' then
    if v_event.synthetic_only is not true then perform fftt_private.v3_err('conflict','fixture-synthetic-only'); end if;
    v_id := null; v_title := null; v_ws := null; v_map := '{}'::jsonb;
  else
    v_id := p_source ->> 'spreadsheet_id'; v_title := nullif(p_source ->> 'spreadsheet_title', ''); v_ws := p_source ->> 'worksheet';
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]{20,100}$' then perform fftt_private.v3_err('validation','spreadsheet'); end if;
    if v_ws is null or char_length(v_ws) not between 1 and 100 or v_ws ~ '[[:cntrl:]]' then perform fftt_private.v3_err('validation','worksheet'); end if;
    if v_title is not null and (char_length(v_title) > 200 or v_title ~ '[[:cntrl:]]') then perform fftt_private.v3_err('validation','title'); end if;
    -- a live Google source can never be switched ON for a synthetic (fictional) event: the connection may be saved and
    -- tested, but not used for event operations. A real-event environment lifts this in its own, separately approved step.
    if v_enabled and v_event.synthetic_only then perform fftt_private.v3_err('conflict','google-not-allowed-synthetic'); end if;
  end if;
  v_old := fftt_private.registration_source_v5(p_event_id);
  insert into fftt_private.registration_sources(event_id, kind, spreadsheet_id, spreadsheet_title, worksheet, column_map, enabled,
                                                status, last_error, last_checked_at, last_ok_at, last_response_count, updated_by, updated_at)
  values (p_event_id, v_kind, v_id, v_title, v_ws, v_map, v_enabled, 'untested', null, null, null, null, auth.uid(), now())
  on conflict (event_id) do update set
    kind = excluded.kind, spreadsheet_id = excluded.spreadsheet_id, spreadsheet_title = excluded.spreadsheet_title,
    worksheet = excluded.worksheet, column_map = excluded.column_map, enabled = excluded.enabled,
    -- a changed source forgets the old test result; an unchanged one (e.g. only toggling) keeps it
    status = case when fftt_private.registration_sources.spreadsheet_id is not distinct from excluded.spreadsheet_id
                   and fftt_private.registration_sources.worksheet is not distinct from excluded.worksheet
                   and fftt_private.registration_sources.column_map = excluded.column_map
                   and fftt_private.registration_sources.kind = excluded.kind
                  then fftt_private.registration_sources.status else 'untested' end,
    last_error = case when fftt_private.registration_sources.spreadsheet_id is not distinct from excluded.spreadsheet_id
                   and fftt_private.registration_sources.worksheet is not distinct from excluded.worksheet
                   and fftt_private.registration_sources.column_map = excluded.column_map
                   and fftt_private.registration_sources.kind = excluded.kind
                  then fftt_private.registration_sources.last_error else null end,
    last_checked_at = case when fftt_private.registration_sources.spreadsheet_id is not distinct from excluded.spreadsheet_id
                   and fftt_private.registration_sources.worksheet is not distinct from excluded.worksheet
                   and fftt_private.registration_sources.column_map = excluded.column_map
                   and fftt_private.registration_sources.kind = excluded.kind
                  then fftt_private.registration_sources.last_checked_at else null end,
    last_ok_at = case when fftt_private.registration_sources.spreadsheet_id is not distinct from excluded.spreadsheet_id
                   and fftt_private.registration_sources.worksheet is not distinct from excluded.worksheet
                   and fftt_private.registration_sources.kind = excluded.kind
                  then fftt_private.registration_sources.last_ok_at else null end,
    last_response_count = case when fftt_private.registration_sources.spreadsheet_id is not distinct from excluded.spreadsheet_id
                   and fftt_private.registration_sources.worksheet is not distinct from excluded.worksheet
                   and fftt_private.registration_sources.column_map = excluded.column_map
                   and fftt_private.registration_sources.kind = excluded.kind
                  then fftt_private.registration_sources.last_response_count else null end,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'registration_source_changed', null,
    pg_catalog.jsonb_build_object('kind', v_old ->> 'kind', 'worksheet', v_old ->> 'worksheet', 'enabled', (v_old ->> 'enabled')::boolean),
    pg_catalog.jsonb_build_object('kind', v_kind, 'worksheet', v_ws, 'enabled', v_enabled), null, v_rev);
  return pg_catalog.jsonb_build_object('status', 'saved', 'event_revision', v_rev);
end;
$f$;

create function fftt_private.clear_registration_source_v5(p_event_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_rev bigint; v_n integer;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  delete from fftt_private.registration_sources where event_id = p_event_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then return pg_catalog.jsonb_build_object('status', 'unchanged'); end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'registration_source_changed', null,
    pg_catalog.jsonb_build_object('configured', true), pg_catalog.jsonb_build_object('configured', false), null, v_rev);
  return pg_catalog.jsonb_build_object('status', 'cleared', 'event_revision', v_rev);
end;
$f$;

-- Informational result of a connection test or a read (never any registration data). Organizer-only and event-scoped;
-- it can only store one of the enumerated outcomes and counts, and it changes no configuration.
create function fftt_private.record_registration_check_v5(p_event_id uuid, p_status text, p_error text, p_count integer) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $f$
declare v_n integer;
begin
  if p_event_id is null or fftt_private.staff_role_for_event(p_event_id) is distinct from 'organizer' then
    perform fftt_private.v3_err('forbidden');
  end if;
  if p_status is null or p_status not in ('ready','needs-attention','failed') then perform fftt_private.v3_err('validation','status'); end if;
  if p_error is not null and p_error not in ('not-configured','unauthorized','not-found','worksheet-not-found','busy','unavailable','malformed','invalid-source','columns','google-auth') then
    perform fftt_private.v3_err('validation','error');
  end if;
  if p_count is not null and (p_count < 0 or p_count > 100000) then perform fftt_private.v3_err('validation','count'); end if;
  update fftt_private.registration_sources
     set status = p_status, last_error = case when p_status = 'ready' then null else p_error end,
         last_checked_at = now(), last_ok_at = case when p_status = 'ready' then now() else last_ok_at end,
         last_response_count = case when p_status = 'ready' then p_count else last_response_count end
   where event_id = p_event_id;
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('status', case when v_n = 1 then 'recorded' else 'no-source' end);
end;
$f$;

-- ================================================================ grants + public wrappers
do $grants$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'fftt_private'
             and p.proname in ('registration_source_v5','set_registration_source_v5','clear_registration_source_v5','record_registration_check_v5')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'fftt_private' and p.proname = 'v5_mapping_ok'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$grants$;

create function public.fftt_registration_source_v5(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.registration_source_v5(p_event_id); $f$;
create function public.fftt_set_registration_source_v5(p_event_id uuid, p_source jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_registration_source_v5(p_event_id, p_source); $f$;
create function public.fftt_clear_registration_source_v5(p_event_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.clear_registration_source_v5(p_event_id); $f$;
create function public.fftt_record_registration_check_v5(p_event_id uuid, p_status text, p_error text, p_count integer)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.record_registration_check_v5(p_event_id, p_status, p_error, p_count); $f$;

do $wrap$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fftt\_%registration%\_v5' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$wrap$;

commit;
