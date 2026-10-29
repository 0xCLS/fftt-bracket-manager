-- FFTT GAME-DAY TOURNAMENT V4 (SYNTHETIC STAGING). Additive: applies AFTER B1-B2d, the V2 scoring file and V3.
-- REVIEW CANDIDATE. NOT APPLIED to any hosted project. Applying it is a separate owner decision.
-- Fictional data only: fftt_private.events.synthetic_only stays CHECKed true.
--
-- Part A  Match formats. Best of 1 / Best of 3, games to 11 or 21, always won by two.
--         Defaults: Championship Bo3/11, Championship Final Bo3/11, Consolation Bo1/21, Consolation Final Bo1/21,
--         Mixed-Skill Doubles Finale Bo3/11. Best of 5 is NOT selectable for new configuration. Every match is
--         stamped with its own format when its bracket is built. A match whose stored format is NULL is a
--         pre-V4 (historical) match: its format resolves from the legacy event columns (regular Bo3, final Bo5,
--         games to 11). NO existing match, score, winner or event row is rewritten by this file.
--         Formats lock once a match (or, at event level, a format category) has a recorded result.
-- Part B  Registration and check-in support: roster provenance (manual / registration / walk-in), an opaque
--         registration reference (never a contact detail), rating confirmation, atomic bulk check-in with
--         reconciliation of a registrant against an existing roster player. Contact information is never stored.
-- Part C  Event management: archive restores to its previous state, and PERMANENT deletion of an empty draft
--         event only (organizer + platform organizer, typed confirmation). Deletion moves the event's audit
--         trail into an append-only tombstone; nothing historical is lost, and non-empty events cannot be deleted.
--
-- Every public.* wrapper is SECURITY INVOKER and authenticated-only. Replaced functions keep their grants.
begin;

-- ================================================================ schema evolution
alter table fftt_private.audit_events drop constraint audit_events_operation_check;
alter table fftt_private.audit_events add constraint audit_events_operation_check check (operation in (
  'result_accepted','result_corrected','bracket_built','bracket_rebuilt','consolation_reviewed',
  'staff_grant_changed','event_created','event_updated','player_changed','checkin_changed',
  'table_assigned','match_forfeited','doubles_updated','doubles_result','lifecycle_changed',
  'visibility_changed','format_changed','registration_checkin','rating_confirmed','event_restored'));

alter table fftt_private.events
  add column champ_best_of smallint not null default 3 check (champ_best_of in (1,3)),
  add column champ_points smallint not null default 11 check (champ_points in (11,21)),
  add column champ_final_best_of smallint not null default 3 check (champ_final_best_of in (1,3)),
  add column champ_final_points smallint not null default 11 check (champ_final_points in (11,21)),
  add column cons_best_of smallint not null default 1 check (cons_best_of in (1,3)),
  add column cons_points smallint not null default 21 check (cons_points in (11,21)),
  add column cons_final_best_of smallint not null default 1 check (cons_final_best_of in (1,3)),
  add column cons_final_points smallint not null default 21 check (cons_final_points in (11,21)),
  add column doubles_best_of smallint not null default 3 check (doubles_best_of in (1,3)),
  add column doubles_points smallint not null default 11 check (doubles_points in (11,21)),
  add column archived_from text check (archived_from in ('draft','active','complete'));

-- NULL = historical (pre-V4) match; both NULL or both set.
alter table fftt_private.matches
  add column best_of smallint check (best_of in (1,3)),
  add column points_to_win smallint check (points_to_win in (11,21)),
  add constraint matches_format_pair check ((best_of is null) = (points_to_win is null));

alter table fftt_private.players
  add column source text not null default 'manual' check (source in ('manual','registration','walk_in')),
  add column rating_confirmed boolean not null default true;

-- Opaque registration references (made server-side from a registration row; they hold NO contact detail) that
-- belong to a roster player. One player may hold several (a duplicate submission merged into one person).
create table fftt_private.registration_links (
  event_id uuid not null,
  ref text not null check (ref ~ '^[A-Za-z0-9_-]{16,64}$'),
  player_id uuid not null,
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (event_id, ref),
  foreign key (event_id, player_id) references fftt_private.players(event_id, id) on delete cascade
);
create index registration_links_player_idx on fftt_private.registration_links (event_id, player_id);
alter table fftt_private.registration_links enable row level security;
revoke all on fftt_private.registration_links from public, anon, authenticated;

alter table public.fftt_published_matches
  add column best_of smallint,
  add column points_to_win smallint;

-- Tombstones of permanently deleted empty draft events (append-only; organizer-visible through no API).
create table fftt_private.deleted_events (
  event_id uuid primary key,
  public_id uuid not null,
  event_name text not null,
  event_date date not null,
  created_by uuid,
  deleted_by uuid not null,
  deleted_at timestamptz not null default now(),
  audit jsonb not null,
  staff jsonb not null
);
alter table fftt_private.deleted_events enable row level security;
revoke all on fftt_private.deleted_events from public, anon, authenticated;
create trigger fftt_deleted_events_append_only before update or delete
on fftt_private.deleted_events for each row execute function fftt_private.reject_audit_mutation();

-- The audit trail stays append-only. The single exception is the controlled removal of an EMPTY draft event's
-- own audit rows, which is allowed only inside delete_event_v4 after the same rows were copied into the
-- tombstone above (the function sets a transaction-local marker that API roles cannot set).
create or replace function fftt_private.reject_audit_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and tg_table_name = 'audit_events'
     and pg_catalog.current_setting('fftt.deleting_event', true) = old.event_id::text
     and exists (select 1 from fftt_private.deleted_events d where d.event_id = old.event_id) then
    return old;
  end if;
  raise exception 'FFTT audit entries are append-only' using errcode = '42501';
end;
$$;

-- ================================================================ Part A: formats (private helpers)
-- Effective format of one match: its own stamp, else the historical rule.
create function fftt_private.v4_match_format(p_event_id uuid, p_match_id uuid)
returns table (best_of integer, points integer, legacy boolean)
language sql stable security definer set search_path = ''
as $f$
  select coalesce(m.best_of,
           case when b.kind = 'championship' and m.is_championship_final
                then e.championship_final_best_of else e.regular_best_of end)::integer,
         coalesce(m.points_to_win, 11)::integer,
         m.best_of is null
    from fftt_private.matches m
    join fftt_private.events e on e.id = m.event_id
    join fftt_private.brackets b on b.id = m.bracket_id
   where m.event_id = p_event_id and m.id = p_match_id;
$f$;

-- Game-score rules for any odd best-of and 11/21 points: win by two, exactly two after the target is passed.
-- Blank is allowed (winner only). Returns the normalized "11-8, 9-11, 11-7" text.
create function fftt_private.v4_normalize_scores(p_scores text, p_best_of integer, p_points integer, p_p1_won boolean)
returns text language plpgsql immutable set search_path = ''
as $f$
declare
  v_needed integer := (p_best_of + 1) / 2;
  v_games text[]; v_pair text[]; v_a integer; v_b integer;
  v_w1 integer := 0; v_w2 integer := 0; v_out text := ''; v_i integer;
begin
  if p_scores is null or length(p_scores) > 128 or p_points is null or p_points < 2 then
    perform fftt_private.v3_err('validation','scores');
  end if;
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
    if greatest(v_a, v_b) < p_points or pg_catalog.abs(v_a - v_b) < 2
       or (greatest(v_a, v_b) > p_points and pg_catalog.abs(v_a - v_b) <> 2) then
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

-- Which format category a match belongs to (for the current generation).
create function fftt_private.v4_match_category(p_kind text, p_next_match_id uuid)
returns text language sql immutable set search_path = ''
as $f$
  select case when p_kind = 'championship' then (case when p_next_match_id is null then 'champ_final' else 'champ' end)
              else (case when p_next_match_id is null then 'cons_final' else 'cons' end) end;
$f$;

-- ================================================================ Part A: score engine (same signature; formats per match)
-- Replaces the B2b function body. Everything but the format lookup and the score validation is unchanged:
-- the V2 wrapper still serializes, records the decision and calls this function.
create or replace function fftt_private.submit_match_result_v1(
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
   where id=p_event_id and synthetic_only=true for update;
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
        and prior.id<>v_match.id and prior.status='complete'
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
$fn$;

-- ================================================================ Part A: bracket construction stamps formats
create or replace function fftt_private.v3_create_bracket(p_event_id uuid, p_generation integer, p_kind text, p_slots uuid[])
returns uuid language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_size integer := pg_catalog.array_length(p_slots, 1);
  v_rounds integer := 0; v_n integer := 1;
  v_bracket uuid; v_r integer; v_i integer; v_count integer;
  m record; a record; b record;
  v_p1 uuid; v_p2 uuid; v_ready boolean;
  e fftt_private.events%rowtype;
  v_bo smallint; v_pts smallint;
begin
  while v_n < v_size loop v_n := v_n * 2; v_rounds := v_rounds + 1; end loop;
  if v_n <> v_size or v_size < 2 or v_size > 64 then perform fftt_private.v3_err('validation','slots-size'); end if;
  select * into e from fftt_private.events where id = p_event_id;

  insert into fftt_private.brackets(event_id, generation, kind, status, consolation_review_completed, created_by)
  values (p_event_id, p_generation, p_kind, 'active', p_kind = 'consolation', auth.uid())
  returning id into v_bracket;

  for v_r in 0..v_rounds - 1 loop
    v_count := v_size / (2 ^ (v_r + 1))::integer;
    if p_kind = 'championship' then
      if v_r = v_rounds - 1 then v_bo := e.champ_final_best_of; v_pts := e.champ_final_points;
      else v_bo := e.champ_best_of; v_pts := e.champ_points; end if;
    else
      if v_r = v_rounds - 1 then v_bo := e.cons_final_best_of; v_pts := e.cons_final_points;
      else v_bo := e.cons_best_of; v_pts := e.cons_points; end if;
    end if;
    for v_i in 0..v_count - 1 loop
      insert into fftt_private.matches(event_id, bracket_id, generation, match_code, round_number, slot,
                                       is_championship_final, best_of, points_to_win)
      values (p_event_id, v_bracket, p_generation, 'C-' || v_r || '-' || v_i, v_r, v_i,
              p_kind = 'championship' and v_r = v_rounds - 1, v_bo, v_pts);
    end loop;
  end loop;

  update fftt_private.matches mm set next_match_id = n.id, next_match_slot = (mm.slot % 2) + 1
    from fftt_private.matches n
   where mm.bracket_id = v_bracket and n.bracket_id = v_bracket
     and n.round_number = mm.round_number + 1 and n.slot = mm.slot / 2;

  for v_i in 0..(v_size / 2) - 1 loop
    update fftt_private.matches set player_1_id = p_slots[2 * v_i + 1], player_2_id = p_slots[2 * v_i + 2]
     where bracket_id = v_bracket and round_number = 0 and slot = v_i;
  end loop;

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

-- ================================================================ Part A: corrections and doubles use the match's format
create or replace function fftt_private.correct_result_v3(p_event_id uuid, p_match_id uuid, p_expected_match_version bigint,
                                                          p_winner_id uuid, p_game_scores text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_next fftt_private.matches%rowtype;
  v_bracket fftt_private.brackets%rowtype; v_reason text := pg_catalog.btrim(coalesce(p_reason,''));
  v_scores text; v_best integer; v_points integer; v_old_winner uuid; v_new_loser uuid; v_changed boolean; v_rev bigint;
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

create or replace function fftt_private.record_doubles_result_v3(p_event_id uuid, p_winner_team integer, p_game_scores text)
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

-- ================================================================ Part A: configuration RPCs
-- p_formats: {"champ":{"best_of":3,"points":11}, "champ_final":..., "cons":..., "cons_final":..., "doubles":...}
-- Any subset. Allowed: best_of 1 or 3, points 11 or 21. A category that already has a recorded result is locked.
-- Pending matches of a changed category are re-stamped (their organizer overrides are replaced).
create function fftt_private.set_formats_v4(p_event_id uuid, p_formats jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_key text; v_val jsonb; v_bo integer; v_pts integer;
  v_before jsonb := '{}'::jsonb; v_after jsonb := '{}'::jsonb; v_cur_bo integer; v_cur_pts integer;
  v_changed text[] := '{}'; v_rev bigint; v_locked boolean;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if p_formats is null or pg_catalog.jsonb_typeof(p_formats) <> 'object' or p_formats = '{}'::jsonb then
    perform fftt_private.v3_err('validation','formats');
  end if;
  for v_key, v_val in select * from pg_catalog.jsonb_each(p_formats) loop
    if v_key not in ('champ','champ_final','cons','cons_final','doubles') then perform fftt_private.v3_err('validation','formats'); end if;
    if pg_catalog.jsonb_typeof(v_val) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(v_val) k where k not in ('best_of','points'))
       or coalesce(pg_catalog.jsonb_typeof(v_val -> 'best_of'), '') <> 'number'
       or coalesce(pg_catalog.jsonb_typeof(v_val -> 'points'), '') <> 'number'
       or coalesce(v_val ->> 'best_of', '') !~ '^[13]$' or coalesce(v_val ->> 'points', '') !~ '^(11|21)$' then
      perform fftt_private.v3_err('validation','format-value');
    end if;
    v_bo := (v_val ->> 'best_of')::integer; v_pts := (v_val ->> 'points')::integer;
    select case v_key when 'champ' then v_event.champ_best_of when 'champ_final' then v_event.champ_final_best_of
                      when 'cons' then v_event.cons_best_of when 'cons_final' then v_event.cons_final_best_of
                      else v_event.doubles_best_of end,
           case v_key when 'champ' then v_event.champ_points when 'champ_final' then v_event.champ_final_points
                      when 'cons' then v_event.cons_points when 'cons_final' then v_event.cons_final_points
                      else v_event.doubles_points end
      into v_cur_bo, v_cur_pts;
    if v_cur_bo = v_bo and v_cur_pts = v_pts then continue; end if;

    -- lock: a recorded result in this category (current generation), or a recorded doubles result
    if v_key = 'doubles' then
      v_locked := exists (select 1 from fftt_private.doubles_finale where event_id = p_event_id and winner_team is not null);
    else
      v_locked := exists (
        select 1 from fftt_private.matches m join fftt_private.brackets b on b.id = m.bracket_id
         where m.event_id = p_event_id and m.generation = v_event.bracket_generation
           and b.status in ('active','complete') and m.status = 'complete'
           and fftt_private.v4_match_category(b.kind, m.next_match_id) = v_key);
    end if;
    if v_locked then perform fftt_private.v3_err('conflict','format-locked'); end if;

    v_before := v_before || pg_catalog.jsonb_build_object(v_key, pg_catalog.jsonb_build_object('best_of', v_cur_bo, 'points', v_cur_pts));
    v_after := v_after || pg_catalog.jsonb_build_object(v_key, pg_catalog.jsonb_build_object('best_of', v_bo, 'points', v_pts));
    v_changed := v_changed || v_key;
    case v_key
      when 'champ' then update fftt_private.events set champ_best_of = v_bo, champ_points = v_pts where id = p_event_id;
      when 'champ_final' then update fftt_private.events set champ_final_best_of = v_bo, champ_final_points = v_pts where id = p_event_id;
      when 'cons' then update fftt_private.events set cons_best_of = v_bo, cons_points = v_pts where id = p_event_id;
      when 'cons_final' then update fftt_private.events set cons_final_best_of = v_bo, cons_final_points = v_pts where id = p_event_id;
      else update fftt_private.events set doubles_best_of = v_bo, doubles_points = v_pts where id = p_event_id;
    end case;
    if v_key <> 'doubles' then
      update fftt_private.matches m set best_of = v_bo, points_to_win = v_pts, updated_at = now()
        from fftt_private.brackets b
       where b.id = m.bracket_id and m.event_id = p_event_id and m.generation = v_event.bracket_generation
         and b.status in ('active','complete') and m.status in ('pending','bye','empty')
         and fftt_private.v4_match_category(b.kind, m.next_match_id) = v_key;
    end if;
  end loop;
  if pg_catalog.cardinality(v_changed) = 0 then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
  end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'format_changed', null, v_before, v_after, null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','changed', pg_catalog.cardinality(v_changed), 'event_revision', v_rev);
end;
$f$;

-- One match, before any result: organizer override. Version is NOT bumped (like a table move); a score that was
-- prepared under the old format is refused by the server's own validation, never silently accepted.
create function fftt_private.set_match_format_v4(p_event_id uuid, p_match_id uuid, p_best_of integer, p_points integer)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_match fftt_private.matches%rowtype; v_cur record; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['active']);
  if p_best_of is null or p_best_of not in (1,3) or p_points is null or p_points not in (11,21) then
    perform fftt_private.v3_err('validation','format-value');
  end if;
  select * into v_match from fftt_private.matches
   where event_id = p_event_id and id = p_match_id and generation = v_event.bracket_generation for update;
  if not found then perform fftt_private.v3_err('notfound','match'); end if;
  if v_match.status <> 'pending' then perform fftt_private.v3_err('conflict','format-locked'); end if;
  select f.best_of, f.points into v_cur from fftt_private.v4_match_format(p_event_id, p_match_id) f;
  if v_cur.best_of = p_best_of and v_cur.points = p_points and v_match.best_of is not null then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
  end if;
  update fftt_private.matches set best_of = p_best_of, points_to_win = p_points, updated_at = now()
   where event_id = p_event_id and id = p_match_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'format_changed', p_match_id,
    pg_catalog.jsonb_build_object('best_of', v_cur.best_of, 'points', v_cur.points),
    pg_catalog.jsonb_build_object('best_of', p_best_of, 'points', p_points), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','event_revision', v_rev);
end;
$f$;

-- ================================================================ Part A: Match Desk with formats (v1 is left untouched)
create function fftt_private.matchdesk_for_event_v2(p_event_id uuid)
returns table (
  event_id uuid, bracket_generation integer, match_id uuid, match_code text, match_version bigint,
  bracket text, round_number integer, slot integer, player_1_id uuid, player_2_id uuid,
  player_1_name text, player_2_name text, is_championship_final boolean, table_number smallint,
  best_of integer, points_to_win integer
)
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  perform fftt_private.staff_role_for_event(p_event_id);
  return query
    select e.id, e.bracket_generation, m.id, m.match_code, m.match_version, b.kind, m.round_number, m.slot,
           m.player_1_id, m.player_2_id, p1.display_name, p2.display_name, m.is_championship_final, m.table_number,
           f.best_of, f.points
      from fftt_private.events e
      join fftt_private.brackets b on b.event_id = e.id and b.generation = e.bracket_generation and b.status = 'active'
      join fftt_private.matches m on m.event_id = e.id and m.bracket_id = b.id and m.generation = e.bracket_generation
      join fftt_private.players p1 on p1.event_id = e.id and p1.id = m.player_1_id
      join fftt_private.players p2 on p2.event_id = e.id and p2.id = m.player_2_id
      cross join lateral fftt_private.v4_match_format(e.id, m.id) f
     where e.id = p_event_id and e.lifecycle = 'active' and m.status = 'pending'
     order by b.kind, m.round_number, m.slot;
end;
$fn$;

-- ================================================================ Part A: public projection carries formats
create or replace function fftt_private.v3_refresh_public(p_event_id uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $f$
declare
  e fftt_private.events%rowtype;
  v_finale jsonb := null;
  d fftt_private.doubles_finale%rowtype;
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
      'game_scores', d.game_scores,
      'best_of', e.doubles_best_of,
      'points_to_win', e.doubles_points);
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
                                            table_number, phase, best_of, points_to_win)
  select e.public_id,
         pg_catalog.lower(b.kind || '-' || m.match_code),
         b.kind, m.round_number, m.slot, p1.display_name, p2.display_name, w.display_name,
         m.game_scores, m.status, m.table_number,
         case when m.status <> 'pending' then 'done'
              when m.player_1_id is null or m.player_2_id is null then 'waiting'
              when m.table_number is not null then 'playing'
              else 'up_next' end,
         case when m.status in ('bye','empty') then null else f.best_of::smallint end,
         case when m.status in ('bye','empty') then null else f.points::smallint end
    from fftt_private.matches m
    join fftt_private.brackets b on b.id = m.bracket_id and b.event_id = m.event_id
         and b.generation = m.generation and b.status in ('active','complete')
    left join fftt_private.players p1 on p1.event_id = m.event_id and p1.id = m.player_1_id
    left join fftt_private.players p2 on p2.event_id = m.event_id and p2.id = m.player_2_id
    left join fftt_private.players w on w.event_id = m.event_id and w.id = m.winner_id
    cross join lateral fftt_private.v4_match_format(m.event_id, m.id) f
   where m.event_id = e.id and m.generation = e.bracket_generation;
end;
$f$;

create or replace view public.fftt_public_tournament_v1 with (security_invoker = true) as
select e.event_id, e.event_name, e.event_date, e.status, e.public_revision as revision,
       e.table_count as tables, e.updated_at, e.finale,
       coalesce((
         select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.bracket, 'matches', g.matches) order by g.bracket)
           from (select m.bracket,
                   pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                     'match_id', m.match_id, 'bracket', m.bracket, 'round', m.round, 'slot', m.slot,
                     'player_1_name', m.player_1_name, 'player_2_name', m.player_2_name,
                     'winner_name', m.winner_name, 'game_scores', m.game_scores, 'status', m.status,
                     'table_number', m.table_number, 'phase', m.phase,
                     'best_of', m.best_of, 'points_to_win', m.points_to_win) order by m.round, m.slot) as matches
                   from public.fftt_published_matches m where m.event_id = e.event_id group by m.bracket) g
       ), '[]'::jsonb) as brackets
  from public.fftt_published_events e;

-- ================================================================ Part A+B: organizer snapshot (formats, roster provenance)
create or replace function fftt_private.organizer_snapshot_v3(p_event_id uuid) returns jsonb
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
       'formats', pg_catalog.jsonb_build_object(
         'champ', pg_catalog.jsonb_build_object('best_of', e.champ_best_of, 'points', e.champ_points),
         'champ_final', pg_catalog.jsonb_build_object('best_of', e.champ_final_best_of, 'points', e.champ_final_points),
         'cons', pg_catalog.jsonb_build_object('best_of', e.cons_best_of, 'points', e.cons_points),
         'cons_final', pg_catalog.jsonb_build_object('best_of', e.cons_final_best_of, 'points', e.cons_final_points),
         'doubles', pg_catalog.jsonb_build_object('best_of', e.doubles_best_of, 'points', e.doubles_points))),
    'players', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'name', p.display_name, 'rating', p.rating, 'rating_status', p.rating_status,
        'checked_in', p.checked_in, 'first_champ_loss', p.first_champ_loss,
        'registration_refs', coalesce((select pg_catalog.jsonb_agg(l.ref order by l.ref)
            from fftt_private.registration_links l where l.event_id = p.event_id and l.player_id = p.id), '[]'::jsonb),
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
    'staff', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', s.user_id, 'email', u.email, 'role', s.role, 'active', s.active) order by u.email)
        from fftt_private.event_staff s join auth.users u on u.id = s.user_id
        where s.event_id = e.id), '[]'::jsonb));
end;
$f$;

-- ================================================================ Part B: registration and check-in
-- p_registrants: array (max 64) of {ref?, name, rating, rating_status?, source, link_player_id?, same_as_ref?,
--   rating_confirmed?}. source 'registration' needs a ref (an opaque server-made token); 'walk_in' has none.
--   * a ref already linked to a roster player   -> that player is (un)checked, nothing is created
--   * same_as_ref (an earlier element or an already-linked ref) -> this registration is a DUPLICATE of that
--                                                  person: its ref is linked to the same player
--   * link_player_id                              -> reconciles the registrant with an existing roster player
--                                                  (the ref is linked; that player's name and rating are NOT changed)
--   * otherwise                                   -> a new roster player is created
-- All or nothing. Contact details are never accepted: names that look like e-mail/phone are refused (as V3 does).
create function fftt_private.checkin_registrants_v4(p_event_id uuid, p_registrants jsonb, p_check_in boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_el jsonb; v_i integer; v_len integer;
  v_ref text; v_same text; v_name text; v_rating integer; v_status text; v_src text; v_conf boolean; v_link uuid;
  v_pid uuid; v_cur record; v_created integer := 0; v_linked integer := 0; v_existing integer := 0; v_checked integer := 0;
  v_rev bigint; v_in_bracket boolean;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if p_check_in is null then perform fftt_private.v3_err('validation','checkin'); end if;
  if p_registrants is null or pg_catalog.jsonb_typeof(p_registrants) <> 'array' then perform fftt_private.v3_err('validation','registrants'); end if;
  v_len := pg_catalog.jsonb_array_length(p_registrants);
  if v_len < 1 or v_len > 64 then perform fftt_private.v3_err('validation','players-count'); end if;
  for v_i in 0..v_len - 1 loop
    v_el := p_registrants -> v_i;
    if pg_catalog.jsonb_typeof(v_el) <> 'object' then perform fftt_private.v3_err('validation','player'); end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_el) k
                where k not in ('ref','name','rating','rating_status','source','link_player_id','same_as_ref','rating_confirmed')) then
      perform fftt_private.v3_err('validation','player-fields');
    end if;
    v_src := v_el ->> 'source';
    if v_src is null or v_src not in ('registration','walk_in') then perform fftt_private.v3_err('validation','player-source'); end if;
    v_ref := case when pg_catalog.jsonb_typeof(v_el -> 'ref') = 'string' then v_el ->> 'ref' else null end;
    v_same := case when pg_catalog.jsonb_typeof(v_el -> 'same_as_ref') = 'string' then v_el ->> 'same_as_ref' else null end;
    if (v_src = 'registration') <> (v_ref is not null) or (v_ref is not null and v_ref !~ '^[A-Za-z0-9_-]{16,64}$')
       or (v_same is not null and (v_ref is null or v_same !~ '^[A-Za-z0-9_-]{16,64}$' or v_same = v_ref)) then
      perform fftt_private.v3_err('validation','player-ref');
    end if;
    v_name := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_el ->> 'name', ''), '[[:space:]]+', ' ', 'g'));
    if length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]' or v_name ~ '@'
       or v_name ~ '[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9]' then
      perform fftt_private.v3_err('validation','player-name');
    end if;
    if coalesce(pg_catalog.jsonb_typeof(v_el -> 'rating'), '') <> 'number' or coalesce(v_el ->> 'rating', '') !~ '^[1-5]$' then perform fftt_private.v3_err('validation','player-rating'); end if;
    v_rating := (v_el ->> 'rating')::integer;
    v_status := coalesce(v_el ->> 'rating_status', 'provisional');
    if v_status not in ('provisional','established') then perform fftt_private.v3_err('validation','player-status'); end if;
    v_conf := case when pg_catalog.jsonb_typeof(v_el -> 'rating_confirmed') = 'boolean' then (v_el ->> 'rating_confirmed')::boolean
                   else v_src = 'walk_in' end;
    v_link := null;
    if v_el ? 'link_player_id' and pg_catalog.jsonb_typeof(v_el -> 'link_player_id') <> 'null' then
      if (v_el ->> 'link_player_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then perform fftt_private.v3_err('validation','player-id'); end if;
      if v_ref is null or v_same is not null then perform fftt_private.v3_err('validation','player-ref'); end if;
      v_link := (v_el ->> 'link_player_id')::uuid;
    end if;

    v_pid := null;
    if v_ref is not null then
      select player_id into v_pid from fftt_private.registration_links where event_id = p_event_id and ref = v_ref;
    end if;
    if v_pid is not null then
      v_existing := v_existing + 1;
    elsif v_same is not null then
      select player_id into v_pid from fftt_private.registration_links where event_id = p_event_id and ref = v_same;
      if v_pid is null then perform fftt_private.v3_err('notfound','player'); end if;
      insert into fftt_private.registration_links(event_id, ref, player_id, linked_by) values (p_event_id, v_ref, v_pid, auth.uid());
      v_linked := v_linked + 1;
    elsif v_link is not null then
      select * into v_cur from fftt_private.players where event_id = p_event_id and id = v_link for update;
      if not found then perform fftt_private.v3_err('notfound','player'); end if;
      insert into fftt_private.registration_links(event_id, ref, player_id, linked_by) values (p_event_id, v_ref, v_link, auth.uid());
      update fftt_private.players set source = case when source = 'manual' then 'registration' else source end
       where event_id = p_event_id and id = v_link;
      v_pid := v_link; v_linked := v_linked + 1;
    else
      if not p_check_in then perform fftt_private.v3_err('notfound','player'); end if;
      if (select pg_catalog.count(*) from fftt_private.players where event_id = p_event_id) >= 64 then
        perform fftt_private.v3_err('conflict','roster-full');
      end if;
      if exists (select 1 from fftt_private.players where event_id = p_event_id and lower(display_name) = lower(v_name)) then
        perform fftt_private.v3_err('conflict','duplicate-name');
      end if;
      insert into fftt_private.players(event_id, display_name, rating, rating_status, source, rating_confirmed)
      values (p_event_id, v_name, v_rating, v_status, v_src, v_conf) returning id into v_pid;
      if v_ref is not null then
        insert into fftt_private.registration_links(event_id, ref, player_id, linked_by) values (p_event_id, v_ref, v_pid, auth.uid());
      end if;
      v_created := v_created + 1;
    end if;

    select checked_in into v_cur from fftt_private.players where event_id = p_event_id and id = v_pid for update;
    if v_cur.checked_in is distinct from p_check_in then
      if not p_check_in then
        select exists (select 1 from fftt_private.matches where event_id = p_event_id and generation = v_event.bracket_generation
                          and (player_1_id = v_pid or player_2_id = v_pid)) into v_in_bracket;
        if v_in_bracket then perform fftt_private.v3_err('conflict','player-in-bracket'); end if;
      end if;
      update fftt_private.players set checked_in = p_check_in where event_id = p_event_id and id = v_pid;
      v_checked := v_checked + 1;
    end if;
  end loop;
  if (select pg_catalog.count(*) - pg_catalog.count(distinct lower(display_name)) from fftt_private.players where event_id = p_event_id) > 0 then
    perform fftt_private.v3_err('conflict','duplicate-name');
  end if;
  if v_created + v_linked + v_checked = 0 then
    return pg_catalog.jsonb_build_object('status','unchanged','created',0,'linked',0,'existing', v_existing,
      'changed',0,'event_revision', v_event.revision);
  end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'registration_checkin', null, null,
    pg_catalog.jsonb_build_object('created', v_created, 'linked', v_linked, 'existing', v_existing,
      'checked_in_changed', v_checked, 'check_in', p_check_in), null, v_rev);
  return pg_catalog.jsonb_build_object('status','saved','created', v_created,'linked', v_linked,'existing', v_existing,
    'changed', v_checked,'event_revision', v_rev);
end;
$f$;

-- Organizer confirmation of ratings: [{id, rating}] sets the level and marks it confirmed.
create function fftt_private.confirm_ratings_v4(p_event_id uuid, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_el jsonb; v_i integer; v_len integer; v_id uuid; v_rating integer;
  v_cur fftt_private.players%rowtype; v_changed integer := 0; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft','active']);
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then perform fftt_private.v3_err('validation','players'); end if;
  v_len := pg_catalog.jsonb_array_length(p_items);
  if v_len < 1 or v_len > 64 then perform fftt_private.v3_err('validation','players-count'); end if;
  for v_i in 0..v_len - 1 loop
    v_el := p_items -> v_i;
    if pg_catalog.jsonb_typeof(v_el) <> 'object' or exists (select 1 from pg_catalog.jsonb_object_keys(v_el) k where k not in ('id','rating')) then
      perform fftt_private.v3_err('validation','player-fields');
    end if;
    if (v_el ->> 'id') is null or (v_el ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then perform fftt_private.v3_err('validation','player-id'); end if;
    if coalesce(pg_catalog.jsonb_typeof(v_el -> 'rating'), '') <> 'number' or coalesce(v_el ->> 'rating', '') !~ '^[1-5]$' then perform fftt_private.v3_err('validation','player-rating'); end if;
    v_id := (v_el ->> 'id')::uuid; v_rating := (v_el ->> 'rating')::integer;
    select * into v_cur from fftt_private.players where event_id = p_event_id and id = v_id for update;
    if not found then perform fftt_private.v3_err('notfound','player'); end if;
    if v_cur.rating <> v_rating or not v_cur.rating_confirmed then
      update fftt_private.players set rating = v_rating, rating_confirmed = true where event_id = p_event_id and id = v_id;
      v_changed := v_changed + 1;
    end if;
  end loop;
  if v_changed = 0 then
    return pg_catalog.jsonb_build_object('status','unchanged','event_revision', v_event.revision);
  end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'rating_confirmed', null, null,
    pg_catalog.jsonb_build_object('players', v_changed), null, v_rev);
  return pg_catalog.jsonb_build_object('status','saved','changed', v_changed,'event_revision', v_rev);
end;
$f$;

-- ================================================================ Part C: event management
-- Archiving remembers where the event came from, so it can be restored to exactly that state.
create or replace function fftt_private.set_lifecycle_v3(p_event_id uuid, p_lifecycle text)
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
    update fftt_private.events set public_visible = false, archived_from = v_event.lifecycle where id = p_event_id;
  end if;
  update fftt_private.events set lifecycle = p_lifecycle where id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'lifecycle_changed', null,
    pg_catalog.jsonb_build_object('lifecycle', v_event.lifecycle),
    pg_catalog.jsonb_build_object('lifecycle', p_lifecycle), null, v_rev);
  return pg_catalog.jsonb_build_object('status','updated','lifecycle', p_lifecycle, 'event_revision', v_rev);
end;
$f$;

create function fftt_private.restore_event_v4(p_event_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_target text; v_rev bigint;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['archived']);
  v_target := coalesce(v_event.archived_from,
    case when v_event.bracket_generation = 0 then 'draft'
         when exists (select 1 from fftt_private.brackets where event_id = p_event_id
                        and generation = v_event.bracket_generation and kind = 'championship' and status = 'complete')
         then 'complete' else 'active' end);
  -- the public view is never switched back on by a restore: publishing is a separate, deliberate choice
  update fftt_private.events set lifecycle = v_target, archived_from = null, public_visible = false where id = p_event_id;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'event_restored', null,
    pg_catalog.jsonb_build_object('lifecycle', 'archived'),
    pg_catalog.jsonb_build_object('lifecycle', v_target), null, v_rev);
  return pg_catalog.jsonb_build_object('status','restored','lifecycle', v_target, 'event_revision', v_rev);
end;
$f$;

-- An event may be permanently deleted ONLY while it is an empty draft: never built, no players, no matches,
-- no results or decisions, not public.
create function fftt_private.v4_event_deletable(p_event_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $f$
  select e.lifecycle = 'draft' and e.bracket_generation = 0 and not e.public_visible
     and not exists (select 1 from fftt_private.players where event_id = e.id)
     and not exists (select 1 from fftt_private.brackets where event_id = e.id)
     and not exists (select 1 from fftt_private.matches where event_id = e.id)
     and not exists (select 1 from fftt_private.doubles_finale where event_id = e.id)
     and not exists (select 1 from fftt_private.result_submissions where event_id = e.id)
     and not exists (select 1 from fftt_private.score_decisions_v2 where event_id = e.id)
    from fftt_private.events e where e.id = p_event_id;
$f$;

create function fftt_private.delete_event_v4(p_event_id uuid, p_confirm_name text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_actor uuid := auth.uid();
begin
  v_event := fftt_private.v3_begin(p_event_id, array['organizer'], array['draft']);
  if not exists (select 1 from fftt_private.platform_organizers where user_id = v_actor) then
    perform fftt_private.v3_err('forbidden');
  end if;
  if not coalesce(fftt_private.v4_event_deletable(p_event_id), false) then
    perform fftt_private.v3_err('conflict','not-deletable');
  end if;
  if p_confirm_name is null or pg_catalog.btrim(p_confirm_name) <> v_event.event_name then
    perform fftt_private.v3_err('validation','confirmation');
  end if;
  insert into fftt_private.deleted_events(event_id, public_id, event_name, event_date, created_by, deleted_by, audit, staff)
  values (v_event.id, v_event.public_id, v_event.event_name, v_event.event_date, v_event.created_by, v_actor,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('operation', a.operation, 'actor_id', a.actor_id,
        'before', a.before_state, 'after', a.after_state, 'reason', a.reason, 'revision', a.event_revision, 'at', a.created_at)
        order by a.created_at, a.id) from fftt_private.audit_events a where a.event_id = v_event.id), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user_id', s.user_id, 'role', s.role, 'active', s.active))
        from fftt_private.event_staff s where s.event_id = v_event.id), '[]'::jsonb));
  perform pg_catalog.set_config('fftt.deleting_event', v_event.id::text, true);
  delete from public.fftt_published_events where event_id = v_event.public_id;
  delete from fftt_private.events where id = v_event.id;
  perform pg_catalog.set_config('fftt.deleting_event', '', true);
  return pg_catalog.jsonb_build_object('status','deleted');
end;
$f$;

-- Richer event list: what is needed to choose an event by NAME and to know what is safe to delete.
create function fftt_private.my_events_v4() returns jsonb
language plpgsql stable security definer set search_path = ''
as $f$
declare v_actor uuid := auth.uid(); v_platform boolean;
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    perform fftt_private.v3_err('forbidden');
  end if;
  v_platform := exists (select 1 from fftt_private.platform_organizers po where po.user_id = v_actor);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'event_id', e.id, 'name', e.event_name, 'date', e.event_date, 'lifecycle', e.lifecycle,
             'role', s.role, 'revision', e.revision, 'can_create', v_platform, 'tables', e.table_count,
             'players', case when s.role = 'organizer' then (select pg_catalog.count(*) from fftt_private.players p where p.event_id = e.id) end,
             'deletable', s.role = 'organizer' and v_platform and coalesce(fftt_private.v4_event_deletable(e.id), false))
           order by e.event_date desc, e.created_at desc)
      from fftt_private.event_staff s
      join fftt_private.events e on e.id = s.event_id
     where s.user_id = v_actor and s.active and s.revoked_at is null and e.synthetic_only
  ), '[]'::jsonb);
end;
$f$;

-- ================================================================ grants + public wrappers
do $grants$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'fftt_private'
             and p.proname in ('set_formats_v4','set_match_format_v4','matchdesk_for_event_v2','checkin_registrants_v4',
               'confirm_ratings_v4','restore_event_v4','delete_event_v4','my_events_v4')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  -- helpers stay unreachable from every API role (callable only by the definer functions above)
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'fftt_private'
             and p.proname in ('v4_match_format','v4_normalize_scores','v4_match_category','v4_event_deletable')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$grants$;

create function public.fftt_set_formats_v4(p_event_id uuid, p_formats jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_formats_v4(p_event_id, p_formats); $f$;
create function public.fftt_set_match_format_v4(p_event_id uuid, p_match_id uuid, p_best_of integer, p_points integer)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.set_match_format_v4(p_event_id, p_match_id, p_best_of, p_points); $f$;
create function public.fftt_checkin_registrants_v4(p_event_id uuid, p_registrants jsonb, p_check_in boolean default true)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.checkin_registrants_v4(p_event_id, p_registrants, p_check_in); $f$;
create function public.fftt_confirm_ratings_v4(p_event_id uuid, p_items jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.confirm_ratings_v4(p_event_id, p_items); $f$;
create function public.fftt_restore_event_v4(p_event_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.restore_event_v4(p_event_id); $f$;
create function public.fftt_delete_event_v4(p_event_id uuid, p_confirm_name text)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.delete_event_v4(p_event_id, p_confirm_name); $f$;
create function public.fftt_my_events_v4()
returns jsonb language sql stable security invoker set search_path = ''
as $f$ select fftt_private.my_events_v4(); $f$;
create function public.fftt_matchdesk_v2(p_event_id uuid)
returns table (
  event_id uuid, bracket_generation integer, match_id uuid, match_code text, match_version bigint,
  bracket text, round_number integer, slot integer, player_1_id uuid, player_2_id uuid,
  player_1_name text, player_2_name text, is_championship_final boolean, table_number smallint,
  best_of integer, points_to_win integer)
language sql stable security invoker set search_path = ''
as $f$ select * from fftt_private.matchdesk_for_event_v2(p_event_id); $f$;

do $wrap$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and (p.proname like 'fftt\_%\_v4' escape '\' or p.proname = 'fftt_matchdesk_v2')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$wrap$;

-- the replaced view keeps the exact grants of V3 (re-asserted so a fresh replace can never widen them)
revoke all on public.fftt_public_tournament_v1 from public, anon, authenticated;
grant select on public.fftt_public_tournament_v1 to anon, authenticated;

commit;
