-- FFTT Phase 1B, milestone B1: schema and DENY-BY-DEFAULT policies.
-- SYNTHETIC PROTOTYPE ONLY. Not a live service, score RPC, or production migration.
-- Apply only to an isolated Supabase development project after organizer authorization.
-- No data is seeded; public projections intentionally remain empty.
-- Supabase API Exposed Schemas must NOT include fftt_private.
begin;

create schema if not exists fftt_private;
revoke all on schema fftt_private from public, anon, authenticated;
grant usage on schema fftt_private to service_role;

-- Separate private and public IDs: no player UUIDs enter the published API.
create table fftt_private.events (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  event_name text not null check (length(btrim(event_name)) between 1 and 160),
  event_date date not null,
  lifecycle text not null default 'draft'
    check (lifecycle in ('draft','active','complete','archived')),
  regular_best_of smallint not null default 3 check (regular_best_of = 3),
  championship_final_best_of smallint not null default 5 check (championship_final_best_of = 5),
  table_count smallint not null default 2 check (table_count between 1 and 12),
  bracket_generation integer not null default 0 check (bracket_generation >= 0),
  revision bigint not null default 0 check (revision >= 0),
  synthetic_only boolean not null default true check (synthetic_only = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No browser-supplied role claim grants access. User IDs come from Supabase Auth.
create table fftt_private.event_staff (
  event_id uuid not null references fftt_private.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('organizer','scorekeeper')),
  active boolean not null default true,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (event_id, user_id),
  check ((active and revoked_at is null) or (not active))
);
create index event_staff_active_lookup on fftt_private.event_staff (user_id, event_id) where active;

-- Intentionally DO NOT store contact info in the Bracket Manager database.
create table fftt_private.players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references fftt_private.events(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  rating smallint not null check (rating between 1 and 5),
  rating_status text not null check (rating_status in ('provisional','established')),
  checked_in boolean not null default false,
  first_champ_loss boolean not null default false,
  seed_order integer check (seed_order > 0),
  unique (event_id, id)
);
create index players_event_idx on fftt_private.players(event_id);

create table fftt_private.brackets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references fftt_private.events(id) on delete cascade,
  generation integer not null check (generation > 0),
  kind text not null check (kind in ('championship','consolation')),
  status text not null default 'active' check (status in ('active','complete','superseded')),
  consolation_review_completed boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (event_id, generation, kind),
  unique (event_id, generation, id)
);

create table fftt_private.matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  bracket_id uuid not null,
  generation integer not null,
  match_code text not null check (match_code ~ '^[Cc]-[0-9]+-[0-9]+$'),
  round_number integer not null check (round_number >= 0),
  slot integer not null check (slot >= 0),
  player_1_id uuid,
  player_2_id uuid,
  winner_id uuid,
  game_scores text not null default '',
  table_number smallint check (table_number between 1 and 12),
  status text not null default 'pending'
    check (status in ('pending','complete','bye','empty')),
  is_championship_final boolean not null default false,
  match_version bigint not null default 0 check (match_version >= 0),
  next_match_id uuid,
  next_match_slot smallint check (next_match_slot in (1,2)),
  updated_at timestamptz not null default now(),
  foreign key (event_id, generation, bracket_id)
    references fftt_private.brackets(event_id, generation, id) on delete cascade,
  foreign key (event_id, player_1_id)
    references fftt_private.players(event_id, id),
  foreign key (event_id, player_2_id)
    references fftt_private.players(event_id, id),
  foreign key (event_id, winner_id)
    references fftt_private.players(event_id, id),
  unique (event_id, id),
  unique (event_id, generation, bracket_id, id),
  unique (event_id, generation, bracket_id, match_code),
  unique (event_id, generation, bracket_id, round_number, slot),
  check ((next_match_id is null) = (next_match_slot is null)),
  check (player_1_id is null or player_2_id is null or player_1_id <> player_2_id),
  check (
    (status = 'pending' and winner_id is null)
    or (status = 'complete' and player_1_id is not null and player_2_id is not null
        and winner_id in (player_1_id, player_2_id))
    or (status = 'bye' and winner_id is not null
        and ((player_1_id = winner_id and player_2_id is null)
             or (player_2_id = winner_id and player_1_id is null)))
    or (status = 'empty' and winner_id is null
        and player_1_id is null and player_2_id is null)
  ),
  foreign key (event_id, generation, bracket_id, next_match_id)
    references fftt_private.matches(event_id, generation, bracket_id, id)
    deferrable initially deferred
);
create index matches_active_idx on fftt_private.matches(event_id, generation, status);

-- Consolation qualification is a reviewed organizer decision, NOT automatic routing.
create table fftt_private.consolation_reviews (
  event_id uuid not null references fftt_private.events(id) on delete cascade,
  player_id uuid not null,
  first_loss_match_id uuid not null,
  review_state text not null default 'eligible'
    check (review_state in ('eligible','reviewed','placed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  primary key(event_id, player_id),
  foreign key(event_id, player_id) references fftt_private.players(event_id, id),
  foreign key(event_id, first_loss_match_id) references fftt_private.matches(event_id, id)
);

-- One doubles finale; team SELECTION only. No invented doubles score feature.
create table fftt_private.doubles_finale (
  event_id uuid primary key references fftt_private.events(id) on delete cascade,
  championship_finalist_1 uuid not null,
  championship_finalist_2 uuid not null,
  consolation_partner_1 uuid,
  consolation_partner_2 uuid,
  updated_at timestamptz not null default now(),
  foreign key(event_id, championship_finalist_1) references fftt_private.players(event_id, id),
  foreign key(event_id, championship_finalist_2) references fftt_private.players(event_id, id),
  foreign key(event_id, consolation_partner_1) references fftt_private.players(event_id, id),
  foreign key(event_id, consolation_partner_2) references fftt_private.players(event_id, id),
  check(championship_finalist_1 <> championship_finalist_2)
);

-- Server-side RPC will own idempotency, score validation and atomic advancement in B2.
create table fftt_private.result_submissions (
  event_id uuid not null references fftt_private.events(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  submission_id uuid not null,
  match_id uuid not null,
  generation integer not null,
  expected_match_version bigint not null check(expected_match_version >= 0),
  request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
  response jsonb not null,
  received_at timestamptz not null default now(),
  primary key (event_id, actor_id, submission_id),
  foreign key(event_id, match_id) references fftt_private.matches(event_id, id)
);

create table fftt_private.audit_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references fftt_private.events(id) on delete cascade,
  actor_id uuid references auth.users(id),
  operation text not null
    check (operation in ('result_accepted','result_corrected','bracket_built',
                         'bracket_rebuilt','consolation_reviewed','staff_grant_changed')),
  match_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  event_revision bigint not null check(event_revision >= 0),
  created_at timestamptz not null default now()
);
create index audit_event_order_idx on fftt_private.audit_events(event_id, created_at, id);

create function fftt_private.reject_audit_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception 'FFTT audit entries are append-only' using errcode = '42501';
end;
$$;
create trigger fftt_audit_no_update_delete before update or delete
on fftt_private.audit_events for each row execute function fftt_private.reject_audit_mutation();

-- Private objects remain inaccessible to browser roles, including signed-in users.
-- Even an authorized staff member receives NO raw table grants at B1.
alter table fftt_private.events enable row level security;
alter table fftt_private.event_staff enable row level security;
alter table fftt_private.players enable row level security;
alter table fftt_private.brackets enable row level security;
alter table fftt_private.matches enable row level security;
alter table fftt_private.consolation_reviews enable row level security;
alter table fftt_private.doubles_finale enable row level security;
alter table fftt_private.result_submissions enable row level security;
alter table fftt_private.audit_events enable row level security;
revoke all on all tables in schema fftt_private from public, anon, authenticated;
revoke execute on all functions in schema fftt_private from public, anon, authenticated;
alter default privileges in schema fftt_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema fftt_private revoke execute on functions from public, anon, authenticated;

-- Public results are MATERIALIZED, EXPLICITLY ALLOWLISTED data, not a view
-- over private tables. They have independent opaque IDs and never store ratings.
-- B1 intentionally supplies no publication writer; these remain EMPTY until B2.
create table public.fftt_published_events (
  event_id uuid primary key,
  event_name text not null,
  event_date date not null,
  status text not null check(status in ('draft','active','complete','archived')),
  updated_at timestamptz not null
);
create table public.fftt_published_matches (
  event_id uuid not null references public.fftt_published_events(event_id) on delete cascade,
  match_id text not null,
  bracket text not null check (bracket in ('championship','consolation')),
  round integer not null check(round >= 0),
  slot integer not null check(slot >= 0),
  player_1_name text,
  player_2_name text,
  winner_name text,
  game_scores text not null default '',
  status text not null check(status in ('pending','complete','bye','empty')),
  primary key(event_id, match_id)
);

-- RLS works together with SQL grants. No browser role can INSERT/UPDATE/DELETE.
alter table public.fftt_published_events enable row level security;
alter table public.fftt_published_matches enable row level security;
revoke all on public.fftt_published_events, public.fftt_published_matches
  from public, anon, authenticated;
grant select on public.fftt_published_events, public.fftt_published_matches
  to anon, authenticated;
create policy fftt_published_events_read on public.fftt_published_events
  for select to anon, authenticated using (true);
create policy fftt_published_matches_read on public.fftt_published_matches
  for select to anon, authenticated using (true);

-- Exact contract-shaped JSON projection; PG15 security_invoker applies base RLS.
create view public.fftt_public_results_v1 with (security_invoker = true) as
select e.event_id, e.event_name, e.event_date, e.status,
       coalesce((
         select jsonb_agg(
           jsonb_build_object('name', grouped.bracket, 'matches', grouped.matches)
           order by grouped.bracket
         )
         from (
           select m.bracket,
             jsonb_agg(jsonb_build_object(
               'match_id',m.match_id,'bracket',m.bracket,
               'round',m.round,'slot',m.slot,
               'player_1_name',m.player_1_name,
               'player_2_name',m.player_2_name,
               'winner_name',m.winner_name,
               'game_scores',m.game_scores,'status',m.status
             ) order by m.round,m.slot) as matches
           from public.fftt_published_matches m
           where m.event_id = e.event_id
           group by m.bracket
         ) grouped
       ), '[]'::jsonb) as brackets,
       e.updated_at
from public.fftt_published_events e;
revoke all on public.fftt_public_results_v1 from public, anon, authenticated;
grant select on public.fftt_public_results_v1 to anon, authenticated;

comment on schema fftt_private is 'FFTT prototype private data; NOT an exposed API schema';
comment on view public.fftt_public_results_v1 is
  'Synthetic-only anonymous read projection. Populated only by a future audited server transaction.';
commit;
