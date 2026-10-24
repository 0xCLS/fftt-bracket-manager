#!/usr/bin/env python3
"""Device readiness page in real Chromium: zero network, reports labels only, blocks bad origins."""
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
 if route.request.url.startswith(BASE+'/'):route.continue_()
 else:external.append(route.request.url);route.abort()
with sync_playwright() as p:
 browser=p.chromium.launch()
 ctx=browser.new_context();ctx.route('**/*',guard)
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/rehearsals/m1/device-check.html')
 expect(page.locator('#summary')).to_contain_text('Not checked yet')
 page.click('#check')
 expect(page.locator('#summary')).to_contain_text('NOT READY')
 text=page.inner_text('#checks')
 require('✔ secure context' in text and '✔ web crypto sha256' in text and '✔ tab storage usable' in text,
  'Browser capabilities are detected on a secure context')
 require('✘ origin allowed' in text and 'loopback port or alias not allowlisted' in text,
  'An unapproved origin (not exactly localhost:3000 or an approved HTTPS origin) is blocked')
 page.fill('#approved',BASE)
 page.click('#check')
 expect(page.locator('#summary')).to_contain_text('not a valid exact HTTPS origin')
 require(page.inner_text('#checks').strip()=='','Typing an http origin as "approved" is rejected outright')
 page.fill('#approved','https://phone-host.example.invalid')
 page.click('#check')
 expect(page.locator('#summary')).to_contain_text('NOT READY')
 require('✘ origin allowed' in page.inner_text('#checks'),'An approved HTTPS origin that is not THIS page\'s origin cannot unblock it')
 page.fill('#approved','https://*.example.invalid')
 page.click('#check')
 expect(page.locator('#summary')).to_contain_text('not a valid exact HTTPS origin')
 require(page.inner_text('#checks').strip()=='','Invalid approved-origin input is rejected without a report')
 require(page.evaluate("sessionStorage.length")==0 and page.evaluate("localStorage.length")==0,'Nothing was stored')
 require(BASE not in page.inner_text('main').replace(page.input_value('#approved'),''),'The page address is never echoed in the report')
 require(not external,'No network request was attempted')
 require(not errors,'No page JavaScript errors: '+'; '.join(errors))
 browser.close()
print('M1 DEVICE CHECK BROWSER: capability probe, origin policy, no storage, no network PASS')
