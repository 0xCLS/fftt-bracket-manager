#!/usr/bin/env python3
"""Verify a LIVE Cloudflare Pages deployment against the local, hash-verified bundle it was built from. Read-only.

  verify_deployment.py --bundle DIR --base https://fftt3-staff-stg.pages.dev --kind staff
  verify_deployment.py --bundle DIR --base https://fftt3-games-stg.pages.dev --kind spectator

Checks: every file listed in MANIFEST.json is served with the same SHA-256 (and the live MANIFEST.json equals the local one);
security headers; private paths (server/, functions/, SQL, tests, docs) answer 404; for `staff`, the registration Function
refuses a GET (405) and a token-less POST (401) and, for `spectator`, serves no Function at all. Sends no credential, no data.
Exit code 0 only if everything passed.
`--static-only` (used by the pipeline on a throw-away PREVIEW deployment, before anything is promoted) skips the token-less POST (401) check dependent on production secrets and pinned origin. It accepts only GET 405 or the explicit fail-closed 503 `registration-not-configured` from a preview that has no production environment secrets; all other 503s still fail. The stable live Staff URL must return 405/401. Uses a browser-like User-Agent (Cloudflare refuses the default Python agent)."""
import argparse, hashlib, json, sys, urllib.error, urllib.request
from pathlib import Path

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
PRIVATE = ['/server/registration/handler.mjs', '/functions/api/registrations.js', '/supabase/proposals/GAMEDAY_TOURNAMENT_V5_STAGING.sql',
           '/tests/registration_handler.test.mjs', '/docs/launch/FFTT3_CUTOVER_RUNBOOK.md', '/tools/release/build_single_project_upgrade.py', '/.git/config', '/.env']

def get(url, method='GET', data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers={'User-Agent': UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e: return e.code, e.headers, e.read()

def staff_get_ok(status, body, static_only=False):
    """An unconfigured preview is safe; a broken Function or live endpoint is not."""
    if status == 405:
        return True
    if not static_only or status != 503:
        return False
    try:
        payload = json.loads(body)
    except (TypeError, ValueError):
        return False
    return isinstance(payload, dict) and payload == {'error': 'registration-not-configured'}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--bundle', required=True); ap.add_argument('--base', required=True)
    ap.add_argument('--kind', choices=['staff', 'spectator'], required=True)
    ap.add_argument('--static-only', action='store_true')
    a = ap.parse_args(); base = a.base.rstrip('/'); root = Path(a.bundle)
    fails = []
    def check(ok, label):
        print(('PASS  ' if ok else 'FAIL  ') + label)
        if not ok: fails.append(label)
    manifest = json.loads((root / 'MANIFEST.json').read_text())
    files = manifest['files']; items = list(files.items()) if isinstance(files, dict) else [(f['path'], f['sha256']) for f in files]
    check(len(items) > 0, f'{len(items)} files in the local manifest (commit {manifest["commit"][:7]}, {manifest["target"]}, {manifest["environment"]})')
    bad = []
    items = [(p, w) for p, w in items if p not in ('_headers', '_redirects')]   # consumed by Cloudflare, never served (checked below)
    for path, want in items:
        want = want if isinstance(want, str) else want['sha256']
        st, _, body = get(f'{base}/{path}')
        if st != 200 or hashlib.sha256(body).hexdigest() != want: bad.append((path, st))
    check(not bad, f'every manifest file is served with the same SHA-256 ({len(items) - len(bad)}/{len(items)})' + (f' — mismatches: {bad[:5]}' if bad else ''))
    st, h, body = get(f'{base}/MANIFEST.json')
    check(st == 200 and json.loads(body) == manifest, 'live MANIFEST.json equals the local manifest')
    entry = {'staff': '/app/staff.html', 'spectator': '/app/spectator.html'}[a.kind]
    st, h, _ = get(base + entry)
    csp = h.get('Content-Security-Policy', '')
    check(st == 200, f'{entry} -> {st}')
    check("default-src 'self'" in csp and "script-src 'self'" in csp and "frame-ancestors 'none'" in csp and "object-src 'none'" in csp, 'Content-Security-Policy: self-only scripts, no frames, no objects')
    check('copmkalfkkrkzheohwuc.supabase.co' in csp and '*' not in csp.replace("'self'", ''), 'CSP connect-src names only the pinned Supabase project (no wildcard)')
    check(h.get('X-Content-Type-Options') == 'nosniff' and h.get('Referrer-Policy') == 'no-referrer', 'nosniff and no-referrer')
    check('no-store' in (h.get('Cache-Control') or ''), 'Cache-Control: no-store')
    check('noindex' in (h.get('X-Robots-Tag') or ''), 'X-Robots-Tag: noindex')
    check('max-age=' in (h.get('Strict-Transport-Security') or ''), 'Strict-Transport-Security')
    leaks = [p for p in PRIVATE if get(base + p)[0] == 200]
    check(not leaks, 'server/, functions/, SQL, tests, docs, tools and dotfiles are not served' + (f' — SERVED: {leaks}' if leaks else ''))
    for p in ('/_headers', '/_redirects'):
        check(get(base + p)[0] == 404, f'{p} is consumed by Cloudflare and not served')
    if a.kind == 'staff':
        origin = base
        st, h, body = get(base + '/api/registrations')
        expected = '405 or explicit unconfigured-preview 503' if a.static_only else '405'
        check(staff_get_ok(st, body, a.static_only), f'GET /api/registrations -> {st} (expected {expected})')
        if a.static_only:
            check('no-store' in (h.get('Cache-Control') or ''), 'preview Function answers with Cache-Control: no-store')
        if not a.static_only:
            st, h, _ = get(base + '/api/registrations', 'POST', b'{"action":"capabilities","eventId":"00000000-0000-4000-8000-000000000000"}', {'Content-Type': 'application/json', 'Origin': origin})
            check(st == 401, f'token-less POST /api/registrations -> {st} (expected 401)')
            check('no-store' in (h.get('Cache-Control') or ''), 'the Function answers with Cache-Control: no-store')
    else:
        st, _, _ = get(base + '/api/registrations', 'POST', b'{}', {'Content-Type': 'application/json', 'Origin': base})
        check(st in (404, 405), f'the spectator origin serves no registration Function (POST -> {st})')
        check(get(base + '/app/staff.html')[0] == 404, 'no staff page on the spectator origin')
    print(f'\n{len(fails)} CHECK(S) FAILED' if fails else '\nALL LIVE CHECKS PASSED')
    return 1 if fails else 0

if __name__ == '__main__': sys.exit(main())
