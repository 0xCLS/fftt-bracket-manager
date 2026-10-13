-- B2g: AUDITABLE SYNTHETIC FIXTURE TEMPLATE — NOT APPROVED TO EXECUTE.
-- NOT A MIGRATION and NOT a production tournament/bracket builder.
-- Never store real player identities, Auth passwords, JWTs or secret keys here.
-- Must be explicitly approved separately by the organizer to mutate the
-- already-existing synthetic development event, not FFTT3 or production.
-- Project must be copmkalfkkrkzheohwuc; run ONLY in trusted SQL Editor.
-- Before execution, replace exactly TWO placeholders below:
--   v_approval: a one-time operator authorization string after fresh approval.
--   v_event_id: the existing 2099-01-01 synthetic UUID from private changelog.
-- The default template HALTS before any write and locks down expected empty state.
-- The only planned mutations: 2 synthetic players, 1 championship bracket,
-- 1 pending match, event bracket-generation/revision update, 1 immutable audit.
-- Actual two-client POST scoring and signed JWT tests require distinct gates.

begin;
do $b2g_fixture$
declare
  v_approval text := 'APPROVAL_NOT_GRANTED';
  v_event_id uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_event fftt_private.events%rowtype;
  v_alpha uuid := gen_random_uuid();
  v_beta uuid := gen_random_uuid();
  v_bracket uuid := gen_random_uuid();
  v_match uuid := gen_random_uuid();
  v_revision bigint;
begin
  if v_approval <> 'YES_B2G_ONE_SYNTHETIC_FIXTURE_WRITE' then
    raise exception 'B2g fixture write has not been explicitly approved';
  end if;
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'B2g trusted administrator context required';
  end if;
  if v_event_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'B2g synthetic event UUID placeholder must be replaced';
  end if;

  select * into v_event from fftt_private.events
    where id = v_event_id
      and event_name = 'B2e Synthetic Hosted Rehearsal — NOT FFTT3'
      and event_date = '2099-01-01'::date
      and lifecycle = 'active'
      and synthetic_only = true
      and bracket_generation = 0
      and revision = 2
    for update;
  if not found or (select count(*) from fftt_private.events) <> 1 then
    raise exception 'B2g expected single untouched synthetic event not found';
  end if;
  if (select count(*) from fftt_private.event_staff where event_id=v_event_id) <> 3
     or (select count(*) from fftt_private.event_staff
           where event_id=v_event_id and active=true and revoked_at is null
             and role='organizer') <> 1
     or (select count(*) from fftt_private.event_staff
           where event_id=v_event_id and active=true and revoked_at is null
             and role='scorekeeper') <> 2
     or (select count(*) from fftt_private.audit_events
           where event_id=v_event_id and operation='staff_grant_changed'
             and actor_id is null) <> 2
     or (select count(*) from fftt_private.audit_events where event_id=v_event_id) <> 2
     or (select count(*) from fftt_private.players where event_id=v_event_id) <> 0
     or (select count(*) from fftt_private.brackets where event_id=v_event_id) <> 0
     or (select count(*) from fftt_private.matches where event_id=v_event_id) <> 0
     or (select count(*) from fftt_private.result_submissions where event_id=v_event_id) <> 0
     or (select count(*) from fftt_private.consolation_reviews where event_id=v_event_id) <> 0
     or (select count(*) from fftt_private.doubles_finale where event_id=v_event_id) <> 0
     or (select count(*) from public.fftt_published_events) <> 0
     or (select count(*) from public.fftt_published_matches) <> 0 then
    raise exception 'B2g fixture baseline has changed; inspect before making writes';
  end if;

  insert into fftt_private.players
    (id,event_id,display_name,rating,rating_status,checked_in,seed_order)
  values
    (v_alpha,v_event_id,'Synthetic Fixture Alpha',3,'provisional',true,1),
    (v_beta,v_event_id,'Synthetic Fixture Beta',3,'provisional',true,2);
  insert into fftt_private.brackets
    (id,event_id,generation,kind,status,created_by)
  values
    (v_bracket,v_event_id,1,'championship','active',null);
  insert into fftt_private.matches
    (id,event_id,bracket_id,generation,match_code,round_number,slot,
     player_1_id,player_2_id,status,match_version)
  values
    (v_match,v_event_id,v_bracket,1,'C-0-0',0,0,v_alpha,v_beta,'pending',0);

  update fftt_private.events
    set bracket_generation = 1, revision = revision + 1, updated_at = now()
    where id = v_event_id and revision = 2
    returning revision into v_revision;
  if v_revision <> 3 then
    raise exception 'B2g revision mismatch after synthetic fixture creation';
  end if;

  insert into fftt_private.audit_events
    (event_id,actor_id,operation,before_state,after_state,reason,event_revision)
  values
    (v_event_id,null,'bracket_built',null,
      jsonb_build_object('generation',1,'synthetic_players',2,
                         'synthetic_matches',1,'bracket_id',v_bracket,
                         'match_id',v_match),
     'B2g explicit organizer-approved trusted administrative synthetic fixture; NOT authenticated organizer bracket build',
     v_revision);
  raise notice 'B2g synthetic-only fixture accepted; match UUID: %',v_match;
end;
$b2g_fixture$;
commit;
