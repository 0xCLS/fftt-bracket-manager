#!/usr/bin/env python3
"""Physical-device staff page in real mobile-sized Chromium. NO server, NO network, NO hosted traffic:
the page is served from FAKE origins by request interception and every Supabase call is answered by an
in-test GoTrue/PostgREST-shaped mock. Proves origin gating, the same-tab email-link flow, read-only
following, background suspend/resume with fresh identity+role proof, revocation while backgrounded,
grace overrun, offline sign-out, outsider denial and callback tampering. Not physical-device acceptance.
"""
import base64, hashlib, json
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
HOST='https://copmkalfkkrkzheohwuc.supabase.co'
HTTPS_DEVICE='https://fftt-desk.example.invalid'
LAN_HTTP='http://192.168.1.20:3000'
LOOPBACK='http://localhost:3000'
PAGE='/rehearsals/m1/device-staff.html'
EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
P1='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
M1='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
M2='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
PA='11111111-1111-4111-8111-111111111111'
PB='22222222-2222-4222-8222-222222222222'
PC='33333333-3333-4333-8333-333333333333'
PD='44444444-4444-4444-8444-444444444444'
CODE='q'*48
JWT='header.payload.signature'
TYPES={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'}
CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,GET,OPTIONS',
 'Access-Control-Allow-Headers':'apikey,authorization,content-type,accept'}
def must(ok,label):
 assert ok,label
 print('PASS:',label,flush=True)
calls=[];unexpected=[]
def row(mid,code,a,b,pa,pb):
 return {'event_id':EVENT,'bracket_generation':1,'match_id':mid,'match_code':code,'match_version':0,
  'bracket':'championship','round_number':0,'slot':0,'player_1_id':pa,'player_2_id':pb,
  'player_1_name':a,'player_2_name':b,'is_championship_final':False,'table_number':1}
def fresh_server():
 return {'challenge':None,'redirect':None,'used':False,'revoked':False,'role':'scorekeeper',
  'revision':1,'matches':[row(M1,'C-0-0','Ada Quill','Bo Marsh',PA,PB),row(M2,'C-0-1','Cy Dunn','Dee Reeve',PC,PD)]}
def make_context(browser,origin,approved,S):
 ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 def route(r):
  req=r.request;u=urlparse(req.url)
  base=f'{u.scheme}://{u.netloc}'
  if base in (HTTPS_DEVICE,LAN_HTTP,LOOPBACK):
   if u.path.endswith('device-origins.local.json'):
    if approved and base==origin:
     r.fulfill(status=200,headers={'Content-Type':'application/json'},body=json.dumps({'approvedHttpsOrigins':approved}))
    else:r.fulfill(status=404,body='')
    return
   f=(ROOT/u.path.lstrip('/')).resolve()
   if ROOT in f.parents and f.is_file():
    r.fulfill(status=200,headers={'Content-Type':TYPES.get(f.suffix,'application/octet-stream'),'Cache-Control':'no-store'},body=f.read_bytes())
   else:r.fulfill(status=404,body='')
   return
  if not req.url.startswith(HOST+'/'):
   unexpected.append('external origin '+base);r.abort();return
  if req.method=='OPTIONS':
   r.fulfill(status=204,headers=CORS);return
  calls.append((req.method,u.path))
  h={**CORS,'Content-Type':'application/json','Cache-Control':'no-store'}
  status=200;body={}
  if u.path=='/auth/v1/otp' and req.method=='POST':
   d=json.loads(req.post_data)
   must(d['create_user'] is False and d['code_challenge_method']=='s256','Link request is existing-user-only with an S256 challenge')
   S['challenge']=d['code_challenge'];S['redirect']=parse_qs(u.query)['redirect_to'][0]
  elif u.path=='/auth/v1/token' and u.query=='grant_type=pkce':
   d=json.loads(req.post_data)
   c=base64.urlsafe_b64encode(hashlib.sha256(d['code_verifier'].encode()).digest()).decode().rstrip('=')
   if c!=S['challenge'] or d['auth_code']!=CODE or S['used']:status=400
   else:
    S['used']=True
    body={'access_token':JWT,'refresh_token':'DO-NOT-STORE','token_type':'bearer','expires_in':3600}
  elif u.path=='/auth/v1/user':
   body={'id':P1,'is_anonymous':False}
  elif u.path=='/rest/v1/rpc/fftt_staff_role_v1':
   if S['role'] and not S['revoked']:body=S['role']
   else:status=403
  elif u.path=='/rest/v1/rpc/fftt_score_decision_snapshot_v2':
   body={'event_id':EVENT,'revision':S['revision'],'generation':1,'lifecycle':'active','submission_id':None,'decision':None}
  elif u.path=='/rest/v1/rpc/fftt_matchdesk_v1':
   if S['role'] and not S['revoked']:body=S['matches']
   else:status=403
  else:
   unexpected.append(u.path);status=404
  r.fulfill(status=status,headers=h,body=json.dumps(body))
 ctx.route('**/*',route)
 return ctx
def open_page(browser,origin,approved=None,S=None):
 S=S or fresh_server()
 ctx=make_context(browser,origin,approved,S)
 page=ctx.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.clock.install(time=4102444800000)
 page.goto(origin+PAGE)
 return ctx,page,S,errors
def advance(page,ms):
 page.clock.run_for(ms);page.wait_for_timeout(200)
def set_hidden(page,hidden):
 page.evaluate("h=>{Object.defineProperty(document,'hidden',{value:h,configurable:true});document.dispatchEvent(new Event('visibilitychange'));}",hidden)
def login(browser,S=None):
 ctx,page,S,errors=open_page(browser,HTTPS_DEVICE,[HTTPS_DEVICE],S)
 expect(page.locator('#originStatus')).to_contain_text('READY')
 page.fill('#email','fictional-scorekeeper@example.test');page.check('#consent');page.click('#requestLink')
 expect(page.locator('#requestStatus')).to_contain_text('One link requested')
 target=urlparse(S['redirect']);q=parse_qs(target.query)
 page.goto(f'{HTTPS_DEVICE}{PAGE}?'+urlencode({'code':CODE,'state':q['state'][0]}))
 return ctx,page,S,errors
with sync_playwright() as p:
 browser=p.chromium.launch()
 try:
  # --- origin gating -------------------------------------------------------
  ctx,page,S,errors=open_page(browser,LAN_HTTP)
  expect(page.locator('#originStatus')).to_contain_text('BLOCKED')
  text=page.inner_text('#readiness')
  must('✘ secure context' in text and 'insecure non loopback origin' in text,'A plain-http LAN address is not a secure context and is refused')
  must(page.locator('#requestLink').is_disabled() and page.locator('#complete').is_disabled(),'Every sign-in control is disabled on an unapproved origin')
  ctx.close()
  ctx,page,S,errors=open_page(browser,HTTPS_DEVICE,None)
  expect(page.locator('#originStatus')).to_contain_text('BLOCKED')
  must('https origin not approved' in page.inner_text('#readiness'),'An HTTPS origin the organizer has not approved is refused')
  ctx.close()
  ctx,page,S,errors=open_page(browser,HTTPS_DEVICE,['https://other.example.invalid'])
  expect(page.locator('#originStatus')).to_contain_text('BLOCKED')
  ctx.close()
  ctx,page,S,errors=open_page(browser,LOOPBACK)
  expect(page.locator('#originStatus')).to_contain_text('READY')
  must(True,'Exactly http://localhost:3000 is accepted as the loopback profile')
  ctx.close()
  must(calls==[],'No provider request on any page load or blocked origin')
  # --- full same-tab flow, suspend/resume, revocation while backgrounded ----------
  ctx,page,S,errors=open_page(browser,HTTPS_DEVICE,[HTTPS_DEVICE])
  expect(page.locator('#originStatus')).to_contain_text('READY')
  page.fill('#email','fictional-scorekeeper@example.test');page.click('#requestLink')
  must(calls==[],'Request without the consent box sends nothing')
  page.check('#consent');page.click('#requestLink')
  expect(page.locator('#requestStatus')).to_contain_text('One link requested')
  must(page.locator('#requestLink').is_disabled(),'The request button disables itself after the single click')
  page.evaluate("document.getElementById('requestLink').click()")  # a double-tap on a disabled control
  page.wait_for_timeout(150)
  must(sum(1 for c in calls if c[1]=='/auth/v1/otp')==1,'Exactly one link request, a second click is refused')
  must(S['redirect'].startswith(HTTPS_DEVICE+PAGE+'?state='),'Callback returns to this exact device origin and page with an unguessable state')
  must(page.evaluate("sessionStorage.length")==1,'Only the single pending verifier is held while waiting for the email')
  q=parse_qs(urlparse(S['redirect']).query)
  page.goto(f'{HTTPS_DEVICE}{PAGE}?'+urlencode({'code':CODE,'state':q['state'][0]}))  # same tab
  expect(page.locator('#authStatus')).to_contain_text('Return received')
  must('code=' not in page.url and 'state=' not in page.url,'One-time code and state are removed from the address bar')
  page.fill('#eventId',EVENT);page.click('#complete')
  expect(page.locator('#authStatus')).to_contain_text('SIGNED IN · verified scorekeeper')
  must(page.evaluate("sessionStorage.length")==0 and page.evaluate("localStorage.length")==0,'No verifier, token or refresh token is stored after sign-in')
  page.click('#follow');page.wait_for_timeout(250)
  expect(page.locator('#deskStatus')).to_contain_text('revision 1')
  must(page.locator('#matches p').count()==2,'Read-only Match Desk shows the two pending fictional matches')
  S['revision']=2;S['matches']=[S['matches'][0]]
  advance(page,6000)
  expect(page.locator('#deskStatus')).to_contain_text('revision 2')
  must(page.locator('#matches p').count()==1,'Following picks up the new authoritative revision')
  set_hidden(page,True)
  expect(page.locator('#authStatus')).to_contain_text('SUSPENDED')
  must(page.locator('#matches').inner_text().strip()=='','Backgrounding clears the private rows at once')
  before=len(calls);advance(page,30000)
  must(len(calls)==before,'No network request is made while the tab is in the background')
  set_hidden(page,False)
  expect(page.locator('#authStatus')).to_contain_text('re-verified scorekeeper')
  advance(page,6000)
  expect(page.locator('#deskStatus')).to_contain_text('revision 2')
  must(True,'Returning re-proves identity and role, then following resumes by itself (reads only)')
  set_hidden(page,True);S['revoked']=True;set_hidden(page,False)
  expect(page.locator('#authStatus')).to_contain_text('SIGNED OUT')
  must(page.locator('#matches').inner_text().strip()=='' and page.locator('#follow').is_disabled(),
   'A grant revoked while backgrounded signs the device out and shows nothing')
  advance(page,12000)
  must(page.locator('#matches').inner_text().strip()=='','Nothing reappears afterwards')
  ctx.close()
  # --- grace overrun ---------------------------------------------------------
  ctx,page,S,errors=login(browser)
  page.fill('#eventId',EVENT);page.click('#complete')
  expect(page.locator('#authStatus')).to_contain_text('SIGNED IN')
  set_hidden(page,True);page.clock.run_for(121000);set_hidden(page,False)
  expect(page.locator('#authStatus')).to_contain_text('SIGNED OUT')
  must(True,'Staying in the background longer than two minutes ends the session')
  ctx.close()
  # --- offline ------------------------------------------------------------------
  ctx,page,S,errors=login(browser)
  page.fill('#eventId',EVENT);page.click('#complete');page.click('#follow')
  expect(page.locator('#authStatus')).to_contain_text('SIGNED IN')
  page.evaluate("window.dispatchEvent(new Event('offline'))")
  expect(page.locator('#authStatus')).to_contain_text('connection lost')
  set_hidden(page,True);set_hidden(page,False)
  must(page.locator('#follow').is_disabled() and page.locator('#matches').inner_text().strip()=='','Going offline signs out and coming back does not resume')
  ctx.close()
  # --- outsider (authenticated but no event role) --------------------------------
  S=fresh_server();S['role']=None
  ctx,page,S,errors=login(browser,S)
  desks=sum(1 for c in calls if c[1].endswith('fftt_matchdesk_v1'))
  page.fill('#eventId',EVENT);page.click('#complete')
  expect(page.locator('#authStatus')).to_contain_text('Sign-in failed')
  must(page.locator('#follow').is_disabled() and sum(1 for c in calls if c[1].endswith('fftt_matchdesk_v1'))==desks,
   'An outsider never reaches the private Match Desk')
  ctx.close()
  # --- callback tampering -------------------------------------------------------------
  S=fresh_server()
  ctx,page,S,errors=open_page(browser,HTTPS_DEVICE,[HTTPS_DEVICE],S)
  page.fill('#email','fictional-scorekeeper@example.test');page.check('#consent');page.click('#requestLink')
  expect(page.locator('#requestStatus')).to_contain_text('One link requested')
  tokens=sum(1 for c in calls if c[1]=='/auth/v1/token')
  page.goto(f'{HTTPS_DEVICE}{PAGE}?'+urlencode({'code':CODE,'state':'Z'*43}))
  page.fill('#eventId',EVENT);page.click('#complete')
  expect(page.locator('#authStatus')).to_contain_text('Sign-in failed')
  must(sum(1 for c in calls if c[1]=='/auth/v1/token')==tokens and page.evaluate("sessionStorage.length")==0,
   'A tampered state fails before any code exchange and burns the verifier')
  ctx.close()
  allowed={'/auth/v1/otp','/auth/v1/token','/auth/v1/user','/rest/v1/rpc/fftt_staff_role_v1',
   '/rest/v1/rpc/fftt_score_decision_snapshot_v2','/rest/v1/rpc/fftt_matchdesk_v1'}
  must(all(c[1] in allowed for c in calls),'Only sign-in and authorized read endpoints were ever called')
  must(not unexpected,'No unexpected origin or endpoint: '+str(unexpected))
  must(not errors,'No page JavaScript errors: '+'; '.join(errors))
 finally:
  browser.close()
print('M1 DEVICE STAFF BROWSER: origin gating, same-tab PKCE, read-only follow, suspend/resume, revocation, offline, tamper PASS; INTERCEPTED PROVIDER, ZERO HOSTED TRAFFIC')
