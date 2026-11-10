-- FFTT #79 post-start departure ledger. SOURCE PROPOSAL ONLY; NOT FOR HOSTED INSTALL.
-- Adds private, event-scoped recorded/returned state without rewriting any existing
-- bracket, accepted score, saved game, walkover, consolation, or doubles result.
-- A returned player DOES NOT regain a forfeited match; existing decisions are immutable.
-- Apply to disposable PostgreSQL first. Hosted install requires separate Organizer approval.

BEGIN;
DO $preflight$
BEGIN
  IF to_regclass('fftt_private.player_departures_v1') IS NOT NULL
     OR to_regprocedure('public.fftt_player_departures_v1(uuid)') IS NOT NULL
     OR to_regprocedure('public.fftt_set_player_departure_v1(uuid,uuid,bigint,integer,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FFTT departures: already installed, no replay';
  END IF;
  IF to_regprocedure('fftt_private.v3_begin(uuid,text[],text[])') IS NULL
    OR to_regprocedure('fftt_private.v3_audit(uuid,text,uuid,jsonb,jsonb,text,bigint)') IS NULL
    OR to_regprocedure('fftt_private.staff_role_for_event(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FFTT departures: missing role/permission/audit foundations';
  END IF;
END;
$preflight$;

CREATE TABLE fftt_private.player_departures_v1 (
  event_id uuid NOT NULL,
  player_id uuid NOT NULL,
  withdrawn boolean NOT NULL DEFAULT true,
  departure_reason text NOT NULL CHECK(length(btrim(departure_reason)) BETWEEN 3 AND 300
    AND departure_reason !~ '[[:cntrl:]]'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  returned_at timestamptz,
  returned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  return_reason text CHECK(return_reason IS NULL OR
    (length(btrim(return_reason)) BETWEEN 3 AND 300 AND return_reason !~ '[[:cntrl:]]')),
  CONSTRAINT player_departures_v1_pkey PRIMARY KEY(event_id,player_id),
  CONSTRAINT player_departures_v1_player_fkey FOREIGN KEY(event_id,player_id)
    REFERENCES fftt_private.players(event_id,id) ON DELETE CASCADE,
  CONSTRAINT player_departures_v1_state_check CHECK(
    (withdrawn AND returned_at IS NULL AND return_reason IS NULL AND returned_by IS NULL)
    OR (NOT withdrawn AND returned_at IS NOT NULL AND return_reason IS NOT NULL))
);
-- The existing audit ledger has a strict allowed-operation CHECK. Expand it
-- transactionally for this new audited event type; preserve EVERY old operation.
DO $audit_guard$
DECLARE v_check text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_check FROM pg_constraint c
    WHERE c.conrelid='fftt_private.audit_events'::regclass
    AND c.conname='audit_events_operation_check';
  IF v_check IS NULL OR position('doubles_result_corrected' IN v_check)=0
     OR position('match_forfeited' IN v_check)=0
     OR position('player_departure_changed' IN v_check)>0 THEN
    RAISE EXCEPTION 'FFTT departure audit: unexpected operation baseline';
  END IF;
END;
$audit_guard$;
ALTER TABLE fftt_private.audit_events DROP CONSTRAINT audit_events_operation_check;
ALTER TABLE fftt_private.audit_events ADD CONSTRAINT audit_events_operation_check
  CHECK (operation IN (
    'result_accepted',
    'result_corrected',
    'bracket_built',
    'bracket_rebuilt',
    'consolation_reviewed',
    'staff_grant_changed',
    'event_created',
    'event_updated',
    'player_changed',
    'checkin_changed',
    'table_assigned',
    'match_forfeited',
    'doubles_updated',
    'doubles_result',
    'lifecycle_changed',
    'visibility_changed',
    'format_changed',
    'registration_checkin',
    'rating_confirmed',
    'event_restored',
    'registration_source_changed',
    'game_saved',
    'game_corrected',
    'showcase_reset',
    'doubles_game_saved',
    'doubles_game_corrected',
    'doubles_result_corrected',
    'player_departure_changed'
  ));
-- Defense in depth. Neither anon nor authenticated may read/write this table directly.
ALTER TABLE fftt_private.player_departures_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fftt_private.player_departures_v1 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION fftt_private.player_departures_read_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE v_role text; v_rev bigint;
BEGIN
  v_role := fftt_private.staff_role_for_event(p_event_id);
  IF v_role NOT IN ('organizer','bracket_manager') THEN
    RAISE EXCEPTION 'forbidden' USING errcode='42501';
  END IF;
  SELECT revision INTO v_rev FROM fftt_private.events WHERE id=p_event_id;
  RETURN pg_catalog.jsonb_build_object(
    'event_id', p_event_id, 'revision', v_rev,
    'players', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
         'player_id',d.player_id,'withdrawn',d.withdrawn,
         'reason',d.departure_reason,'recorded_at',d.recorded_at,
         'returned_at',d.returned_at,'return_reason',d.return_reason
      ) ORDER BY d.recorded_at,d.player_id)
      FROM fftt_private.player_departures_v1 d WHERE d.event_id=p_event_id
    ), '[]'::jsonb));
END;
$f$;

CREATE FUNCTION fftt_private.set_player_departure_v1(
  p_event_id uuid,p_player_id uuid,p_expected_revision bigint,p_expected_generation integer,
  p_state text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE e fftt_private.events%rowtype; d fftt_private.player_departures_v1%rowtype;
  v_reason text:=pg_catalog.btrim(COALESCE(p_reason,'')); v_rev bigint;
BEGIN
  e := fftt_private.v3_begin(p_event_id, ARRAY['organizer','bracket_manager'], ARRAY['active']);
  IF e.revision <> p_expected_revision OR e.bracket_generation <> p_expected_generation THEN
    PERFORM fftt_private.v3_err('conflict','revision');
  END IF;
  IF p_state NOT IN ('withdrawn','returned') OR p_state IS NULL THEN
    PERFORM fftt_private.v3_err('validation','departure-state');
  END IF;
  IF length(v_reason) NOT BETWEEN 3 AND 300 OR v_reason ~ '[[:cntrl:]]' THEN
    PERFORM fftt_private.v3_err('validation','reason');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM fftt_private.players p WHERE p.event_id=p_event_id
      AND p.id=p_player_id AND p.checked_in) THEN
    PERFORM fftt_private.v3_err('conflict','not-checked-in');
  END IF;
  -- Do not invent a new participant in a live event by marking an unrelated record.
  IF NOT EXISTS(SELECT 1 FROM fftt_private.matches m WHERE m.event_id=p_event_id
     AND m.generation=e.bracket_generation
     AND (m.player_1_id=p_player_id OR m.player_2_id=p_player_id)) THEN
    PERFORM fftt_private.v3_err('conflict','player-not-in-bracket');
  END IF;
  SELECT * INTO d FROM fftt_private.player_departures_v1
   WHERE event_id=p_event_id AND player_id=p_player_id FOR UPDATE;
  IF p_state='withdrawn' THEN
    IF FOUND AND d.withdrawn THEN PERFORM fftt_private.v3_err('conflict','already-withdrawn'); END IF;
    INSERT INTO fftt_private.player_departures_v1(
      event_id,player_id,withdrawn,departure_reason,recorded_at,recorded_by,
      returned_at,returned_by,return_reason)
    VALUES(p_event_id,p_player_id,true,v_reason,now(),auth.uid(),NULL,NULL,NULL)
    ON CONFLICT(event_id,player_id) DO UPDATE SET
      withdrawn=true,departure_reason=EXCLUDED.departure_reason,
      recorded_at=now(),recorded_by=auth.uid(),
      returned_at=NULL,returned_by=NULL,return_reason=NULL;
  ELSE
    IF NOT FOUND OR NOT d.withdrawn THEN
      PERFORM fftt_private.v3_err('conflict','not-withdrawn');
    END IF;
    UPDATE fftt_private.player_departures_v1 SET
      withdrawn=false,returned_at=now(),returned_by=auth.uid(),
      return_reason=v_reason
    WHERE event_id=p_event_id AND player_id=p_player_id AND withdrawn;
  END IF;
  v_rev := fftt_private.v3_bump(p_event_id);
  PERFORM fftt_private.v3_audit(p_event_id,'player_departure_changed',NULL,
    pg_catalog.jsonb_build_object('player_id',p_player_id,'withdrawn',CASE WHEN d.player_id IS NULL THEN false ELSE d.withdrawn END),
    pg_catalog.jsonb_build_object('player_id',p_player_id,'withdrawn',p_state='withdrawn'),
    v_reason,v_rev);
  RETURN pg_catalog.jsonb_build_object('status','updated','event_revision',v_rev);
END;
$f$;


-- ------------------------------------------------------------------------
-- Authoritative scoring hold: never accept a NEW result/game or assign doubles
-- while any active participating player has an unresolved event withdrawal.
-- Keep existing saved games and accepted receipts. Role-gated match-level W/Os
-- still advance via the internal v1 engine (which is not user-callable).
-- All five functions below already lock the event before this call, serializing
-- status updates and score writes across clients.
CREATE FUNCTION fftt_private.assert_players_present_v1(p_event_id uuid,p_players uuid[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $present$
BEGIN
  IF EXISTS (SELECT 1 FROM fftt_private.player_departures_v1 d
    WHERE d.event_id=p_event_id AND d.withdrawn
      AND d.player_id=ANY(p_players)) THEN
    PERFORM fftt_private.v3_err('conflict','player-withdrawn');
  END IF;
END;
$present$;
REVOKE ALL ON FUNCTION fftt_private.assert_players_present_v1(uuid,uuid[])
  FROM PUBLIC,anon,authenticated;

-- Existing versioned scoring logic stays intact. We insert one fail-closed
-- check at each already-serialized authorization boundary. The installed
-- function body must contain exactly one known insertion point, not already
-- contain the hold, and retain SECURITY DEFINER + fixed search_path.
-- On hosted Supabase (with migration-history catalog), compare five verified
-- exact source fingerprints; local disposable PGlite uses equivalent fixtures.
DO $patch_scoring$
DECLARE
  v_sig pg_catalog.regprocedure; v_source text; v_anchor text;
  v_insert text; v_label text; v_expected_md5 text;
  v_hosted boolean := to_regclass('supabase_migrations.schema_migrations') IS NOT NULL;
BEGIN
  IF has_function_privilege('authenticated',
      'fftt_private.submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,integer)'::regprocedure,
      'EXECUTE') OR has_function_privilege('authenticated',
      'public.fftt_submit_match_result_v1(uuid,uuid,integer,bigint,uuid,uuid,text,integer)'::regprocedure,
      'EXECUTE') THEN
    RAISE EXCEPTION 'FFTT departure guard: legacy direct result scoring must stay inaccessible';
  END IF;

  v_label := 'fftt_private.submit_match_result_v2(uuid,uuid,integer,bigint,uuid,uuid,text,integer)';
  v_sig := to_regprocedure(v_label);
  v_expected_md5 := 'ba6ef3c7a20046f9275fa28ebac330f8';
  v_anchor := '      v_accepted := fftt_private.submit_match_result_v1(';
  v_insert := '      PERFORM fftt_private.assert_players_present_v1(p_event_id,
        ARRAY[v_match.player_1_id,v_match.player_2_id]);
';
  IF v_sig IS NULL THEN RAISE EXCEPTION 'missing guarded score function: %',v_label; END IF;
  v_source := pg_get_functiondef(v_sig);
  IF strpos(v_source,'SECURITY DEFINER')=0
     OR strpos(v_source,'SET search_path TO')=0
     OR strpos(v_source,'assert_players_present_v1')>0
     OR (length(v_source)-length(replace(v_source,v_anchor,''))) <> length(v_anchor)
     OR (v_hosted AND md5(v_source) <> v_expected_md5) THEN
    RAISE EXCEPTION 'FFTT departure score-source drift for %',v_label;
  END IF;
  EXECUTE replace(v_source,v_anchor,v_insert || v_anchor);

  v_label := 'fftt_private.game_progress_save_v1(uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text)';
  v_sig := to_regprocedure(v_label);
  v_expected_md5 := '556a7111dccf1513212614c2d25bca8b';
  v_anchor := '  if not exists (select 1 from fftt_private.brackets b where b.id=m.bracket_id';
  v_insert := '  PERFORM fftt_private.assert_players_present_v1(p_event_id,
    ARRAY[m.player_1_id,m.player_2_id]);
';
  IF v_sig IS NULL THEN RAISE EXCEPTION 'missing guarded score function: %',v_label; END IF;
  v_source := pg_get_functiondef(v_sig);
  IF strpos(v_source,'SECURITY DEFINER')=0
     OR strpos(v_source,'SET search_path TO')=0
     OR strpos(v_source,'assert_players_present_v1')>0
     OR (length(v_source)-length(replace(v_source,v_anchor,''))) <> length(v_anchor)
     OR (v_hosted AND md5(v_source) <> v_expected_md5) THEN
    RAISE EXCEPTION 'FFTT departure score-source drift for %',v_label;
  END IF;
  EXECUTE replace(v_source,v_anchor,v_insert || v_anchor);

  v_label := 'fftt_private.doubles_game_save_v1(uuid,text,bigint,integer,integer,uuid,integer,integer,integer,text)';
  v_sig := to_regprocedure(v_label);
  v_expected_md5 := 'f2bb9a325797a89a5c9825a8c67346a5';
  v_anchor := '  v_key := pg_catalog.md5(coalesce(d.progress_epoch::text,'''')||';
  v_insert := '  PERFORM fftt_private.assert_players_present_v1(p_event_id,
    ARRAY[d.championship_finalist_1,d.championship_finalist_2,
          d.consolation_partner_1,d.consolation_partner_2]);
';
  IF v_sig IS NULL THEN RAISE EXCEPTION 'missing guarded score function: %',v_label; END IF;
  v_source := pg_get_functiondef(v_sig);
  IF strpos(v_source,'SECURITY DEFINER')=0
     OR strpos(v_source,'SET search_path TO')=0
     OR strpos(v_source,'assert_players_present_v1')>0
     OR (length(v_source)-length(replace(v_source,v_anchor,''))) <> length(v_anchor)
     OR (v_hosted AND md5(v_source) <> v_expected_md5) THEN
    RAISE EXCEPTION 'FFTT departure score-source drift for %',v_label;
  END IF;
  EXECUTE replace(v_source,v_anchor,v_insert || v_anchor);

  v_label := 'fftt_private.record_doubles_result_v3(uuid,integer,text)';
  v_sig := to_regprocedure(v_label);
  v_expected_md5 := 'e8b8df90af248ffc5640d8c4a7407ef5';
  v_anchor := '    -- Game-by-game scoring: when games were saved for the current teams,';
  v_insert := '    PERFORM fftt_private.assert_players_present_v1(p_event_id,
      ARRAY[d.championship_finalist_1,d.championship_finalist_2,
            d.consolation_partner_1,d.consolation_partner_2]);
';
  IF v_sig IS NULL THEN RAISE EXCEPTION 'missing guarded score function: %',v_label; END IF;
  v_source := pg_get_functiondef(v_sig);
  IF strpos(v_source,'SECURITY DEFINER')=0
     OR strpos(v_source,'SET search_path TO')=0
     OR strpos(v_source,'assert_players_present_v1')>0
     OR (length(v_source)-length(replace(v_source,v_anchor,''))) <> length(v_anchor)
     OR (v_hosted AND md5(v_source) <> v_expected_md5) THEN
    RAISE EXCEPTION 'FFTT departure score-source drift for %',v_label;
  END IF;
  EXECUTE replace(v_source,v_anchor,v_insert || v_anchor);

  v_label := 'fftt_private.set_doubles_teams_v3(uuid,uuid,uuid)';
  v_sig := to_regprocedure(v_label);
  v_expected_md5 := 'cdd8ddbb635b4103a09191b5097ea386';
  v_anchor := '  insert into fftt_private.doubles_finale(event_id, championship_finalist_1, championship_finalist_2,';
  v_insert := '  PERFORM fftt_private.assert_players_present_v1(p_event_id,
    ARRAY[v_final.player_1_id,v_final.player_2_id,p_partner_1,p_partner_2]);
';
  IF v_sig IS NULL THEN RAISE EXCEPTION 'missing guarded score function: %',v_label; END IF;
  v_source := pg_get_functiondef(v_sig);
  IF strpos(v_source,'SECURITY DEFINER')=0
     OR strpos(v_source,'SET search_path TO')=0
     OR strpos(v_source,'assert_players_present_v1')>0
     OR (length(v_source)-length(replace(v_source,v_anchor,''))) <> length(v_anchor)
     OR (v_hosted AND md5(v_source) <> v_expected_md5) THEN
    RAISE EXCEPTION 'FFTT departure score-source drift for %',v_label;
  END IF;
  EXECUTE replace(v_source,v_anchor,v_insert || v_anchor);
END;
$patch_scoring$;

-- Existing scoring/result APIs retain their signatures; their internal new-write paths are now guarded.
CREATE FUNCTION public.fftt_player_departures_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $f$ SELECT fftt_private.player_departures_read_v1(p_event_id); $f$;

CREATE FUNCTION public.fftt_set_player_departure_v1(
  p_event_id uuid,p_player_id uuid,p_expected_revision bigint,p_expected_generation integer,
  p_state text,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $f$ SELECT fftt_private.set_player_departure_v1(
  p_event_id,p_player_id,p_expected_revision,p_expected_generation,p_state,p_reason); $f$;

REVOKE ALL ON FUNCTION fftt_private.player_departures_read_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION fftt_private.set_player_departure_v1(uuid,uuid,bigint,integer,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.fftt_player_departures_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.fftt_set_player_departure_v1(uuid,uuid,bigint,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION fftt_private.player_departures_read_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fftt_private.set_player_departure_v1(uuid,uuid,bigint,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fftt_player_departures_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fftt_set_player_departure_v1(uuid,uuid,bigint,integer,text,text) TO authenticated;
COMMIT;
