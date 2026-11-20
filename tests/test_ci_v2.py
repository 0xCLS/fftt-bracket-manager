"""Cheap, network-free CI v2 policy tests. No hosted services or browser."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import subprocess
import shutil
import struct
import zlib
from unittest.mock import patch

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

    def test_approved_static_png_webp_assets_take_focused_public_lane(self):
        def chunk(tag, data):
            body = tag + data
            return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
        def png(w=1, h=1):
            ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
            return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
                    chunk(b'IDAT', zlib.compress(b'\x00\x00\x00\x00\x00')) + chunk(b'IEND', b''))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets = root / 'app/assets'
            assets.mkdir(parents=True)
            target = assets / 'trophy-exact.png'
            target.write_bytes(png())
            self.assertEqual(ci.select(['app/assets/trophy-exact.png'], root)['lanes'], ['public'])
            self.assertFalse(ci.select(['app/assets/trophy-exact.png'], root)['manual'])
            # Actual repository WebP exercises the lossless/lossy media header path.
            shutil.copyfile(ROOT / 'app/assets/emblem.webp', assets / 'trophy-exact.webp')
            self.assertFalse(ci.select(['app/assets/trophy-exact.webp'], root)['manual'])
            self.assertTrue(ci.select(['app/assets/trophy-exact.webp'])['manual'],
                            'without a verified checkout, fail closed')
            # Runtime changes still require proof even alongside a valid image.
            combo = ci.select(['app/assets/trophy-exact.webp', 'server/auth.mjs'], root)
            self.assertTrue(combo['manual'])
            self.assertIn('public', combo['lanes'])
            self.assertIn('auth', combo['lanes'])

            # A file's extension alone never grants the exception.
            target.write_bytes(b'<script>alert(1)</script>')
            self.assertTrue(ci.select(['app/assets/trophy-exact.png'], root)['manual'])
            target.write_bytes(png(8192, 8192))
            self.assertTrue(ci.select(['app/assets/trophy-exact.png'], root)['manual'])
            target.write_bytes(png() + b'extra-data')
            self.assertTrue(ci.select(['app/assets/trophy-exact.png'], root)['manual'])
            target.write_bytes(b'x' * (ci.MAX_PUBLIC_IMAGE_BYTES + 1))
            self.assertTrue(ci.select(['app/assets/trophy-exact.png'], root)['manual'])
            webp = assets / 'trophy-exact.webp'
            webp.write_bytes(b'<svg><script>bad()</script></svg>')
            self.assertTrue(ci.select(['app/assets/trophy-exact.webp'], root)['manual'])
            # An extended WebP flagged as animated is not a static icon.
            chunk = b'\x02' + b'\x00' * 9
            webp.write_bytes(b'RIFF' + (22).to_bytes(4, 'little') +
                             b'WEBP' + b'VP8X' + (10).to_bytes(4, 'little') + chunk)
            self.assertTrue(ci.select(['app/assets/trophy-exact.webp'], root)['manual'])
            # Valid container bytes must still meet the conservative dimension cap.
            chunk = b'\x00' * 4 + (5000 - 1).to_bytes(3, 'little') + (50 - 1).to_bytes(3, 'little')
            webp.write_bytes(b'RIFF' + (22).to_bytes(4, 'little') +
                             b'WEBP' + b'VP8X' + (10).to_bytes(4, 'little') + chunk)
            self.assertTrue(ci.select(['app/assets/trophy-exact.webp'], root)['manual'])
            target.unlink()
            target.symlink_to(ROOT / 'app/assets/emblem.webp')
            self.assertTrue(ci.select(['app/assets/trophy-exact.png'], root)['manual'])
            self.assertTrue(ci.select(['app/assets/unavailable.png'], root)['manual'])
            for unsafe in ('app/assets/active.svg', 'app/assets/module.js',
                           'app/assets/icon.gif', 'app/assets/icon.webp.mjs',
                           'app/assets/../server/evil.webp'):
                self.assertTrue(ci.select([unsafe], root)['manual'], unsafe)

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

    def test_real_git_merge_base_diff_and_no_spurious_full(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'app').mkdir()
            (root / 'app/tv.css').write_text('.score { color: white; }\n')
            def git(*args):
                return subprocess.check_output(['git', '-C', folder, *args], text=True, stderr=subprocess.DEVNULL).strip()
            git('init')
            git('config', 'user.name', 'CI Fixture')
            git('config', 'user.email', 'ci@example.invalid')
            git('add', '.')
            git('commit', '-m', 'base')
            base = git('rev-parse', 'HEAD')
            (root / 'app/tv.css').write_text('.score { color: cyan; }\n')
            git('add', '.')
            git('commit', '-m', 'visual')
            head = git('rev-parse', 'HEAD')
            with patch.object(ci, 'ROOT', root):
                self.assertEqual(ci.changed_paths(base, head), ['app/tv.css'])
                self.assertFalse(ci.select(ci.changed_paths(base, head))['manual'])
                with self.assertRaises(ValueError):
                    ci.changed_paths(head, base)

    def test_invalid_git_history_is_not_an_automatic_full_trigger(self):
        with self.assertRaises(ValueError):
            ci.changed_paths('', 'x')


if __name__ == '__main__':
    unittest.main()
