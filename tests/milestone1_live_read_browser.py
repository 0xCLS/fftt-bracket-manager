#!/usr/bin/env python3
"""Milestone 1 operational READINESS: opt-in signed follow + anonymous spectator.
Real isolated Chromium browser contexts, ALL Supabase traffic intercepted.
No hosted scoring, new fixture, Auth Admin operation or cloud publication.
"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
HOST='https://copmkalfkkrkzheohwuc.supabase.co'
EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
MATCH='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
P1='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
P2='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
JWT='header.payload.signature'
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*_):pass
def require(ok,reason):
 assert ok,reason
 print('PASS:',reason,flush=True)
def public_event(winner=None,illegal=False):
 row={'match_id':'champ-0-0','bracket':'championship','round':0,'slot':0,
      'player_1_name':'<img src=x onerror=alert(1)>','player_2_name':'Fictional Beta',
      'winner_name':winner,'game_scores':'11-8, 11-9, 11-7' if winner else '',
      'status':'complete' if winner else 'pending'}
 if illegal: row['private_email']='do-not-display@example.test'
 return [{
  'event_id':EVENT,'event_name':'Fictional Public Spectator Rehearsal',
  'event_date':'2099-11-27','status':'active',
  'updated_at':'2099-11-27T10:00:00Z',
  'brackets':[{'name':'championship','matches':[row]}]
 }]
state={'public':[], 'rev':1,'desk':[], 'staffDenied':False}
calls=[];forbidden=[]
def desk():
 return {'event_id':EVENT,'bracket_generation':1,'match_id':MATCH,
  'match_code':'C-0-0','match_version':0,'bracket':'championship',
  'round_number':0,'slot':0,'player_1_id':P1,'player_2_id':P2,
  'player_1_name':'Fictional Alpha','player_2_name':'Fictional Beta',
  'is_championship_final':True,'table_number':None}
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
worker=threading.Thread(target=server.serve_forever,daemon=True)
worker.start()
base=f'http://127.0.0.1:{server.server_port}'
def new_context(browser,role):
 ctx=browser.new_context(viewport={'width':960,'height':800})
 def intercept(route):
  r=route.request
  if not r.url.startswith(HOST+'/'):
   route.continue_();return
  path=r.url[len(HOST):].split('?')[0]
  calls.append((role,r.method,path,'authorization' in r.headers))
  headers={'Content-Type':'application/json','Cache-Control':'no-store',
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers':'apikey,authorization,content-type,accept'}
  if r.method=='OPTIONS':route.fulfill(status=200,body='',headers=headers);return
  status=200
  if path=='/rest/v1/fftt_public_results_v1' and r.method=='GET':
   data=state['public']
  elif role=='staff' and path=='/auth/v1/user':
   data={'id':P1,'email':'fake-staff@example.test'}
  elif role=='staff' and path=='/rest/v1/rpc/fftt_staff_role_v1' and r.method=='POST':
   data='scorekeeper' if not state['staffDenied'] else None
  elif role=='staff' and path=='/rest/v1/rpc/fftt_score_decision_snapshot_v2' and r.method=='POST':
   data={'event_id':EVENT,'revision':state['rev'],'generation':1,
         'lifecycle':'active','submission_id':None,'decision':None}
  elif role=='staff' and path=='/rest/v1/rpc/fftt_matchdesk_v1' and r.method=='POST':
   data=state['desk']
  else:
   forbidden.append((role,r.method,path));status=403;data={}
  route.fulfill(status=status,body=json.dumps(data),headers=headers)
 ctx.route('**/*',intercept)
 page=ctx.new_page()
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 return ctx,page,errors

try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
  contexts=[]
  try:
   a,pa,ea=new_context(browser,'audienceA');contexts.append(a)
   b,pb,eb=new_context(browser,'audienceB');contexts.append(b)
   c,ps,es=new_context(browser,'staff');contexts.append(c)
   pa.goto(base+'/rehearsals/m1/live-spectator.html')
   pb.goto(base+'/rehearsals/m1/live-spectator.html')
   require(pa.locator('#events').inner_text().strip()=='' and pb.locator('#events').inner_text().strip()=='',
           'Two separate spectator browsers default paused and show no cached event')
   pa.locator('#start').click();pb.locator('#start').click()
   expect(pa.locator('#status')).to_contain_text('0 approved event(s)')
   expect(pb.locator('#status')).to_contain_text('0 approved event(s)')
   ps.goto(base+'/rehearsals/c8/index.html#access_token='+JWT+
           '&token_type=bearer&expires_in=3600&type=magiclink')
   ps.locator('#confirmEmail').fill('fake-staff@example.test')
   ps.locator('#confirmForm button').click()
   expect(ps.locator('#authBadge')).to_contain_text('SIGNED IN')
   ps.locator('#eventId').fill(EVENT)
   ps.locator('#followConnected').click()
   expect(ps.locator('#connectedStatus')).to_contain_text('event revision 1')
   require(ps.locator('#connectedMatches .match').count()==0,
           'Synthetic staff starts with no private pending match')
   # Shared mock backend updates, independent reader/browser contexts.
   state['public']=public_event()
   state['rev']=2
   state['desk']=[desk()]
   expect(pa.locator('#events')).to_contain_text('Fictional Beta',timeout=11000)
   expect(pb.locator('#events')).to_contain_text('Fictional Beta',timeout=11000)
   expect(ps.locator('#connectedStatus')).to_contain_text('event revision 2',timeout=11000)
   require(ps.locator('#connectedMatches .match').count()==1,
           'Signed staff follow automatically picked up next approved revision')
   require(pa.locator('#events img').count()==0 and pb.locator('#events img').count()==0,
           'Public hostile-looking fictional player text never executes as HTML')
   require(not any(x[3] for x in calls if x[0].startswith('audience')),
           'Anonymous spectator contexts never transmit any bearer token')
   require(not any(x[1]=='POST' for x in calls if x[0].startswith('audience')),
           'Both public contexts make GETs only, no RPC/write/admin calls')
   # Authorized public changed outcome, visible after another signed-free read.
   state['public']=public_event('Fictional Beta')
   expect(pa.locator('#events')).to_contain_text('Winner: Fictional Beta',timeout=11000)
   expect(pb.locator('#events')).to_contain_text('Winner: Fictional Beta',timeout=11000)
   # Malformed projection containing private contact fields must clear + pause.
   state['public']=public_event('Fictional Beta',illegal=True)
   expect(pa.locator('#status')).to_contain_text('denied',timeout=11000)
   expect(pb.locator('#status')).to_contain_text('denied',timeout=11000)
   require(pa.locator('#events .event').count()==0 and
           pb.locator('#events .event').count()==0,
           'Both spectator contexts fail closed and drop old cached results')
   require('private_email' not in pa.locator('body').inner_text(),
           'Private backend fields never reach the public DOM')
   # Neither online nor visible event silently restarts a denied/paused reader.
   state['public']=public_event('Fictional Beta')
   pa.evaluate("window.dispatchEvent(new Event('online'))")
   require(pa.locator('#events .event').count()==0,
           'Offline/online event does not reenable denied public read')
   pa.locator('#start').click()
   expect(pa.locator('#status')).to_contain_text('1 approved event(s)')
   ps.evaluate("window.dispatchEvent(new Event('offline'))")
   expect(ps.locator('#connectedStatus')).to_contain_text('Connection lost')
   require(ps.locator('#connectedMatches .match').count()==0,
           'Staff disconnect clears authorized private display')
   ps.locator('#end').click()
   require(ps.locator('#connectedControls').is_hidden(),
           'Sign-out clears connected staff view')
   require(not forbidden,'No unexpected RPC or domain requests in either client')
   require(not any('submit_match_result' in x[2] for x in calls),
           'Both spectator contexts and signed staff follower make ZERO score submissions')
   require(not ea and not eb and not es,
           'No browser script exceptions across three Chromium contexts')
   print('M1 READ SYNC/SPECTATOR: two independent public contexts + signed staff follow and fail-closed privacy PASS; ZERO HOSTED REQUESTS',flush=True)
  finally:
   for c in contexts:c.close()
   browser.close()
finally:
 server.shutdown();server.server_close();worker.join(timeout=3)
