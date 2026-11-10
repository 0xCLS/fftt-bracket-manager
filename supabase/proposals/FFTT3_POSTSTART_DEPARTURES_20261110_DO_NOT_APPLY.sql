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

-- API adapters: leave existing match/result functions untouched.
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
