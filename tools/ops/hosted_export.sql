-- FFTT private backup: ONE read-only query for the Supabase SQL editor or Management API. It reads all 14 reviewed
-- FFTT application tables plus referenced Auth identities (id, email, created_at, is_anonymous only).
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
  union all select 'matches', to_jsonb(x) from fftt_private.matches x
  union all select 'platform_organizers', to_jsonb(x) from fftt_private.platform_organizers x
  union all select 'players', to_jsonb(x) from fftt_private.players x
  union all select 'registration_links', to_jsonb(x) from fftt_private.registration_links x
  union all select 'registration_sources', to_jsonb(x) from fftt_private.registration_sources x
  union all select 'result_submissions', to_jsonb(x) from fftt_private.result_submissions x
  union all select 'score_decisions_v2', to_jsonb(x) from fftt_private.score_decisions_v2 x
  union all select 'auth_users', jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'is_anonymous', u.is_anonymous)
    from auth.users u
    where u.id in (select user_id from fftt_private.event_staff union select user_id from fftt_private.platform_organizers
                   union select created_by from fftt_private.events where created_by is not null)
)
 , grouped as (
  select tbl, count(*) as n, md5(coalesce(jsonb_agg(j order by j::text)::text, '')) as fp,
         coalesce(jsonb_agg(j order by j::text)::text, '[]') as data
  from t group by 1
), expected(tbl) as (values
  ('audit_events'),('brackets'),('consolation_reviews'),('deleted_events'),('doubles_finale'),
  ('event_staff'),('events'),('matches'),('platform_organizers'),('players'),
  ('registration_links'),('registration_sources'),('result_submissions'),('score_decisions_v2'),('auth_users')
)
select expected.tbl, coalesce(grouped.n,0) as n, coalesce(grouped.fp,md5('')) as fp,
       coalesce(grouped.data,'[]') as data
from expected left join grouped on grouped.tbl=expected.tbl order by expected.tbl;
