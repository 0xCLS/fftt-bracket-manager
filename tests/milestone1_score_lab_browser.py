#!/usr/bin/env python3
"""Chromium end-to-end local synthetic scoring + unknown-result recovery lab.
ZERO Supabase/hosted network. Two independently prepared role-bound score
intents in a shared volatile fictional fixture. No production score routes.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
URL=f'http://127.0.0.1:{server.server_port}/rehearsals/m1/index.html'
def check(ok,label):
    assert ok,label
    print('PASS:',label,flush=True)
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1280,'height':980})
        external=[]
        errors=[]
        def strict(route):
            if route.request.url.startswith(f'http://127.0.0.1:{server.server_port}/'):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()
        context.route('**/*',strict)
        page=context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(URL,wait_until='networkidle')
        expect(page.get_by_role('heading',name='Scorekeeper safety rehearsal')).to_be_visible()
        check(page.locator('#network').inner_text()=='0','Local simulation makes zero network requests')
        for who in ['A','B']:
            page.locator('#load'+who).click()
            expect(page.locator('#state'+who)).to_contain_text('READY')
            page.locator('#prepare'+who).click()
            expect(page.locator('#state'+who)).to_contain_text('PREPARED')
            ident=page.locator('#incident'+who).inner_text()
            check(len(ident)==36,'Prepared submission ID generated BEFORE score send')
            check(page.locator('#send'+who).is_disabled(),'Record acknowledgment is required')
            page.locator('#recorded'+who).check()
            check(page.locator('#send'+who).is_enabled(),'Only prepared recorded score can send once')
        check(page.locator('#rev').inner_text()=='0','Both devices prepared at same revision')
        page.locator('#lostA').check()
        page.locator('#sendA').click()
        expect(page.locator('#stateA')).to_contain_text('UNKNOWN')
        check(page.locator('#sendA').is_disabled(),'Lost HTTP response blocks replay')
        check(page.locator('#rev').inner_text()=='1','Server committed synthetic score even though A lost ACK')
        page.locator('#sendB').click()
        expect(page.locator('#stateB')).to_contain_text('NEEDS OWN RECEIPT')
        page.locator('#inspectB').click()
        expect(page.locator('#stateB')).to_contain_text('CONFIRMED REJECTED')
        check(page.locator('#sendB').is_disabled(),'Durable stale rejection cannot be replayed')
        page.locator('#inspectA').click()
        expect(page.locator('#stateA')).to_contain_text('CONFIRMED ACCEPTED')
        check(page.locator('#decisions').inner_text()=='2','One accepted and one stale rejected terminal decision')
        check(page.locator('#publicCount').inner_text()=='0','Spectator receives no fictional private publication')
        page.locator('#ackB').click()
        expect(page.locator('#stateB')).to_contain_text('NEEDS REFRESH')
        page.locator('#loadB').click()
        expect(page.locator('#stateB')).to_contain_text('READY')
        check(page.locator('#prepareB').is_disabled(),'Committed match not available for new scoring')
        page.locator('#fallbackA').click()
        expect(page.locator('#fallbackStatus')).to_contain_text('Checklist incomplete')
        for x in ['Organizer','Devices','Backup','Log','Unknown']:
            page.locator('#check'+x).check()
        page.locator('#fallbackA').click()
        expect(page.locator('#fallbackStatus')).to_contain_text('physical isolation is UNVERIFIED')
        check(page.locator('#network').inner_text()=='0','Fallback preview never sends cloud writes')
        page.set_viewport_size({'width':375,'height':820})
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),
              'Mobile scorekeeper and fallback layout has no horizontal overflow')
        check(not external,'Strict browser test intercepted no external/hosted network requests')
        check(not errors,'No uncaught browser JavaScript errors')
        context.close();browser.close()
        print('MILESTONE 1 SCORE LAB: accepted, stale-rejected, lost ACK, own recovery, private fallback PASS (zero network)',flush=True)
finally:
    server.shutdown();server.server_close();thread.join(timeout=3)
