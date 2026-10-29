-- Disposable PostgreSQL-only synthetic fixture for C5 proposed function.
-- NEVER RUN AGAINST HOSTED SUPABASE. Run only in ephemeral GH Actions service.
\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema fftt_private;

create function auth.uid()
returns uuid language sql stable
set search_path to ''
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function auth.jwt()
returns jsonb language sql stable
set search_path to ''
as $$
  select jsonb_build_object(
    'role', nullif(current_setting('request.jwt.claim.role', true), '')
  );
$$;

grant usage on schema auth, fftt_private to authenticated;
grant usage on schema auth to anon;

create table fftt_private.events(
 id uuid primary key,
 revision bigint not null,
 bracket_generation integer not null,
 lifecycle text not null,
 synthetic_only boolean not null
);
create table fftt_private.event_staff(
 event_id uuid not null references fftt_private.events(id),
 user_id uuid not null,
 role text not null,
 active boolean not null,
 revoked_at timestamptz,
 primary key(event_id, user_id)
);
create table fftt_private.result_submissions(
 event_id uuid not null references fftt_private.events(id),
 actor_id uuid not null,
 submission_id uuid not null,
 match_id uuid not null,
 generation integer not null,
 response jsonb not null,
 primary key(event_id,actor_id,submission_id)
);
revoke all on all tables in schema fftt_private from public, anon, authenticated;

-- Matching the hosted project's CURRENT authorization helper by contract:
-- enforce active, unrevoked JWT-owned staff on one synthetic-only event.
create or replace function fftt_private.staff_role_for_event(p_event_id uuid)
returns text
language plpgsql stable security definer
set search_path to ''
as $role$
declare
  v_user uuid := auth.uid();
  v_role text;
begin
  if v_user is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select s.role into v_role
    from fftt_private.event_staff s
    join fftt_private.events e on e.id=s.event_id
   where s.event_id=p_event_id and s.user_id=v_user
     and s.active=true and s.revoked_at is null
     and e.synthetic_only=true;
  if v_role is null then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return v_role;
end;
$role$;
revoke all on function fftt_private.staff_role_for_event(uuid)
  from public, anon;
grant execute on function fftt_private.staff_role_for_event(uuid)
  to authenticated;

insert into fftt_private.events(
  id,revision,bracket_generation,lifecycle,synthetic_only
) values
('12345678-1234-4234-9234-123456789abc',4,1,'active',true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,0,'active',true);

insert into fftt_private.event_staff(
  event_id,user_id,role,active,revoked_at
) values
('12345678-1234-4234-9234-123456789abc',
 '11111111-1111-4111-8111-111111111111','organizer',true,null),
('12345678-1234-4234-9234-123456789abc',
 '22222222-2222-4222-8222-222222222222','scorekeeper',true,null),
('12345678-1234-4234-9234-123456789abc',
 '33333333-3333-4333-8333-333333333333','scorekeeper',true,null);

-- Exactly ONE accepted receipt from scorekeeper A; scorekeeper B's
-- conflicting/failed request is NOT logged as a rejected receipt.
insert into fftt_private.result_submissions(
  event_id,actor_id,submission_id,match_id,generation,response
) values (
 '12345678-1234-4234-9234-123456789abc',
 '22222222-2222-4222-8222-222222222222',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 1,
 '{"event_revision":4,"match_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","match_version":1,"status":"accepted"}'::jsonb
);

-- Confirm actual caller cannot directly read private staff/receipt rows.
do $verify$
begin
  if has_table_privilege('authenticated',
                        'fftt_private.result_submissions','SELECT') then
    raise exception 'Invalid test fixture: direct receipt SELECT is permitted';
  end if;
  if has_table_privilege('authenticated',
                        'fftt_private.event_staff','SELECT') then
    raise exception 'Invalid test fixture: direct staff SELECT is permitted';
  end if;
end;
$verify$;
