#!/usr/bin/env python3
"""Milestone 1 isolated real-browser synthetic organizer continuity drill.
All external requests are BLOCKED, no Auth, hosted scores, backend or real data.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parent.parent
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*_):pass
def require(yes,label):
 assert yes,label
 print('PASS:',label,flush=True)
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
base=f'http://127.0.0.1:{server.server_port}'
network=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':1080,'height':900})
  context.route('**/*',lambda route:route.continue_()
    if route.request.url.startswith(base+'/')
    else (network.append(route.request.url),route.abort()))
  page=context.new_page();errors=[]
  page.on('pageerror',lambda err:errors.append(str(err)))
  page.goto(base+'/rehearsals/m1/continuity.html')
  require('DISABLED' in page.locator('#writes').inner_text(),
          'Cloud writer is never enabled in disconnected drill')
  page.locator('#verify').click()
  expect(page.locator('#message')).to_contain_text('BLOCKED')
  require(page.locator('#phase').inner_text().startswith('cloud-ready'),
          'Non-organizer rejected and cloud state unchanged')
  page.locator('#role').select_option('organizer')
  page.locator('#verify').click()
  expect(page.locator('#message')).to_contain_text('role verified')
  page.locator('#fallback').click()
  expect(page.locator('#message')).to_contain_text('BLOCKED')
  require('cloud-ready' in page.locator('#phase').inner_text(),
          'Healthy cloud cannot silently enter fallback')
  page.locator('#unknown').check()
  page.locator('#outage').click()
  expect(page.locator('#phase')).to_contain_text('cloud-paused')
  page.locator('#approved').check()
  page.locator('#stoodDown').check()
  page.locator('#backup').check()
  page.locator('#log').check()
  page.locator('#fallback').click()
  expect(page.locator('#message')).to_contain_text('BLOCKED')
  require('cloud-paused' in page.locator('#phase').inner_text(),
          'Unknown in-flight score cannot be hidden for fallback')
  page.locator('#documented').check()
  page.locator('#fallback').click()
  expect(page.locator('#phase')).to_contain_text('single-device-fallback')
  expect(page.locator('#writes')).to_contain_text('DISABLED')
  page.locator('#edit').click()
  expect(page.locator('#edits')).to_have_text('1')
  page.locator('#reconnect').click()
  expect(page.locator('#phase')).to_contain_text('organizer-reconciliation')
  page.locator('#reconcile').click()
  expect(page.locator('#message')).to_contain_text('BLOCKED')
  page.locator('#reverify').click()
  expect(page.locator('#message')).to_contain_text('role rechecked')
  page.locator('#backupReviewed').check()
  page.locator('#logReviewed').check()
  page.locator('#editsReviewed').check()
  page.locator('#reconcile').click()
  expect(page.locator('#message')).to_contain_text('BLOCKED')
  page.locator('#unknownReviewed').check()
  page.locator('#reconcile').click()
  expect(page.locator('#phase')).to_contain_text('cloud-reloading')
  require('DISABLED' in page.locator('#writes').inner_text(),
          'Manual review still cannot re-enable cloud scoring')
  page.locator('#verified').click()
  expect(page.locator('#phase')).to_contain_text('cloud-ready')
  require('DISABLED' in page.locator('#writes').inner_text(),
          'Even fresh simulated signed read never supplies cloud score writer')
  page.locator('#restart').click()
  expect(page.locator('#phase')).to_contain_text('cloud-ready')
  expect(page.locator('#edits')).to_have_text('0')
  require(not network,'No external or Supabase network requests in local drill')
  require(not errors,'No browser script errors')
  context.close();browser.close()
  print('M1 CONTINUITY BROWSER: organizer-only denied outsider, unknown-score documentation, backup/staff stand-down and manual reconciliation PASS; ZERO NETWORK',flush=True)
finally:
 server.shutdown();server.server_close();thread.join(timeout=3)
