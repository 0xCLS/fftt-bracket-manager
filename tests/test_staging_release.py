#!/usr/bin/env python3
"""The automatic staging pipeline's decisions: what to deploy, when the regression gate is satisfied, bundle integrity,
and the hard-wired staging-only boundaries. Zero network; publishes nothing."""
import hashlib, json, re, shutil, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'ops'))
import staging_release as R
import verify_deployment as V

SHA = 'a' * 40


def run(name, status='completed', conclusion='success'):
    return {'name': name, 'status': status, 'conclusion': conclusion}


def manifest(files, commit=SHA, target='staff', env='staging'):
    return {'commit': commit, 'environment': env, 'target': target, 'files': files}


class Decisions(unittest.TestCase):
    def test_same_content_from_a_different_commit_is_not_redeployed(self):
        local = manifest({'a': '1', 'b': '2'}, commit='b' * 40)
        live = manifest({'b': '2', 'a': '1'}, commit='c' * 40)
        self.assertFalse(R.needs_deploy(local, live, False)[0])

    def test_any_file_difference_or_unreachable_site_deploys(self):
        self.assertTrue(R.needs_deploy(manifest({'a': '1'}), manifest({'a': '2'}), False)[0])
        self.assertTrue(R.needs_deploy(manifest({'a': '1'}), manifest({'a': '1', 'b': '2'}), False)[0])
        self.assertTrue(R.needs_deploy(manifest({'a': '1'}), None, False)[0])

    def test_function_change_deploys_even_when_static_files_match(self):
        self.assertTrue(R.needs_deploy(manifest({'a': '1'}), manifest({'a': '1'}), True)[0])

    def test_unknown_live_commit_is_treated_as_function_changed(self):
        self.assertTrue(R.function_source_changed(None, SHA))
        self.assertTrue(R.function_source_changed('f' * 40, 'e' * 40))   # not in this repository

    def test_gate_needs_every_full_job_green(self):
        ok = [run(n) for n in R.REQUIRED_CHECKS]
        self.assertEqual(R.evaluate(ok)[0], 'ready')
        self.assertEqual(R.evaluate(ok[:2])[0], 'dispatch')   # one required job never ran

    def test_gate_never_accepts_a_fast_lane_or_skipped_jobs(self):
        fast = [run(R.CLASSIFY_CHECK), run('Fast UI checks (fictional Chrome)')] + [run(n, conclusion='skipped') for n in R.REQUIRED_CHECKS]
        self.assertEqual(R.evaluate(fast)[0], 'dispatch')
        self.assertEqual(R.evaluate([])[0], 'dispatch')

    def test_gate_waits_for_running_jobs_and_fails_on_any_failure(self):
        running = [run(R.REQUIRED_CHECKS[0], 'in_progress', None)] + [run(n) for n in R.REQUIRED_CHECKS[1:]]
        self.assertEqual(R.evaluate(running)[0], 'wait')
        failed = [run(R.REQUIRED_CHECKS[0], conclusion='failure')] + [run(n) for n in R.REQUIRED_CHECKS[1:]]
        self.assertEqual(R.evaluate(failed)[0], 'fail')
        timed = [run(R.REQUIRED_CHECKS[0], conclusion='timed_out')] + [run(n, 'queued', None) for n in R.REQUIRED_CHECKS[1:]]
        self.assertEqual(R.evaluate(timed)[0], 'fail')

    def test_a_green_rerun_supersedes_an_earlier_failure_but_a_cancelled_run_is_not_a_pass(self):
        rerun = [run(n, conclusion='failure') for n in R.REQUIRED_CHECKS] + [run(n) for n in R.REQUIRED_CHECKS]
        self.assertEqual(R.evaluate(rerun)[0], 'ready')
        cancelled = [run(n, conclusion='cancelled') for n in R.REQUIRED_CHECKS]
        self.assertEqual(R.evaluate(cancelled)[0], 'dispatch')

    def test_required_check_names_match_the_regression_workflow(self):
        wf = (ROOT / '.github' / 'workflows' / 'browser-tests.yml').read_text()
        names = set(re.findall(r'^    name: (.+)$', wf, flags=re.M))
        for n in (*R.REQUIRED_CHECKS, R.CLASSIFY_CHECK):
            self.assertIn(n, names, f'{n!r} is not a job name in browser-tests.yml')

    def test_preview_url_is_the_unique_deployment_not_the_alias(self):
        out = 'Take a peek over at https://1a2b3c4d.fftt3-staff-stg.pages.dev\nalias https://ci-verify.fftt3-staff-stg.pages.dev'
        self.assertEqual(R.preview_url(out, 'fftt3-staff-stg'), 'https://1a2b3c4d.fftt3-staff-stg.pages.dev')
        self.assertIsNone(R.preview_url(out, 'fftt3-games-stg'))


class PreviewFunctionSafety(unittest.TestCase):
    def test_preview_accepts_only_explicit_fail_closed_unconfigured_response(self):
        safe = b'{"error":"registration-not-configured"}'
        self.assertTrue(V.staff_get_ok(503, safe, static_only=True))
        self.assertTrue(V.staff_get_ok(405, b'{"error":"method-not-allowed"}', static_only=True))
        for body in [b'', b'error', b'{"error":"service-unavailable"}',
                     b'{"error":"registration-not-configured","registrants":[]}',
                     b'{"error":"registration-not-configured","debug":"internal"}',
                     b'[]', b'{"error":"registration-not-configured"']:
            self.assertFalse(V.staff_get_ok(503, body, static_only=True), body)
        for code in [200, 401, 403, 404, 500, 502, 504]:
            self.assertFalse(V.staff_get_ok(code, safe, static_only=True), code)

    def test_live_still_requires_405_even_with_missing_configuration(self):
        self.assertTrue(V.staff_get_ok(405, b'', static_only=False))
        self.assertFalse(V.staff_get_ok(503, b'{"error":"registration-not-configured"}', static_only=False))
        self.assertFalse(V.staff_get_ok(200, b'{"registrants":[]}', static_only=False))


class Boundaries(unittest.TestCase):
    def test_only_the_two_staging_projects_and_origins_are_reachable(self):
        self.assertEqual({a['project'] for a in R.APPS.values()}, {'fftt3-staff-stg', 'fftt3-games-stg'})
        for a in R.APPS.values():
            self.assertTrue(a['origin'].endswith('-stg.pages.dev'))
            self.assertIn(a['project'], a['origin'])

    def test_no_environment_or_project_input_exists(self):
        src = (ROOT / 'tools' / 'ops' / 'staging_release.py').read_text()
        self.assertNotIn("'--project", src.replace("'--project-name'", ''))
        self.assertNotIn("'--environment', 'production'", src)
        self.assertNotIn('secret put', src)

    def test_workflow_is_staging_only_and_least_privilege(self):
        wf = (ROOT / '.github' / 'workflows' / 'deploy-staging.yml').read_text()
        self.assertIn(f'branches: [{R.BRANCH}]', wf)
        self.assertNotIn('branches: [main]', wf)
        self.assertEqual(wf.count('environment: staging'), 1)               # secrets exist only in this job
        self.assertEqual(wf.count('CLOUDFLARE_API_TOKEN'), 2)               # secret read + passed once, only in the deploy job
        self.assertNotIn('pull_request', wf)                                # a fork or PR can never reach the token
        self.assertRegex(wf, r'permissions:\s*\n\s*contents: read')
        for uses in re.findall(r'uses: (\S+)', wf):
            self.assertRegex(uses, r'@v\d+$')


class BundleIntegrity(unittest.TestCase):
    def make(self, tmp, commit=SHA, kind='staff', env='staging'):
        root = Path(tmp)
        (root / 'app').mkdir(parents=True, exist_ok=True)
        (root / 'app' / 'x.mjs').write_bytes(b'export {}')
        files = {'app/x.mjs': hashlib.sha256(b'export {}').hexdigest()}
        (root / 'MANIFEST.json').write_text(json.dumps(manifest(files, commit, kind, env)))
        return root

    def test_a_faithful_bundle_passes(self):
        with tempfile.TemporaryDirectory() as t:
            self.assertEqual(R.check_bundle(self.make(t), SHA, 'staff'), [])

    def test_wrong_commit_kind_or_environment_is_refused(self):
        with tempfile.TemporaryDirectory() as t:
            root = self.make(t)
            self.assertTrue(R.check_bundle(root, 'b' * 40, 'staff'))
            self.assertTrue(R.check_bundle(root, SHA, 'spectator'))
        with tempfile.TemporaryDirectory() as t:
            self.assertTrue(R.check_bundle(self.make(t, env='production'), SHA, 'staff'))

    def test_tampered_missing_or_extra_files_are_refused(self):
        with tempfile.TemporaryDirectory() as t:
            root = self.make(t)
            (root / 'app' / 'x.mjs').write_bytes(b'tampered')
            self.assertTrue(any('hash mismatch' in p for p in R.check_bundle(root, SHA, 'staff')))
        with tempfile.TemporaryDirectory() as t:
            root = self.make(t)
            (root / 'app' / 'x.mjs').unlink()
            self.assertTrue(any('missing' in p for p in R.check_bundle(root, SHA, 'staff')))
        with tempfile.TemporaryDirectory() as t:
            root = self.make(t)
            (root / 'app' / 'extra.mjs').write_bytes(b'1')
            self.assertTrue(any('not in the manifest' in p for p in R.check_bundle(root, SHA, 'staff')))


if __name__ == '__main__':
    unittest.main()
