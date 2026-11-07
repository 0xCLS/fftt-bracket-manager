#!/usr/bin/env python3
"""Fail-closed CI routing. PR risk is cumulative from the verified merge base.

A later cosmetic push cannot erase an earlier unverified sensitive change. Main
pushes use the entire verified before/after range. Manual dispatch always runs
full CI; staging/production release gates are independent of this router.
"""
import os
import re
import subprocess
import sys

SHA = re.compile(r'^[0-9a-f]{40}$')
VISUAL = {'app/app.css', 'app/tv.css', 'public-site/styles.css', 'app/assets/emblem.webp'}
PUBLIC = {'app/tv.html', 'app/tv.mjs', 'app/spectator.html', 'app/spectator.mjs',
          'app/date_format.mjs',
          'public-site/index.html', 'tests/e2e/tv_presentation.test.mjs',
          'tests/e2e/public_presentation.test.mjs', 'tests/spectator_presentation.test.mjs'}
ORGANIZER = {'app/view_players.mjs', 'app/view_registration.mjs',
             'tests/e2e/gameday_fast_ui_browser.test.mjs',
             'tests/e2e/gameday_registration_browser.test.mjs',
             'tests/e2e/gameday_launch_google_browser.test.mjs'}
# Do not expedite edits touching data access, scoring, auth, permissions, imports,
# publication or staff writes. Unknown paths remain full regardless of content.
PROTECTED = re.compile(r'\b(?:submit|record|correct|delete|update|insert|upsert|publish|assign|advance|save|clear|remove)\w*\s*\(|\b(import|export|fetch|XMLHttpRequest|WebSocket|sendBeacon|eval|Function|localStorage|sessionStorage|cookie|token|secret|authorization|apikey|password|credential|session|supabase|rpc|mutation|write|publish|permission|authorize|auth|submit|delete|insert|upsert|signIn|signOut)\b|core\s*\.|\.actions\b|\b(?:window|globalThis|navigator|document)\s*\[', re.I)
UI_PROTECTED = re.compile(r'\b\w*(?:auth|publish|score|winner|secret|token|permission|write|submit|record|advance|session|rating|email|phone|private)\w*\b|\b(computeStandings|deriveBoard|startPublicFeed|pickEvent|phase|freshness|stale|expired|event_id|window|document|location|navigator|globalThis|prototype|constructor|Reflect|Proxy|setTimeout|setInterval)\b|https?://|<script', re.I)
CSS_PROTECTED = re.compile(r'@import|url\s*\(|display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:|filter\s*:|clip(?:-path)?\s*:|color\s*:\s*transparent|(?:live|stale|status|warn|error|security|private|demo|fictional)', re.I)


# A narrow TV-presentational lane. This includes the known, read-only screenshot
# workflow introduced by TV PR #61. Any different workflow blob fails closed.
# Scoring/transport/contract/staff changes are never eligible for this lane.
TV_PATHS = {'app/tv.css', 'app/tv.mjs',
            'tests/e2e/tv_presentation.test.mjs',
            '.github/workflows/tv-presentation.yml'}
TV_EVIDENCE_BLOB = 'ab279f6950953aea18fb2052937dfd8a9be054df'
TV_START = 'function tally(m) {'
TV_END = 'function drawConnections() {'
TV_JS_PROTECTED = re.compile(
    r'\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|eval|localStorage|'
    r'sessionStorage|cookie|token|secret|authorization|apikey|password|'
    r'credential|session|supabase|rpc|mutation|write|publish|permission|'
    r'authorize|auth|submit|delete|insert|upsert|signIn|signOut|'
    r'startPublicFeed|pickEvent|deriveBoard|document|window|globalThis|'
    r'navigator|location|setTimeout|setInterval|import|export|async|await|'
    r'email|phone|private|innerHTML|outerHTML|addEventListener)\b|'
    r'\bnew\s+Function\b|https?://', re.I)
TV_CSS_PROTECTED = re.compile(
    r'@import|url\s*\(|display\s*:\s*none\b|visibility\s*:\s*hidden\b|'
    r'opacity\s*:\s*0(?:\.0*)?\s*(?:;|}|$)|'
    r'filter\s*:\s*(?!drop-shadow\s*\()|'
    r'clip(?:-path)?\s*:|(?:-webkit-)?mask(?:-image)?\s*:|'
    r'(?<![\w-])color\s*:\s*transparent\b', re.I)
TV_TEST_NAME = re.compile(r"""\btest\(\s*(['"])(.*?)\1\s*,""")
TV_TEST_ASSERT = re.compile(r'\bassert\.\w+\s*\(')


def safe_tv_presentation(start, end, changed):
    """Allow only the tested rendering island, preserved tests and attested workflow."""
    if 'app/tv.mjs' in changed:
        old = git('show', f'{start}:app/tv.mjs')
        new = git('show', f'{end}:app/tv.mjs')
        if any(old.count(marker) != 1 or new.count(marker) != 1
               for marker in (TV_START, TV_END)):
            return False, 'missing or ambiguous TV render boundaries'
        # Imports, feed selection, subscriptions, privacy, timers and controls
        # must remain byte-identical. Only render helpers may change.
        if old.split(TV_START)[0] != new.split(TV_START)[0] or old.split(TV_END)[1] != new.split(TV_END)[1]:
            return False, 'TV public feed or control boundary changed'
        if TV_JS_PROTECTED.search(edited_lines(start, end, 'app/tv.mjs')):
            return False, 'TV rendering edit has a protected side effect or data reference'
    if 'app/tv.css' in changed and TV_CSS_PROTECTED.search(edited_lines(start, end, 'app/tv.css')):
        return False, 'TV CSS might hide content or fetch resources'
    if 'tests/e2e/tv_presentation.test.mjs' in changed:
        path = 'tests/e2e/tv_presentation.test.mjs'
        old, new = git('show', f'{start}:{path}'), git('show', f'{end}:{path}')
        old_names, new_names = set(TV_TEST_NAME.findall(old)), set(TV_TEST_NAME.findall(new))
        if (not old_names or not old_names <= new_names
                or len(TV_TEST_ASSERT.findall(new)) < len(TV_TEST_ASSERT.findall(old))
                or re.search(r'\b(?:test|describe)\s*\.\s*(?:skip|only|todo)\s*\(|'
                             r'\bprocess\s*\.\s*exit\s*\(', new)):
            return False, 'TV regression coverage deleted, skipped or unverifiable'
    if '.github/workflows/tv-presentation.yml' in changed:
        if git('rev-parse', f'{end}:.github/workflows/tv-presentation.yml') != TV_EVIDENCE_BLOB:
            return False, 'unattested TV workflow modification'
    return True, 'verified TV-only rendering, coverage and evidence workflow'


def git(*args):
    return subprocess.check_output(('git', *args), encoding='utf-8', stderr=subprocess.DEVNULL).strip()


def edited_lines(before, after, path):
    patch = git('diff', '--no-ext-diff', '--unified=0', before, after, '--', path)
    return '\n'.join(line[1:] for line in patch.splitlines()
                     if line.startswith(('+', '-')) and not line.startswith(('+++', '---')))


def classify(event, action, before, after, base='', head=''):
    if event == 'workflow_dispatch':
        return 'full', 'manual full-regression request'
    try:
        if event == 'pull_request' and action in ('opened', 'reopened', 'synchronize'):
            if not SHA.fullmatch(base or '') or not SHA.fullmatch(head or ''):
                return 'full', 'missing or invalid PR base/head SHA'
            for sha in (base, head):
                git('cat-file', '-e', sha + '^{commit}')
            if git('rev-parse', 'HEAD') != head:
                return 'full', 'checkout is not the PR head'
            if action == 'synchronize':
                if not SHA.fullmatch(before or '') or after != head:
                    return 'full', 'missing or inconsistent synchronize SHAs'
                git('cat-file', '-e', before + '^{commit}')
                git('merge-base', '--is-ancestor', before, head)
            start = git('merge-base', base, head)
            if not SHA.fullmatch(start):
                return 'full', 'unverifiable merge base'
            end = head
        elif event == 'push':
            if not SHA.fullmatch(before or '') or not SHA.fullmatch(after or ''):
                return 'full', 'missing or invalid push SHAs'
            for sha in (before, after):
                git('cat-file', '-e', sha + '^{commit}')
            if git('rev-parse', 'HEAD') != after:
                return 'full', 'checkout is not the pushed commit'
            git('merge-base', '--is-ancestor', before, after)
            start, end = before, after
        else:
            return 'full', 'unrecognized trigger'
        changed = [x for x in git('diff', '--name-only', '--no-renames', start, end).splitlines() if x]
        if not changed:
            return 'full', 'empty or unverifiable change range'
        docs = lambda p: p.startswith('docs/') and p.endswith('.md')
        if all(docs(p) for p in changed):
            return 'docs', 'documentation-only verified range'
        if all(p in TV_PATHS or docs(p) for p in changed) and any(p in TV_PATHS for p in changed):
            safe, reason = safe_tv_presentation(start, end, changed)
            return ('public-ui' if safe else 'full'), reason
        for path in changed:
            if docs(path):
                continue
            if path == 'app/public_core.mjs':
                # Only the final pure event-selection function can enter the public lane.
                # The anonymous reader, feed wiring and imports must be byte-identical.
                marker = 'export function pickEvent('
                old, new = git('show', f'{start}:{path}'), git('show', f'{end}:{path}')
                if old.count(marker) != 1 or new.count(marker) != 1 or old.split(marker)[0] != new.split(marker)[0]:
                    return 'full', 'public reader or feed wiring changed'
                edits = edited_lines(start, end, path)
                if (PROTECTED.search(edits) or UI_PROTECTED.search(edits)) or re.search(r'\b(?:new|throw|class|async|await|import|export)\b', edits):
                    return 'full', 'event selection contains protected or ambiguous edits'
                continue
            if path not in VISUAL | PUBLIC | ORGANIZER:
                return 'full', 'unknown, security, scoring, contract or infrastructure path'
            if path.endswith('.css') and CSS_PROTECTED.search(edited_lines(start, end, path)):
                return 'full', 'CSS changes may hide status or load external content'
            if path.startswith('tests/'):
                return 'full', 'test changes require comprehensive verification'
            if path.endswith(('.mjs', '.html')) and (PROTECTED.search(edited_lines(start, end, path)) or UI_PROTECTED.search(edited_lines(start, end, path))):
                return 'full', 'protected or ambiguous UI edit'
        if any(p in PUBLIC or p in {'app/public_core.mjs', 'app/tv.css', 'public-site/styles.css'} for p in changed):
            return 'public-ui', 'verified public presentation or event-selection range'
        if any(p in ORGANIZER for p in changed):
            return 'organizer-ui', 'verified organizer presentation range'
        return 'ui-visual', 'verified visual-only range'
    except (OSError, subprocess.CalledProcessError, ValueError, TypeError):
        return 'full', 'change range or source could not be verified'


if __name__ == '__main__':
    lane, reason = classify(os.getenv('GITHUB_EVENT_NAME', ''), os.getenv('EVENT_ACTION', ''),
                            os.getenv('SYNC_BEFORE', ''), os.getenv('SYNC_AFTER', ''),
                            os.getenv('BASE_SHA', ''), os.getenv('HEAD_SHA', ''))
    print('CI lane:', lane, '\nReason:', reason)
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
            stream.write('lane=' + lane + '\n')
    if lane not in ('full', 'organizer-ui', 'public-ui', 'ui-visual', 'docs'):
        sys.exit('Unrecognized lane')
