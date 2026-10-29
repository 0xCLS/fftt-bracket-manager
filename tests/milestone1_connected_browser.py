#!/usr/bin/env python3
"""Milestone 1: real Chromium dual-browser synthetic connected-desk rehearsal.
ALL Supabase traffic intercepted. No hosted sign-in, score, migration or writes.
Tests the existing C8 memory-only Magic Link callback and deployed V2 read shape.
"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
SUPA='https://copmkalfkkrkzheohwuc.supabase.co'
EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
MATCH='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
P1='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
P2='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
JWT='header.payload.signature'
EMAILS={role:'fictional-'+role+'@example.test'
        for role in ('organizer','scorekeeper','outsider')}
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
def require(ok,reason):
    assert ok,reason
    print('PASS:',reason,flush=True)
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
URL=f'http://127.0.0.1:{server.server_port}/rehearsals/c8/index.html'
live={'revision':1,'desk':[],'fail':None,'readIndex':0}
calls=[]
forbidden=[]
def desk_row():
    return {
        'event_id':EVENT,'bracket_generation':1,'match_id':MATCH,
        'match_code':'C-0-0','match_version':0,'bracket':'championship',
        'round_number':0,'slot':0,'player_1_id':P1,'player_2_id':P2,
        'player_1_name':'<img src=x onerror=alert(1)>',
        'player_2_name':'Fictional Beta','is_championship_final':True,'table_number':None,
    }
def new_context(browser,role):
    ctx=browser.new_context(viewport={'width':1100,'height':820})
    def handler(route):
        req=route.request
        if not req.url.startswith(SUPA+'/'):
            route.continue_();return
        path=req.url.removeprefix(SUPA)
        pathOnly=path.split('?')[0]
        calls.append((role,req.method,pathOnly))
        status=200;body=None
        if req.method=='OPTIONS':
            route.fulfill(status=200,body='',headers={
                'Access-Control-Allow-Origin':'*',
                'Access-Control-Allow-Headers':'apikey, authorization, content-type, accept',
                'Access-Control-Allow-Methods':'POST, GET, OPTIONS'})
            return
        if pathOnly=='/auth/v1/user':
            require(req.headers.get('authorization')=='Bearer '+JWT,
                    'Signed existing user lookup required')
            body={'id':P1,'email':EMAILS[role]}
        elif pathOnly=='/rest/v1/fftt_public_results_v1':
            require(req.method=='GET','Anonymous public read uses only GET')
            body=[]
        elif pathOnly=='/rest/v1/rpc/fftt_staff_role_v1':
            if role=='outsider':status=403;body={'code':'42501'}
            else:body=role
        elif pathOnly=='/rest/v1/rpc/fftt_matchdesk_v1':
            if role=='outsider':status=403;body={'code':'42501'}
            else:body=live['desk']
        elif pathOnly=='/rest/v1/rpc/fftt_score_decision_snapshot_v2':
            require(req.method=='POST' and req.headers.get('authorization')=='Bearer '+JWT,
                    'V2 snapshot is signed and read-only')
            require(json.loads(req.post_data)=={'p_event_id':EVENT,'p_submission_id':None},
                    'V2 snapshot is exact event-scoped without foreign receipt')
            if role=='outsider':status=403;body={'code':'42501'}
            elif live['fail']=='http':status=503;body={'code':'service unavailable'}
            else:
                live['readIndex']+=1
                rev=live['revision'] + (1 if live['fail']=='race' and live['readIndex']%2==0 else 0)
                body={'event_id':EVENT,'revision':rev,'generation':1,'lifecycle':'active',
                      'submission_id':None,'decision':None}
        else:
            forbidden.append((role,pathOnly))
            status=403;body={}
        route.fulfill(status=status,headers={
            'Access-Control-Allow-Origin':'*',
            'Access-Control-Allow-Methods':'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers':'apikey, authorization, content-type, accept',
            'Cache-Control':'no-store','Content-Type':'application/json'},
            body=json.dumps(body))
    ctx.route('**/*',handler)
    page=ctx.new_page()
    errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
    return ctx,page,errors
def sign_in(page,role):
    # Mock a synthetic returning callback; requestLink is NEVER called.
    page.goto(URL+'#access_token='+JWT+'&token_type=bearer&expires_in=3600&type=magiclink')
    expect(page.locator('#confirmForm')).to_be_visible()
    page.locator('#confirmEmail').fill(EMAILS[role])
    page.locator('#confirmForm button').click()
    expect(page.locator('#authBadge')).to_contain_text('SIGNED IN')
    require('#' not in page.url and 'access_token=' not in page.url,
            'Callback bearer token scrubbed from browser address')
    require(page.locator('#connectedControls').is_visible(),'Connected controls require signed account')
    require(page.locator('#hostControls').is_visible(),'Synthetic hosted scoring area visible ONLY after signed login')
    require(page.locator('#hostSend').is_disabled(),'Hosted score cannot transmit without authorized prepared match')
def read(page):
    page.locator('#eventId').fill(EVENT)
    page.locator('#readConnected').click()

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
        contexts=[]
        a,pa,ea=new_context(browser,'organizer');contexts.append(a)
        b,pb,eb=new_context(browser,'scorekeeper');contexts.append(b)
        o,po,eo=new_context(browser,'outsider');contexts.append(o)
        for page,role in [(pa,'organizer'),(pb,'scorekeeper'),(po,'outsider')]:
            sign_in(page,role)
        require(not any(path=='/auth/v1/otp' for _,_,path in calls),
                'No unsolicited Magic Link email or account creation')
        # Old mock/consumed fixture must never be eligible for a hosted score
        pb.locator('#eventId').fill(EVENT)
        pb.locator('#hostRead').click()
        expect(pb.locator('#hostStatus')).to_contain_text('NO hosted score sent')
        check_hosted=pb.locator('#hostPrepare').is_disabled() and pb.locator('#hostSend').is_disabled()
        require(check_hosted,'Unknown/consumed event blocked BEFORE hosted score preparation')
        read(pa);read(pb)
        expect(pa.locator('#connectedStatus')).to_contain_text('event revision 1')
        expect(pb.locator('#connectedStatus')).to_contain_text('event revision 1')
        require('0 pending matches' in pa.locator('#connectedStatus').inner_text(),
                'Consumed hosted fixture shows zero pending matches')
        live['revision']=2;live['desk']=[desk_row()]
        read(pb)
        expect(pb.locator('#connectedStatus')).to_contain_text('event revision 2')
        expect(pb.locator('#connectedMatches')).to_contain_text('Fictional Beta')
        require(pa.locator('#connectedMatches .match').count()==0,
                'Independent organizer device remains previous read until manual refresh')
        read(pa);expect(pa.locator('#connectedStatus')).to_contain_text('event revision 2')
        require(pa.locator('#connectedMatches .match').count()==1,
                'Organizer device now sees same revised synthetic Match Desk')
        require(pa.locator('#connectedMatches img').count()==0,
                'Private player names rendered as text, not HTML')
        read(po)
        expect(po.locator('#connectedStatus')).to_contain_text('denied, changed, or unavailable')
        require(po.locator('#connectedMatches .match').count()==0,
                'Signed outsider never sees private match rows')
        live['fail']='race';live['readIndex']=0
        read(pb);expect(pb.locator('#connectedStatus')).to_contain_text('denied, changed, or unavailable')
        require(pb.locator('#connectedMatches .match').count()==0,
                'Event revision changed mid-read; private view fully discarded')
        live['fail']='http'
        read(pa);expect(pa.locator('#connectedStatus')).to_contain_text('denied, changed, or unavailable')
        require(pa.locator('#connectedMatches .match').count()==0,
                'HTTP 503 clears old private view and never claims cached results')
        live['fail']=None
        read(pa);expect(pa.locator('#connectedStatus')).to_contain_text('event revision 2')
        pa.locator('#readStaff').click()
        expect(pa.locator('#staffStatus')).to_contain_text('Authorized organizer')
        require(pa.locator('#staffMatches .match').count()==1,
                'Legacy private Match Desk can be loaded before disconnect')
        pa.evaluate("window.dispatchEvent(new Event('offline'))")
        expect(pa.locator('#connectedStatus')).to_contain_text('Connection lost')
        require(pa.locator('#connectedMatches .match').count()==0
                and pa.locator('#staffMatches .match').count()==0,
                'Offline event removes BOTH legacy and connected private views; no queue')
        pa.locator('#end').click()
        require(pa.locator('#connectedControls').is_hidden()
                and pa.locator('#connectedMatches .match').count()==0,
                'Sign-out clears connected private data')
        require(pa.evaluate('localStorage.length===0 && sessionStorage.length===0'),
                'No JWT or score data in browser storage')
        pb.set_viewport_size({'width':375,'height':780})
        require(pb.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),
                'Mobile connected desk has no horizontal overflow')
        require(not forbidden,'No unexpected or write endpoints called')
        require(not any('submit_match_result' in path or 'manage_staff' in path
                  for _,_,path in calls),
                'Both browser devices and outsider make zero score or admin calls')
        require(not ea and not eb and not eo,
                'No browser script exceptions on organizer/scorekeeper/outsider')
        for c in contexts:c.close()
        browser.close()
        print('MILESTONE 1 CONNECTED CHROMIUM: two isolated signed devices + outsider PASS; NO hosted traffic',flush=True)
finally:
    server.shutdown();server.server_close();thread.join(timeout=3)
