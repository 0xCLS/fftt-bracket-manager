#!/usr/bin/env python3
"""Build the sanitized static export for ONE environment of the staff sign-in app. Publishes nothing.

Reads ONLY tracked files at an exact commit (`git show`, never the working tree), follows the real
import/link/script graph from the sign-in page, and writes: those files, a generated origin-profile.json
for the chosen environment, a generated _headers file, and MANIFEST.json (SHA-256 of every file).
Refuses: a dirty tree, a commit that is not HEAD, an external reference, any sensitive-looking path, and
any origin the runtime policy would refuse (shared account origin, non-dedicated platform host, preview
host, port, path, http, other platforms).

Targets (--target): `login` (default, the original read-only sign-in page), `staff` (the integrated staff app:
organizer + scorekeeper) and `spectator` (the anonymous public bracket and TV board). Staff and spectator are
DIFFERENT origins by design; the spectator bundle contains no sign-in, session, score or organizer code.

Usage: build_export.py --checkout DIR --commit SHA --environment staging|production --origin https://x.pages.dev --out DIR
       [--target login|staff|spectator] [--spectator-origin https://y.pages.dev]   (staff only: shown as a link)
"""
import argparse, hashlib, json, re, shutil, subprocess, sys
from pathlib import Path, PurePosixPath

ENTRY = 'rehearsals/m1/staff-login.html'  # default target
ENTRIES = {'login': [ENTRY], 'staff': ['app/staff.html'], 'spectator': ['app/spectator.html', 'app/tv.html']}
SUPABASE = 'https://copmkalfkkrkzheohwuc.supabase.co'
KNOWN_SHARED_ORIGINS = {'https://0xcls.github.io'}
DEDICATED_HOST = re.compile(r'^(?:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.(github\.io|pages\.dev)|fftt-(?:staff|games)\.clslifestyle\.com)
SENSITIVE = re.compile(r'(^|/)(\.git|\.github|\.env|node_modules|__pycache__|tests|docs|supabase|tools|server|functions)(/|$)|\.(log|bak|sql|py|sh|key|pem)$|\.local\.json$')
HEADERS = (
    "/*\n"
    "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' " + SUPABASE +
    "; img-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'\n"
    "  Strict-Transport-Security: max-age=31536000\n"
    "  X-Content-Type-Options: nosniff\n"
    "  Referrer-Policy: no-referrer\n"
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n"
    "  Cache-Control: no-store\n"
    "  X-Robots-Tag: noindex, nofollow\n")

def die(msg): sys.exit('build_export: ' + msg)

def valid_origin(origin):
    if not isinstance(origin, str) or re.search(r'[*?\s]', origin): return False
    m = re.fullmatch(r'https://([^/:@?#]+)', origin)
    return bool(m and DEDICATED_HOST.match(m.group(1)) and origin not in KNOWN_SHARED_ORIGINS)

def deps(path, data):
    if not path.endswith(('.html', '.mjs', '.js')): return  # binary/other assets have no references
    text = data.decode('utf-8'); refs = []
    if path.endswith('.html'):
        refs += (re.findall(r'<script[^>]+src="([^"]+)"', text) + re.findall(r'<link[^>]+href="([^"]+)"', text)
                 + re.findall(r'<img[^>]+src="([^"]+)"', text))
    if path.endswith(('.mjs', '.js')):
        refs += re.findall(r'''(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]''', text)
        refs += re.findall(r'''import\(\s*['"]([^'"]+)['"]\s*\)''', text)
    for r in refs:
        if re.match(r'^(https?:|//|data:)', r): die(f'external reference in {path}')
        parts = []
        base = PurePosixPath('.') if r.startswith('/') else PurePosixPath(path).parent  # root-absolute refs
        for p in (base / r.lstrip('/')).parts:
            if p == '..':
                if not parts: die('path escapes the repository')
                parts.pop()
            elif p != '.': parts.append(p)
        yield '/'.join(parts)

def build(checkout, commit, environment, origin, out, target='login', spectator_origin=None):
    if environment not in ('staging', 'production'): die('environment must be staging or production')
    if not re.fullmatch(r'[0-9a-f]{40}', commit): die('commit must be a full SHA')
    if target not in ENTRIES: die('unknown target')
    if not valid_origin(origin): die('origin is not an acceptable dedicated public static origin')
    if spectator_origin is not None and (target != 'staff' or not valid_origin(spectator_origin) or spectator_origin == origin):
        die('spectator origin must be a different dedicated origin, and only the staff bundle takes one')
    if origin in PRODUCTION_CUSTOM.values() and (environment != 'production' or PRODUCTION_CUSTOM.get(target) != origin):
        die('custom hostname reserved for matching production application')
    if spectator_origin in PRODUCTION_CUSTOM.values() and (environment != 'production' or spectator_origin != PRODUCTION_CUSTOM['spectator']):
        die('custom spectator hostname reserved for production')
    if environment == 'production' and origin == PRODUCTION_CUSTOM['staff'] and spectator_origin != PRODUCTION_CUSTOM['spectator']:
        die('custom production staff must link to approved custom spectator')
    git = lambda *a: subprocess.check_output(['git', '-C', checkout, *a], text=True)
    if git('rev-parse', 'HEAD').strip() != commit: die('checkout HEAD is not the approved commit')
    if git('status', '--porcelain').strip(): die('working tree is not clean')
    seen, queue = {}, list(ENTRIES[target])
    while queue:
        p = queue.pop()
        if p in seen: continue
        seen[p] = subprocess.check_output(['git', '-C', checkout, 'show', f'{commit}:{p}'])
        queue += [d for d in deps(p, seen[p]) if d not in seen]
    for p in seen:
        if SENSITIVE.search(p): die(f'refusing sensitive-looking path: {p}')
    files = dict(seen)
    public_entries = [{'origin': origin, 'environment': environment, 'dedicatedOrigin': True}] if origin.endswith(('.pages.dev', '.github.io')) else []
    https_entries = [] if public_entries else [origin]
    if target == 'login':
        files['rehearsals/m1/origin-profile.json'] = (json.dumps({
            'environment': environment,
            'approvedPublicStaticOrigins': public_entries,
            'approvedHttpsOrigins': https_entries}, indent=1) + '\n').encode()
    elif target == 'staff':
        files['app/origin-profile.json'] = (json.dumps({
            'environment': environment,
            'approvedPublicStaticOrigins': public_entries,
            'approvedHttpsOrigins': https_entries, 'spectatorOrigin': spectator_origin}, indent=1) + '\n').encode()
        files['_redirects'] = b'/ /app/staff.html 302\n'
    else:
        files['_redirects'] = b'/ /app/spectator.html 200\n/tv /app/tv.html 200\n'
    files['_headers'] = (HEADERS if target == 'login' else HEADERS.replace("img-src 'none'", "img-src 'self'")).encode()
    shutil.rmtree(out, ignore_errors=True)
    for p, data in files.items():
        dest = Path(out) / p; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data)
    manifest = {'commit': commit, 'environment': environment, 'target': target,
                'files': {p: hashlib.sha256(d).hexdigest() for p, d in sorted(files.items())}}
    (Path(out) / 'MANIFEST.json').write_text(json.dumps(manifest, indent=1) + '\n')
    return sorted(files) + ['MANIFEST.json']

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    for a in ('checkout', 'commit', 'environment', 'origin', 'out'): ap.add_argument('--' + a, required=True)
    ap.add_argument('--target', default='login'); ap.add_argument('--spectator-origin', default=None)
    a = ap.parse_args()
    print(json.dumps({'files': build(a.checkout, a.commit, a.environment, a.origin, a.out, a.target, a.spectator_origin)}, indent=1))
)
PRODUCTION_CUSTOM = {'staff': 'https://fftt-staff.clslifestyle.com', 'spectator': 'https://fftt-games.clslifestyle.com'}
SENSITIVE = re.compile(r'(^|/)(\.git|\.github|\.env|node_modules|__pycache__|tests|docs|supabase|tools|server|functions)(/|$)|\.(log|bak|sql|py|sh|key|pem)$|\.local\.json$')
HEADERS = (
    "/*\n"
    "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' " + SUPABASE +
    "; img-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'\n"
    "  Strict-Transport-Security: max-age=31536000\n"
    "  X-Content-Type-Options: nosniff\n"
    "  Referrer-Policy: no-referrer\n"
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n"
    "  Cache-Control: no-store\n"
    "  X-Robots-Tag: noindex, nofollow\n")

def die(msg): sys.exit('build_export: ' + msg)

def valid_origin(origin):
    if not isinstance(origin, str) or re.search(r'[*?\s]', origin): return False
    m = re.fullmatch(r'https://([^/:@?#]+)', origin)
    return bool(m and DEDICATED_HOST.match(m.group(1)) and origin not in KNOWN_SHARED_ORIGINS)

def deps(path, data):
    if not path.endswith(('.html', '.mjs', '.js')): return  # binary/other assets have no references
    text = data.decode('utf-8'); refs = []
    if path.endswith('.html'):
        refs += (re.findall(r'<script[^>]+src="([^"]+)"', text) + re.findall(r'<link[^>]+href="([^"]+)"', text)
                 + re.findall(r'<img[^>]+src="([^"]+)"', text))
    if path.endswith(('.mjs', '.js')):
        refs += re.findall(r'''(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]''', text)
        refs += re.findall(r'''import\(\s*['"]([^'"]+)['"]\s*\)''', text)
    for r in refs:
        if re.match(r'^(https?:|//|data:)', r): die(f'external reference in {path}')
        parts = []
        base = PurePosixPath('.') if r.startswith('/') else PurePosixPath(path).parent  # root-absolute refs
        for p in (base / r.lstrip('/')).parts:
            if p == '..':
                if not parts: die('path escapes the repository')
                parts.pop()
            elif p != '.': parts.append(p)
        yield '/'.join(parts)

def build(checkout, commit, environment, origin, out, target='login', spectator_origin=None):
    if environment not in ('staging', 'production'): die('environment must be staging or production')
    if not re.fullmatch(r'[0-9a-f]{40}', commit): die('commit must be a full SHA')
    if target not in ENTRIES: die('unknown target')
    if not valid_origin(origin): die('origin is not an acceptable dedicated public static origin')
    if spectator_origin is not None and (target != 'staff' or not valid_origin(spectator_origin) or spectator_origin == origin):
        die('spectator origin must be a different dedicated origin, and only the staff bundle takes one')
    git = lambda *a: subprocess.check_output(['git', '-C', checkout, *a], text=True)
    if git('rev-parse', 'HEAD').strip() != commit: die('checkout HEAD is not the approved commit')
    if git('status', '--porcelain').strip(): die('working tree is not clean')
    seen, queue = {}, list(ENTRIES[target])
    while queue:
        p = queue.pop()
        if p in seen: continue
        seen[p] = subprocess.check_output(['git', '-C', checkout, 'show', f'{commit}:{p}'])
        queue += [d for d in deps(p, seen[p]) if d not in seen]
    for p in seen:
        if SENSITIVE.search(p): die(f'refusing sensitive-looking path: {p}')
    files = dict(seen)
    if target == 'login':
        files['rehearsals/m1/origin-profile.json'] = (json.dumps({
            'environment': environment,
            'approvedPublicStaticOrigins': [{'origin': origin, 'environment': environment, 'dedicatedOrigin': True}],
            'approvedHttpsOrigins': []}, indent=1) + '\n').encode()
    elif target == 'staff':
        files['app/origin-profile.json'] = (json.dumps({
            'environment': environment,
            'approvedPublicStaticOrigins': [{'origin': origin, 'environment': environment, 'dedicatedOrigin': True}],
            'approvedHttpsOrigins': [], 'spectatorOrigin': spectator_origin}, indent=1) + '\n').encode()
        files['_redirects'] = b'/ /app/staff.html 302\n'
    else:
        files['_redirects'] = b'/ /app/spectator.html 200\n/tv /app/tv.html 200\n'
    files['_headers'] = (HEADERS if target == 'login' else HEADERS.replace("img-src 'none'", "img-src 'self'")).encode()
    shutil.rmtree(out, ignore_errors=True)
    for p, data in files.items():
        dest = Path(out) / p; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data)
    manifest = {'commit': commit, 'environment': environment, 'target': target,
                'files': {p: hashlib.sha256(d).hexdigest() for p, d in sorted(files.items())}}
    (Path(out) / 'MANIFEST.json').write_text(json.dumps(manifest, indent=1) + '\n')
    return sorted(files) + ['MANIFEST.json']

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    for a in ('checkout', 'commit', 'environment', 'origin', 'out'): ap.add_argument('--' + a, required=True)
    ap.add_argument('--target', default='login'); ap.add_argument('--spectator-origin', default=None)
    a = ap.parse_args()
    print(json.dumps({'files': build(a.checkout, a.commit, a.environment, a.origin, a.out, a.target, a.spectator_origin)}, indent=1))
