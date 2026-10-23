#!/usr/bin/env python3
"""The staging export builder: exact file set, generated profile and headers, hashes, refusals, and
agreement with the runtime origin policy. Builds from a throw-away git repository; publishes nothing."""
import hashlib, json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'staging'))
import build_export as B

ENV = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.invalid',
       'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.invalid'}
ORIGIN = 'https://fftt-staging-example.pages.dev'

def make_repo(tmp):
    repo = Path(tmp) / 'repo'; repo.mkdir()
    for d in ('contracts', 'rehearsals', 'docs', 'tests', 'tools', 'supabase'):
        src = ROOT / d
        if src.exists(): shutil.copytree(src, repo / d, ignore=shutil.ignore_patterns('__pycache__', '*.local.json'))
    (repo / 'docs' / 'private-note.md').write_text('internal')
    run = lambda *a: subprocess.check_call(['git', '-C', str(repo), *a], env=ENV, stdout=subprocess.DEVNULL)
    run('init', '-q'); run('add', '-A'); run('commit', '-q', '-m', 'fixture')
    sha = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    return repo, sha

class StagingExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(); cls.repo, cls.sha = make_repo(cls.tmp)
        cls.out = Path(cls.tmp) / 'out'
        cls.files = B.build(str(cls.repo), cls.sha, 'staging', ORIGIN, str(cls.out))
    @classmethod
    def tearDownClass(cls): shutil.rmtree(cls.tmp, ignore_errors=True)
    def test_only_the_sign_in_closure_is_exported(self):
        f = set(self.files)
        for need in ('rehearsals/m1/staff-login.html', 'rehearsals/m1/staff-login.mjs', 'rehearsals/m1/staff-login.css',
                     'contracts/milestone1_password_session.mjs', 'contracts/milestone1_password_transport.mjs',
                     'contracts/milestone1_staff_session_vault.mjs', 'contracts/milestone1_email_code_recovery.mjs',
                     'contracts/milestone1_device_origin_policy.mjs', 'contracts/milestone1_read_supervisor.mjs',
                     'rehearsals/m1/origin-profile.json', '_headers', 'MANIFEST.json'):
            self.assertIn(need, f)
        for p in f:
            self.assertFalse(p.startswith(('tests/', 'docs/', 'tools/', 'supabase/', '.git')), p)
            self.assertFalse(p.endswith(('.py', '.sql', '.sh', '.log', '.local.json')), p)
        # no scoring, fallback, PKCE-link or public-display code ships with the staff app
        for p in f: self.assertNotRegex(p, r'score|fallback|pkce|public_display|tv-display|spectator')
        self.assertLess(len(f), 25)
        on_disk = {str(p.relative_to(self.out)) for p in self.out.rglob('*') if p.is_file()}
        self.assertEqual(on_disk, f)
    def test_generated_profile_matches_the_environment(self):
        prof = json.loads((self.out / 'rehearsals/m1/origin-profile.json').read_text())
        self.assertEqual(prof, {'environment': 'staging', 'approvedPublicStaticOrigins':
            [{'origin': ORIGIN, 'environment': 'staging', 'dedicatedOrigin': True}], 'approvedHttpsOrigins': []})
    def test_headers_are_strict(self):
        h = (self.out / '_headers').read_text()
        for need in ("default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'",
                     'Strict-Transport-Security', 'nosniff', 'Referrer-Policy: no-referrer', 'noindex'):
            self.assertIn(need, h)
        self.assertNotIn('unsafe-inline', h); self.assertNotIn('unsafe-eval', h); self.assertNotIn('*.', h)
        self.assertEqual(h.count('https://'), 1, 'the only remote origin allowed is the Supabase project')
    def test_manifest_hashes_match_every_file(self):
        m = json.loads((self.out / 'MANIFEST.json').read_text())
        self.assertEqual(m['commit'], self.sha)
        for p, digest in m['files'].items():
            self.assertEqual(hashlib.sha256((self.out / p).read_bytes()).hexdigest(), digest, p)
    def test_nothing_secret_or_private_is_exported(self):
        import re
        text = '\n'.join((self.out / p).read_text(errors='replace') for p in self.files)
        # shapes of real leaks (a comment saying a key is ABSENT is fine)
        for pattern in (r'eyJ[A-Za-z0-9_-]{10,}', r'sb_secret_', r'service_role[\'"]?\s*[:=]', r'PGPASSWORD',
                        r'(?i)password\s*[:=]\s*[\'"][^\'"]{6,}', r'private-note', r'[\w.+-]+@(?!example\.(invalid|test|com))[\w-]+\.[a-z]{2,}'):
            self.assertIsNone(re.search(pattern, text), pattern)
        self.assertEqual(sorted(set(re.findall(r'sb_publishable_[A-Za-z0-9_-]+', text))), ['sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0'])
    def test_refusals(self):
        bad_origins = ['https://0xcls.github.io', 'http://x.pages.dev', 'https://x.pages.dev:8443', 'https://x.pages.dev/p',
                       'https://a.b.pages.dev', 'https://x.netlify.app', 'https://x.vercel.app', 'https://*.pages.dev',
                       'https://x.example.com', 'https://x.pages.dev ', '', None]
        for o in bad_origins:
            with self.subTest(origin=o), self.assertRaises(SystemExit):
                B.build(str(self.repo), self.sha, 'staging', o, str(Path(self.tmp) / 'x'))
        with self.assertRaises(SystemExit): B.build(str(self.repo), self.sha, 'preview', ORIGIN, str(Path(self.tmp) / 'x'))
        with self.assertRaises(SystemExit): B.build(str(self.repo), 'a' * 40, 'staging', ORIGIN, str(Path(self.tmp) / 'x'))
        (self.repo / 'dirty.txt').write_text('x')
        try:
            with self.assertRaises(SystemExit): B.build(str(self.repo), self.sha, 'staging', ORIGIN, str(Path(self.tmp) / 'x'))
        finally: (self.repo / 'dirty.txt').unlink()
    def test_builder_and_runtime_policy_agree_on_origins(self):
        cases = [ORIGIN, 'https://fftt-staff-example.github.io', 'https://0xcls.github.io', 'http://x.pages.dev',
                 'https://x.pages.dev:8443', 'https://x.pages.dev/p', 'https://a.b.pages.dev', 'https://x.netlify.app',
                 'https://github.io', 'https://pages.dev', 'https://x.example.com', 'https://*.pages.dev', 'https://X.Pages.Dev']
        js = ("import {normalizeApprovedPublicStaticOrigins as n} from %s;"
              "const out=JSON.parse(process.argv[1]).map(o=>{try{n([{origin:o,environment:'staging',dedicatedOrigin:true}]);return true}catch{return false}});"
              "console.log(JSON.stringify(out))") % json.dumps((ROOT / 'contracts/milestone1_device_origin_policy.mjs').as_uri())
        node = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js, json.dumps(cases)], text=True))
        self.assertEqual([B.valid_origin(o) for o in cases], node)

if __name__ == '__main__': unittest.main()
