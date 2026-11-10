-- FFTT3 Scorer-safe round labels — SOURCE PROPOSAL ONLY. DO NOT APPLY WITHOUT RELEASE APPROVAL.
-- Replaces only the JSON response body of the existing read-only event_brief_v3 function.
-- No scoring, permissions, roster, match details or write paths change. Run in isolated DB first.
-- The new 'rounds' object gives each already-authorized staff member only two aggregate counts.

BEGIN;
DO $rounds_guard$
DECLARE v_sql text;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'trusted administrator required';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_sql FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='fftt_private' AND p.proname='event_brief_v3'
     AND pg_get_function_identity_arguments(p.oid)='p_event_id uuid';
  IF v_sql IS NULL OR position('SECURITY DEFINER' in v_sql)=0
     OR position('staff_role_for_event' in v_sql)=0
     OR position("'rounds'" in v_sql)>0 THEN
    RAISE EXCEPTION 'event brief baseline drift or already installed';
  END IF;
END;
$rounds_guard$;

CREATE OR REPLACE FUNCTION fftt_private.event_brief_v3(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  e fftt_private.events%rowtype;
  v_champ_rounds integer;
  v_cons_rounds integer;
BEGIN
  SELECT * INTO e FROM fftt_private.events WHERE id=p_event_id;
  -- Role verified before reading even aggregate bracket depth; unchanged access boundary.
  PERFORM fftt_private.staff_role_for_event(p_event_id);
  SELECT max(m.round_number + 1) FILTER (WHERE b.kind='championship'),
         max(m.round_number + 1) FILTER (WHERE b.kind='consolation')
    INTO v_champ_rounds,v_cons_rounds
    FROM fftt_private.brackets b
    JOIN fftt_private.matches m ON m.bracket_id=b.id AND m.event_id=b.event_id
   WHERE b.event_id=p_event_id AND b.generation=e.bracket_generation
     AND m.generation=e.bracket_generation AND b.status IN ('active','complete');
  RETURN pg_catalog.jsonb_build_object(
    'event_id',e.id,'name',e.event_name,'date',e.event_date,
    'tables',e.table_count,'lifecycle',e.lifecycle,
    'generation',e.bracket_generation,'revision',e.revision,
    'rounds',pg_catalog.jsonb_build_object(
      'championship',v_champ_rounds,'consolation',v_cons_rounds));
END;
$function$;
COMMIT;
