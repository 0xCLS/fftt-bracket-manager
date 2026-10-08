-- FFTT Phase 1B B2a: authenticated, event-scoped READ operations only.
-- Synthetic prototype. No production participants or frontend switch.
-- Private functions are SECURITY DEFINER *only in the non-exposed schema*.
-- Public-facing wrappers are SECURITY INVOKER, and their signatures have
-- explicit EXECUTE grants. No browser role gets SELECT on private tables.
begin;

-- Private schema is NOT in Supabase Data API exposed schemas.
-- Grant USAGE only so authenticated RPC wrappers can resolve their
-- explicitly allowlisted private functions. Raw tables remain inaccessible.
grant usage on schema fftt_private to authenticated;

create function fftt_private.staff_role_for_event(p_event_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  -- A JWT's role is established by Supabase's authenticated API gateway.
  -- User metadata and browser-provided role/event claims are NEVER trusted.
  if v_user is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.role into v_role
    from fftt_private.event_staff s
    join fftt_private.events e on e.id = s.event_id
   where s.event_id = p_event_id
     and s.user_id = v_user
     and s.active = true
     and s.revoked_at is null
     and e.synthetic_only = true;

  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_role;
end;
$fn$;

create function fftt_private.matchdesk_for_event(p_event_id uuid)
returns table (
  event_id uuid,
  bracket_generation integer,
  match_id uuid,
  match_code text,
  match_version bigint,
  bracket text,
  round_number integer,
  slot integer,
  player_1_id uuid,
  player_2_id uuid,
  player_1_name text,
  player_2_name text,
  is_championship_final boolean,
  table_number smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  -- Force a LIVE database grant lookup every time. Revocation wins over
  -- previous reads or remembered JWT metadata; no role is client-selected.
  perform fftt_private.staff_role_for_event(p_event_id);

  return query
    select e.id, e.bracket_generation, m.id, m.match_code,
           m.match_version, b.kind, m.round_number, m.slot,
           m.player_1_id, m.player_2_id,
           p1.display_name, p2.display_name,
           m.is_championship_final, m.table_number
      from fftt_private.events e
      join fftt_private.brackets b on b.event_id=e.id
        and b.generation=e.bracket_generation
        and b.status='active'
      join fftt_private.matches m on m.event_id=e.id
        and m.bracket_id=b.id and m.generation=e.bracket_generation
      join fftt_private.players p1 on p1.event_id=e.id
        and p1.id=m.player_1_id
      join fftt_private.players p2 on p2.event_id=e.id
        and p2.id=m.player_2_id
     where e.id=p_event_id
       and e.lifecycle='active'
       and m.status='pending'
     order by b.kind, m.round_number, m.slot;
end;
$fn$;

-- Remove the PostgreSQL default PUBLIC execute grant before granting narrowly.
revoke all on function fftt_private.staff_role_for_event(uuid)
  from public, anon, authenticated;
revoke all on function fftt_private.matchdesk_for_event(uuid)
  from public, anon, authenticated;
grant execute on function fftt_private.staff_role_for_event(uuid) to authenticated;
grant execute on function fftt_private.matchdesk_for_event(uuid) to authenticated;

-- Security INVOKER wrappers are the only exposed API entry points.
create function public.fftt_staff_role_v1(p_event_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $fn$
  select fftt_private.staff_role_for_event(p_event_id);
$fn$;

create function public.fftt_matchdesk_v1(p_event_id uuid)
returns table (
  event_id uuid,
  bracket_generation integer,
  match_id uuid,
  match_code text,
  match_version bigint,
  bracket text,
  round_number integer,
  slot integer,
  player_1_id uuid,
  player_2_id uuid,
  player_1_name text,
  player_2_name text,
  is_championship_final boolean,
  table_number smallint
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select * from fftt_private.matchdesk_for_event(p_event_id);
$fn$;

revoke all on function public.fftt_staff_role_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.fftt_matchdesk_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.fftt_staff_role_v1(uuid) to authenticated;
grant execute on function public.fftt_matchdesk_v1(uuid) to authenticated;

comment on function public.fftt_staff_role_v1(uuid) is
  'Synthetic-only: currently-authorized role in one event. No roster or staff list.';
comment on function public.fftt_matchdesk_v1(uuid) is
  'Synthetic-only: eligible scores desk, current event and generation; no rating/contact/staff data.';

commit;
