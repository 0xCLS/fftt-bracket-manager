-- FFTT GAME-DAY TOURNAMENT V3 (SYNTHETIC STAGING). Additive: applies AFTER B1-B2d and the V2 scoring file.
-- Authorized by the organizer's October 23, 2026 consolidated synthetic scope. Fictional data only:
-- fftt_private.events.synthetic_only is CHECKed true, so this file cannot hold real event data.
--
-- Adds, all server-authoritative and event-scoped:
--   event creation (platform organizers only) and selection; roster, check-in, no-show forfeit;
--   championship + consolation bracket construction (the browser proposes seed slots, the SERVER builds
--   the structure and byes); table assignment; organizer correction with audit; Mixed-Skill Doubles
--   finale team selection and result; lifecycle; organizer-controlled public visibility with an
--   allowlisted projection (names and results only, never ratings or private identifiers);
--   organizer snapshot, audit log and private export.
-- Scoring itself (and progression) stays in the audited V2 function. Nothing here weakens it.
-- Every public.* wrapper is SECURITY INVOKER, authenticated-only; anon gets only the public view.
begin;

-- ---------------------------------------------------------------- schema evolution
alter table fftt_private.audit_events drop constraint audit_events_operation_check;
alter table fftt_private.audit_events add constraint audit_events_operation_check check (operation in (
  'result_accepted','result_corrected','bracket_built','bracket_rebuilt','consolation_reviewed',
  'staff_grant_changed','event_created','event_updated','player_changed','checkin_changed',
  'table_assigned','match_forfeited','doubles_updated','doubles_result','lifecycle_changed',
  'visibility_changed'));

alter table fftt_private.events
  add column public_visible boolean not null default false,
  add column created_by uuid references auth.users(id) on delete set null;

alter table fftt_private.doubles_finale
  add column winner_team smallint check (winner_team in (1,2)),
  add column game_scores text not null default '',
  add column completed_at timestamptz,
  add column completed_by uuid references auth.users(id);

-- One pending match per table at a time.
create unique index matches_pending_table_uniq on fftt_private.matches (event_id, generation, table_number)
  where status = 'pending' and table_number is not null;

-- Accounts allowed to CREATE events. Populated only by trusted administrative SQL; never by an API.
create table fftt_private.platform_organizers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table fftt_private.platform_organizers enable row level security;
revoke all on fftt_private.platform_organizers from public, anon, authenticated;

alter table public.fftt_published_events
  add column public_revision bigint not null default 0,
  add column table_count smallint not null default 2,
  add column finale jsonb;
alter table public.fftt_published_matches
  add column table_number smallint,
  add column phase text not null default 'waiting'
    check (phase in ('waiting','up_next','playing','done'));

-- ---------------------------------------------------------------- small helpers (private)
create function fftt_private.v3_err(p_kind text, p_detail text default null)
returns void language plpgsql immutable set search_path = ''
as $f$
begin
  raise exception using
    message = case p_kind when 'validation' then 'fftt_validation_error'
                          when 'notfound' then 'fftt_not_found'
                          when 'stale' then 'fftt_stale_generation'
                          when 'forbidden' then 'forbidden'
                          else 'fftt_conflict' end,
    errcode = case p_kind when 'validation' then '22023' when 'notfound' then '22023'
                          when 'forbidden' then '42501' else 'P0001' end,
    detail = coalesce(p_detail, '');
end;
$f$;

-- Locks the event, proves a CURRENT grant with one of p_roles, and (optionally) a lifecycle.
-- Missing event and missing grant are indistinguishable to a caller.
create function fftt_private.v3_begin(p_event_id uuid, p_roles text[], p_lifecycles text[] default null)
returns fftt_private.events
language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype;
  v_role text;
begin
  if p_event_id is null then perform fftt_private.v3_err('validation','event'); end if;
  select * into v_event from fftt_private.events where id = p_event_id and synthetic_only = true for update;
  v_role := fftt_private.staff_role_for_event(p_event_id);
  if not (v_role = any(p_roles)) then perform fftt_private.v3_err('forbidden'); end if;
  if v_event.id is null then perform fftt_private.v3_err('notfound'); end if;
  if p_lifecycles is not null and not (v_event.lifecycle = any(p_lifecycles)) then
    perform fftt_private.v3_err('conflict','lifecycle');
  end if;
  return v_event;
end;
$f$;

create function fftt_private.v3_bump(p_event_id uuid) returns bigint
language plpgsql volatile security definer set search_path = ''
as $f$
declare v_rev bigint;
begin
  update fftt_private.events set revision = revision + 1, updated_at = now()
   where id = p_event_id returning revision into v_rev;
  return v_rev;
end;
$f$;

create function fftt_private.v3_audit(p_event_id uuid, p_op text, p_match uuid, p_before jsonb,
                                      p_after jsonb, p_reason text, p_revision bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $f$
begin
  insert into fftt_private.audit_events(event_id, actor_id, operation, match_id, before_state,
                                        after_state, reason, event_revision)
  values (p_event_id, auth.uid(), p_op, p_match, p_before, p_after, p_reason, p_revision);
end;
$f$;

-- Same game-score rules as the audited B2b function and the approved app (11, win by 2, exact 2 after deuce).
-- Blank is allowed (winner only). Returns the normalized "11-8, 9-11, 11-7" text.
create function fftt_private.v3_normalize_scores(p_scores text, p_best_of integer, p_p1_won boolean)
returns text language plpgsql immutable set search_path = ''
as $f$
declare
  v_needed integer := (p_best_of + 1) / 2;
  v_games text[]; v_pair text[]; v_a integer; v_b integer;
  v_w1 integer := 0; v_w2 integer := 0; v_out text := ''; v_i integer;
begin
  if p_scores is null or length(p_scores) > 128 then perform fftt_private.v3_err('validation','scores'); end if;
  if btrim(p_scores) = '' then return ''; end if;
  v_games := pg_catalog.string_to_array(p_scores, ',');
  if pg_catalog.array_length(v_games, 1) not between v_needed and p_best_of then
    perform fftt_private.v3_err('validation','scores-count');
  end if;
  for v_i in 1..pg_catalog.array_length(v_games, 1) loop
    v_pair := pg_catalog.regexp_match(pg_catalog.btrim(v_games[v_i]), '^([0-9]+)[[:space:]]*[-–—][[:space:]]*([0-9]+)$');
    if v_pair is null then perform fftt_private.v3_err('validation','scores-format'); end if;
    if length(v_pair[1]) > 2 or length(v_pair[2]) > 2 then perform fftt_private.v3_err('validation','scores-range'); end if;
    v_a := v_pair[1]::integer; v_b := v_pair[2]::integer;
    if greatest(v_a, v_b) < 11 or pg_catalog.abs(v_a - v_b) < 2
       or (greatest(v_a, v_b) > 11 and pg_catalog.abs(v_a - v_b) <> 2) then
      perform fftt_private.v3_err('validation','scores-game');
    end if;
    if v_a > v_b then v_w1 := v_w1 + 1; else v_w2 := v_w2 + 1; end if;
    if v_i < pg_catalog.array_length(v_games, 1) and greatest(v_w1, v_w2) >= v_needed then
      perform fftt_private.v3_err('validation','scores-extra-games');
    end if;
    if v_i > 1 then v_out := v_out || ', '; end if;
    v_out := v_out || v_a || '-' || v_b;
  end loop;
  if (p_p1_won and (v_w1 <> v_needed or v_w2 >= v_needed))
     or (not p_p1_won and (v_w2 <> v_needed or v_w1 >= v_needed)) then
    perform fftt_private.v3_err('validation','scores-winner');
  end if;
  return v_out;
end;
$f$;

-- ---------------------------------------------------------------- public projection (allowlisted)
create function fftt_private.v3_refresh_public(p_event_id uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype;
  v_finale jsonb := null;
  d fftt_private.doubles_finale%rowtype;
  v_name text;
begin
  select * into e from fftt_private.events where id = p_event_id;
  if not found then return; end if;
  if not e.public_visible or e.lifecycle = 'draft' then
    delete from public.fftt_published_events where event_id = e.public_id;
    return;
  end if;

  select * into d from fftt_private.doubles_finale where event_id = e.id;
  if found and d.consolation_partner_1 is not null and d.consolation_partner_2 is not null then
    v_finale := pg_catalog.jsonb_build_object(
      'status', case when d.winner_team is null then 'pending' else 'complete' end,
      'team_1', pg_catalog.jsonb_build_array(
         (select display_name from fftt_private.players where event_id = e.id and id = d.championship_finalist_1),
         (select display_name from fftt_private.players where event_id = e.id and id = d.consolation_partner_1)),
      'team_2', pg_catalog.jsonb_build_array(
         (select display_name from fftt_private.players where event_id = e.id and id = d.championship_finalist_2),
         (select display_name from fftt_private.players where event_id = e.id and id = d.consolation_partner_2)),
      'winner_team', d.winner_team,
      'game_scores', d.game_scores);
  end if;

  insert into public.fftt_published_events(event_id, event_name, event_date, status, updated_at,
                                           public_revision, table_count, finale)
  values (e.public_id, e.event_name, e.event_date, e.lifecycle, now(), e.revision, e.table_count, v_finale)
  on conflict (event_id) do update set
    event_name = excluded.event_name, event_date = excluded.event_date, status = excluded.status,
    updated_at = excluded.updated_at, public_revision = excluded.public_revision,
    table_count = excluded.table_count, finale = excluded.finale;

  delete from public.fftt_published_matches where event_id = e.public_id;
  insert into public.fftt_published_matches(event_id, match_id, bracket, round, slot, player_1_name,
                                            player_2_name, winner_name, game_scores, status,
                                            table_number, phase)
  select e.public_id,
         pg_catalog.lower(b.kind || '-' || m.match_code),
         b.kind, m.round_number, m.slot, p1.display_name, p2.display_name, w.display_name,
         m.game_scores, m.status, m.table_number,
         case when m.status <> 'pending' then 'done'
              when m.player_1_id is null or m.player_2_id is null then 'waiting'
              when m.table_number is not null then 'playing'
              else 'up_next' end
    from fftt_private.matches m
    join fftt_private.brackets b on b.id = m.bracket_id and b.event_id = m.event_id
         and b.generation = m.generation and b.status in ('active','complete')
    left join fftt_private.players p1 on p1.event_id = m.event_id and p1.id = m.player_1_id
    left join fftt_private.players p2 on p2.event_id = m.event_id and p2.id = m.player_2_id
    left join fftt_private.players w on w.event_id = m.event_id and w.id = m.winner_id
   where m.event_id = e.id and m.generation = e.bracket_generation;
end;
$f$;

create function fftt_private.v3_events_publish_trigger() returns trigger
language plpgsql volatile security definer set search_path = ''
as $f$
begin
  if new.public_visible or old.public_visible then
    perform fftt_private.v3_refresh_public(new.id);
  end if;
  return new;
end;
$f$;
create trigger fftt_events_publish_v3 after update on fftt_private.events
  for each row execute function fftt_private.v3_events_publish_trigger();

-- ---------------------------------------------------------------- bracket construction (server-built)
-- p_slots: array of player ids (null = bye) in bracket slot order; length is a power of two.
create function fftt_private.v3_create_bracket(p_event_id uuid, p_generation integer, p_kind text, p_slots uuid[])
returns uuid language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_size integer := pg_catalog.array_length(p_slots, 1);
  v_rounds integer := 0; v_n integer := 1;
  v_bracket uuid; v_r integer; v_i integer; v_count integer;
  m record; a record; b record;
  v_p1 uuid; v_p2 uuid; v_ready boolean;
begin
  while v_n < v_size loop v_n := v_n * 2; v_rounds := v_rounds + 1; end loop;
  if v_n <> v_size or v_size < 2 or v_size > 64 then perform fftt_private.v3_err('validation','slots-size'); end if;

  insert into fftt_private.brackets(event_id, generation, kind, status, consolation_review_completed, created_by)
  values (p_event_id, p_generation, p_kind, 'active', p_kind = 'consolation', auth.uid())
  returning id into v_bracket;

  for v_r in 0..v_rounds - 1 loop
    v_count := v_size / (2 ^ (v_r + 1))::integer;
    for v_i in 0..v_count - 1 loop
      insert into fftt_private.matches(event_id, bracket_id, generation, match_code, round_number, slot,
                                       is_championship_final)
      values (p_event_id, v_bracket, p_generation, 'C-' || v_r || '-' || v_i, v_r, v_i,
              p_kind = 'championship' and v_r = v_rounds - 1);
    end loop;
  end loop;

  update fftt_private.matches mm set next_match_id = n.id, next_match_slot = (mm.slot % 2) + 1
    from fftt_private.matches n
   where mm.bracket_id = v_bracket and n.bracket_id = v_bracket
     and n.round_number = mm.round_number + 1 and n.slot = mm.slot / 2;

  -- Opening round players from the seed slots.
  for v_i in 0..(v_size / 2) - 1 loop
    update fftt_private.matches set player_1_id = p_slots[2 * v_i + 1], player_2_id = p_slots[2 * v_i + 2]
     where bracket_id = v_bracket and round_number = 0 and slot = v_i;
  end loop;

  -- Resolve byes and empty slots round by round (feeders always precede their match).
  for v_r in 0..v_rounds - 1 loop
    for m in select * from fftt_private.matches where bracket_id = v_bracket and round_number = v_r order by slot loop
      v_p1 := m.player_1_id; v_p2 := m.player_2_id; v_ready := true;
      if v_r > 0 then
        select * into a from fftt_private.matches where bracket_id = v_bracket and round_number = v_r - 1 and slot = 2 * m.slot;
        select * into b from fftt_private.matches where bracket_id = v_bracket and round_number = v_r - 1 and slot = 2 * m.slot + 1;
        v_p1 := case when a.status = 'bye' then a.winner_id else null end;
        v_p2 := case when b.status = 'bye' then b.winner_id else null end;
        v_ready := a.status <> 'pending' and b.status <> 'pending';
        update fftt_private.matches set player_1_id = v_p1, player_2_id = v_p2 where id = m.id;
      end if;
      if v_ready then
        if v_p1 is null and v_p2 is null then
          update fftt_private.matches set status = 'empty' where id = m.id;
        elsif v_p1 is null or v_p2 is null then
          update fftt_private.matches set status = 'bye', winner_id = coalesce(v_p1, v_p2) where id = m.id;
        end if;
      end if;
    end loop;
  end loop;
  return v_bracket;
end;
$f$;

-- Validates a jsonb slots array: power of two, uuid-or-null, unique, no all-bye pair, and (when
-- p_must_equal is non-null) exactly that player set. Returns the uuid[].
create function fftt_private.v3_parse_slots(p_slots jsonb, p_allowed uuid[], p_exact boolean)
returns uuid[] language plpgsql immutable set search_path = ''
as $f$
declare
  v_len integer; v_out uuid[] := '{}'; v_el jsonb; v_n integer := 1; v_i integer; v_ids uuid[];
  v_real integer := 0;
begin
  if p_slots is null or pg_catalog.jsonb_typeof(p_slots) <> 'array' then perform fftt_private.v3_err('validation','slots'); end if;
  v_len := pg_catalog.jsonb_array_length(p_slots);
  if v_len < 2 or v_len > 64 then perform fftt_private.v3_err('validation','slots-size'); end if;
  for v_i in 0..v_len - 1 loop
    v_el := p_slots -> v_i;
    if pg_catalog.jsonb_typeof(v_el) = 'null' then
      v_out := v_out || null::uuid;
    elsif pg_catalog.jsonb_typeof(v_el) = 'string' and (v_el #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_out := v_out || (v_el #>> '{}')::uuid; v_real := v_real + 1;
    else
      perform fftt_private.v3_err('validation','slots-element');
    end if;
  end loop;
  while v_n < v_len loop v_n := v_n * 2; end loop;
  if v_n <> v_len then perform fftt_private.v3_err('validation','slots-size'); end if;
  if v_real < 2 then perform fftt_private.v3_err('validation','slots-players'); end if;
  -- minimal bracket: byes fewer than half the slots, and never two empty slots in one pair
  if v_real <= v_len / 2 then perform fftt_private.v3_err('validation','slots-too-large'); end if;
  for v_i in 0..(v_len / 2) - 1 loop
    if v_out[2 * v_i + 1] is null and v_out[2 * v_i + 2] is null then perform fftt_private.v3_err('validation','slots-empty-pair'); end if;
  end loop;
  select pg_catalog.array_agg(x) into v_ids from pg_catalog.unnest(v_out) as x where x is not null;
  if (select pg_catalog.count(distinct x) from pg_catalog.unnest(v_ids) as x) <> v_real then
    perform fftt_private.v3_err('validation','slots-duplicate');
  end if;
  if exists (select 1 from pg_catalog.unnest(v_ids) as x where not (x = any(p_allowed))) then
    perform fftt_private.v3_err('validation','slots-ineligible');
  end if;
  if p_exact and pg_catalog.cardinality(p_allowed) <> v_real then
    perform fftt_private.v3_err('validation','slots-incomplete');
  end if;
  return v_out;
end;
$f$;

-- ---------------------------------------------------------------- events
create function fftt_private.create_event_v3(p_name text, p_date date, p_table_count integer)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_actor uuid := auth.uid();
  v_id uuid; v_pub uuid; v_name text := pg_catalog.btrim(coalesce(p_name, ''));
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    perform fftt_private.v3_err('forbidden');
  end if;
  if not exists (select 1 from fftt_private.platform_organizers where user_id = v_actor)
     or not exists (select 1 from auth.users u where u.id = v_actor and u.is_anonymous = false
                    and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())) then
    perform fftt_private.v3_err('forbidden');
  end if;
  if length(v_name) not between 1 and 120 or v_name ~ '[[:cntrl:]]' or p_date is null
     or p_table_count is null or p_table_count not between 1 and 12
     or p_date < date '2026-01-01' or p_date > date '2100-12-31' then
    perform fftt_private.v3_err('validation','event');
  end if;
  if (select pg_catalog.count(*) from fftt_private.events where created_by = v_actor
        and lifecycle <> 'archived') >= 25 then
    perform fftt_private.v3_err('conflict','event-limit');
  end if;
  insert into fftt_private.events(event_name, event_date, table_count, created_by)
  values (v_name, p_date, p_table_count::smallint, v_actor) returning id, public_id into v_id, v_pub;
  insert into fftt_private.event_staff(event_id, user_id, role, granted_by) values (v_id, v_actor, 'organizer', v_actor);
  perform fftt_private.v3_audit(v_id, 'event_created', null, null,
    pg_catalog.jsonb_build_object('name', v_name, 'date', p_date, 'tables', p_table_count), null, 0);
  return pg_catalog.jsonb_build_object('status', 'created', 'event_id', v_id, 'lifecycle', 'draft', 'event_revision', 0);
end;
$f$;

create function fftt_private.my_events_v3() returns jsonb
language plpgsql stable security definer set search_path = ''
as $f$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    perform fftt_private.v3_err('forbidden');
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'event_id', e.id, 'name', e.event_name, 'date', e.event_date, 'lifecycle', e.lifecycle,
             'role', s.role, 'revision', e.revision,
             'can_create', exists (select 1 from fftt_private.platform_organizers po where po.user_id = v_actor))
           order by e.event_date desc, e.created_at desc)
      from fftt_private.event_staff s
      join fftt_private.events e on e.id = s.event_id
     where s.user_id = v_actor and s.active and s.revoked_at is null and e.synthetic_only
  ), '[]'::jsonb);
end;
$f$;

create function fftt_private.update_event_v3(p_event_id uuid, p_name text, p_date date, p_table_count integer)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_name text := pg_catalog.btrim(coalesce(p_name,'')); v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if length(v_name) not between 1 and 120 or v_name ~ '[[:cntrl:]]' or p_date is null
     or p_table_count is null or p_table_count not between 1 and 12 then
    perform fftt_private.v3_err('validation','event');
  end if;
  if p_table_count < v_event.table_count and exists (
       select 1 from fftt_private.matches where event_id = p_event_id and status = 'pending'
          and generation = v_event.bracket_generation and table_number > p_table_count) then
    perform fftt_private.v3_err('conflict','table-in-use');
  end if;
  update fftt_private.events set event_name = v_name, event_date = p_date, table_count = p_table_count::smallint
   where id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'event_updated', null,
    pg_catalog.jsonb_build_object('name', v_event.event_name, 'date', v_event.event_date, 'tables', v_event.table_count),
    pg_catalog.jsonb_build_object('name', v_name, 'date', p_date, 'tables', p_table_count), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','event_revision', v_rev);
end;
$f$;

create function fftt_private.set_lifecycle_v3(p_event_id uuid, p_lifecycle text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active','complete']);
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
    update fftt_private.events set public_visible = false where id = p_event_id;
  end if;
  update fftt_private.events set lifecycle = p_lifecycle where id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'lifecycle_changed', null,
    pg_catalog.jsonb_build_object('lifecycle', v_event.lifecycle),
    pg_catalog.jsonb_build_object('lifecycle', p_lifecycle), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','lifecycle', p_lifecycle, 'event_revision', v_rev);
end;
$f$;

create function fftt_private.set_visibility_v3(p_event_id uuid, p_visible boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active','complete']);
  if p_visible is null then perform fftt_private.v3_err('validation','visibility'); end if;
  if v_event.public_visible = p_visible then
    return pg_catalog.jsonb_build_object('status','unchanged','public_visible', p_visible,'event_revision', v_event.revision);
  end if;
  update fftt_private.events set public_visible = p_visible where id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'visibility_changed', null,
    pg_catalog.jsonb_build_object('public_visible', v_event.public_visible),
    pg_catalog.jsonb_build_object('public_visible', p_visible), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','public_visible', p_visible,'event_revision', v_rev);
end;
$f$;

-- ---------------------------------------------------------------- roster
create function fftt_private.upsert_players_v3(p_event_id uuid, p_players jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_el jsonb; v_i integer; v_len integer;
  v_id uuid; v_name text; v_rating integer; v_status text; v_added integer := 0; v_changed integer := 0;
  v_rev bigint; v_existing fftt_private.players%rowtype;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if p_players is null or pg_catalog.jsonb_typeof(p_players) <> 'array' then perform fftt_private.v3_err('validation','players'); end if;
  v_len := pg_catalog.jsonb_array_length(p_players);
  if v_len < 1 or v_len > 64 then perform fftt_private.v3_err('validation','players-count'); end if;
  for v_i in 0..v_len - 1 loop
    v_el := p_players -> v_i;
    if pg_catalog.jsonb_typeof(v_el) <> 'object' then perform fftt_private.v3_err('validation','player'); end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_el) k where k not in ('id','name','rating','rating_status')) then
      perform fftt_private.v3_err('validation','player-fields');
    end if;
    v_name := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_el ->> 'name', ''), '[[:space:]]+', ' ', 'g'));
    -- This database never stores contact details: reject anything that looks like one.
    if length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]' or v_name ~ '@'
       or v_name ~ '[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9]' then
      perform fftt_private.v3_err('validation','player-name');
    end if;
    if pg_catalog.jsonb_typeof(v_el -> 'rating') <> 'number' or (v_el ->> 'rating') !~ '^[1-5]$' then perform fftt_private.v3_err('validation','player-rating'); end if;
    v_rating := (v_el ->> 'rating')::integer;
    v_status := v_el ->> 'rating_status';
    if v_status not in ('provisional','established') then perform fftt_private.v3_err('validation','player-status'); end if;
    v_id := null;
    if v_el ? 'id' and pg_catalog.jsonb_typeof(v_el -> 'id') <> 'null' then
      if (v_el ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then perform fftt_private.v3_err('validation','player-id'); end if;
      v_id := (v_el ->> 'id')::uuid;
    end if;
    if v_id is null then
      if (select pg_catalog.count(*) from fftt_private.players where event_id = p_event_id) >= 64 then
        perform fftt_private.v3_err('conflict','roster-full');
      end if;
      if exists (select 1 from fftt_private.players where event_id = p_event_id and lower(display_name) = lower(v_name)) then
        perform fftt_private.v3_err('conflict','duplicate-name');
      end if;
      insert into fftt_private.players(event_id, display_name, rating, rating_status)
      values (p_event_id, v_name, v_rating, v_status);
      v_added := v_added + 1;
    else
      select * into v_existing from fftt_private.players where event_id = p_event_id and id = v_id for update;
      if not found then perform fftt_private.v3_err('notfound','player'); end if;
      if exists (select 1 from fftt_private.players where event_id = p_event_id and id <> v_id and lower(display_name) = lower(v_name)) then
        perform fftt_private.v3_err('conflict','duplicate-name');
      end if;
      if v_existing.display_name <> v_name or v_existing.rating <> v_rating or v_existing.rating_status <> v_status then
        update fftt_private.players set display_name = v_name, rating = v_rating, rating_status = v_status
         where event_id = p_event_id and id = v_id;
        v_changed := v_changed + 1;
      end if;
    end if;
  end loop;
  -- within one call a name may not repeat either
  if (select pg_catalog.count(*) - pg_catalog.count(distinct lower(display_name)) from fftt_private.players where event_id = p_event_id) > 0 then
    perform fftt_private.v3_err('conflict','duplicate-name');
  end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'player_changed', null, null,
    pg_catalog.jsonb_build_object('added', v_added, 'changed', v_changed), null, v_rev);
  return pg_catalog.jsonb_build_object('status','saved','added', v_added,'changed', v_changed,'event_revision', v_rev);
end;
$f$;

create function fftt_private.remove_player_v3(p_event_id uuid, p_player_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_rev bigint;
begin
  perform fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if not exists (select 1 from fftt_private.players where event_id = p_event_id and id = p_player_id) then
    perform fftt_private.v3_err('notfound','player');
  end if;
  if exists (select 1 from fftt_private.matches where event_id = p_event_id
              and (player_1_id = p_player_id or player_2_id = p_player_id or winner_id = p_player_id))
     or exists (select 1 from fftt_private.doubles_finale where event_id = p_event_id and p_player_id in
                (championship_finalist_1, championship_finalist_2, consolation_partner_1, consolation_partner_2)) then
    perform fftt_private.v3_err('conflict','player-in-bracket');
  end if;
  delete from fftt_private.consolation_reviews where event_id = p_event_id and player_id = p_player_id;
  delete from fftt_private.players where event_id = p_event_id and id = p_player_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'player_changed', null, null,
    pg_catalog.jsonb_build_object('removed', 1), null, v_rev);
  return pg_catalog.jsonb_build_object('status','removed','event_revision', v_rev);
end;
$f$;

create function fftt_private.set_checkin_v3(p_event_id uuid, p_player_id uuid, p_checked_in boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_rev bigint; v_old boolean;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
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

-- Bulk check-in / check-out. p_player_ids null = every player in the event.
create function fftt_private.set_checkin_bulk_v3(p_event_id uuid, p_player_ids jsonb, p_checked_in boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_ids uuid[]; v_n integer; v_rev bigint; v_el jsonb;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if p_checked_in is null then perform fftt_private.v3_err('validation','checkin'); end if;
  if p_player_ids is null or pg_catalog.jsonb_typeof(p_player_ids) = 'null' then
    select pg_catalog.array_agg(id) into v_ids from fftt_private.players where event_id = p_event_id;
  else
    if pg_catalog.jsonb_typeof(p_player_ids) <> 'array' or pg_catalog.jsonb_array_length(p_player_ids) > 64 then
      perform fftt_private.v3_err('validation','players');
    end if;
    v_ids := '{}';
    for v_el in select * from pg_catalog.jsonb_array_elements(p_player_ids) loop
      if pg_catalog.jsonb_typeof(v_el) <> 'string' or (v_el #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        perform fftt_private.v3_err('validation','player-id');
      end if;
      v_ids := v_ids || (v_el #>> '{}')::uuid;
    end loop;
    if (select pg_catalog.count(*) from fftt_private.players where event_id = p_event_id and id = any(v_ids))
       <> (select pg_catalog.count(distinct x) from pg_catalog.unnest(v_ids) x) then
      perform fftt_private.v3_err('notfound','player');
    end if;
  end if;
  v_ids := coalesce(v_ids, '{}');
  if not p_checked_in and exists (
       select 1 from fftt_private.matches where event_id = p_event_id and generation = v_event.bracket_generation
          and (player_1_id = any(v_ids) or player_2_id = any(v_ids))) then
    perform fftt_private.v3_err('conflict','player-in-bracket');
  end if;
  update fftt_private.players set checked_in = p_checked_in
   where event_id = p_event_id and id = any(v_ids) and checked_in is distinct from p_checked_in;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return pg_catalog.jsonb_build_object('status','unchanged','changed',0,'event_revision', v_event.revision);
  end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'checkin_changed', null, null,
    pg_catalog.jsonb_build_object('checked_in', p_checked_in, 'players', v_n), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','changed', v_n,'event_revision', v_rev);
end;
$f$;

-- ---------------------------------------------------------------- brackets
create function fftt_private.build_championship_v3(p_event_id uuid, p_slots jsonb,
                                                   p_expected_generation integer, p_confirm boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_slots uuid[]; v_allowed uuid[]; v_gen integer;
  v_rebuild boolean; v_done integer; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if p_expected_generation is null or p_expected_generation <> v_event.bracket_generation then
    perform fftt_private.v3_err('stale','generation');
  end if;
  select pg_catalog.array_agg(id) into v_allowed from fftt_private.players where event_id = p_event_id and checked_in;
  v_slots := fftt_private.v3_parse_slots(p_slots, coalesce(v_allowed, '{}'), true);
  v_rebuild := v_event.bracket_generation > 0;
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

create function fftt_private.build_consolation_v3(p_event_id uuid, p_slots jsonb,
                                                  p_expected_generation integer, p_confirm boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_slots uuid[]; v_allowed uuid[]; v_champ uuid; v_old uuid;
  v_pending integer; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['active']);
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

-- ---------------------------------------------------------------- match operations
create function fftt_private.assign_table_v3(p_event_id uuid, p_match_id uuid, p_table_number integer)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','scorekeeper'], array['active']);
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

-- A no-show: the opponent advances (reusing the audited B2b engine with a blank score). Organizer only.
create function fftt_private.forfeit_match_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint,
                                              p_absent_player_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_winner uuid;
  v_reason text := pg_catalog.btrim(coalesce(p_reason,'')); v_resp jsonb; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['active']);
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

create function fftt_private.correct_result_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint,
                                               p_winner_id uuid, p_game_scores text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_next fftt_private.matches%rowtype;
  v_bracket fftt_private.brackets%rowtype; v_reason text := pg_catalog.btrim(coalesce(p_reason,''));
  v_scores text; v_best integer; v_old_winner uuid; v_new_loser uuid; v_changed boolean; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['active','complete']);
  if length(v_reason) not between 3 and 300 or v_reason ~ '[[:cntrl:]]' then perform fftt_private.v3_err('validation','reason'); end if;
  select * into v_match from fftt_private.matches
   where event_id = p_event_id and id = p_match_id and generation = v_event.bracket_generation for update;
  if not found then perform fftt_private.v3_err('notfound','match'); end if;
  if v_match.status <> 'complete' or v_match.match_version <> p_expected_match_version then
    perform fftt_private.v3_err('conflict','match-version');
  end if;
  if p_winner_id is null or p_winner_id not in (v_match.player_1_id, v_match.player_2_id) then perform fftt_private.v3_err('validation','winner'); end if;
  select * into v_bracket from fftt_private.brackets where id = v_match.bracket_id;
  v_best := case when v_bracket.kind = 'championship' and v_match.is_championship_final
                 then v_event.championship_final_best_of else v_event.regular_best_of end;
  v_scores := fftt_private.v3_normalize_scores(p_game_scores, v_best, p_winner_id = v_match.player_1_id);
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
      -- the previous loser is now the winner: they are no longer a first-loss consolation candidate here
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

-- ---------------------------------------------------------------- Mixed-Skill Doubles finale
create function fftt_private.set_doubles_teams_v3(p_event_id uuid, p_partner_1 uuid, p_partner_2 uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_final fftt_private.matches%rowtype; v_has_consolation boolean; v_rev bigint;
  v_existing fftt_private.doubles_finale%rowtype;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['active']);
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

create function fftt_private.record_doubles_result_v3(p_event_id uuid, p_winner_team integer, p_game_scores text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; d fftt_private.doubles_finale%rowtype; v_scores text; v_role text; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer','scorekeeper'], array['active','complete']);
  v_role := fftt_private.staff_role_for_event(p_event_id);
  select * into d from fftt_private.doubles_finale where event_id = p_event_id for update;
  if not found or d.consolation_partner_1 is null or d.consolation_partner_2 is null then perform fftt_private.v3_err('conflict','teams-not-set'); end if;
  if p_winner_team not in (1,2) then perform fftt_private.v3_err('validation','winner-team'); end if;
  v_scores := fftt_private.v3_normalize_scores(p_game_scores, v_event.regular_best_of, p_winner_team = 1);
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
    pg_catalog.jsonb_build_object('winner_team', p_winner_team, 'game_scores', v_scores), null, v_rev);
  return pg_catalog.jsonb_build_object('status','recorded','event_revision', v_rev);
end;
$f$;

-- ---------------------------------------------------------------- staff (by e-mail, existing accounts only)
-- Same safeguards as the audited B2d function (no self-change, only verified, non-banned, non-anonymous
-- accounts, serialized with scoring, audited) — but it also works after an event is COMPLETE, because
-- access must always be revocable. There is no account creation here: the account must already exist.
create function fftt_private.set_staff_v3(p_event_id uuid, p_email text, p_action text, p_role text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_actor uuid; v_uid uuid; v_old fftt_private.event_staff%rowtype;
  v_has boolean; v_rev bigint; v_email text := lower(pg_catalog.btrim(coalesce(p_email,'')));
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active','complete']);
  v_actor := auth.uid();
  if p_action not in ('grant','revoke') or (p_action = 'grant' and p_role not in ('organizer','scorekeeper')) then
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

-- ---------------------------------------------------------------- organizer reads
create function fftt_private.organizer_snapshot_v3(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $f$
declare e fftt_private.events%rowtype;
begin
  select * into e from fftt_private.events where id = p_event_id and synthetic_only = true;
  if fftt_private.staff_role_for_event(p_event_id) <> 'organizer' then perform fftt_private.v3_err('forbidden'); end if;
  return pg_catalog.jsonb_build_object(
    'event', pg_catalog.jsonb_build_object('event_id', e.id, 'name', e.event_name, 'date', e.event_date,
       'lifecycle', e.lifecycle, 'tables', e.table_count, 'generation', e.bracket_generation,
       'revision', e.revision, 'public_visible', e.public_visible,
       'regular_best_of', e.regular_best_of, 'final_best_of', e.championship_final_best_of),
    'players', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'name', p.display_name, 'rating', p.rating, 'rating_status', p.rating_status,
        'checked_in', p.checked_in, 'first_champ_loss', p.first_champ_loss) order by lower(p.display_name))
        from fftt_private.players p where p.event_id = e.id), '[]'::jsonb),
    'brackets', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'kind', b.kind, 'status', b.status) order by b.kind)
        from fftt_private.brackets b where b.event_id = e.id and b.generation = e.bracket_generation
         and b.status in ('active','complete')), '[]'::jsonb),
    'matches', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', m.id, 'bracket', b.kind, 'code', m.match_code, 'round', m.round_number, 'slot', m.slot,
        'player_1_id', m.player_1_id, 'player_2_id', m.player_2_id, 'winner_id', m.winner_id,
        'status', m.status, 'game_scores', m.game_scores, 'table', m.table_number,
        'version', m.match_version, 'is_final', m.is_championship_final, 'next_match_id', m.next_match_id)
        order by b.kind, m.round_number, m.slot)
        from fftt_private.matches m join fftt_private.brackets b on b.id = m.bracket_id
        where m.event_id = e.id and m.generation = e.bracket_generation and b.status in ('active','complete')), '[]'::jsonb),
    'consolation_candidates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'player_id', r.player_id, 'state', r.review_state, 'first_loss_match_id', r.first_loss_match_id))
        from fftt_private.consolation_reviews r where r.event_id = e.id), '[]'::jsonb),
    'doubles', (select pg_catalog.jsonb_build_object(
        'finalist_1', d.championship_finalist_1, 'finalist_2', d.championship_finalist_2,
        'partner_1', d.consolation_partner_1, 'partner_2', d.consolation_partner_2,
        'winner_team', d.winner_team, 'game_scores', d.game_scores)
        from fftt_private.doubles_finale d where d.event_id = e.id),
    'staff', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', s.user_id, 'email', u.email, 'role', s.role, 'active', s.active) order by u.email)
        from fftt_private.event_staff s join auth.users u on u.id = s.user_id
        where s.event_id = e.id), '[]'::jsonb));
end;
$f$;

-- Minimal event facts for ANY staff role (a scorekeeper needs the table count; no roster, ratings or staff).
create function fftt_private.event_brief_v3(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $f$
declare e fftt_private.events%rowtype;
begin
  select * into e from fftt_private.events where id = p_event_id and synthetic_only = true;
  perform fftt_private.staff_role_for_event(p_event_id);
  return pg_catalog.jsonb_build_object('event_id', e.id, 'name', e.event_name, 'date', e.event_date,
    'tables', e.table_count, 'lifecycle', e.lifecycle, 'generation', e.bracket_generation, 'revision', e.revision);
end;
$f$;

create function fftt_private.audit_log_v3(p_event_id uuid, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $f$
begin
  if fftt_private.staff_role_for_event(p_event_id) <> 'organizer' then perform fftt_private.v3_err('forbidden'); end if;
  if p_limit is null or p_limit not between 1 and 200 then perform fftt_private.v3_err('validation','limit'); end if;
  return coalesce((select pg_catalog.jsonb_agg(x order by x ->> 'at' desc) from (
    select pg_catalog.jsonb_build_object('operation', a.operation, 'match_id', a.match_id, 'actor_id', a.actor_id,
      'reason', a.reason, 'before', a.before_state, 'after', a.after_state, 'revision', a.event_revision,
      'at', a.created_at) as x
      from fftt_private.audit_events a where a.event_id = p_event_id
     order by a.created_at desc, a.id desc limit p_limit) t), '[]'::jsonb);
end;
$f$;

-- Private backup/export of everything the organizer may see, including internal ratings. Never public.
create function fftt_private.export_event_v3(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $f$
declare v_snap jsonb;
begin
  v_snap := fftt_private.organizer_snapshot_v3(p_event_id);
  return pg_catalog.jsonb_build_object(
    'format', 'fftt-event-export-v3', 'exported_at', now(), 'synthetic_only', true,
    'snapshot', v_snap,
    'audit', fftt_private.audit_log_v3(p_event_id, 200),
    'score_decisions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'submission_id', d.submission_id, 'actor_id', d.actor_id, 'match_id', d.match_id, 'status', d.status,
        'reason', d.reason, 'event_revision', d.event_revision, 'decided_at', d.decided_at) order by d.decided_at)
        from fftt_private.score_decisions_v2 d where d.event_id = p_event_id), '[]'::jsonb));
end;
$f$;

-- ---------------------------------------------------------------- grants + public wrappers
do $grants$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'fftt_private'
             and p.proname in ('create_event_v3','my_events_v3','update_event_v3','set_lifecycle_v3','set_visibility_v3',
               'upsert_players_v3','remove_player_v3','set_checkin_v3','set_checkin_bulk_v3','build_championship_v3','build_consolation_v3',
               'assign_table_v3','forfeit_match_v3','correct_result_v3','set_doubles_teams_v3','record_doubles_result_v3',
               'set_staff_v3','organizer_snapshot_v3','audit_log_v3','export_event_v3','event_brief_v3')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  -- helpers stay unreachable from every API role (callable only by the definer functions above)
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'fftt_private'
             and p.proname in ('v3_err','v3_begin','v3_bump','v3_audit','v3_normalize_scores','v3_refresh_public',
               'v3_events_publish_trigger','v3_create_bracket','v3_parse_slots')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$grants$;

create function public.fftt_create_event_v3(p_name text, p_date date, p_table_count integer)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.create_event_v3(p_name, p_date, p_table_count); $f$;
create function public.fftt_my_events_v3()
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.my_events_v3(); $f$;
create function public.fftt_update_event_v3(p_event_id uuid, p_name text, p_date date, p_table_count integer)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.update_event_v3(p_event_id, p_name, p_date, p_table_count); $f$;
create function public.fftt_set_lifecycle_v3(p_event_id uuid, p_lifecycle text)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_lifecycle_v3(p_event_id, p_lifecycle); $f$;
create function public.fftt_set_visibility_v3(p_event_id uuid, p_visible boolean)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_visibility_v3(p_event_id, p_visible); $f$;
create function public.fftt_upsert_players_v3(p_event_id uuid, p_players jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.upsert_players_v3(p_event_id, p_players); $f$;
create function public.fftt_remove_player_v3(p_event_id uuid, p_player_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.remove_player_v3(p_event_id, p_player_id); $f$;
create function public.fftt_set_checkin_v3(p_event_id uuid, p_player_id uuid, p_checked_in boolean)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_checkin_v3(p_event_id, p_player_id, p_checked_in); $f$;
create function public.fftt_set_checkin_bulk_v3(p_event_id uuid, p_player_ids jsonb, p_checked_in boolean)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_checkin_bulk_v3(p_event_id, p_player_ids, p_checked_in); $f$;
create function public.fftt_build_championship_v3(p_event_id uuid, p_slots jsonb, p_expected_generation integer, p_confirm boolean default false)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.build_championship_v3(p_event_id, p_slots, p_expected_generation, p_confirm); $f$;
create function public.fftt_build_consolation_v3(p_event_id uuid, p_slots jsonb, p_expected_generation integer, p_confirm boolean default false)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.build_consolation_v3(p_event_id, p_slots, p_expected_generation, p_confirm); $f$;
create function public.fftt_assign_table_v3(p_event_id uuid, p_match_id uuid, p_table_number integer)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.assign_table_v3(p_event_id, p_match_id, p_table_number); $f$;
create function public.fftt_forfeit_match_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint, p_absent_player_id uuid, p_reason text)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.forfeit_match_v3(p_event_id, p_match_id, p_expected_match_version, p_absent_player_id, p_reason); $f$;
create function public.fftt_correct_result_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint, p_winner_id uuid, p_game_scores text, p_reason text)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.correct_result_v3(p_event_id, p_match_id, p_expected_match_version, p_winner_id, p_game_scores, p_reason); $f$;
create function public.fftt_set_doubles_teams_v3(p_event_id uuid, p_partner_1 uuid, p_partner_2 uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_doubles_teams_v3(p_event_id, p_partner_1, p_partner_2); $f$;
create function public.fftt_record_doubles_result_v3(p_event_id uuid, p_winner_team integer, p_game_scores text)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.record_doubles_result_v3(p_event_id, p_winner_team, p_game_scores); $f$;
create function public.fftt_set_staff_v3(p_event_id uuid, p_email text, p_action text, p_role text)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_staff_v3(p_event_id, p_email, p_action, p_role); $f$;
create function public.fftt_organizer_snapshot_v3(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.organizer_snapshot_v3(p_event_id); $f$;
create function public.fftt_event_brief_v3(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.event_brief_v3(p_event_id); $f$;
create function public.fftt_audit_log_v3(p_event_id uuid, p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.audit_log_v3(p_event_id, p_limit); $f$;
create function public.fftt_export_event_v3(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.export_event_v3(p_event_id); $f$;

do $wrap$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fftt\_%\_v3' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$wrap$;

-- ---------------------------------------------------------------- anonymous public read model
create view public.fftt_public_tournament_v1 with (security_invoker = true) as
select e.event_id, e.event_name, e.event_date, e.status, e.public_revision as revision,
       e.table_count as tables, e.updated_at, e.finale,
       coalesce((
         select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.bracket, 'matches', g.matches) order by g.bracket)
           from (select m.bracket,
                   pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                     'match_id', m.match_id, 'bracket', m.bracket, 'round', m.round, 'slot', m.slot,
                     'player_1_name', m.player_1_name, 'player_2_name', m.player_2_name,
                     'winner_name', m.winner_name, 'game_scores', m.game_scores, 'status', m.status,
                     'table_number', m.table_number, 'phase', m.phase) order by m.round, m.slot) as matches
                   from public.fftt_published_matches m where m.event_id = e.event_id group by m.bracket) g
       ), '[]'::jsonb) as brackets
  from public.fftt_published_events e;
revoke all on public.fftt_public_tournament_v1 from public, anon, authenticated;
grant select on public.fftt_public_tournament_v1 to anon, authenticated;

commit;
