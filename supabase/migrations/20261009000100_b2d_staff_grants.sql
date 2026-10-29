-- FFTT Phase 1B B2d: organizer-controlled, event-scoped staff grants.
-- SYNTHETIC PROTOTYPE ONLY. No automatic user creation, invite or first organizer.
-- Initial organizer must be established in a separately authorized trusted
-- administrative bootstrap; an unaffiliated account can NEVER self-elevate.
begin;

create function fftt_private.manage_staff_v1(
  p_event_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_role text
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_event fftt_private.events%rowtype;
  v_old fftt_private.event_staff%rowtype;
  v_has_old boolean;
  v_revision bigint;
  v_new_state jsonb;
  v_before_state jsonb;
  v_result text;
begin
  if p_event_id is null or p_target_user_id is null
     or p_action is null
     or p_action not in ('grant','revoke')
     or (p_action='grant' and (p_role is null
           or p_role not in ('organizer','scorekeeper')))
     or (p_action='revoke' and p_role is not null) then
    raise exception 'fftt_validation_error' using errcode='22023';
  end if;

  -- Serialize staff changes with every score submit, and every other
  -- staff change for the event. Privileged reads are performed afterward.
  select * into v_event from fftt_private.events
   where id=p_event_id and synthetic_only=true for update;
  if not found or v_event.lifecycle not in ('draft','active') then
    raise exception 'fftt_not_found' using errcode='22023';
  end if;

  if fftt_private.staff_role_for_event(p_event_id) <> 'organizer' then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_actor:=auth.uid();

  -- A caller cannot promote, demote or revoke their own organizer identity.
  -- A second organizer may be granted/revoked by a different organizer.
  if p_target_user_id=v_actor then
    raise exception 'fftt_forbidden_self_change' using errcode='42501';
  end if;

  -- Reject anonymous, unverified, deleted and currently banned identities
  -- even if a UUID was already known. No email or contact info is returned.
  if p_action='grant' and not exists (
    select 1 from auth.users u
     where u.id=p_target_user_id
       and u.is_anonymous=false
       and u.email_confirmed_at is not null
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
  ) then
    raise exception 'fftt_ineligible_staff_target' using errcode='22023';
  end if;

  select * into v_old from fftt_private.event_staff
   where event_id=p_event_id and user_id=p_target_user_id for update;
  v_has_old:=found;
  v_before_state:=case when v_has_old then
    pg_catalog.jsonb_build_object('user_id',v_old.user_id,
     'role',v_old.role,'active',v_old.active,'revoked_at',v_old.revoked_at)
    else null end;

  if p_action='grant' then
    if v_has_old and v_old.active and v_old.revoked_at is null
       and v_old.role=p_role then
      return pg_catalog.jsonb_build_object(
        'status','unchanged','event_id',p_event_id,'role',p_role,
        'event_revision',v_event.revision);
    end if;

    insert into fftt_private.event_staff(
      event_id,user_id,role,active,granted_by,granted_at,revoked_at
    ) values (p_event_id,p_target_user_id,p_role,true,v_actor,now(),null)
    on conflict (event_id,user_id) do update
      set role=excluded.role,active=true,granted_by=excluded.granted_by,
          granted_at=excluded.granted_at,revoked_at=null;
    v_result:='granted';
    v_new_state:=pg_catalog.jsonb_build_object(
      'user_id',p_target_user_id,'role',p_role,'active',true);
  else
    if not v_has_old or not v_old.active then
      return pg_catalog.jsonb_build_object(
        'status','unchanged','event_id',p_event_id,
        'event_revision',v_event.revision);
    end if;
    update fftt_private.event_staff
      set active=false,revoked_at=now()
      where event_id=p_event_id and user_id=p_target_user_id;
    v_result:='revoked';
    v_new_state:=pg_catalog.jsonb_build_object(
      'user_id',p_target_user_id,'role',v_old.role,'active',false);
  end if;

  update fftt_private.events set revision=revision+1,updated_at=now()
   where id=p_event_id returning revision into v_revision;

  insert into fftt_private.audit_events(
    event_id,actor_id,operation,before_state,after_state,event_revision)
  values (p_event_id,v_actor,'staff_grant_changed',
          v_before_state,v_new_state,v_revision);

  return pg_catalog.jsonb_build_object(
    'status',v_result,'event_id',p_event_id,
    'role',case when p_action='grant' then p_role else v_old.role end,
    'event_revision',v_revision);
end;
$fn$;

revoke all on function fftt_private.manage_staff_v1(uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function fftt_private.manage_staff_v1(uuid,uuid,text,text)
 to authenticated;

create function public.fftt_manage_staff_v1(
  p_event_id uuid,p_target_user_id uuid,p_action text,p_role text
)
returns jsonb language sql volatile security invoker set search_path=''
as $fn$
  select fftt_private.manage_staff_v1(
    p_event_id,p_target_user_id,p_action,p_role);
$fn$;

revoke all on function public.fftt_manage_staff_v1(uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.fftt_manage_staff_v1(uuid,uuid,text,text)
 to authenticated;

comment on function public.fftt_manage_staff_v1(uuid,uuid,text,text) is
 'Synthetic-only: organizer-checked staff grant/revoke. No account creation or first-organizer bootstrap.';
commit;
