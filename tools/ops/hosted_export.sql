-- FFTT private CURRENT backup: ONE read-only query for the Supabase SQL editor or Management API.
-- It reads all 19 non-secret private application tables plus referenced Auth identities
-- (id, email, created_at, is_anonymous only). Rehearsal and showcase data are PRIVATE.
-- EXCLUDED: fftt_private.registration_gate contains a proof secret and must not be exported. Query returns
-- one row per table: row count, an md5 fingerprint and the rows as JSON. Save the result to a PRIVATE location outside GitHub
-- (see docs/launch/FFTT3_BACKUP_RECOVERY.md), then prove it with: node tools/ops/restore_verify.mjs <file> --rehearse
-- Every expected table returns exactly one group, including empty tables. Missing groups are an error.
with t as (
  select 'audit_events' as tbl, to_jsonb(x) as j from fftt_private.audit_events x
  union all select 'brackets', to_jsonb(x) from fftt_private.brackets x
  union all select 'consolation_reviews', to_jsonb(x) from fftt_private.consolation_reviews x
  union all select 'deleted_events', to_jsonb(x) from fftt_private.deleted_events x
  union all select 'doubles_finale', to_jsonb(x) from fftt_private.doubles_finale x
  union all select 'event_staff', to_jsonb(x) from fftt_private.event_staff x
  union all select 'events', to_jsonb(x) from fftt_private.events x
  union all select 'game_progress_decisions', to_jsonb(x) from fftt_private.game_progress_decisions x
  union all select 'match_game_progress', to_jsonb(x) from fftt_private.match_game_progress x
  union all select 'matches', to_jsonb(x) from fftt_private.matches x
  union all select 'platform_organizers', to_jsonb(x) from fftt_private.platform_organizers x
  union all select 'players', to_jsonb(x) from fftt_private.players x
  union all select 'registration_links', to_jsonb(x) from fftt_private.registration_links x
  union all select 'registration_sources', to_jsonb(x) from fftt_private.registration_sources x
  union all select 'result_submissions', to_jsonb(x) from fftt_private.result_submissions x
  union all select 'score_decisions_v2', to_jsonb(x) from fftt_private.score_decisions_v2 x
  union all select 'showcase_progress_watermarks', to_jsonb(x) from fftt_private.showcase_progress_watermarks x
  union all select 'showcase_reset_baseline', to_jsonb(x) from fftt_private.showcase_reset_baseline x
  union all select 'showcase_reset_decisions', to_jsonb(x) from fftt_private.showcase_reset_decisions x
  union all select 'auth_users', jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'is_anonymous', u.is_anonymous)
    from auth.users u
    where u.id in (
      -- All owner/staff, match, audit and recovery actors, including former staff.
      -- Restore must not silently omit an Auth identity referenced by any private FK.
      select actor_id from fftt_private.audit_events
      union select created_by from fftt_private.brackets
      union select reviewed_by from fftt_private.consolation_reviews
      union select completed_by from fftt_private.doubles_finale
      union select progress_updated_by from fftt_private.doubles_finale
      union select granted_by from fftt_private.event_staff
      union select user_id from fftt_private.event_staff
      union select created_by from fftt_private.events
      union select actor_id from fftt_private.game_progress_decisions
      union select updated_by from fftt_private.match_game_progress
      union select user_id from fftt_private.platform_organizers
      union select linked_by from fftt_private.registration_links
      union select updated_by from fftt_private.registration_sources
      union select actor_id from fftt_private.result_submissions
      union select actor_id from fftt_private.score_decisions_v2
      union select actor_id from fftt_private.showcase_reset_decisions
    )
)
 , grouped as (
  -- Pin a bytewise sort for NEW backups; old ICU-sorted exports remain
  -- verifiable with the strict compatibility path in restore_verify.mjs.
  select tbl, count(*) as n, md5(coalesce(jsonb_agg(j order by j::text collate "C")::text, '')) as fp,
         coalesce(jsonb_agg(j order by j::text collate "C")::text, '[]') as data
  from t group by 1
), expected(tbl) as (values
  ('audit_events'),('brackets'),('consolation_reviews'),('deleted_events'),('doubles_finale'),
  ('event_staff'),('events'),('game_progress_decisions'),('match_game_progress'),('matches'),
  ('platform_organizers'),('players'),('registration_links'),('registration_sources'),
  ('result_submissions'),('score_decisions_v2'),('showcase_progress_watermarks'),
  ('showcase_reset_baseline'),('showcase_reset_decisions'),('auth_users')
)
select expected.tbl, coalesce(grouped.n,0) as n, coalesce(grouped.fp,md5('')) as fp,
       coalesce(grouped.data,'[]') as data
from expected left join grouped on grouped.tbl=expected.tbl order by expected.tbl;
