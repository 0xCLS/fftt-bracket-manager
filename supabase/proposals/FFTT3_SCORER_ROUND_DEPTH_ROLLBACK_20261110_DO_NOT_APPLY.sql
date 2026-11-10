-- FFTT3 Scorer round-label proposal rollback — NOT FOR EXECUTION WITHOUT SEPARATE APPROVAL.
-- Restore the exact existing read-only brief structure; do not change grants or other functions.
BEGIN;
DO $guard$
DECLARE v_sql text;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'trusted administrator required';
  END IF;
  SELECT pg_get_functiondef('fftt_private.event_brief_v3(uuid)'::regprocedure) INTO v_sql;
  IF v_sql IS NULL OR position("'rounds'" in v_sql)=0 THEN
    RAISE EXCEPTION 'expected installed round metadata extension absent';
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION fftt_private.event_brief_v3(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE e fftt_private.events%rowtype;
BEGIN
  SELECT * INTO e FROM fftt_private.events WHERE id=p_event_id;
  PERFORM fftt_private.staff_role_for_event(p_event_id);
  RETURN pg_catalog.jsonb_build_object('event_id',e.id,'name',e.event_name,'date',e.event_date,
    'tables',e.table_count,'lifecycle',e.lifecycle,'generation',e.bracket_generation,'revision',e.revision);
END;
$function$;
COMMIT;
