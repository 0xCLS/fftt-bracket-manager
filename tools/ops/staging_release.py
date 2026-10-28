#!/usr/bin/env python3
"""Automatic FFTT3 STAGING release pipeline (Cloudflare Pages Direct Upload). Production is not reachable from here.

Used only by .github/workflows/deploy-staging.yml; every command also runs locally. Sub-commands:

  build    build both sanitized bundles from an exact commit (tools/staging/build_export.py)
  plan     compare each bundle with what is live; write GitHub outputs staff=true|false spectator=true|false
  gate     wait for (or start) the full regression on the exact commit; exit 0 only when every required job passed
  release  verify bundle integrity -> PREVIEW upload + static checks -> production upload -> live checks -> auto-rollback on failure

Safety properties (all enforced here, covered by tests/test_staging_release.py):
  * the two project names, their origins and the Git branch are constants, not inputs;
  * bundles are always built with --environment staging and the pinned staging origins;
  * nothing is uploaded unless the manifest's commit is the commit under test and every file hash matches;
  * a bundle is first uploaded to a throw-away preview branch and must pass the static checks before it is promoted;
  * after promotion the live site must equal the bundle byte for byte, otherwise the previous deployment is restored;
  * no variable, secret, Supabase setting or Auth rule is read, written or changed (a Direct Upload deployment only
    replaces static files and the Function code; project variables/secrets are untouched).
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / 'tools' / 'staging'))

REPO = '0xCLS/fftt-bracket-manager'
BRANCH = 'integration/milestone1-secure-foundation'
TEST_WORKFLOW = 'browser-tests.yml'
WRANGLER = 'wrangler@4.154.0'
PREVIEW_BRANCH = 'ci-verify'
APPS = {
    'staff': {'project': 'fftt3-staff-stg', 'origin': 'https://fftt3-staff-stg.pages.dev'},
    'spectator': {'project': 'fftt3-games-stg', 'origin': 'https://fftt3-games-stg.pages.dev'},
}
# Job names in browser-tests.yml that make up the FULL regression (a fast UI lane is never enough to release).
CLASSIFY_CHECK = 'Select safe CI lane'
REQUIRED_CHECKS = (
    'Full regression — browser and security foundation',
    'Full regression — game-day and launch workflows',
    'Disposable synthetic PostgreSQL',
)
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
SHA = re.compile(r'[0-9a-f]{40}')


def die(msg):
    print(f'staging_release: {msg}', file=sys.stderr)
    sys.exit(1)


def log(msg):
    print(msg, flush=True)


def set_output(name, value):
    path = os.environ.get('GITHUB_OUTPUT')
    if path:
        with open(path, 'a') as f:
            f.write(f'{name}={value}\n')
    log(f'output {name}={value}')


# ----- pure decision logic (unit-tested) ------------------------------------------------------------------------

def hash_file_set(manifest):
    """The deployable content of a manifest, ignoring which commit happened to produce it."""
    files = manifest.get('files')
    items = files.items() if isinstance(files, dict) else ((f['path'], f['sha256']) for f in files or [])
    return {'target': manifest.get('target'), 'environment': manifest.get('environment'), 'files': dict(items)}


def needs_deploy(local, live, function_changed):
    """True when the live site is not already serving this content (or the Function source changed)."""
    if live is None:
        return True, 'live manifest unavailable'
    if hash_file_set(local) != hash_file_set(live):
        return True, 'served files differ from the live deployment'
    if function_changed:
        return True, 'Function source changed since the live deployment'
    return False, 'live deployment already serves this content'


def evaluate(runs):
    """Reduce GitHub check runs of ONE commit to ready | fail | wait | dispatch.

    A required job counts as passed if any run of it succeeded (a re-run supersedes an earlier failure).
    Skipped/cancelled/missing means the full lane has not (yet) run for this commit."""
    by = {}
    for r in runs:
        by.setdefault(r['name'], []).append(r)
    states = {}
    for name in REQUIRED_CHECKS:
        rs = by.get(name, [])
        if any(r['status'] == 'completed' and r['conclusion'] == 'success' for r in rs):
            states[name] = 'success'
        elif any(r['status'] != 'completed' for r in rs):
            states[name] = 'pending'
        elif any(r['conclusion'] in ('failure', 'timed_out', 'action_required', 'startup_failure') for r in rs):
            states[name] = 'failure'
        else:
            states[name] = 'absent'
    vals = set(states.values())
    if 'failure' in vals:
        return 'fail', states
    if vals == {'success'}:
        return 'ready', states
    if 'pending' in vals:
        return 'wait', states
    return 'dispatch', states


def classify_finished(runs):
    return any(r['name'] == CLASSIFY_CHECK and r['status'] == 'completed' for r in runs)


def check_bundle(bundle, commit, kind):
    """Refuse to upload anything that is not exactly the tested commit's sanitized staging bundle."""
    root = Path(bundle)
    manifest = json.loads((root / 'MANIFEST.json').read_text())
    problems = []
    if manifest.get('commit') != commit:
        problems.append(f'manifest commit {manifest.get("commit")} is not the commit under test {commit}')
    if manifest.get('target') != kind:
        problems.append(f'manifest target {manifest.get("target")} is not {kind}')
    if manifest.get('environment') != 'staging':
        problems.append('manifest environment is not staging')
    files = hash_file_set(manifest)['files']
    if not files:
        problems.append('manifest lists no files')
    for rel, want in files.items():
        p = root / rel
        if not p.is_file():
            problems.append(f'missing file {rel}')
        elif hashlib.sha256(p.read_bytes()).hexdigest() != want:
            problems.append(f'hash mismatch {rel}')
    on_disk = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()} - {'MANIFEST.json'}
    extra = on_disk - set(files)
    if extra:
        problems.append(f'files not in the manifest: {sorted(extra)[:5]}')
    return problems


def preview_url(output, project):
    """The unique deployment URL printed by `wrangler pages deploy` (never the production alias)."""
    m = re.search(r'https://([0-9a-f]{8})\.' + re.escape(project) + r'\.pages\.dev', output)
    return m.group(0) if m else None


# ----- helpers --------------------------------------------------------------------------------------------------

def http_json(url, headers=None, method='GET', data=None):
    req = urllib.request.Request(url, method=method, data=data, headers={'User-Agent': UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def live_manifest(origin):
    try:
        return http_json(f'{origin}/MANIFEST.json', {'Cache-Control': 'no-cache'})
    except (urllib.error.URLError, ValueError, TimeoutError):
        return None


def git(*args, check=True):
    return subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True, check=check)


def gh_json(*args):
    out = subprocess.run(['gh', *args], capture_output=True, text=True)
    if out.returncode:
        die(f'gh {" ".join(args[:2])} failed: {out.stderr.strip()[:300]}')
    return out.stdout


def cf(path, method='GET', data=None):
    token, account = os.environ.get('CLOUDFLARE_API_TOKEN'), os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    if not token or not account:
        die('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required (GitHub environment "staging")')
    body = json.dumps(data).encode() if data is not None else None
    hdrs = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    try:
        res = http_json(f'https://api.cloudflare.com/client/v4/accounts/{account}/{path}', hdrs, method, body)
    except urllib.error.HTTPError as e:
        die(f'Cloudflare API {method} {path} -> HTTP {e.code}')
    if not res.get('success'):
        die(f'Cloudflare API {method} {path} reported failure')
    return res['result']


def production_deployments(project):
    return cf(f'pages/projects/{project}/deployments?env=production')


# ----- commands -------------------------------------------------------------------------------------------------

def cmd_build(a):
    import build_export
    if not SHA.fullmatch(a.commit):
        die('--commit must be a full lowercase SHA')
    out = Path(a.out)
    build_export.build(a.checkout, a.commit, 'staging', APPS['staff']['origin'], str(out / 'staff'), 'staff',
                       APPS['spectator']['origin'])
    build_export.build(a.checkout, a.commit, 'staging', APPS['spectator']['origin'], str(out / 'spectator'), 'spectator')
    for kind in APPS:
        problems = check_bundle(out / kind, a.commit, kind)
        if problems:
            die(f'{kind} bundle failed integrity checks: {problems}')
        log(f'built {kind} bundle for {a.commit[:7]}')


def function_source_changed(live_commit, commit):
    if not live_commit or not SHA.fullmatch(live_commit):
        return True
    known = git('cat-file', '-e', f'{live_commit}^{{commit}}', check=False)
    if known.returncode:
        return True
    return git('diff', '--quiet', live_commit, commit, '--', 'functions', 'server', check=False).returncode != 0


def cmd_plan(a):
    any_needed = False
    for kind, app in APPS.items():
        local = json.loads((Path(a.bundles) / kind / 'MANIFEST.json').read_text())
        live = live_manifest(app['origin'])
        fn = kind == 'staff' and function_source_changed((live or {}).get('commit'), a.commit)
        need, why = needs_deploy(local, live, fn)
        if a.force:
            need, why = True, 'forced'
        log(f'{kind}: {"DEPLOY" if need else "skip"} — {why} (live commit {(live or {}).get("commit", "?")[:7]})')
        set_output(kind, 'true' if need else 'false')
        any_needed = any_needed or need
    set_output('any', 'true' if any_needed else 'false')


def check_runs(commit):
    out = gh_json('api', f'repos/{REPO}/commits/{commit}/check-runs?per_page=100', '--paginate',
                  '--jq', '.check_runs[] | {name, status, conclusion}')
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def branch_tip():
    return json.loads(gh_json('api', f'repos/{REPO}/git/ref/heads/{BRANCH}'))['object']['sha']


def cmd_gate(a):
    deadline = time.time() + a.timeout_min * 60
    started = time.time()
    dispatched = False
    while True:
        if not a.allow_old and branch_tip() != a.commit:
            log('a newer commit exists on the branch; this release is superseded and will not be deployed')
            set_output('superseded', 'true')
            return
        runs = check_runs(a.commit)
        verdict, states = evaluate(runs)
        log(f'{int(time.time() - started):>4}s  {verdict:8} ' + '; '.join(f'{k.split(" — ")[-1]}={v}' for k, v in states.items()))
        if verdict == 'ready':
            set_output('superseded', 'false')
            return
        if verdict == 'fail':
            die('the full regression FAILED on this commit; nothing is deployed')
        if verdict == 'dispatch' and not dispatched:
            if classify_finished(runs) or time.time() - started > 180:
                if branch_tip() != a.commit:
                    die('the full regression has not run on this commit and it is no longer the branch tip')
                log('only a fast lane (or nothing) ran for this commit; starting the full regression once')
                subprocess.run(['gh', 'workflow', 'run', TEST_WORKFLOW, '--repo', REPO, '--ref', BRANCH], check=True)
                dispatched = True
        if time.time() > deadline:
            die('timed out waiting for the full regression')
        time.sleep(a.poll_sec)


def wrangler_deploy(bundle, project, branch, commit, cwd):
    cmd = ['npx', '--yes', WRANGLER, 'pages', 'deploy', str(bundle), '--project-name', project, '--branch', branch,
           '--commit-hash', commit, '--commit-message', f'staging pipeline {commit[:7]}']
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env={**os.environ, 'CI': '1'})
    text = res.stdout + res.stderr
    print(re.sub(r'(?i)(token|secret)[^\s]*', '[redacted]', text)[-1500:])
    if res.returncode:
        die(f'wrangler deploy to {project} ({branch}) failed')
    return text


def run_verify(bundle, base, kind, static_only=False, attempts=1):
    cmd = [sys.executable, str(ROOT / 'tools' / 'ops' / 'verify_deployment.py'), '--bundle', str(bundle), '--base', base, '--kind', kind]
    if static_only:
        cmd.append('--static-only')
    for i in range(attempts):
        res = subprocess.run(cmd, capture_output=True, text=True)
        print(res.stdout[-3000:])
        if res.returncode == 0:
            return True
        if i + 1 < attempts:
            time.sleep(20)   # edge propagation after an upload
    return False


def cmd_release(a):
    kind, app = a.kind, APPS[a.kind]
    project, origin = app['project'], app['origin']
    if not SHA.fullmatch(a.commit):
        die('--commit must be a full lowercase SHA')
    problems = check_bundle(a.bundle, a.commit, kind)
    if problems:
        die(f'refusing to upload; bundle does not match the tested commit: {problems}')
    previous = next((d for d in production_deployments(project) if d.get('latest_stage', {}).get('status') == 'success'), None)
    previous_id = previous['id'] if previous else None
    log(f'{kind}: previous production deployment {previous_id}')
    # The staff Function lives in functions/ next to the checkout; the spectator project must never receive one.
    cwd = str(ROOT) if kind == 'staff' else tempfile.mkdtemp(prefix='fftt-spectator-')
    if kind == 'staff' and not (ROOT / 'functions' / 'api' / 'registrations.js').is_file():
        die('functions/api/registrations.js missing from the checkout')

    log(f'{kind}: uploading to the throw-away preview branch "{PREVIEW_BRANCH}"')
    text = wrangler_deploy(a.bundle, project, PREVIEW_BRANCH, a.commit, cwd)
    url = preview_url(text, project)
    if not url:
        die('could not read the preview deployment URL from wrangler output')
    if not run_verify(a.bundle, url, kind, static_only=True, attempts=4):
        die(f'{kind}: PREVIEW failed the static checks; nothing was promoted')

    log(f'{kind}: promoting to {origin}')
    wrangler_deploy(a.bundle, project, 'main', a.commit, cwd)
    if run_verify(a.bundle, origin, kind, attempts=6):
        log(f'{kind}: ALL LIVE CHECKS PASSED at {origin} for {a.commit[:7]}')
        return
    if previous_id:
        log(f'{kind}: LIVE CHECKS FAILED — restoring deployment {previous_id}')
        cf(f'pages/projects/{project}/deployments/{previous_id}/rollback', 'POST')
    die(f'{kind}: live checks failed after promotion' + ('; the previous deployment was restored' if previous_id else ''))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('build'); p.add_argument('--checkout', default=str(ROOT)); p.add_argument('--commit', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('plan'); p.add_argument('--commit', required=True); p.add_argument('--bundles', required=True); p.add_argument('--force', action='store_true')
    p = sub.add_parser('gate'); p.add_argument('--commit', required=True); p.add_argument('--timeout-min', type=int, default=75)
    p.add_argument('--poll-sec', type=int, default=30); p.add_argument('--allow-old', action='store_true')
    p = sub.add_parser('release'); p.add_argument('--kind', choices=sorted(APPS), required=True); p.add_argument('--bundle', required=True); p.add_argument('--commit', required=True)
    a = ap.parse_args()
    {'build': cmd_build, 'plan': cmd_plan, 'gate': cmd_gate, 'release': cmd_release}[a.cmd](a)


if __name__ == '__main__':
    main()
