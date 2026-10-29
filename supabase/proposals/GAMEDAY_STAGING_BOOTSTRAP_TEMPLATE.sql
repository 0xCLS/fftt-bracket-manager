-- FFTT GAME-DAY STAGING BOOTSTRAP — run by the PROJECT OWNER in the Supabase SQL editor of the SYNTHETIC
-- development project ONLY, AFTER GAMEDAY_TOURNAMENT_V3_STAGING.sql has been applied.
-- Creates fictional staff accounts (organizer, two scorekeepers, an outsider) and ONE NEW empty draft event
-- with event-scoped grants. It never touches the three consumed historical fixtures or any existing account.
--
-- 1. Edit the four e-mail addresses in the LAST statement. To test the optional emailed 6-digit code, use
--    addresses of an inbox YOU own (for example name+fftt-org@yourdomain); otherwise keep the placeholders.
-- 2. Run the whole script once. The result grid shows each NEW account's generated password EXACTLY ONCE:
--    store them in your password manager. Passwords are generated inside your database and are never written
--    to the repository, a chat or a log.
-- 3. Re-running creates another empty event and leaves existing accounts unchanged (their passwords are not re-shown).
-- Prerequisite in the dashboard (Authentication): "Allow new users to sign up" must be OFF.

create or replace function pg_temp.fftt_bootstrap_user(p_email text) returns table(uid uuid, secret text)
language plpgsql as $f$
declare v_id uuid; v_pw text;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if found then return query select v_id, '(existing account — unchanged)'::text; return; end if;
  v_id := gen_random_uuid();
  v_pw := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', 'xyz');
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', lower(p_email),
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities(id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true),
      'email', v_id::text, now(), now(), now());
  return query select v_id, v_pw;
end $f$;

create or replace function pg_temp.fftt_bootstrap(org_email text, a_email text, b_email text, out_email text)
returns table(label text, email text, secret text) language plpgsql as $f$
declare v_org uuid; v_a uuid; v_b uuid; v_out uuid; v_event uuid; s1 text; s2 text; s3 text; s4 text;
begin
  select u.uid, u.secret into v_org, s1 from pg_temp.fftt_bootstrap_user(org_email) u;
  select u.uid, u.secret into v_a, s2 from pg_temp.fftt_bootstrap_user(a_email) u;
  select u.uid, u.secret into v_b, s3 from pg_temp.fftt_bootstrap_user(b_email) u;
  select u.uid, u.secret into v_out, s4 from pg_temp.fftt_bootstrap_user(out_email) u;
  insert into fftt_private.platform_organizers(user_id) values (v_org) on conflict do nothing;
  insert into fftt_private.events(event_name, event_date, table_count, created_by)
  values ('FFTT Synthetic Rehearsal (fictional)', date '2026-11-22', 3, v_org) returning id into v_event;
  insert into fftt_private.event_staff(event_id, user_id, role, granted_by) values
    (v_event, v_org, 'organizer', v_org), (v_event, v_a, 'scorekeeper', v_org), (v_event, v_b, 'scorekeeper', v_org);
  insert into fftt_private.audit_events(event_id, actor_id, operation, after_state, event_revision)
  values (v_event, v_org, 'event_created', jsonb_build_object('bootstrap', true), 0);
  return query values ('organizer'::text, org_email, s1), ('scorekeeper A', a_email, s2), ('scorekeeper B', b_email, s3),
                      ('outsider (no grant)', out_email, s4), ('EVENT ID', null::text, v_event::text);
end $f$;

select * from pg_temp.fftt_bootstrap(
  'fftt-org@fftt-staging.invalid',
  'fftt-scorekeeper-a@fftt-staging.invalid',
  'fftt-scorekeeper-b@fftt-staging.invalid',
  'fftt-outsider@fftt-staging.invalid');
