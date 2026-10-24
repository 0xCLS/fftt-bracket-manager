-- FFTT B2e — TRUSTED ADMINISTRATIVE TEMPLATE ONLY; do not run unchanged.
-- NOT a migration. Never add this file to supabase/migrations.
-- Run only in the organizer-controlled *synthetic* Supabase Free development
-- project using the trusted SQL Editor, AFTER a verified test-only Auth organizer
-- account has been created through Supabase Auth.
-- Confirm the project reference is copmkalfkkrkzheohwuc before running.
--
-- Change only the placeholder organizer UUID. Never paste email/password,
-- access tokens, service_role key, production person details, or real event IDs.
-- The operation fails closed when other FFTT event data already exists.
begin;
do $bootstrap$
declare
  v_organizer uuid := '00000000-0000-0000-0000-000000000000';
  v_event_id uuid := gen_random_uuid();
  v_count integer;
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Trusted database administrator context required';
  end if;
  if v_organizer='00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Replace placeholder with the confirmed synthetic organizer Auth UUID';
  end if;
  select count(*) into v_count from fftt_private.events;
  if v_count<>0 then
    raise exception 'FFTT events already exist; stop and inspect before bootstrapping';
  end if;
  if not exists (
    select 1 from auth.users
      where id=v_organizer and email_confirmed_at is not null
        and is_anonymous=false and deleted_at is null
        and (banned_until is null or banned_until<=now())
  ) then
    raise exception 'Organizer UUID does not identify a confirmed eligible test account';
  end if;

  insert into fftt_private.events(
    id, public_id, event_name, event_date,
    lifecycle, bracket_generation, synthetic_only
  ) values (
    v_event_id, gen_random_uuid(),
    'B2e Synthetic Hosted Rehearsal — NOT FFTT3',
    '2099-01-01', 'active', 0, true
  );
  insert into fftt_private.event_staff(
    event_id,user_id,role,active,granted_by,granted_at,revoked_at
  ) values (
    v_event_id,v_organizer,'organizer',true,v_organizer,now(),null
  );

  raise notice 'B2e synthetic-only event UUID (use as FFTT_B2E_EVENT_ID): %', v_event_id;
end;
$bootstrap$;
commit;
