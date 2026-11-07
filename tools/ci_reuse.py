#!/usr/bin/env python3
"""Prove an unchanged, fully tested PR tree for a main push (never a release gate)."""
import json
import os
import re
import subprocess
import urllib.request

SHA = re.compile(r'^[0-9a-f]{40}$')
REQUIRED = {'Full regression — browser and security foundation',
            'Full regression — game-day and launch workflows', 'Disposable synthetic PostgreSQL'}


def proof(before, after, pulls, commits, runs, jobs, changed, base_ancestor=False):
    if not SHA.fullmatch(before or '') or not SHA.fullmatch(after or '') or not changed or not base_ancestor:
        return False
    # Workflow, policy, test and dependency changes always receive fresh full CI.
    if any(p.startswith(('.github/', 'tests/', 'tools/')) or p.endswith(('package-lock.json', 'package.json')) for p in changed):
        return False
    candidates = [p for p in pulls if p.get('merged_at') and p.get('merge_commit_sha') == after
                  and p.get('base', {}).get('ref') == 'main'
                  and p.get('head', {}).get('repo', {}).get('full_name') == os.environ.get('GITHUB_REPOSITORY')]
    if len(candidates) != 1:
        return False
    head = candidates[0].get('head', {}).get('sha', '')
    if not SHA.fullmatch(head) or commits.get(head) != commits.get(after) or not commits.get(after):
        return False
    for run in runs:
        tested_pr = [p for p in run.get('pull_requests', []) if p.get('number') == candidates[0].get('number')
                     and p.get('base', {}).get('sha') == before and p.get('head', {}).get('sha') == head]
        if (len(tested_pr) == 1 and run.get('head_sha') == head and run.get('event') == 'pull_request'
                and run.get('path') == '.github/workflows/browser-tests.yml'
                and run.get('status') == 'completed' and run.get('conclusion') == 'success'):
            rows = jobs.get(run.get('id'), [])
            if REQUIRED <= {j.get('name') for j in rows if j.get('status') == 'completed' and j.get('conclusion') == 'success'}:
                return True
    return False


def main():
    repo=os.environ['GITHUB_REPOSITORY']; before=os.environ.get('SYNC_BEFORE',''); after=os.environ.get('SYNC_AFTER','')
    if not SHA.fullmatch(before) or not SHA.fullmatch(after): return False
    def api(path):
        req=urllib.request.Request('https://api.github.com/repos/'+repo+path,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'], 'Accept':'application/vnd.github+json', 'User-Agent':'fftt-ci-router'})
        with urllib.request.urlopen(req,timeout=15) as r: return json.load(r)
    if subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip() != after: return False
    if subprocess.check_output(['git','rev-parse',after+'^1'],text=True).strip() != before: return False
    changed=subprocess.check_output(['git','diff','--name-only','--no-renames',before,after],text=True).splitlines()
    pulls=api(f'/commits/{after}/pulls?per_page=100')
    if len(pulls)!=1: return False
    head=pulls[0].get('head',{}).get('sha','')
    if not SHA.fullmatch(head): return False
    commits={sha:api('/git/commits/'+sha).get('tree',{}).get('sha') for sha in (head,after)}
    runs=api(f'/actions/workflows/browser-tests.yml/runs?event=pull_request&head_sha={head}&per_page=100').get('workflow_runs',[])
    jobs={r['id']:api(f'/actions/runs/{r["id"]}/jobs?per_page=100').get('jobs',[]) for r in runs if r.get('status')=='completed' and r.get('conclusion')=='success'}
    comparison=api(f'/compare/{before}...{head}')
    ancestor=comparison.get('status') in ('ahead','identical')
    return proof(before,after,pulls,commits,runs,jobs,changed,ancestor)


if __name__ == '__main__':
    try:
        if main():
            print('PR full regression and merge tree match; exact-commit release gate remains independent.')
            with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as f: f.write('lane=reused\n')
    except Exception as exc:
        print('PR proof unavailable; classify normally:', type(exc).__name__)
