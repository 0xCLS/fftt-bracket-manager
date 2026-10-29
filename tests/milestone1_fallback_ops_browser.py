#!/usr/bin/env python3
"""Organizer fallback operations rehearsal in real Chromium. ZERO network (every non-local request
is aborted and counted), fictional data only. Walks stand-down, protected backup, isolated fallback,
paper-backed offline results, manual per-result reconciliation and the return-to-cloud readiness list,
checking that each safety gate blocks until satisfied and that no score write is ever enabled.
"""
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*_):pass
def require(ok,reason):
 assert ok,reason
 print('PASS:',reason,flush=True)
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}'
external=[]
def guard(route):
 if route.request.url.startswith(BASE+'/'):
  route.continue_()
 else:
  external.append(route.request.url);route.abort()
with sync_playwright() as p:
 browser=p.chromium.launch()
 ctx=browser.new_context(viewport={'width':1100,'height':1400})
 ctx.route('**/*',guard)
 page=ctx.new_page()
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/rehearsals/m1/fallback-ops.html')
 msg=page.locator('#message');phase=page.locator('#phase')
 def click(sel):
  page.click(sel);page.wait_for_timeout(60)
 expect(phase).to_contain_text('cloud-ready')
 click('#outage')
 expect(msg).to_contain_text('BLOCKED')
 require(True,'Declaring an outage without a verified organizer session is blocked')
 click('#verify');page.check('#unknown');click('#outage')
 expect(phase).to_contain_text('cloud-paused')
 expect(page.locator('#unknowns')).to_contain_text('1 unresolved of 1')
 click('#requestStandDown')
 page.select_option('#method-scorekeeper-a','simulated');click('#ack-scorekeeper-a')
 page.select_option('#method-scorekeeper-b','device-self-report');click('#ack-scorekeeper-b')
 page.select_option('#method-tv-display','organizer-physically-observed');click('#ack-tv-display')
 expect(page.locator('#standdown')).to_contain_text('3/3 acknowledged (complete)')
 expect(page.locator('#physical')).to_contain_text('NOT physically confirmed')
 require(True,'Simulated and self-reported stand-down completes training but is NOT labelled physical')
 click('#seal');expect(msg).to_contain_text('BLOCKED')
 page.check('#protected');click('#seal')
 expect(page.locator('#backup')).to_contain_text('sealed · intact')
 click('#tamper');click('#verifyBackup')
 expect(page.locator('#backup')).to_contain_text('MISMATCH')
 page.check('#approved');page.check('#paperLog');click('#fallback')
 expect(msg).to_contain_text('BLOCKED');expect(phase).to_contain_text('cloud-paused')
 require(True,'A tampered backup blocks the transfer of authority')
 page.fill('#backupText','{"fictionalBackup":true,"matches":["C-0-0","C-0-1"]}');click('#verifyBackup')
 expect(page.locator('#backup')).to_contain_text('sealed · intact')
 page.uncheck('#approved');click('#fallback');expect(msg).to_contain_text('BLOCKED')
 page.check('#approved');click('#fallback')
 expect(phase).to_contain_text('single-device-fallback')
 click('#record')
 expect(page.locator('#offline')).to_contain_text('1 awaiting disposition of 1')
 expect(page.locator('#writes')).to_contain_text('DISABLED')
 click('#reconnect');expect(phase).to_contain_text('organizer-reconciliation')
 click('#reconcile');expect(msg).to_contain_text('BLOCKED')
 click('#reverify');click('#verifyBackup')
 page.check('#backupReviewed');page.check('#logReviewed')
 click('#reconcile');expect(msg).to_contain_text('BLOCKED')
 require(True,'Reconciliation is blocked while any result or unknown score is undecided')
 page.select_option('#disp-O-1','cloud-already-authoritative-discard-offline');click('#dispose-O-1')
 click('#reconcile');expect(msg).to_contain_text('BLOCKED')
 click('#check-unknown');click('#reconcile')
 expect(phase).to_contain_text('cloud-reloading')
 click('#cloudRead');expect(phase).to_contain_text('cloud-ready')
 expect(page.locator('#readiness')).to_contain_text('Ready: no')
 for d in ['scorekeeper-a','scorekeeper-b','tv-display']:
  click('#release-'+d)
 expect(page.locator('#readiness')).to_contain_text('Ready: YES')
 expect(page.locator('#readiness')).to_contain_text('score writes remain disabled')
 expect(page.locator('#writes')).to_contain_text('DISABLED')
 click('#verifyLog');expect(msg).to_contain_text('Incident log chain verified')
 require(True,'Full manual recovery completes; readiness never enables a score writer')
 page.select_option('#mode','live')
 click('#verify');click('#outage');click('#requestStandDown')
 page.select_option('#method-scorekeeper-a','simulated');click('#ack-scorekeeper-a')
 expect(msg).to_contain_text('BLOCKED');expect(page.locator('#standdown')).to_contain_text('0/3')
 page.select_option('#method-scorekeeper-a','organizer-physically-observed');click('#ack-scorekeeper-a')
 expect(page.locator('#standdown')).to_contain_text('1/3')
 require(True,'Live mode refuses simulated stand-down and accepts only physical observation')
 require(not external,'No network request was attempted: '+str(external))
 require(not errors,'No page JavaScript errors: '+'; '.join(errors))
 browser.close()
print('M1 FALLBACK OPS BROWSER: stand-down evidence, backup tamper gate, isolated fallback, manual reconciliation, readiness PASS; ZERO NETWORK')
