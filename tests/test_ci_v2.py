"""Cheap, network-free CI v2 policy tests. No hosted services or browser."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('ci_v2', ROOT/'tools/ci_v2.py')
ci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci)


class RoutingTests(unittest.TestCase):
    def test_tv_layout_never_launches_full(self):
        for paths in (['app/tv.css'], ['app/tv.mjs', 'tests/e2e/tv_presentation.test.mjs']):
            p = ci.select(paths)
            self.assertEqual(p['lanes'], ['tv', 'public'])
            self.assertFalse(p['manual'])

    def test_scoring_auth_database_and_unknown_do_not_autorun_full(self):
        for path in ('contracts/gameday_engine.mjs', 'app/staff_core.mjs',
                     'server/api.mjs', 'supabase/proposals/v6.sql',
                     '.github/workflows/fast-ci.yml', 'tools/ci_v2.py',
                     'tests/test_ci_v2.py', 'unexpected.js'):
            self.assertTrue(ci.select([path])['manual'], path)

    def test_cumulative_scope_cannot_be_escaped_by_later_cosmetic_edits(self):
        p = ci.select(['contracts/gameday_engine.mjs', 'app/tv.css'])
        self.assertTrue(p['manual'])
        self.assertIn('scoring', p['lanes'])

    def test_docs_only_and_empty_range(self):
        self.assertEqual(ci.select(['docs/CI_TESTING_POLICY.md'])['lanes'], [])
        self.assertFalse(ci.select(['docs/CI_TESTING_POLICY.md'])['manual'])
        self.assertTrue(ci.select([])['manual'])

    def test_suite_names_are_unique_and_known(self):
        self.assertEqual(len(ci.tests_for(['tv', 'public', 'tv'])), len(set(ci.tests_for(['tv', 'public']))))
        with self.assertRaises(ValueError):
            ci.tests_for(['all'])

    def test_unrelated_features_never_trigger_tv(self):
        self.assertNotIn('tv', ci.select(['app/view_players.mjs'])['lanes'])
        self.assertNotIn('tv', ci.select(['tests/registration_model.test.mjs'])['lanes'])

    def test_manual_proof_must_match_sha_and_all_jobs(self):
        sha = 'a'*40
        good = {'id': 1, 'head_sha': sha, 'event': 'workflow_dispatch', 'status': 'completed',
                'conclusion': 'success', 'path': '.github/workflows/browser-tests.yml'}
        jobs = [{'name': n, 'status': 'completed', 'conclusion': 'success'} for n in ci.FULL_JOBS]
        self.assertTrue(ci.proof_from_runs([good], lambda _: jobs, sha))
        self.assertFalse(ci.proof_from_runs([dict(good, head_sha='b'*40)], lambda _: jobs, sha))
        self.assertFalse(ci.proof_from_runs([dict(good, event='pull_request')], lambda _: jobs, sha))
        self.assertFalse(ci.proof_from_runs([good], lambda _: jobs[:-1], sha))
        self.assertFalse(ci.proof_from_runs([dict(good, conclusion='cancelled')], lambda _: jobs, sha))

    def test_invalid_git_history_is_not_an_automatic_full_trigger(self):
        with self.assertRaises(ValueError):
            ci.changed_paths('', 'x')


if __name__ == '__main__':
    unittest.main()
