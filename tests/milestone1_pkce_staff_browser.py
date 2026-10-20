#!/usr/bin/env python3
"""Isolated GoTrue-shaped PKCE UI acceptance in real Chromium.
No remote Auth, email, test user creation, database, scoring or publication.
Two independent Chromium staff/outsider profiles plus invalid-CSRF callback.
"""
import base64, hashlib, json, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
HOST='https://copmkalfkkrkzheohwuc.supabase.co'
EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
P1='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
P2='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
P3='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
CODE='q'*48
JWT='header.payload.signature'
def must(ok,label):
 assert ok,label
 print('PASS:',label,flush=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*_):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
BASE=f'http://127.0.0.1:{server.server_port}'
PAGE=BASE+'/rehearsals/m1/staff-pkce.html'
calls=[];unexpected=[]
def open_context(browser,role):
 ctx=browser.new_context(viewport={'width':1000,'height':820})
 ctx.add_init_script('window.__FFTT_SYNTHETIC_PKCE_MOCK__=true;')
 session={'verifier_challenge':None,'state':None,'redirect':None,'used':False,'role':role,'revoked':False}
 def serve(route):
  request=route.request
  if request.url.startswith(BASE+'/'):
   route.continue_();return
  if not request.url.startswith(HOST+'/'):
   unexpected.append('unexpected external origin')
   route.abort();return
  url=urlparse(request.url)
  path=url.path
  calls.append((role,request.method,path))
  headers={'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'apikey,authorization,content-type,accept',
    'Access-Control-Allow-Methods':'POST,GET,OPTIONS',
    'Content-Type':'application/json','Cache-Control':'no-store'}
  if request.method=='OPTIONS':
   route.fulfill(status=200,headers=headers,body='');return
  status=200;body={}
  if path=='/auth/v1/otp' and request.method=='POST':
   data=json.loads(request.post_data)
   must(data['create_user'] is False,
        'No new user can be created by PKCE existing-user request')
   must(data['code_challenge_method']=='s256',
        'Email link request sends S256 code challenge')
   redirect=parse_qs(url.query).get('redirect_to',[None])[0]
   parsed=urlparse(redirect)
   must(parsed.scheme=='http' and parsed.hostname=='127.0.0.1' and
     parsed.path=='/rehearsals/m1/staff-pkce.html' and parsed.fragment=='',
     'Callback remains same exact trusted local app')
   state=parse_qs(parsed.query).get('state',[None])[0]
   must(isinstance(state,str) and len(state)>=32,
     'Explicit high-entropy CSRF callback state attached')
   session.update({'verifier_challenge':data['code_challenge'],
     'state':state,'redirect':redirect,'used':False})
  elif path=='/auth/v1/token' and request.method=='POST' and url.query=='grant_type=pkce':
   data=json.loads(request.post_data)
   verifier=data.get('code_verifier','')
   challenge=base64.urlsafe_b64encode(hashlib.sha256(
       verifier.encode('ascii')).digest()).decode().rstrip('=')
   must(challenge==session['verifier_challenge'] and data.get('auth_code')==CODE,
     'Exchanged one-time code proves same-browser cryptographic verifier')
   must(not session['used'],'Authorization code cannot be used twice')
   session['used']=True
   body={'access_token':JWT,'refresh_token':'DO-NOT-STORE-PRIVATE-REFRESH',
     'token_type':'bearer','expires_in':3600}
  elif path=='/auth/v1/user' and request.method=='GET':
   must(request.headers.get('authorization')=='Bearer '+JWT,
     'Signed current-user account lookup uses exact ephemeral JWT')
   body={'id':P1 if role=='staff' else P3 if role=='staffB' else P2,
         'is_anonymous':False,'email':'fictional-'+role+'@example.test'}
  elif path=='/rest/v1/rpc/fftt_staff_role_v1' and request.method=='POST':
   body='scorekeeper' if role in ('staff','staffB') and not session['revoked'] else None
   if body is None:status=403
  elif path=='/rest/v1/rpc/fftt_score_decision_snapshot_v2' and request.method=='POST':
   must(json.loads(request.post_data)==
      {'p_event_id':EVENT,'p_submission_id':None},
      'Only event-scoped no-submission V2 read requested')
   body={'event_id':EVENT,'revision':1,'generation':1,
       'lifecycle':'active','submission_id':None,'decision':None}
  elif path=='/rest/v1/rpc/fftt_matchdesk_v1' and request.method=='POST':
   body=[] # all actual previously scored fixtures are consumed
  else:
   unexpected.append(path);status=403
  route.fulfill(status=status,headers=headers,body=json.dumps(body))
 ctx.route('**/*',serve)
 page=ctx.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 return ctx,page,session,errors
def request_link(page,email):
 page.goto(PAGE)
 page.locator('#email').fill(email)
 page.locator('#requestLink').click()
 expect(page.locator('#requestStatus')).to_contain_text(
     'Existing-account mock link requested.')
def complete(page,session,state=None):
 redirect=urlparse(session['redirect'])
 qs=parse_qs(redirect.query)
 original=qs['state'][0]
 page.goto(PAGE+'?code='+CODE+'&state='+(state or original))
 must('?code=' not in page.url and 'state=' not in page.url and
      'access_token' not in page.url and '#' not in page.url,
      'Browser callback immediately erases code and state from URL')
 page.locator('#eventId').fill(EVENT)
 page.locator('#complete').click()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
  contexts=[]
  try:
   a,staff,sa,err_a=open_context(browser,'staff');contexts.append(a)
   b,outsider,sb,err_b=open_context(browser,'outsider');contexts.append(b)
   d,staffB,sd,err_d=open_context(browser,'staffB');contexts.append(d)
   request_link(staff,'fictional-staff@example.test')
   request_link(outsider,'fictional-outsider@example.test')
   request_link(staffB,'fictional-second-scorekeeper@example.test')
   must(sa['state']!=sb['state'] and sa['state']!=sd['state'] and
        sa['verifier_challenge']!=sb['verifier_challenge'] and
        sa['verifier_challenge']!=sd['verifier_challenge'],
        'Two isolated browser profiles have distinct CSRF/verifier secrets')
   complete(staff,sa)
   expect(staff.locator('#authStatus')).to_contain_text(
        'SIGNED IN · verified scorekeeper')
   staff.locator('#readDesk').click()
   expect(staff.locator('#deskStatus')).to_contain_text('event revision 1')
   must(staff.locator('#matches').inner_text().strip()=='',
        'Private matchdesk empty for completed synthetic test fixtures')
   must(sa['used'],'Staff authorization code used exactly once')
   complete(staffB,sd)
   expect(staffB.locator('#authStatus')).to_contain_text('SIGNED IN · verified scorekeeper')
   staffB.locator('#readDesk').click()
   expect(staffB.locator('#deskStatus')).to_contain_text('event revision 1')
   must(sd['used'] and not sd['revoked'],'Second independent staff browser verified safely')
   complete(outsider,sb)
   expect(outsider.locator('#authStatus')).to_contain_text('unauthorized')
   must(outsider.locator('#readDesk').is_disabled(),
        'Unapproved outsider cannot read private event')
   must(not sb['used'] is False,'Outsider never bypassed single-use exchange')
   must(staff.evaluate("!sessionStorage.getItem('fftt.m1.pkce.one-pending')"),
        'PKCE verifier is destroyed on successful callback')
   must(staff.evaluate("!JSON.stringify(sessionStorage).includes('DO-NOT-STORE')"),
        'Refresh token not persisted by client')
   must(staff.evaluate("!JSON.stringify(localStorage).includes('header.payload')"),
        'JWT not persisted to localStorage')
   sd['revoked']=True
   staffB.locator('#readDesk').click()
   expect(staffB.locator('#deskStatus')).to_contain_text('Denied, changed or expired.')
   must(staffB.locator('#readDesk').is_disabled() and
        staffB.locator('#matches').inner_text().strip()=='',
        'Real browser role revocation clears private reads and requires new sign-in')
   staff.locator('#signOut').click()
   expect(staff.locator('#authStatus')).to_contain_text('SIGNED OUT')
   must(staff.locator('#readDesk').is_disabled(),
        'Signout drops private Match Desk access immediately')
   c,bad,sc,err_c=open_context(browser,'staff');contexts.append(c)
   request_link(bad,'fictional-staff@example.test')
   complete(bad,sc,state='x'*48)
   expect(bad.locator('#authStatus')).to_contain_text('mismatched')
   must(sc['used'] is False and bad.locator('#readDesk').is_disabled(),
        'Tampered CSRF return fails BEFORE Auth code exchange')
   must(bad.evaluate("sessionStorage.length===0"),
        'Failed callback burns pending verifier/state')
   must(not unexpected,'No disallowed origin, endpoint or operation')
   must(not any('submit_match_result' in name or 'manage_staff' in name or
        'published' in name for _,_,name in calls),
        'No score, staff mutation, public publication or replay endpoint')
   must(not err_a and not err_b and not err_c and not err_d,
        'All four Chromium profiles have no script exceptions')
   print('M1 PKCE REAL CHROMIUM MOCK: two isolated staff, code exchange, revocation, outsider denial, CSRF burn, signout PASS; ZERO HOSTED REQUESTS',flush=True)
  finally:
   for c in contexts:c.close()
   browser.close()
finally:
 server.shutdown();server.server_close();worker.join(timeout=3)
