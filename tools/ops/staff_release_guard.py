#!/usr/bin/env python3
"""Read-only target-identity guard for a PRODUCTION Staff release (and for the proof-secret step that goes with it).

Run it BEFORE any `wrangler pages secret put` / `wrangler pages deploy` against the production Staff project, with the
same project name that those commands will be given:

  staff_release_guard.py --project fftt-staff --release-commit <FULL_SHA> --bundle ../staff-bundle
  staff_release_guard.py --project fftt-staff --live-only            (identity of what is live now; no bundle needed)

It exits non-zero unless ALL of these hold:
  * the project name is exactly `fftt-staff` (the production Staff project). The old Staff staging project
    `fftt3-staff-stg`, the Spectator staging project `fftt3-games-stg`, the production Spectator/TV project `fftt-games`
    and the public homepage project `fftt-public` are refused by name, with the reason;
  * `https://fftt-staff.clslifestyle.com/MANIFEST.json` and `https://fftt-staff.pages.dev/MANIFEST.json` (the same Pages
    project reached by its custom domain and by its own name) both say target `staff`, environment `production` and the SAME
    commit, so the name you are about to use is the project that serves production, not staging;
  * with --bundle: the local bundle is target `staff`, environment `production`, its commit equals --release-commit, its
    approved origin is only the production Staff hostname, and it carries no server-only
    path (server/, functions/, supabase/, tests/, docs/, tools/).
It then prints what the release would change on the live site (added / changed / removed served files).
It sends only GET requests to those two public hostnames, no credential and no data, and it changes nothing.
It cannot see your Cloudflare login: also run `npx wrangler@4 whoami` and `... pages project list` (the runbook lists them)."""
import argparse, json, re, sys, urllib.error, urllib.request
from pathlib import Path

STAFF_PROJECT = 'fftt-staff'
STAFF_ORIGIN = 'https://fftt-staff.clslifestyle.com'
STAFF_PAGES_ORIGIN = 'https://fftt-staff.pages.dev'
SPECTATOR_ORIGIN = 'https://fftt-games.clslifestyle.com'
REFUSED = {
    'fftt3-staff-stg': 'the old Staff STAGING project',
    'fftt3-games-stg': 'the Spectator STAGING project',
    'fftt-games': 'the production Spectator/TV project (static only: it must never receive the registration Function or the proof secret)',
    'fftt-public': 'the public homepage project',
}
PRIVATE_PREFIXES = ('server/', 'functions/', 'supabase/', 'tests/', 'docs/', 'tools/', '.git', '.env')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
SHA = re.compile(r'^[0-9a-f]{40}$')


def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def check_project(name):
    if name in REFUSED:
        return [f'refused project {name!r}: that is {REFUSED[name]}. The only allowed production Staff project is {STAFF_PROJECT!r}.']
    if name != STAFF_PROJECT:
        return [f'refused project {name!r}: the only allowed production Staff project is {STAFF_PROJECT!r} (exact match).']
    return []


def _identity(manifest, where):
    problems = []
    if not isinstance(manifest, dict) or not isinstance(manifest.get('files'), dict):
        return [f'{where}: not a Staff manifest']
    if manifest.get('target') != 'staff':
        problems.append(f"{where}: target is {manifest.get('target')!r}, expected 'staff'")
    if manifest.get('environment') != 'production':
        problems.append(f"{where}: environment is {manifest.get('environment')!r}, expected 'production'")
    if not SHA.match(str(manifest.get('commit', ''))):
        problems.append(f'{where}: no full commit SHA')
    return problems


def check_live(fetch=fetch_json):
    """Both production names of the Staff project must serve the same production Staff deployment."""
    problems, manifests = [], {}
    for origin in (STAFF_ORIGIN, STAFF_PAGES_ORIGIN):
        try:
            manifests[origin] = fetch(origin + '/MANIFEST.json')
        except (urllib.error.URLError, OSError, ValueError) as e:
            problems.append(f'{origin}: cannot read the live manifest ({type(e).__name__})')
            continue
        problems += _identity(manifests[origin], origin)
    if len(manifests) == 2 and not problems:
        a, b = (manifests[STAFF_ORIGIN]['commit'], manifests[STAFF_PAGES_ORIGIN]['commit'])
        if a != b:
            problems.append(f'{STAFF_ORIGIN} serves {a} but {STAFF_PAGES_ORIGIN} serves {b}: they are not the same project state')
    return problems, manifests.get(STAFF_ORIGIN)


def check_bundle(bundle, release_commit):
    bundle = Path(bundle)
    problems = []
    try:
        manifest = json.loads((bundle / 'MANIFEST.json').read_text())
    except (OSError, ValueError):
        return ['bundle: MANIFEST.json is missing or unreadable'], None
    problems += _identity(manifest, 'bundle')
    if manifest.get('commit') != release_commit:
        problems.append(f"bundle: manifest commit {manifest.get('commit')} is not the release commit {release_commit}")
    try:
        profile = json.loads((bundle / 'app' / 'origin-profile.json').read_text())
    except (OSError, ValueError):
        problems.append('bundle: app/origin-profile.json is missing or unreadable')
        profile = {}
    if profile.get('environment') != 'production' or profile.get('approvedHttpsOrigins') != [STAFF_ORIGIN] or profile.get('spectatorOrigin') != SPECTATOR_ORIGIN:
        problems.append('bundle: origin profile is not the production profile (Staff origin only, production Spectator origin)')
    if profile.get('approvedPublicStaticOrigins'):
        problems.append('bundle: origin profile approves extra static origins')
    files = manifest.get('files') if isinstance(manifest.get('files'), dict) else {}
    for path in files:
        if path.startswith(PRIVATE_PREFIXES):
            problems.append(f'bundle: server-only path {path} would be served')
    return problems, manifest


def diff(local, live):
    a, b = (local or {}).get('files', {}), (live or {}).get('files', {})
    return (sorted(set(a) - set(b)), sorted(k for k in a if k in b and a[k] != b[k]), sorted(set(b) - set(a)))


def run(project, release_commit=None, bundle=None, live_only=False, fetch=fetch_json, out=print):
    problems = check_project(project)
    live_problems, live = check_live(fetch)
    problems += live_problems
    local = None
    if not live_only:
        if not bundle or not release_commit or not SHA.match(release_commit):
            problems.append('--bundle and a full 40-character --release-commit are required (or pass --live-only)')
        else:
            bundle_problems, local = check_bundle(bundle, release_commit)
            problems += bundle_problems
    if live:
        out(f"live production Staff ({STAFF_ORIGIN} and {STAFF_PAGES_ORIGIN}): commit {live.get('commit')}, {len(live['files'])} files")
    if local and live:
        added, changed, removed = diff(local, live)
        out(f'this release would add {len(added)}, change {len(changed)}, remove {len(removed)} served files:')
        for label, items in (('add', added), ('change', changed), ('remove', removed)):
            for item in items:
                out(f'  {label}: {item}')
    for p in problems:
        out('REFUSED: ' + p)
    out('GUARD PASSED: the target is the production Staff project' if not problems else 'GUARD FAILED: do not run the secret or deploy command')
    return not problems


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--project', required=True)
    ap.add_argument('--release-commit')
    ap.add_argument('--bundle')
    ap.add_argument('--live-only', action='store_true')
    a = ap.parse_args(argv)
    return 0 if run(a.project, a.release_commit, a.bundle, a.live_only) else 1


if __name__ == '__main__':
    sys.exit(main())
