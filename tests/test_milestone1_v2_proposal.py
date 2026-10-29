"""Static safety review of unapplied Milestone 1 v2 SQL proposal ONLY.
Does not run PostgreSQL, deploy, authenticate, or prove transaction semantics.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / 'supabase/proposals/MILESTONE1_DURABLE_SCORING_V2_DO_NOT_APPLY.sql'
SOURCE = PATH.read_text(encoding='utf-8')
LOW = SOURCE.lower()


class ProposedMilestone1ScoringSafety(unittest.TestCase):
    def test_stays_out_of_executable_migrations(self):
        self.assertTrue(PATH.is_file())
        self.assertIn('DO NOT APPLY', SOURCE)
        self.assertIn('SEPARATE EXPLICIT APPROVAL', SOURCE)
        self.assertFalse(any('durable_scoring_v2' in p.name.lower()
                             for p in (ROOT / 'supabase/migrations').glob('*.sql')))

    def test_one_transaction_and_explicit_api_cutover(self):
        self.assertRegex(LOW, r'\bbegin;\s*create table')
        self.assertTrue(LOW.strip().endswith('commit;'))
        self.assertIn('revoke execute on function public.fftt_submit_match_result_v1(', LOW)
        self.assertIn('revoke execute on function fftt_private.submit_match_result_v1(', LOW)
        self.assertIn('grant execute on function public.fftt_submit_match_result_v2(', LOW)

    def test_private_append_only_owner_scoped_decision_ledger(self):
        self.assertIn('create table fftt_private.score_decisions_v2', LOW)
        self.assertIn('primary key (event_id,actor_id,submission_id)', LOW)
        self.assertIn('enable row level security', LOW)
        self.assertIn('revoke all on fftt_private.score_decisions_v2 from public,anon,authenticated;', LOW)
        self.assertIn('fftt_decisions_v2_append_only', LOW)
        self.assertIn("status='rejected' and reason='stale-match-version'", LOW)

    def test_lock_then_role_then_read_within_score_function(self):
        fn = LOW.split('create function fftt_private.submit_match_result_v2(', 1)[1].split('$v2$;',1)[0]
        event_lock = fn.index('for update;')
        role = fn.index('perform fftt_private.staff_role_for_event(p_event_id);')
        decision = fn.index('from fftt_private.score_decisions_v2')
        self.assertLess(event_lock, role)
        self.assertLess(role, decision)
        self.assertIn('v_actor := auth.uid();',fn)
        self.assertIn('actor_id=v_actor',fn)
        self.assertNotIn('p_actor_id',fn)

    def test_accepted_score_uses_current_engine_and_atomic_receipt(self):
        fn = LOW.split('create function fftt_private.submit_match_result_v2(', 1)[1].split('$v2$;',1)[0]
        legacy = fn.index('v_accepted := fftt_private.submit_match_result_v1(')
        ledger = fn.index('insert into fftt_private.score_decisions_v2(')
        self.assertLess(legacy,ledger)
        self.assertIn('from fftt_private.result_submissions',fn)
        self.assertIn('request_fingerprint <> v_fingerprint',fn)
        self.assertIn("v_previous.response ->> 'status' is distinct from 'accepted'",fn)

    def test_terminal_rejection_is_narrow_and_not_generic_exception(self):
        fn = LOW.split('create function fftt_private.submit_match_result_v2(', 1)[1].split('$v2$;',1)[0]
        self.assertIn("v_reason := 'stale-match-version';",fn)
        self.assertIn("if v_match.status='complete'",fn)
        self.assertIn("or v_match.match_version <> p_expected_match_version",fn)
        self.assertNotIn('when others',fn)
        self.assertNotIn('on conflict do update',fn)

    def test_owner_scoped_snapshot_locks_same_event(self):
        fn = LOW.split('create function fftt_private.score_decision_snapshot_v2(', 1)[1].split('$v2$;',1)[0]
        self.assertLess(fn.index('for share;'),
                        fn.index('perform fftt_private.staff_role_for_event(p_event_id);'))
        self.assertLess(fn.index('perform fftt_private.staff_role_for_event(p_event_id);'),
                        fn.index('from fftt_private.score_decisions_v2'))
        self.assertIn('actor_id=v_actor',fn)
        self.assertIn('submission_id=p_submission_id',fn)
        self.assertIn("'decision',v_result",fn)
        self.assertIn("'revision',v_event.revision",fn)
        self.assertNotIn('p_actor_id',fn)

    def test_explicit_allowlisted_wrappers_and_no_publication_write(self):
        self.assertIn('security definer set search_path',LOW)
        self.assertIn('security invoker set search_path',LOW)
        self.assertIn('revoke all on function public.fftt_score_decision_snapshot_v2(uuid,uuid)',LOW)
        self.assertIn('grant execute on function public.fftt_score_decision_snapshot_v2(uuid,uuid)',LOW)
        self.assertNotIn('insert into public.fftt_published_',LOW)
        self.assertNotIn('update public.fftt_published_',LOW)
        self.assertNotIn('auth.users values',LOW)
        self.assertNotIn('delete from fftt_private.matches',LOW)

if __name__ == '__main__':
    unittest.main()
