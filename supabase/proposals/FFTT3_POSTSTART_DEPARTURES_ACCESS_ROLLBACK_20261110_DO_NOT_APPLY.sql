-- #79 full emergency rollback — SOURCE PROPOSAL ONLY; separately approve hosted execution.
-- Transactionally restore all FIVE original scoring functions, then turn off
-- the departure read/write RPCs. Private ledger, audit entries and saved games
-- are retained. No accepted result or W/O is rewritten.
BEGIN;
DO $restore_scoring$
DECLARE
  r record; v_sig pg_catalog.regprocedure; v_count integer;
BEGIN
  IF to_regclass('fftt_private.departure_guard_restore_v1') IS NULL
      OR to_regprocedure('public.fftt_player_departures_v1(uuid)') IS NULL
      OR to_regprocedure('public.fftt_set_player_departure_v1(uuid,uuid,bigint,integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'FFTT departure rollback: missing installed source/permission baseline';
  END IF;
  SELECT count(*) INTO v_count FROM fftt_private.departure_guard_restore_v1;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FFTT departure rollback: expected exactly five guarded source backups';
  END IF;
  -- Validate ALL functions before replacing ANY; reject a partially altered or
  -- externally modified codebase instead of restoring stale code over it.
  FOR r IN SELECT * FROM fftt_private.departure_guard_restore_v1 ORDER BY signature LOOP
    v_sig := to_regprocedure(r.signature);
    IF v_sig IS NULL OR md5(pg_get_functiondef(v_sig)) <> r.guarded_md5
       OR md5(r.original_ddl) <> r.original_md5
       OR strpos(pg_get_functiondef(v_sig),'assert_players_present_v1')=0 THEN
      RAISE EXCEPTION 'FFTT departure rollback: source mismatch on %',r.signature;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM fftt_private.departure_guard_restore_v1 ORDER BY signature LOOP
    EXECUTE r.original_ddl;
    v_sig := to_regprocedure(r.signature);
    IF v_sig IS NULL OR md5(pg_get_functiondef(v_sig)) <> r.original_md5 THEN
      RAISE EXCEPTION 'FFTT departure rollback: function restoration failed on %',r.signature;
    END IF;
  END LOOP;
END;
$restore_scoring$;
REVOKE ALL ON FUNCTION public.fftt_player_departures_v1(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fftt_set_player_departure_v1(uuid,uuid,bigint,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION fftt_private.player_departures_read_v1(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION fftt_private.set_player_departure_v1(uuid,uuid,bigint,integer,text,text) FROM PUBLIC,anon,authenticated;
-- Leave the private restore ledger as evidence; the scorer guard helper is now
-- unreachable from the five restored paths. Keep its rights revoked.
COMMIT;
