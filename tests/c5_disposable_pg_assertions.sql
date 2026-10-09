-- Disposable C5 proposed function integration checks with fictional identities.
-- NEVER run this against hosted Supabase or production.
\set ON_ERROR_STOP on

do $permissions$
begin
  if has_function_privilege('anon',
     'public.fftt_event_snapshot_v1(uuid,uuid)','EXECUTE') then
    raise exception 'FAIL anonymous can execute private snapshot API';
  end if;
  if not has_function_privilege('authenticated',
     'public.fftt_event_snapshot_v1(uuid,uuid)','EXECUTE') then
    raise exception 'FAIL signed authenticated user lacks RPC EXECUTE';
  end if;
  if has_table_privilege('authenticated',
     'fftt_private.result_submissions','SELECT') then
    raise exception 'FAIL private receipt table directly readable';
  end if;
  raise notice 'PASS C5 function/table privilege boundary';
end;
$permissions$;

-- Scorekeeper A can retrieve only their own accepted submission metadata.
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $accepted$
declare
  v jsonb;
  receipt jsonb;
begin
  v := public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  if (v->>'revision')::bigint <> 4 or
     (v->>'generation')::int <> 1 or
     v->>'lifecycle' <> 'active' or
     v->>'event_id' <> '12345678-1234-4234-9234-123456789abc' then
    raise exception 'FAIL accepted scorekeeper incorrect event snapshot';
  end if;
  receipt := v->'resolved_submission';
  if receipt->>'status' <> 'accepted' or
     receipt->>'id' <> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' or
     receipt->>'match_id' <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' or
     (receipt->>'match_version')::bigint <> 1 or
     (receipt->>'event_revision')::bigint <> 4 then
    raise exception 'FAIL own accepted receipt incorrect';
  end if;
  if v ? 'email' or v ? 'actor_id' or v ? 'game_scores'
     or receipt ? 'actor_id' or receipt ? 'winner_id'
     or receipt ? 'game_scores' or receipt ? 'request_fingerprint' then
    raise exception 'FAIL private result/staff data disclosed';
  end if;
  if (select count(*) from jsonb_object_keys(v)) <> 5
     or (select count(*) from jsonb_object_keys(receipt)) <> 6 then
    raise exception 'FAIL JSON field projection is not exact';
  end if;
  raise notice 'PASS authorized actor accepted receipt, exact fields and versions';
end;
$accepted$;

-- Scorekeeper B cannot see A's accepted receipt, even knowing its UUID.
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $otheractor$
declare
  v jsonb;
begin
  v := public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  if v->'resolved_submission' is distinct from 'null'::jsonb then
    raise exception 'FAIL leaked another scorekeeper receipt';
  end if;
  raise notice 'PASS alternate scorekeeper receipt absent => unresolved';
end;
$otheractor$;

-- Organizer cannot look up a scorekeeper's receipt either.
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $organizer$
declare
  v jsonb;
begin
  v := public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  if v->'resolved_submission' is distinct from 'null'::jsonb then
    raise exception 'FAIL organizer accessed someone else own-receipt lookup';
  end if;
  v := public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',
    null
  );
  if v->'resolved_submission' is distinct from 'null'::jsonb then
    raise exception 'FAIL event-only snapshot has a receipt';
  end if;
  raise notice 'PASS event revision access and no unauthorized receipt';
end;
$organizer$;

-- Revoked or nonstaff accounts cannot obtain even event revision.
set request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $outsider$
begin
  perform public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',null
  );
  raise exception 'FAIL outsider read event snapshot';
exception
  when insufficient_privilege then
    raise notice 'PASS outsider denied';
end;
$outsider$;

-- Even a real account with one event's grant cannot query another event.
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $crossevent$
begin
  perform public.fftt_event_snapshot_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null
  );
  raise exception 'FAIL cross-event revision disclosed';
exception
  when insufficient_privilege then
    raise notice 'PASS cross-event denied';
end;
$crossevent$;

-- Forged role claim must never pass signed-current-role helper.
set request.jwt.claim.role = 'anon';
do $forgedrole$
begin
  perform public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',null
  );
  raise exception 'FAIL non-authenticated JWT role accepted';
exception
  when insufficient_privilege then
    raise notice 'PASS JWT role mismatch denied';
end;
$forgedrole$;

-- Restore fake authenticated claim and test a revoked scorekeeper grant.
reset role;
update fftt_private.event_staff set active=false,revoked_at=now()
 where event_id='12345678-1234-4234-9234-123456789abc'
   and user_id='33333333-3333-4333-8333-333333333333';
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $revoked$
begin
  perform public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',null
  );
  raise exception 'FAIL revoked scorekeeper retained read access';
exception
  when insufficient_privilege then
    raise notice 'PASS revoked scorekeeper denied';
end;
$revoked$;

-- Unauthenticated PostgREST role must never have EXECUTE.
reset role;
set role anon;
set request.jwt.claim.role = 'anon';
set request.jwt.claim.sub = '';
do $anonymous$
begin
  perform public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',null
  );
  raise exception 'FAIL anonymous client read event snapshot';
exception
  when insufficient_privilege then
    raise notice 'PASS anonymous RPC forbidden';
end;
$anonymous$;

-- Corrupt accepted receipt is not converted to "rejected"/"saved".
reset role;
update fftt_private.result_submissions
 set response=jsonb_set(response,'{status}','"rejected"'::jsonb)
 where actor_id='22222222-2222-4222-8222-222222222222'
   and submission_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $badreceipt$
begin
  perform public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  raise exception 'FAIL malformed persisted result status accepted';
exception
  when invalid_parameter_value then
    raise notice 'PASS corrupted receipt fails closed';
end;
$badreceipt$;

-- Restored status but impossible future accepted event revision is an error.
reset role;
update fftt_private.result_submissions
  set response=jsonb_set(
     jsonb_set(response,'{status}','"accepted"'::jsonb),
     '{event_revision}','999'::jsonb
  )
 where actor_id='22222222-2222-4222-8222-222222222222'
   and submission_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $futureversion$
begin
  perform public.fftt_event_snapshot_v1(
    '12345678-1234-4234-9234-123456789abc',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  raise exception 'FAIL future receipt revision accepted';
exception
  when invalid_parameter_value then
    raise notice 'PASS corrupt version fails closed';
end;
$futureversion$;

-- Assertions completed against disposable fake Auth; actual GoTrue/JWT/RLS
-- integration is STILL pending and must not be overstated.
reset role;
select 'C5 DISPOSABLE POSTGRES SECURITY PASS (not hosted)' as outcome;
