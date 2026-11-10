-- Rollback for FFTT3_COMPLETED_EVENT_RENAME_20261109. Drops ONLY the two functions the proposal created.
-- Names already changed stay changed (and audited); no event data is touched. Separate authorization required.
begin;
drop function if exists public.fftt_rename_completed_event_v1(uuid,text,text);
drop function if exists fftt_private.rename_completed_event_v1(uuid,text,text);
commit;
