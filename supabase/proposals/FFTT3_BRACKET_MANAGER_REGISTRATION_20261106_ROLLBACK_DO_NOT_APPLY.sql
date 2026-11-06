-- ROLLBACK for FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql · 2026-11-06
-- DO NOT APPLY TO HOSTED SUPABASE without explicit release approval. Safe to run more than once.
-- Removes ONLY the objects that file added. Roster players, registration links and audit rows already written through
-- the new check-in stay (they are ordinary event data, valid without the function that wrote them); the Organizer
-- registration workflow, the Bracket Manager roster check-in and walk-in, and every other grant are untouched.
-- After this runs the Pages Function's `lookup` and `checkin` answers become a generic "not set up" (the RPCs are gone),
-- and the browser falls back to the existing roster check-in and walk-in screens.
begin;
drop function if exists public.fftt_bm_registration_checkin_v1(uuid, jsonb, text, bigint, text);
drop function if exists public.fftt_bm_registration_lookup_v1(uuid, bigint, text);
drop function if exists fftt_private.bm_registration_checkin_v1(uuid, jsonb, text, bigint, text);
drop function if exists fftt_private.bm_registration_lookup_v1(uuid, bigint, text);
drop function if exists fftt_private.registration_source_fp(uuid);
drop function if exists fftt_private.registration_gate_ok(text, uuid, text, bigint, text);
drop function if exists fftt_private.hmac_sha256_hex(bytea, bytea);
drop function if exists fftt_private.install_registration_gate_v1(text);
drop table if exists fftt_private.registration_gate;   -- also removes the stored proof secret
commit;
