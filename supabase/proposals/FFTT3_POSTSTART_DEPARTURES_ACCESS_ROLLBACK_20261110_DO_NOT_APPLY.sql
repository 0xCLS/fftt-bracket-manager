-- #79 departure ledger emergency access rollback: keep all history intact.
-- NOT APPROVED FOR HOSTED EXECUTION. The ledger and its audit trail are preserved.
-- Disables only the NEW departure read/write RPCs; no existing scoring RPC changes.
BEGIN;
DO $guard$
BEGIN
  IF to_regprocedure('public.fftt_player_departures_v1(uuid)') IS NULL
    OR to_regprocedure('public.fftt_set_player_departure_v1(uuid,uuid,bigint,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'FFTT departure RPCs absent; do not run rollback';
  END IF;
END;
$guard$;
REVOKE ALL ON FUNCTION public.fftt_player_departures_v1(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fftt_set_player_departure_v1(uuid,uuid,bigint,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION fftt_private.player_departures_read_v1(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION fftt_private.set_player_departure_v1(uuid,uuid,bigint,integer,text,text) FROM PUBLIC,anon,authenticated;
COMMIT;
