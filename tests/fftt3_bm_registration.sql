-- Bracket Manager registration lookup + check-in on NATIVE PostgreSQL (disposable database only; fictional users).
-- Complements tests/e2e/bm_registration_lookup.test.mjs (PGlite + the real Pages Function): this proves the SQL on the real engine:
-- the HMAC against an RFC 4231 vector, privileges, the proof binding, denial for every non-manager, idempotency and audit.
\set ON_ERROR_STOP on
begin;
create schema fftt_bmr;
grant usage on schema fftt_bmr to authenticated;
create function fftt_bmr.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role','authenticated')::text,true);
end $f$;
create function fftt_bmr.id(p_name text) returns uuid language sql stable as $f$ select current_setting('fftt_bmr.' || p_name)::uuid $f$;
create function fftt_bmr.expect(p_label text,p_stmt text,p_state text,p_message text,p_detail text default null)
returns void language plpgsql as $f$
declare s text; msg text; d text;
begin
  begin execute p_stmt;
  exception when others then
    get stacked diagnostics s=returned_sqlstate,msg=message_text,d=pg_exception_detail;
    if s=p_state and msg=p_message and (p_detail is null or d=p_detail) then return; end if;
    raise exception 'WRONG DENIAL %: % % [%] expected % % [%]',p_label,s,msg,d,p_state,p_message,p_detail;
  end;
  raise exception 'NOT DENIED %',p_label;
end $f$;
grant execute on all functions in schema fftt_bmr to authenticated;
insert into auth.users(id,email,role,aud,instance_id,is_anonymous,email_confirmed_at) values
 ('c0000000-0000-4000-8000-000000000031','desk@fftt-bmr.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now()),
 ('c0000000-0000-4000-8000-000000000032','scorer@fftt-bmr.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now()),
 ('c0000000-0000-4000-8000-000000000033','stranger@fftt-bmr.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000',false,now());
select set_config('fftt_bmr.org',(select user_id::text from fftt_private.platform_organizers limit 1),true);
select set_config('fftt_bmr.desk','c0000000-0000-4000-8000-000000000031',true);
select set_config('fftt_bmr.scorer','c0000000-0000-4000-8000-000000000032',true);
select set_config('fftt_bmr.stranger','c0000000-0000-4000-8000-000000000033',true);

-- 1. the proof algorithm on the real engine (RFC 4231 test case 2), then the key installation
do $v$ begin
  if fftt_private.hmac_sha256_hex('\x4a656665'::bytea, convert_to('what do ya want for nothing?','UTF8'))
     <> '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843' then raise exception 'HMAC-SHA256 vector mismatch'; end if;
  if fftt_private.hmac_sha256_hex(decode(repeat('aa',131),'hex'), convert_to('Test Using Larger Than Block-Size Key - Hash Key First','UTF8'))
     <> '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54' then raise exception 'HMAC-SHA256 long-key vector mismatch'; end if;
end $v$;
do $k$ begin
  begin perform fftt_private.install_registration_gate_v1('too short'); raise exception 'a short secret was accepted';
  exception when sqlstate '22023' then null; end;
end $k$;
select fftt_private.install_registration_gate_v1('native-test-gate-secret-0123456789abcdef');

-- 2. an event, its desk and its enabled source (as the Organizer)
set local role authenticated;
select fftt_bmr.as_user(fftt_bmr.id('org'));
select set_config('fftt_bmr.event',(public.fftt_create_event_v3('FICTIONAL NATIVE DESK EVENT','2026-11-08',2)->>'event_id'),true);
select set_config('fftt_bmr.foreign',(public.fftt_create_event_v3('FICTIONAL NATIVE OTHER EVENT','2026-11-22',2)->>'event_id'),true);
select public.fftt_set_staff_v3(fftt_bmr.id('event'),'desk@fftt-bmr.invalid','grant','bracket_manager');
select public.fftt_set_staff_v3(fftt_bmr.id('event'),'scorer@fftt-bmr.invalid','grant','scorekeeper');
select public.fftt_set_registration_source_v5(fftt_bmr.id('event'),
  '{"kind":"google-sheets","spreadsheet_id":"SYNTHETIC_NATIVE_SHEET_0123456789abcdef","worksheet":"Form Responses 1","column_map":{},"enabled":true}'::jsonb);
select public.fftt_set_registration_source_v5(fftt_bmr.id('foreign'),
  '{"kind":"google-sheets","spreadsheet_id":"SYNTHETIC_NATIVE_SHEET_0123456789abcdef","worksheet":"Form Responses 1","column_map":{},"enabled":true}'::jsonb);
reset role;

-- 3. proofs, made the way the Function makes them (the signer holds the shared secret; no API role does)
create function pg_temp.proof(p_purpose text, p_event uuid, p_uid uuid, p_exp bigint, p_fields text) returns text language sql as $f$
  select fftt_private.hmac_sha256_hex(convert_to('native-test-gate-secret-0123456789abcdef','UTF8'),
    convert_to('fftt-reg-gate-v1' || chr(31) || p_purpose || chr(31) || p_event::text || chr(31) || p_uid::text || chr(31) || p_exp::text || chr(31) || p_fields,'UTF8')) $f$;
select set_config('fftt_bmr.exp',(floor(extract(epoch from clock_timestamp()))::bigint + 60)::text,true);
select set_config('fftt_bmr.fp',fftt_private.registration_source_fp(fftt_bmr.id('event')),true);
select set_config('fftt_bmr.ref','NATIVEREFERENCE0000000000000001',true);
select set_config('fftt_bmr.lookup_proof',pg_temp.proof('lookup',fftt_bmr.id('event'),fftt_bmr.id('desk'),current_setting('fftt_bmr.exp')::bigint,''),true);
select set_config('fftt_bmr.checkin_proof',pg_temp.proof('checkin',fftt_bmr.id('event'),fftt_bmr.id('desk'),current_setting('fftt_bmr.exp')::bigint,
  current_setting('fftt_bmr.fp') || chr(31) || current_setting('fftt_bmr.ref') || chr(31) || '' || chr(31) || 'Fictional Native Player' || chr(31) || '3'),true);
select set_config('fftt_bmr.other_proof',pg_temp.proof('checkin',fftt_bmr.id('foreign'),fftt_bmr.id('desk'),current_setting('fftt_bmr.exp')::bigint,
  current_setting('fftt_bmr.fp') || chr(31) || current_setting('fftt_bmr.ref') || chr(31) || '' || chr(31) || 'Fictional Native Player' || chr(31) || '3'),true);

-- 4. denial for everyone who is not the event's desk, and for a desk without a valid proof
set local role authenticated;
select fftt_bmr.as_user(fftt_bmr.id('scorer'));
select fftt_bmr.expect('scorekeeper lookup',format($q$select public.fftt_bm_registration_lookup_v1(%L,%s,%L)$q$,fftt_bmr.id('event'),current_setting('fftt_bmr.exp'),current_setting('fftt_bmr.lookup_proof')),'42501','forbidden');
select fftt_bmr.expect('scorekeeper check-in',format($q$select public.fftt_bm_registration_checkin_v1(%L,%L::jsonb,%L,%s,%L)$q$,fftt_bmr.id('event'),
  '[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Native Player","rating":3}]',current_setting('fftt_bmr.fp'),current_setting('fftt_bmr.exp'),current_setting('fftt_bmr.checkin_proof')),'42501','forbidden');
select fftt_bmr.as_user(fftt_bmr.id('stranger'));
select fftt_bmr.expect('outsider check-in',format($q$select public.fftt_bm_registration_checkin_v1(%L,%L::jsonb,%L,%s,%L)$q$,fftt_bmr.id('event'),
  '[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Native Player","rating":3}]',current_setting('fftt_bmr.fp'),current_setting('fftt_bmr.exp'),current_setting('fftt_bmr.checkin_proof')),'42501','forbidden');
select fftt_bmr.as_user(fftt_bmr.id('org'));
select fftt_bmr.expect('organizer does not hold the desk grant',format($q$select public.fftt_bm_registration_lookup_v1(%L,%s,%L)$q$,fftt_bmr.id('event'),current_setting('fftt_bmr.exp'),current_setting('fftt_bmr.lookup_proof')),'42501','forbidden');
select fftt_bmr.as_user(fftt_bmr.id('desk'));
select fftt_bmr.expect('no proof',format($q$select public.fftt_bm_registration_lookup_v1(%L,%s,%L)$q$,fftt_bmr.id('event'),current_setting('fftt_bmr.exp'),repeat('0',64)),'42501','forbidden','attestation');
select fftt_bmr.expect('forged name',format($q$select public.fftt_bm_registration_checkin_v1(%L,%L::jsonb,%L,%s,%L)$q$,fftt_bmr.id('event'),
  '[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Invented Player","rating":3}]',current_setting('fftt_bmr.fp'),current_setting('fftt_bmr.exp'),current_setting('fftt_bmr.checkin_proof')),'42501','forbidden','attestation');
select fftt_bmr.expect('forged level',format($q$select public.fftt_bm_registration_checkin_v1(%L,%L::jsonb,%L,%s,%L)$q$,fftt_bmr.id('event'),
  '[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Native Player","rating":5}]',current_setting('fftt_bmr.fp'),current_setting('fftt_bmr.exp'),current_setting('fftt_bmr.checkin_proof')),'42501','forbidden','attestation');
select fftt_bmr.expect('another event with this event proof',format($q$select public.fftt_bm_registration_checkin_v1(%L,%L::jsonb,%L,%s,%L)$q$,fftt_bmr.id('foreign'),
  '[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Native Player","rating":3}]',current_setting('fftt_bmr.fp'),current_setting('fftt_bmr.exp'),current_setting('fftt_bmr.checkin_proof')),'42501','forbidden');
select fftt_bmr.expect('another event with its own proof but no grant',format($q$select public.fftt_bm_registration_checkin_v1(%L,%L::jsonb,%L,%s,%L)$q$,fftt_bmr.id('foreign'),
  '[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Native Player","rating":3}]',current_setting('fftt_bmr.fp'),current_setting('fftt_bmr.exp'),current_setting('fftt_bmr.other_proof')),'42501','forbidden');
select fftt_bmr.expect('expired proof',format($q$select public.fftt_bm_registration_lookup_v1(%L,%s,%L)$q$,fftt_bmr.id('event'),(floor(extract(epoch from clock_timestamp()))::bigint - 5)::text,current_setting('fftt_bmr.lookup_proof')),'42501','forbidden','attestation');
select fftt_bmr.expect('the source is not readable by the desk',format($q$select public.fftt_registration_source_v5(%L)$q$,fftt_bmr.id('event')),'42501','forbidden');
select fftt_bmr.expect('the Organizer check-in is not open to the desk',format($q$select public.fftt_checkin_registrants_v4(%L,%L::jsonb,true)$q$,fftt_bmr.id('event'),
  '[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Native Player","rating":3,"source":"registration"}]'),'42501','forbidden');

-- 5. the desk with valid proofs
do $ok$
declare e uuid:=fftt_bmr.id('event'); r jsonb; n integer;
begin
  r := public.fftt_bm_registration_lookup_v1(e,current_setting('fftt_bmr.exp')::bigint,current_setting('fftt_bmr.lookup_proof'));
  if r->>'kind' <> 'google-sheets' or (r->>'enabled')::boolean is not true or (r->>'check_in_open')::boolean is not true or r->'links' <> '[]'::jsonb then raise exception 'lookup answer wrong: %', r; end if;
  if r::text like '%@%' then raise exception 'lookup leaked something'; end if;
  r := public.fftt_bm_registration_checkin_v1(e,'[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Native Player","rating":3}]'::jsonb,
         current_setting('fftt_bmr.fp'),current_setting('fftt_bmr.exp')::bigint,current_setting('fftt_bmr.checkin_proof'));
  if r->>'status' <> 'saved' or r->>'outcome' <> 'created' then raise exception 'check-in answer wrong: %', r; end if;
  r := public.fftt_bm_registration_checkin_v1(e,'[{"ref":"NATIVEREFERENCE0000000000000001","name":"Fictional Native Player","rating":3}]'::jsonb,
         current_setting('fftt_bmr.fp'),current_setting('fftt_bmr.exp')::bigint,current_setting('fftt_bmr.checkin_proof'));
  if r->>'status' <> 'unchanged' or r->>'outcome' <> 'existing' then raise exception 'repeat was not idempotent: %', r; end if;
  select count(*) into n from jsonb_array_elements(public.fftt_bracket_manager_snapshot_v1(e)->'players') p
   where p->>'name' = 'Fictional Native Player' and (p->>'checked_in')::boolean and (p->>'rating')::int = 3 and p->>'source' = 'registration' and (p->>'rating_confirmed')::boolean is false;
  if n <> 1 then raise exception 'roster player wrong'; end if;
  if jsonb_array_length(public.fftt_bracket_manager_snapshot_v1(e)->'players') <> 1 then raise exception 'unexpected roster size'; end if;
end $ok$;
reset role;
do $audit$ begin
  if (select count(*) from fftt_private.audit_events where event_id = fftt_bmr.id('event') and operation = 'registration_checkin'
        and after_state->>'via' = 'bracket_manager' and after_state->>'outcome' = 'created') <> 1 then raise exception 'audit row missing or duplicated'; end if;
  if (select count(*) from fftt_private.players where event_id = fftt_bmr.id('foreign')) <> 0 then raise exception 'the other event changed'; end if;
end $audit$;

-- 6. privileges and definer hygiene
do $priv$
declare f text;
begin
  foreach f in array array['fftt_private.install_registration_gate_v1(text)','fftt_private.hmac_sha256_hex(bytea,bytea)','fftt_private.registration_gate_ok(text,uuid,text,bigint,text)','fftt_private.registration_source_fp(uuid)'] loop
    if has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute') or has_function_privilege('public',f,'execute') then raise exception 'helper executable by an API role: %', f; end if;
  end loop;
  foreach f in array array['public.fftt_bm_registration_lookup_v1(uuid,bigint,text)','public.fftt_bm_registration_checkin_v1(uuid,jsonb,text,bigint,text)'] loop
    if has_function_privilege('anon',f,'execute') or has_function_privilege('public',f,'execute') or not has_function_privilege('authenticated',f,'execute') then raise exception 'wrapper grants wrong: %', f; end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'fftt_private'
              and p.proname in ('install_registration_gate_v1','hmac_sha256_hex','registration_gate_ok','registration_source_fp','bm_registration_lookup_v1','bm_registration_checkin_v1')
              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')) then raise exception 'a function does not pin search_path'; end if;
  if has_table_privilege('anon','fftt_private.registration_gate','select') or has_table_privilege('authenticated','fftt_private.registration_gate','select') then raise exception 'the secret table is readable'; end if;
end $priv$;
rollback;
select 'PASS: Bracket Manager registration desk on native PostgreSQL (proof, denial, idempotency, audit, privileges)' as result;
