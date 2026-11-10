-- Rollback for FFTT3_PREPLAY_WITHDRAWAL_ELIGIBILITY_20261110. Drops ONLY the two read-only functions it created.
-- No data is touched. The new Staff build fails closed (hides the withdrawal control) without them. Separate authorization required.
begin;
drop function if exists public.fftt_preplay_withdrawal_eligibility_v1(uuid);
drop function if exists fftt_private.preplay_withdrawal_eligibility_v1(uuid);
commit;
