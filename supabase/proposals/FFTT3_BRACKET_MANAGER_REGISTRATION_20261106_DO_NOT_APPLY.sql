-- FFTT3 Bracket Manager registration lookup + check-in candidate · 2026-11-06
-- DO NOT APPLY TO HOSTED SUPABASE without explicit release approval, a fresh private backup with disposable
-- restore evidence, and signed-user permission / rollback verification.
-- Layer order: ... V5, single-project upgrade, FFTT3_BRACKET_MANAGER_ROLE_20261030, FFTT3_EVENT_DAY_DELEGATION_20261105,
-- then THIS file. Nothing existing is replaced: four private helpers, one private table, two private RPCs and their two
-- public wrappers are ADDED. Existing RPCs, grants and the Organizer registration workflow are unchanged.
--
-- WHY THIS EXISTS. The Organizer's registration check-in RPC (fftt_checkin_registrants_v4) accepts client-supplied
-- names, levels and opaque references and cannot tell a genuine registration from an invented one. That is acceptable for
-- an Organizer, but a Bracket Manager must not gain it. A Bracket Manager can instead check in a registration only
-- through the Pages Function, which re-reads the event's saved Google Sheet, finds the registration by its opaque
-- reference, and signs a short-lived HMAC proof over exactly what it read. The database refuses anything that is not
-- accompanied by a valid proof for THIS signed-in user, THIS event and THIS source. The browser never receives a proof.
--
-- WHAT A BRACKET MANAGER STILL CANNOT DO: read or change the registration source (fftt_registration_source_v5 stays
-- Organizer-only), insert a player under a name or level the sheet does not carry (walk-ins remain a separate, explicit
-- operation), check in after the Championship bracket exists, use another event, or do any of this after revocation.
--
-- ONE-TIME RELEASE STEP (not part of this file, never commit the value): install the shared proof secret, the same value
-- that is stored as the Cloudflare Pages secret REGISTRATION_GATE_SECRET. Install it as the database owner with
-- tools/ops/install_registration_gate.sql, which reads the value from psql's standard input (psql ... -f that file < private
-- file), so it is in no process argument, shell history, SQL text or server log. Never call the installer with the value
-- typed into a -c string, a psql variable or an SQL editor. The runbook is in
-- docs/launch/FFTT3_BRACKET_MANAGER_REGISTRATION_2026-11-06.md (Release requirements).
-- Until it is installed (and the Function has the secret) every call below is refused: fail closed.
begin;

-- ----------------------------------------------------------------------------------------------- proof secret
create table fftt_private.registration_gate (
  singleton boolean primary key default true check (singleton),
  secret bytea not null check (pg_catalog.length(secret) >= 32),
  installed_at timestamptz not null default now()
);
alter table fftt_private.registration_gate enable row level security;
revoke all on fftt_private.registration_gate from public, anon, authenticated;

create function fftt_private.install_registration_gate_v1(p_secret text) returns text
language plpgsql volatile security definer set search_path = ''
as $f$
begin
  if p_secret is null or pg_catalog.char_length(p_secret) < 32 or pg_catalog.char_length(p_secret) > 200 then
    raise exception 'the registration gate secret must be 32 to 200 characters' using errcode = '22023';
  end if;
  insert into fftt_private.registration_gate(singleton, secret) values (true, pg_catalog.convert_to(p_secret, 'UTF8'))
  on conflict (singleton) do update set secret = excluded.secret, installed_at = pg_catalog.now();
  return 'installed';
end;
$f$;

-- HMAC-SHA256 (RFC 2104) from the core sha256() so no extension has to be installed; verified against RFC 4231 vectors.
create function fftt_private.hmac_sha256_hex(p_key bytea, p_msg bytea) returns text
language plpgsql immutable set search_path = ''
as $f$
declare v_k bytea := p_key; v_ipad bytea; v_opad bytea; v_i integer;
begin
  if pg_catalog.length(v_k) > 64 then v_k := pg_catalog.sha256(v_k); end if;
  v_k := v_k || pg_catalog.decode(pg_catalog.repeat('00', 64 - pg_catalog.length(v_k)), 'hex');
  v_ipad := v_k; v_opad := v_k;
  for v_i in 0..63 loop
    v_ipad := pg_catalog.set_byte(v_ipad, v_i, pg_catalog.get_byte(v_k, v_i) # 54);
    v_opad := pg_catalog.set_byte(v_opad, v_i, pg_catalog.get_byte(v_k, v_i) # 92);
  end loop;
  return pg_catalog.encode(pg_catalog.sha256(v_opad || pg_catalog.sha256(v_ipad || p_msg)), 'hex');
end;
$f$;

-- A proof binds: purpose, event, the CURRENT signed-in user, an expiry (at most 120 s ahead) and the purpose's own fields.
-- Fields are joined with chr(31); validated text never contains a control character, so the encoding is unambiguous.
-- The comparison hashes both sides first so its timing does not depend on how many leading characters match.
create function fftt_private.registration_gate_ok(p_purpose text, p_event_id uuid, p_fields text, p_exp bigint, p_proof text)
returns boolean language plpgsql volatile security definer set search_path = ''
as $f$
declare v_uid uuid := auth.uid(); v_now bigint := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint;
        v_key bytea; v_expect text;
begin
  if v_uid is null or p_event_id is null or p_exp is null or p_proof is null or p_fields is null
     or p_proof !~ '^[0-9a-f]{64}$' or p_exp < v_now or p_exp > v_now + 120 then return false; end if;
  select secret into v_key from fftt_private.registration_gate where singleton;
  if v_key is null then return false; end if;
  v_expect := fftt_private.hmac_sha256_hex(v_key, pg_catalog.convert_to(
    'fftt-reg-gate-v1' || pg_catalog.chr(31) || p_purpose || pg_catalog.chr(31) || p_event_id::text || pg_catalog.chr(31)
    || v_uid::text || pg_catalog.chr(31) || p_exp::text || pg_catalog.chr(31) || p_fields, 'UTF8'));
  return pg_catalog.sha256(pg_catalog.convert_to(v_expect, 'UTF8')) = pg_catalog.sha256(pg_catalog.convert_to(p_proof, 'UTF8'));
end;
$f$;

-- The identity of the source a registration was read from. Computed here and by the Function; a changed source changes it.
create function fftt_private.registration_source_fp(p_event_id uuid) returns text
language plpgsql stable security definer set search_path = ''
as $f$
declare v_row fftt_private.registration_sources%rowtype;
begin
  select * into v_row from fftt_private.registration_sources where event_id = p_event_id;
  if v_row.event_id is null or v_row.kind = 'fixture' then return 'fixture'; end if;
  return pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    v_row.kind || pg_catalog.chr(31) || v_row.spreadsheet_id || pg_catalog.chr(31) || v_row.worksheet, 'UTF8')), 'hex');
end;
$f$;

-- ----------------------------------------------------------------------------------------------- lookup context
-- Bracket Manager of THIS event, and only with a valid proof (so the browser itself can never read it). Returns what the
-- Function needs to read the sheet and to mark who is already on the roster: the saved source (never shown to the browser)
-- and the opaque reference -> roster player links. No contact data exists in any of it.
create function fftt_private.bm_registration_lookup_v1(p_event_id uuid, p_exp bigint, p_proof text) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $f$
declare v_event fftt_private.events%rowtype; v_src fftt_private.registration_sources%rowtype;
begin
  if p_event_id is null or fftt_private.staff_role_for_event(p_event_id) is distinct from 'bracket_manager' then
    perform fftt_private.v3_err('forbidden');
  end if;
  if not fftt_private.registration_gate_ok('lookup', p_event_id, '', p_exp, p_proof) then
    perform fftt_private.v3_err('forbidden', 'attestation');
  end if;
  select * into v_event from fftt_private.events where id = p_event_id;
  if v_event.id is null then perform fftt_private.v3_err('forbidden'); end if;
  select * into v_src from fftt_private.registration_sources where event_id = p_event_id;
  return pg_catalog.jsonb_build_object(
    'configured', v_src.event_id is not null,
    'event_synthetic', v_event.synthetic_only,
    'kind', v_src.kind, 'spreadsheet_id', v_src.spreadsheet_id, 'spreadsheet_title', v_src.spreadsheet_title,
    'worksheet', v_src.worksheet, 'column_map', coalesce(v_src.column_map, '{}'::jsonb), 'enabled', coalesce(v_src.enabled, false),
    'source_fp', fftt_private.registration_source_fp(p_event_id),
    'check_in_open', v_event.lifecycle in ('draft', 'active')
                     and not exists (select 1 from fftt_private.brackets where event_id = p_event_id),
    'roster_size', (select pg_catalog.count(*) from fftt_private.players where event_id = p_event_id),
    'links', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'ref', l.ref, 'player_id', l.player_id, 'checked_in', p.checked_in) order by l.ref)
      from fftt_private.registration_links l join fftt_private.players p on p.event_id = l.event_id and p.id = l.player_id
      where l.event_id = p_event_id), '[]'::jsonb));
end;
$f$;

-- ----------------------------------------------------------------------------------------------- check-in
-- p_items: 1..6 objects. The FIRST is the registration being checked in: {ref, name, rating[, link_player_id]}.
-- Any further object is a duplicate submission of the same person: {ref, name, rating, same_as_ref = first ref}.
-- name / rating / ref are the values the Function READ from the sheet and signed; they are not the browser's claims.
-- All or nothing. Idempotent: repeating it changes nothing and reports `unchanged`.
create function fftt_private.bm_registration_checkin_v1(p_event_id uuid, p_items jsonb, p_source_fp text, p_exp bigint, p_proof text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $f$
declare
  v_event fftt_private.events%rowtype; v_src fftt_private.registration_sources%rowtype;
  v_len integer; v_i integer; v_el jsonb; v_ref text; v_same text; v_raw text; v_name text; v_rating integer; v_link uuid;
  v_fields text := ''; v_first_ref text; v_first_name text; v_first_rating integer; v_first_link uuid; v_refs text[] := '{}';
  v_pid uuid; v_other uuid; v_cur fftt_private.players%rowtype; v_outcome text; v_merged integer := 0; v_checked boolean := false;
  v_rev bigint; v_fp text; v_min integer; v_max integer;
begin
  v_event := fftt_private.v3_begin(p_event_id, array['bracket_manager'], array['draft','active']);
  if exists (select 1 from fftt_private.brackets where event_id = p_event_id) then perform fftt_private.v3_err('conflict','bracket-locked'); end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then perform fftt_private.v3_err('validation','items'); end if;
  v_len := pg_catalog.jsonb_array_length(p_items);
  if v_len < 1 or v_len > 6 then perform fftt_private.v3_err('validation','items-count'); end if;
  if p_source_fp is null or p_source_fp !~ '^(fixture|[0-9a-f]{64})$' then perform fftt_private.v3_err('validation','source'); end if;
  for v_i in 0..v_len - 1 loop
    v_el := p_items -> v_i;
    if pg_catalog.jsonb_typeof(v_el) <> 'object' or exists (select 1 from pg_catalog.jsonb_object_keys(v_el) k
        where k not in ('ref','name','rating','same_as_ref','link_player_id')) then perform fftt_private.v3_err('validation','item-fields'); end if;
    v_ref := case when pg_catalog.jsonb_typeof(v_el -> 'ref') = 'string' then v_el ->> 'ref' end;
    v_same := case when pg_catalog.jsonb_typeof(v_el -> 'same_as_ref') = 'string' then v_el ->> 'same_as_ref' end;
    if v_ref is null or v_ref !~ '^[A-Za-z0-9_-]{16,64}$' or v_ref = any(v_refs) then perform fftt_private.v3_err('validation','item-ref'); end if;
    if (v_i = 0) <> (v_same is null) or (v_i > 0 and v_same is distinct from v_first_ref) then perform fftt_private.v3_err('validation','item-ref'); end if;
    v_raw := case when pg_catalog.jsonb_typeof(v_el -> 'name') = 'string' then v_el ->> 'name' end;
    v_name := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_raw, ''), '[[:space:]]+', ' ', 'g'));
    -- the checked-in person needs a full name (as a walk-in does); a merged duplicate's own name is never stored, so it only has to be safe text
    v_min := case when v_i = 0 then 3 else 1 end; v_max := case when v_i = 0 then 80 else 120 end;
    if pg_catalog.length(v_name) not between v_min and v_max
       or (v_i = 0 and pg_catalog.strpos(v_name, ' ') = 0) or v_name ~ '[[:cntrl:]]' or v_name ~ '@'
       or v_name ~ '[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9][^0-9]{0,2}[0-9]' or v_raw ~ '[[:cntrl:]]' then
      perform fftt_private.v3_err('validation','player-name');
    end if;
    if coalesce(pg_catalog.jsonb_typeof(v_el -> 'rating'), '') <> 'number' or coalesce(v_el ->> 'rating', '') !~ '^[1-5]$' then perform fftt_private.v3_err('validation','player-rating'); end if;
    v_rating := (v_el ->> 'rating')::integer;
    v_link := null;
    if v_el ? 'link_player_id' and pg_catalog.jsonb_typeof(v_el -> 'link_player_id') <> 'null' then
      if v_i > 0 or pg_catalog.jsonb_typeof(v_el -> 'link_player_id') <> 'string'
         or (v_el ->> 'link_player_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then perform fftt_private.v3_err('validation','player-id'); end if;
      v_link := (v_el ->> 'link_player_id')::uuid;
    end if;
    if v_i = 0 then v_first_ref := v_ref; v_first_name := v_name; v_first_rating := v_rating; v_first_link := v_link; end if;
    v_refs := v_refs || v_ref;
    -- the proof covers the signed values only: link_player_id is the desk's own choice and is checked against the roster below
    v_fields := v_fields || pg_catalog.chr(31) || v_ref || pg_catalog.chr(31) || coalesce(v_same, '') || pg_catalog.chr(31) || v_raw || pg_catalog.chr(31) || v_rating::text;
  end loop;
  if not fftt_private.registration_gate_ok('checkin', p_event_id, p_source_fp || v_fields, p_exp, p_proof) then
    perform fftt_private.v3_err('forbidden', 'attestation');
  end if;

  -- PROVENANCE: the registration was read from THIS event's CURRENT enabled source, and the source type is allowed for this event.
  select * into v_src from fftt_private.registration_sources where event_id = p_event_id;
  v_fp := fftt_private.registration_source_fp(p_event_id);
  if v_src.event_id is not null and v_src.kind = 'google-sheets' then
    if v_event.synthetic_only or not v_src.enabled then perform fftt_private.v3_err('conflict','source-not-enabled'); end if;
  elsif not v_event.synthetic_only then
    perform fftt_private.v3_err('conflict','source-not-enabled');          -- the fictional source never serves a real event
  end if;
  if p_source_fp <> v_fp then perform fftt_private.v3_err('conflict','source-changed'); end if;

  -- the registration itself
  select player_id into v_pid from fftt_private.registration_links where event_id = p_event_id and ref = v_first_ref;
  if v_pid is not null then
    v_outcome := 'existing';
  elsif v_first_link is not null then
    select * into v_cur from fftt_private.players where event_id = p_event_id and id = v_first_link for update;
    if not found then perform fftt_private.v3_err('notfound','player'); end if;
    -- identity cannot be substituted: only the roster player that already carries this same name can be linked
    if pg_catalog.lower(v_cur.display_name) <> pg_catalog.lower(v_first_name) then perform fftt_private.v3_err('conflict','link-name-mismatch'); end if;
    insert into fftt_private.registration_links(event_id, ref, player_id, linked_by) values (p_event_id, v_first_ref, v_first_link, auth.uid());
    update fftt_private.players set source = case when source = 'manual' then 'registration' else source end
     where event_id = p_event_id and id = v_first_link;
    v_pid := v_first_link; v_outcome := 'linked';
  else
    if (select pg_catalog.count(*) from fftt_private.players where event_id = p_event_id) >= 64 then perform fftt_private.v3_err('conflict','roster-full'); end if;
    if exists (select 1 from fftt_private.players where event_id = p_event_id and pg_catalog.lower(display_name) = pg_catalog.lower(v_first_name)) then
      perform fftt_private.v3_err('conflict','duplicate-name');
    end if;
    insert into fftt_private.players(event_id, display_name, rating, rating_status, source, rating_confirmed, checked_in)
    values (p_event_id, v_first_name, v_first_rating, 'provisional', 'registration', false, false) returning id into v_pid;
    insert into fftt_private.registration_links(event_id, ref, player_id, linked_by) values (p_event_id, v_first_ref, v_pid, auth.uid());
    v_outcome := 'created';
  end if;
  -- duplicate submissions of the same person join the same player (never a second one)
  for v_i in 1..v_len - 1 loop
    v_ref := (p_items -> v_i) ->> 'ref';
    select player_id into v_other from fftt_private.registration_links where event_id = p_event_id and ref = v_ref;
    if v_other is null then
      insert into fftt_private.registration_links(event_id, ref, player_id, linked_by) values (p_event_id, v_ref, v_pid, auth.uid());
      v_merged := v_merged + 1;
    elsif v_other <> v_pid then perform fftt_private.v3_err('conflict','already-linked');
    end if;
  end loop;
  select * into v_cur from fftt_private.players where event_id = p_event_id and id = v_pid for update;
  if not v_cur.checked_in then
    update fftt_private.players set checked_in = true where event_id = p_event_id and id = v_pid;
    v_checked := true;
  end if;
  if v_outcome = 'existing' and not v_checked and v_merged = 0 then
    return pg_catalog.jsonb_build_object('status','unchanged','outcome','existing','player_id', v_pid,'event_revision', v_event.revision);
  end if;
  v_rev := fftt_private.v3_bump(p_event_id);
  perform fftt_private.v3_audit(p_event_id, 'registration_checkin', null, null,
    pg_catalog.jsonb_build_object('source','registration','via','bracket_manager','outcome', v_outcome,'player_id', v_pid,
      'merged', v_merged,'checked_in', true), null, v_rev);
  return pg_catalog.jsonb_build_object('status','saved','outcome', v_outcome,'player_id', v_pid,'event_revision', v_rev);
end;
$f$;

-- ----------------------------------------------------------------------------------------------- wrappers + grants
create function public.fftt_bm_registration_lookup_v1(p_event_id uuid, p_exp bigint, p_proof text)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.bm_registration_lookup_v1(p_event_id, p_exp, p_proof); $f$;
create function public.fftt_bm_registration_checkin_v1(p_event_id uuid, p_items jsonb, p_source_fp text, p_exp bigint, p_proof text)
returns jsonb language sql volatile security invoker set search_path = ''
as $f$ select fftt_private.bm_registration_checkin_v1(p_event_id, p_items, p_source_fp, p_exp, p_proof); $f$;

revoke all on function fftt_private.bm_registration_lookup_v1(uuid,bigint,text) from public, anon, authenticated;
grant execute on function fftt_private.bm_registration_lookup_v1(uuid,bigint,text) to authenticated;
revoke all on function fftt_private.bm_registration_checkin_v1(uuid,jsonb,text,bigint,text) from public, anon, authenticated;
grant execute on function fftt_private.bm_registration_checkin_v1(uuid,jsonb,text,bigint,text) to authenticated;
revoke all on function public.fftt_bm_registration_lookup_v1(uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.fftt_bm_registration_lookup_v1(uuid,bigint,text) to authenticated;
revoke all on function public.fftt_bm_registration_checkin_v1(uuid,jsonb,text,bigint,text) from public, anon, authenticated;
grant execute on function public.fftt_bm_registration_checkin_v1(uuid,jsonb,text,bigint,text) to authenticated;
-- helpers and the secret installer: callable by no API role (only by the definer functions above and the database owner)
revoke all on function fftt_private.install_registration_gate_v1(text) from public, anon, authenticated;
revoke all on function fftt_private.hmac_sha256_hex(bytea,bytea) from public, anon, authenticated;
revoke all on function fftt_private.registration_gate_ok(text,uuid,text,bigint,text) from public, anon, authenticated;
revoke all on function fftt_private.registration_source_fp(uuid) from public, anon, authenticated;
do $svc$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on fftt_private.registration_gate from service_role;
    revoke all on function fftt_private.install_registration_gate_v1(text) from service_role;
    revoke all on function fftt_private.hmac_sha256_hex(bytea,bytea) from service_role;
    revoke all on function fftt_private.registration_gate_ok(text,uuid,text,bigint,text) from service_role;
    revoke all on function fftt_private.registration_source_fp(uuid) from service_role;
  end if;
end
$svc$;

commit;
