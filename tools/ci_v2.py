#!/usr/bin/env python3
"""FFTT CI v2: predictable, bounded, path-based checks; never launches full CI.

A complete PR merge-base diff is classified once. Unknown and sensitive paths
require independently approved, exact-SHA full-suite proof before PR approval.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

ROOT = Path(os.environ.get('FFTT_CI_ROOT', Path(__file__).resolve().parents[1]))
SHA = re.compile(r'^[0-9a-f]{40}$')
SUITE_ORDER = ('tv', 'public', 'staff', 'registration', 'scoring', 'auth', 'database')
FULL_JOBS = frozenset({
    'Full regression — browser and security foundation',
    'Full regression — game-day and launch workflows',
    'Disposable synthetic PostgreSQL',
})

# Exact entry points, not wildcard commands. Duplicated files run only once.
SUITES = {
    'tv': ('tests/e2e/tv_presentation.test.mjs',
           'tests/milestone1_public_spectator_isolation.test.mjs'),
    'public': ('tests/public_event_selection.test.mjs',
               'tests/spectator_presentation.test.mjs',
               'tests/milestone1_public_results.test.mjs',
               'tests/e2e/public_presentation.test.mjs'),
    'staff': ('tests/e2e/gameday_fast_ui_browser.test.mjs',
              'tests/fftt3_bracket_manager_role.test.mjs',
              'tests/e2e/staff_dialog_x_null_rename_browser.test.mjs',
              'tests/e2e/completed_event_rename.test.mjs'),
    'registration': ('tests/registration_model.test.mjs',
                     'tests/registration_handler.test.mjs',
                     'tests/e2e/gameday_registration_browser.test.mjs'),
    'scoring': ('tests/gameday_formats.test.mjs',
                'tests/milestone1_score_coordinator.test.mjs',
                'tests/e2e/gameday_core.test.mjs',
                 'tests/e2e/gameday_rehearsal_walkovers.test.mjs'),
    'auth': ('tests/milestone1_staff_access_gate.test.mjs',
             'tests/milestone1_staff_revocation.test.mjs',
             'tests/milestone1_password_auth.test.mjs'),
    'database': ('tests/e2e/gameday_real_event_candidate.test.mjs',
                 'tests/fftt_backup_cli.test.mjs',
                 'tests/fftt_cloud_copy.test.mjs',
                 'tests/e2e/ops_restore_rehearsal.test.mjs',
                 'tests/e2e/walkover_install_compose.test.mjs'),
}


def select(paths):
    """Return immutable lanes, authorization requirement and rationale.

    If any path is unrecognized, don't guess that it is UI. Guarded changes may
    still receive fast checks, but cannot be merged/released on them alone.
    """
    lanes, manual, reasons = set(), False, set()
    clean = sorted(set(paths))
    if not clean:
        return {'lanes': [], 'manual': True, 'reasons': ['unverifiable or empty change'], 'paths': []}
    for path in clean:
        if (path.startswith('docs/') and path.endswith('.md')) or (path.endswith('.md') and path in {'README.md', 'CHANGELOG.md'}):
            continue
        if path in {'app/tv.css', 'app/tv.html', 'app/tv.mjs', 'tests/e2e/tv_presentation.test.mjs'}:
            lanes.update(('tv', 'public'))
        elif path in {'app/spectator.html', 'app/spectator.mjs', 'app/public_core.mjs',
                      'app/date_format.mjs', 'contracts/gameday_public.mjs'} or path.startswith('public-site/'):
            lanes.add('public')
        elif path in {'app/app.css', 'app/view_players.mjs', 'app/view_registration.mjs',
                      'app/view_desk_registration.mjs', 'tests/e2e/gameday_fast_ui_browser.test.mjs'}:
            lanes.add('staff')
        elif path.startswith('app/staff') or path.startswith('app/view_'):
            lanes.update(('staff', 'auth'))
            manual = True
            reasons.add('protected Staff actions or permissions')
        elif path.startswith('tests/e2e/') and ('tv_' in path or 'public_' in path):
            lanes.update(('tv', 'public'))
        elif path.startswith('tests/e2e/') and ('registration' in path or 'checkin' in path):
            lanes.add('registration')
        elif path.startswith('tests/registration_'):
            lanes.add('registration')
        elif path.startswith(('app/game_tiles', 'contracts/gameday_', 'tests/gameday_', 'tests/milestone1_score_')):
            lanes.update(('scoring', 'public'))
            manual = True
            reasons.add('scoring or authoritative tournament model')
        elif path.startswith(('server/', 'functions/', 'supabase/')) or path.endswith('.sql'):
            lanes.update(('database', 'auth'))
            manual = True
            reasons.add('server, SQL, permissions, or migration')
        elif path.startswith(('tests/milestone1_password_', 'tests/milestone1_pkce_', 'tests/milestone1_staff_')):
            lanes.add('auth')
            manual = True
            reasons.add('authentication or access-control tests')
        elif path in {'tools/ops/fftt_backup.mjs','tools/ops/restore_verify.mjs',
                      'tools/ops/hosted_export.sql','tests/fftt_backup_cli.test.mjs',
                      'tests/e2e/ops_restore_rehearsal.test.mjs',
                      'tools/ops/compose_walkover_install.mjs',
                      'tests/e2e/walkover_install_compose.test.mjs'}:
            lanes.add('database')
            manual = True
            reasons.add('protected private backup/restore tooling')
        elif path.startswith(('.github/', 'tools/')) or path.startswith('tests/') or path.endswith(('package.json', 'package-lock.json')):
            manual = True
            reasons.add('test infrastructure, dependency, or unknown test')
        else:
            manual = True
            reasons.add('unknown application file')
    ordered = [x for x in SUITE_ORDER if x in lanes]
    return {'lanes': ordered, 'manual': manual, 'reasons': sorted(reasons), 'paths': clean}


def changed_paths(base, head):
    if not SHA.fullmatch(base or '') or not SHA.fullmatch(head or ''):
        raise ValueError('missing or invalid 40-character commit SHA')
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    if git('rev-parse', 'HEAD') != head:
        raise ValueError('checkout does not match requested PR head')
    start = git('merge-base', base, head)
    if not SHA.fullmatch(start):
        raise ValueError('merge base cannot be verified')
    return git('diff', '--name-only', '--no-renames', start, head).splitlines()


def tests_for(lanes):
    if not set(lanes) <= set(SUITES):
        raise ValueError('unknown test suite')
    return list(dict.fromkeys(path for lane in SUITE_ORDER if lane in lanes for path in SUITES[lane]))


def proof_from_runs(runs, fetch_jobs, sha):
    """Accept only a SUCCESSFUL manual workflow for the exact tested SHA."""
    for run in runs:
        if (run.get('head_sha') != sha or run.get('event') != 'workflow_dispatch'
                or run.get('status') != 'completed' or run.get('conclusion') != 'success'
                or run.get('path') != '.github/workflows/browser-tests.yml'):
            continue
        jobs = fetch_jobs(run['id'])
        good = {j.get('name') for j in jobs if j.get('status') == 'completed' and j.get('conclusion') == 'success'}
        if FULL_JOBS <= good:
            return True
    return False


def verify_manual_proof(head):
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    token = os.environ.get('GH_TOKEN', '')
    if not SHA.fullmatch(head or '') or not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or not token:
        raise ValueError('missing trusted repository, SHA, or read-only GitHub token')
    def api(path):
        request = urllib.request.Request(
            'https://api.github.com/repos/' + repo + path,
            headers={'Authorization': 'Bearer ' + token,
                     'Accept': 'application/vnd.github+json',
                     'User-Agent': 'fftt-ci-v2'})
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    runs = api('/actions/workflows/browser-tests.yml/runs?event=workflow_dispatch&head_sha=' + head + '&per_page=100').get('workflow_runs', [])
    if not proof_from_runs(runs, lambda run_id: api(f'/actions/runs/{run_id}/jobs?per_page=100').get('jobs', []), head):
        raise ValueError('manual full regression for this exact SHA is not approved and green')


def cli():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='cmd', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('--base', required=True)
    plan.add_argument('--head', required=True)
    plan.add_argument('--github-output')
    run = sub.add_parser('run')
    run.add_argument('--lanes', required=True)
    proof = sub.add_parser('verify-manual')
    proof.add_argument('--head', required=True)
    a = p.parse_args()
    if a.cmd == 'plan':
        try:
            result = select(changed_paths(a.base, a.head))
        except (ValueError, subprocess.CalledProcessError) as e:
            result = select([])
            result['reasons'] = [type(e).__name__ + ': unverified range']
        print(json.dumps(result, indent=2))
        if a.github_output:
            with open(a.github_output, 'a', encoding='utf-8') as output:
                output.write('lanes=' + (','.join(result['lanes']) or 'none') + '\n')
                output.write('manual=' + ('true' if result['manual'] else 'false') + '\n')
                selected = tests_for(result['lanes'])
                output.write('needs_modules=' + ('true' if any(x.startswith('tests/e2e/') for x in selected) else 'false') + '\n')
                output.write('needs_browser=' + ('true' if any(x in selected for x in (
                    'tests/e2e/tv_presentation.test.mjs',
                    'tests/e2e/public_presentation.test.mjs',
                    'tests/e2e/gameday_fast_ui_browser.test.mjs',
                    'tests/e2e/gameday_registration_browser.test.mjs')) else 'false') + '\n')
        if result['manual']:
            print('Manual full approval required before merge/release; no automatic full suite will start.')
    elif a.cmd == 'run':
        lanes = [] if a.lanes == 'none' else a.lanes.split(',')
        files = tests_for(lanes)
        for file in files:
            if not (ROOT / file).is_file():
                raise ValueError(f'missing required test: {file}')
        if files:
            env = dict(os.environ, FFTT_CHROME_CHANNEL='none')
            subprocess.run(['node', '--test', '--test-concurrency=2', *files], cwd=ROOT, env=env, check=True)
    else:
        verify_manual_proof(a.head)
        print('Exact-SHA manual full regression proof is valid.')


if __name__ == '__main__':
    try:
        cli()
    except (ValueError, OSError, subprocess.CalledProcessError) as e:
        print(f'CI v2 blocked: {e}', file=sys.stderr)
        sys.exit(1)
