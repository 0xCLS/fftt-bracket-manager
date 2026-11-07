#!/usr/bin/env python3
"""The production Staff release guard: it must accept only the production Staff project and refuse staging, Spectator and the
homepage by name and by served identity. Zero network (the live manifests are injected)."""
import json, re, sys, tempfile, unittest, urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'ops'))
import staff_release_guard as G

LIVE = '9' * 40
NEW = 'a' * 40
FILES = {'app/a.mjs': '1', 'app/b.mjs': '2'}
PROFILE = {'environment': 'production', 'approvedPublicStaticOrigins': [], 'approvedHttpsOrigins': [G.STAFF_ORIGIN], 'spectatorOrigin': G.SPECTATOR_ORIGIN}


def manifest(commit=LIVE, target='staff', env='production', files=None):
    return {'commit': commit, 'environment': env, 'target': target, 'files': dict(files or FILES)}


def fetcher(by_origin):
    def fetch(url):
        origin = url.rsplit('/MANIFEST.json', 1)[0]
        value = by_origin[origin]
        if isinstance(value, Exception):
            raise value
        return value
    return fetch


def bundle(tmp, m=None, profile=None, extra=()):
    d = Path(tmp)
    m = m or manifest(NEW, files={**FILES, 'app/a.mjs': 'changed', 'app/new.mjs': '3'})
    (d / 'app').mkdir(parents=True, exist_ok=True)
    (d / 'MANIFEST.json').write_text(json.dumps(m))
    (d / 'app' / 'origin-profile.json').write_text(json.dumps(PROFILE if profile is None else profile))
    for path in list(m['files']) + list(extra):
        (d / path).parent.mkdir(parents=True, exist_ok=True)
        (d / path).write_text('x')
    return d


def good_live():
    return fetcher({G.STAFF_ORIGIN: manifest(), G.STAFF_PAGES_ORIGIN: manifest()})


class Guard(unittest.TestCase):
    def run_guard(self, project='fftt-staff', fetch=None, **kw):
        lines = []
        ok = G.run(project, fetch=fetch or good_live(), out=lines.append, **kw)
        return ok, '\n'.join(lines)

    def test_only_the_exact_production_staff_project_passes(self):
        self.assertTrue(self.run_guard(live_only=True)[0])
        for name in ('fftt3-staff-stg', 'fftt3-games-stg', 'fftt-games', 'fftt-public', 'FFTT-STAFF', 'fftt-staff ', 'fftt-staff-2', '', 'fftt'):
            ok, text = self.run_guard(name, live_only=True)
            self.assertFalse(ok, name)
            self.assertIn('REFUSED', text)
        self.assertIn('STAGING', self.run_guard('fftt3-staff-stg', live_only=True)[1])
        self.assertIn('must never receive the registration Function', self.run_guard('fftt-games', live_only=True)[1])
        self.assertIn('homepage', self.run_guard('fftt-public', live_only=True)[1])

    def test_live_identity_must_be_production_staff_on_both_names(self):
        for label, bad in (('staging', manifest(target='staff', env='staging')), ('spectator', manifest(target='spectator')),
                           ('no commit', manifest(commit='abc')), ('not a manifest', {'files': []})):
            ok, text = self.run_guard(fetch=fetcher({G.STAFF_ORIGIN: bad, G.STAFF_PAGES_ORIGIN: manifest()}), live_only=True)
            self.assertFalse(ok, label)
            ok, _ = self.run_guard(fetch=fetcher({G.STAFF_ORIGIN: manifest(), G.STAFF_PAGES_ORIGIN: bad}), live_only=True)
            self.assertFalse(ok, label)

    def test_custom_domain_and_pages_name_must_be_the_same_deployment(self):
        ok, text = self.run_guard(fetch=fetcher({G.STAFF_ORIGIN: manifest(), G.STAFF_PAGES_ORIGIN: manifest(commit='b' * 40)}), live_only=True)
        self.assertFalse(ok)
        self.assertIn('not the same project state', text)

    def test_unreachable_live_site_fails_closed(self):
        ok, text = self.run_guard(fetch=fetcher({G.STAFF_ORIGIN: urllib.error.URLError('x'), G.STAFF_PAGES_ORIGIN: manifest()}), live_only=True)
        self.assertFalse(ok)
        self.assertIn('cannot read the live manifest', text)

    def test_good_bundle_passes_and_the_change_set_is_listed(self):
        with tempfile.TemporaryDirectory() as tmp:
            ok, text = self.run_guard(bundle=bundle(tmp), release_commit=NEW)
        self.assertTrue(ok, text)
        self.assertIn('add 1, change 1, remove 0', text)
        self.assertIn('add: app/new.mjs', text)
        self.assertIn('change: app/a.mjs', text)

    def test_bundle_must_be_the_release_commit_production_staff_only(self):
        cases = {
            'wrong commit': dict(m=manifest('b' * 40)),
            'staging bundle': dict(m=manifest(NEW, env='staging')),
            'spectator bundle': dict(m=manifest(NEW, target='spectator')),
            'staging profile': dict(profile={**PROFILE, 'environment': 'staging'}),
            'extra origin': dict(profile={**PROFILE, 'approvedHttpsOrigins': [G.STAFF_ORIGIN, 'https://fftt3-staff-stg.pages.dev']}),
            'extra static origin': dict(profile={**PROFILE, 'approvedPublicStaticOrigins': ['https://x.example']}),
            'other spectator': dict(profile={**PROFILE, 'spectatorOrigin': 'https://fftt3-games-stg.pages.dev'}),
            'server file served': dict(m=manifest(NEW, files={**FILES, 'server/registration/gate.mjs': '9'})),
            'function served': dict(m=manifest(NEW, files={**FILES, 'functions/api/registrations.js': '9'})),
        }
        for label, kw in cases.items():
            with tempfile.TemporaryDirectory() as tmp:
                ok, text = self.run_guard(bundle=bundle(tmp, **kw), release_commit=NEW)
            self.assertFalse(ok, label)

    def test_bundle_and_full_commit_are_required_unless_live_only(self):
        self.assertFalse(self.run_guard()[0])
        self.assertFalse(self.run_guard(release_commit='abc', bundle='x')[0])

    def test_wrong_project_still_fails_with_a_good_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            ok, _ = self.run_guard('fftt3-staff-stg', bundle=bundle(tmp), release_commit=NEW)
        self.assertFalse(ok)

    def test_active_release_documents_use_only_the_production_project_and_never_put_the_secret_in_an_argument(self):
        doc = (ROOT / 'docs/launch/FFTT3_BRACKET_MANAGER_REGISTRATION_2026-11-06.md').read_text()
        section = doc[doc.index('## Release requirements'):doc.index('## Evidence')]
        blocks = re.findall(r'```\n(.*?)```', section, re.S)
        commands = [c for b in blocks for c in re.sub(r'\\\n\s*', ' ', b).splitlines() if c.strip() and not c.startswith('#')]
        commands += re.findall(r'`(npx wrangler[^`\n]*)`', section)   # commands quoted inline
        self.assertTrue(blocks and commands)
        wrangler = [c for c in commands if 'wrangler' in c and ('pages secret' in c or 'pages deploy' in c)]
        self.assertGreaterEqual(len(wrangler), 4)   # secret list, secret put, deploy, secret delete
        for c in wrangler:
            self.assertIn('--project-name fftt-staff', c, c)
            self.assertNotRegex(c, r'stg|games|public', c)
            if 'pages secret' in c:
                self.assertIn('--env production', c, c)
        for c in commands:
            if 'staff_release_guard' in c and '--live-only' not in c:
                self.assertIn('--project fftt-staff', c)
            self.assertNotRegex(c, r'fftt3-|fftt-public', c)   # no staging or homepage name in any command (the production Spectator origin appears only as the export's --spectator-origin)
        # the secret travels by redirected file / pipe only
        for c in commands:
            self.assertNotRegex(c, r'-v\s+gate_secret|gate_secret=|\$\(cat|:.gate_secret|psql[^|<]*-c |postgres(ql)?://|<<<', c)
        install = [c for c in commands if 'install_registration_gate.sql' in c]
        put = [c for c in wrangler if 'pages secret put' in c]
        self.assertEqual(len(install), 1)
        self.assertEqual(len(put), 1)
        for c in install + put:
            self.assertRegex(c, r'<\s*~/Documents/FFTT-private/secrets/REGISTRATION_GATE_SECRET\.txt$')
        # nothing in the active setup says to merge PR #51 or to delete the event list as part of the release
        self.assertNotRegex(section, r'(?i)(must|first|before)[^.]{0,60}(merge|retarget)')
        self.assertIn('nothing has to be merged', section.lower())

    def test_no_active_file_shows_the_secret_in_a_command_line(self):
        for rel in ('supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql', 'tools/ops/install_registration_gate.sql',
                    'docs/launch/FFTT3_BRACKET_MANAGER_REGISTRATION_2026-11-06.md', 'docs/REGISTRATION_SETTINGS_2026-10-27.md'):
            text = (ROOT / rel).read_text()
            self.assertNotRegex(text, r"-v\s+gate_secret|:'gate_secret'|\$\(cat [^)]*SECRET", rel)


if __name__ == '__main__':
    unittest.main()
