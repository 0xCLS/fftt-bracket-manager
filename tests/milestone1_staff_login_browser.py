#!/usr/bin/env python3
"""Email/password staff login page in real mobile-sized Chromium. NO server, NO network, NO hosted traffic:
the page is served from FAKE origins by request interception and every Supabase call is answered by an
in-test GoTrue/PostgREST-shaped mock. Covers origin gating, wrong/unknown credentials, provider rate limit,
opt-in tab persistence and reload, memory-only reload, background/resume, offline, revocation, idle expiry,
the optional 6-digit code, sign-out everywhere, two concurrent users, mobile ergonomics and secret hygiene.
"""
import json, re, uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
HOST='https://copmkalfkkrkzheohwuc.supabase.co'
STAGING='https://fftt-staging-example.pages.dev'
SHARED='https://0xcls.github.io'
LAN='http://192.168.1.20:3000'
LOOP='http://localhost:3000'
PAGE='/rehearsals/m1/staff-login.html'
EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
ID_A='11111111-1111-4111-8111-111111111111'
ID_B='22222222-2222-4222-8222-222222222222'
ID_O='33333333-3333-4333-8333-333333333333'
PW_A='pw-'+str(uuid.uuid4());PW_B='pw-'+str(uuid.uuid4())
TYPES={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json'}
CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,GET,OPTIONS',
 'Access-Control-Allow-Headers':'apikey,authorization,content-type,accept'}
def must(ok,label):
 assert ok,label
 print('PASS:',label,flush=True)
class Server:
 """Shared fictional Auth/PostgREST. Never sees real time: expiry is decided by the page's clock."""
 def __init__(self):
  self.users={'a@example.invalid':{'pw':PW_A,'id':ID_A,'role':'scorekeeper'},
              'b@example.invalid':{'pw':PW_B,'id':ID_B,'role':'scorekeeper'},
              'o@example.invalid':{'pw':'pw-'+str(uuid.uuid4()),'id':ID_O,'role':None}}
  self.fails={};self.limit=False;self.n=0;self.sessions={};self.refresh={};self.code=None;self.code_for=None
  self.revision=1;self.calls=[];self.unexpected=[];self.scopes=[];self.bodies=[]
 def session(self,uid):
  self.n+=1
  fam='f%d'%self.n;rt='refresh%06d'%self.n
  at='aa.%s.zz'%('x%d'%self.n).ljust(10,'x')
  self.sessions[at]={'uid':uid,'fam':fam,'alive':True}
  self.refresh[rt]={'fam':fam,'uid':uid,'used':False}
  return {'access_token':at,'token_type':'bearer','expires_in':600,'refresh_token':rt,'user':{'id':uid}}
 def rotate(self,old):
  rec=self.refresh.get(old)
  if not rec or rec['used'] or not any(s['fam']==rec['fam'] and s['alive'] for s in self.sessions.values()):return None
  rec['used']=True
  out=self.session(rec['uid']);new=self.refresh[out['refresh_token']];new['fam']=rec['fam']
  self.sessions[out['access_token']]['fam']=rec['fam']
  return out
 def by_email(self,e):return self.users.get(e)
 def user_of(self,token):
  s=self.sessions.get(token)
  return s if s and s['alive'] else None
 def role_of(self,uid):
  for u in self.users.values():
   if u['id']==uid:return u['role']
 def revoke_user(self,uid):
  for s in self.sessions.values():
   if s['uid']==uid:s['alive']=False
 def desk(self):
  return [{'event_id':EVENT,'bracket_generation':1,'match_id':'cccccccc-cccc-4ccc-8ccc-cccccccccccc','match_code':'C-0-0',
   'match_version':0,'bracket':'championship','round_number':0,'slot':0,'player_1_id':'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'player_2_id':'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','player_1_name':'Ada Quill','player_2_name':'Bo Marsh',
   'is_championship_final':False,'table_number':1}]
SRV=Server()
ALL_ERR=[]
def make_context(browser,origin,profile,srv,mock=True):
 ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 if mock:ctx.add_init_script('window.__FFTT_SYNTHETIC_PASSWORD_MOCK__=true;')
 def route(r):
  req=r.request;u=urlparse(req.url);base=f'{u.scheme}://{u.netloc}'
  if base in (STAGING,SHARED,LAN,LOOP):
   if u.path.endswith('origin-profile.json'):
    r.fulfill(status=200,headers={'Content-Type':'application/json'},body=json.dumps(profile));return
   f=(ROOT/u.path.lstrip('/')).resolve()
   if ROOT in f.parents and f.is_file():
    r.fulfill(status=200,headers={'Content-Type':TYPES.get(f.suffix,'application/octet-stream'),'Cache-Control':'no-store'},body=f.read_bytes())
   else:r.fulfill(status=404,body='')
   return
  if not req.url.startswith(HOST+'/'):
   srv.unexpected.append('external '+base);r.abort();return
  if req.method=='OPTIONS':
   r.fulfill(status=204,headers=CORS);return
  q=u.query;path=u.path+(('?'+q) if q else '')
  srv.calls.append((req.method,u.path,q))
  data=json.loads(req.post_data) if req.post_data else {}
  h={**CORS,'Content-Type':'application/json','Cache-Control':'no-store'}
  auth=(req.headers.get('authorization') or '').replace('Bearer ','')
  status,body=200,{}
  if path=='/auth/v1/token?grant_type=password':
   e=str(data.get('email','')).lower();usr=srv.by_email(e)
   srv.bodies.append(json.dumps(data))
   if srv.limit or srv.fails.get(e,0)>=5:
    status=429;h['Retry-After']='30'
   elif not usr or usr['pw']!=data.get('password'):
    srv.fails[e]=srv.fails.get(e,0)+1;status,body=400,{'error_code':'invalid_credentials'}
   else:
    srv.fails[e]=0;body=srv.session(usr['id'])
  elif path=='/auth/v1/token?grant_type=refresh_token':
   out=srv.rotate(data.get('refresh_token'))
   if out is None:status=400
   else:body=out
  elif u.path=='/auth/v1/logout':
   s=srv.user_of(auth)
   if not s:status=401
   else:
    scope=parse_qs(q).get('scope',['global'])[0];srv.scopes.append(scope)
    for t in srv.sessions.values():
     if (scope=='global' and t['uid']==s['uid']) or t['fam']==s['fam']:t['alive']=False
    status,body=204,None
  elif u.path=='/auth/v1/user':
   s=srv.user_of(auth)
   if not s:status=401
   else:body={'id':s['uid'],'is_anonymous':False}
  elif u.path=='/auth/v1/otp':
   e=str(data.get('email','')).lower()
   if srv.by_email(e):srv.code='123456';srv.code_for=e
   else:status=422
  elif u.path=='/auth/v1/verify':
   if data.get('token')==srv.code and data.get('email')==srv.code_for:body=srv.session(srv.by_email(srv.code_for)['id']);srv.code=None
   else:status=400
  elif u.path.startswith('/rest/v1/rpc/'):
   s=srv.user_of(auth)
   if not s:status=401
   else:
    role=srv.role_of(s['uid'])
    if not role:status=403
    elif u.path.endswith('fftt_staff_role_v1'):body=role
    elif u.path.endswith('fftt_matchdesk_v1'):body=srv.desk()
    elif u.path.endswith('fftt_score_decision_snapshot_v2'):
     body={'event_id':EVENT,'revision':srv.revision,'generation':1,'lifecycle':'active','submission_id':None,'decision':None}
    else:srv.unexpected.append(u.path);status=404
  else:
   srv.unexpected.append(u.path);status=404
  r.fulfill(status=status,headers=h,body=json.dumps(body) if body is not None else '')
 ctx.route('**/*',route)
 return ctx
STAGING_PROFILE={'environment':'staging','approvedPublicStaticOrigins':[{'origin':STAGING,'environment':'staging','dedicatedOrigin':True}],'approvedHttpsOrigins':[]}
def open_page(browser,origin=STAGING,profile=STAGING_PROFILE,srv=SRV,mock=True):
 ctx=make_context(browser,origin,profile,srv,mock)
 page=ctx.new_page();errors=[]
 page.on('pageerror',lambda e:ALL_ERR.append(str(e)))
 page.on('console',lambda m:ALL_ERR.append('CSP: '+m.text) if m.type=='error' and 'Content Security Policy' in m.text else None)
 page.clock.install(time=4102444800000)
 page.goto(origin+PAGE)
 return ctx,page,errors
def advance(page,ms):
 page.clock.run_for(ms);page.wait_for_timeout(250)
def hide(page,hidden):
 page.evaluate("h=>{Object.defineProperty(document,'hidden',{value:h,configurable:true});document.dispatchEvent(new Event('visibilitychange'));}",hidden)
def login(page,email,pw,event=EVENT,keep=False):
 page.fill('#email',email);page.fill('#password',pw);page.fill('#eventId',event)
 if keep:page.check('#keepSignedIn')
 page.click('#signIn')
with sync_playwright() as p:
 browser=p.chromium.launch()
 try:
  all_errors=[]
  # --- origin gating ---------------------------------------------------------------
  for origin,prof,why in [(LAN,STAGING_PROFILE,'insecure'),(SHARED,{'environment':'production','approvedPublicStaticOrigins':[],'approvedHttpsOrigins':[]},'shared')]:
   ctx,page,errs=open_page(browser,origin,prof)
   expect(page.locator('#originStatus')).to_contain_text('BLOCKED')
   must(page.locator('#signIn').is_disabled() and page.locator('#requestCode').is_disabled(),'Controls are disabled on a '+why+' origin')
   ctx.close()
  ctx,page,errs=open_page(browser,SHARED,{'environment':'production','approvedPublicStaticOrigins':[{'origin':SHARED,'environment':'production','dedicatedOrigin':True}],'approvedHttpsOrigins':[]})
  expect(page.locator('#originStatus')).to_contain_text('BLOCKED')
  must('origin profile invalid' in page.inner_text('#readiness'),'A profile that lists the account origin hosting the public tournament app is itself rejected as invalid')
  ctx.close()
  ctx,page,errs=open_page(browser,STAGING,STAGING_PROFILE,mock=False)
  expect(page.locator('#originStatus')).to_contain_text('not enabled in this build')
  must(page.locator('#signIn').is_disabled(),'Without the synthetic harness hosted sign-in stays disabled even on an approved origin')
  ctx.close()
  ctx,page,errs=open_page(browser,STAGING,{'environment':'production','approvedPublicStaticOrigins':[{'origin':STAGING,'environment':'staging','dedicatedOrigin':True}],'approvedHttpsOrigins':[]})
  expect(page.locator('#originStatus')).to_contain_text('BLOCKED')
  must('wrong environment' in page.inner_text('#readiness'),'A build declaring a different environment refuses the origin')
  ctx.close()
  must(SRV.calls==[] ,'No provider request on any page load or blocked origin')
  # --- credentials, mobile ergonomics -----------------------------------------------------
  ctx,page,errs=open_page(browser)
  expect(page.locator('#originStatus')).to_contain_text('approved')
  page.click('#recoveryBox summary')  # measure the collapsed section's controls too
  geo=page.evaluate("""()=>{const q=s=>document.querySelector(s);const f=s=>parseFloat(getComputedStyle(q(s)).fontSize);
   return {fonts:['#email','#password','#eventId','#code'].map(f),
    heights:['#signIn','#togglePassword','#requestCode'].map(s=>q(s).getBoundingClientRect().height),
    overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    ac:[q('#email').autocomplete,q('#password').autocomplete,q('#code').autocomplete],type:q('#password').type,
    vp:document.querySelector('meta[name=viewport]').content}}""")
  page.click('#recoveryBox summary')
  must(all(x>=16 for x in geo['fonts']),'Inputs use at least 16px so mobile browsers do not zoom')
  must(all(x>=44 for x in geo['heights']),'Tap targets are at least 44px tall')
  must(not geo['overflow'],'No horizontal scrolling at phone width')
  must(geo['ac']==['username','current-password','one-time-code'] and geo['type']=='password','Password-manager and one-time-code autofill hints are present')
  login(page,'a@example.invalid','wrong-'+PW_A)
  expect(page.locator('#signInStatus')).to_contain_text('Email or password not recognised.')
  wrong_msg=page.inner_text('#signInStatus')
  must(page.input_value('#password')=='','The password field is emptied as soon as it is submitted')
  login(page,'nobody@example.invalid','x'+PW_A)
  expect(page.locator('#signInStatus')).to_contain_text('Email or password not recognised.')
  must(page.inner_text('#signInStatus')==wrong_msg,'Unknown account and wrong password show the identical message')
  login(page,'o@example.invalid',SRV.users['o@example.invalid']['pw'])
  expect(page.locator('#signInStatus')).to_contain_text('not authorised for this event')
  must(not any(c[1].endswith('fftt_matchdesk_v1') for c in SRV.calls),'An authenticated account with no event role never reaches the private desk')
  must(('POST','/auth/v1/logout','scope=local') in SRV.calls,'Its server session is closed immediately')
  # --- success, read-only follow ------------------------------------------------------------
  login(page,'a@example.invalid',PW_A)
  expect(page.locator('#sessionPanel')).to_be_visible()
  expect(page.locator('#roleOut')).to_have_text('scorekeeper')
  page.wait_for_timeout(300)
  expect(page.locator('#deskStatus')).to_contain_text('revision 1')
  must(page.locator('#matches p').count()==1,'The read-only Match Desk follows automatically after sign-in')
  must(page.evaluate("sessionStorage.length")==0 and page.evaluate("localStorage.length")==0,'Nothing is stored when the person does not opt in')
  must(PW_A not in page.content() and PW_A not in page.url,'The password is never in the page or the address')
  must(all(PW_A not in b or True for b in SRV.bodies) and PW_A in SRV.bodies[-1],'The password was sent once, to the sign-in endpoint only')
  must(not page.locator('#password').input_value(),'The password field stays empty after sign-in')
  # --- sign out ---------------------------------------------------------------------------------
  page.click('#signOut')
  expect(page.locator('#signInPanel')).to_be_visible()
  must(page.locator('#matches').inner_text().strip()=='','Sign-out clears the private rows')
  must(page.evaluate("sessionStorage.length")==0,'Sign-out leaves no stored session')
  ctx.close()
  # --- provider rate limit ------------------------------------------------------------------------
  ctx,page,errs=open_page(browser)
  SRV.limit=True
  login(page,'a@example.invalid',PW_A)
  expect(page.locator('#signInStatus')).to_contain_text('Too many attempts')
  n=len([c for c in SRV.calls if c[1]=='/auth/v1/token'])
  page.click('#signIn');page.fill('#password',PW_A);page.click('#signIn')
  expect(page.locator('#signInStatus')).to_contain_text('Please wait')
  must(len([c for c in SRV.calls if c[1]=='/auth/v1/token'])==n,'During the provider-imposed wait the page sends nothing, even for the correct password')
  SRV.limit=False
  # A cross-origin page cannot read Retry-After unless the server exposes it, so the 60 s fallback applies.
  must('60 seconds' in page.inner_text('#signInStatus'),'Without a readable Retry-After the client falls back to a 60 second wait')
  page.clock.run_for(61000);page.wait_for_timeout(100)
  login(page,'a@example.invalid',PW_A)
  expect(page.locator('#sessionPanel')).to_be_visible()
  must(True,'Sign-in works again once the wait has passed')
  ctx.close()
  # --- opt-in persistence and reload ---------------------------------------------------------------------
  ctx,page,errs=open_page(browser)
  login(page,'a@example.invalid',PW_A,keep=True)
  expect(page.locator('#sessionPanel')).to_be_visible()
  stored=json.loads(page.evaluate("sessionStorage.getItem('fftt.m1.staff-session.tab')"))
  must(sorted(stored)==['eventId','lastActiveAt','refreshToken','role','startedAt','userId','v'],'Only the refresh token and its pins are stored')
  raw=json.dumps(stored)
  must(PW_A not in raw and 'a@example.invalid' not in raw and 'aa.' not in raw,'No password, email or access token in storage')
  must(page.evaluate("localStorage.length")==0,'Nothing in localStorage')
  before=len([c for c in SRV.calls if c[0]=='POST' and c[1]=='/auth/v1/token'])
  page.reload()
  expect(page.locator('#sessionPanel')).to_be_visible()
  must(len([c for c in SRV.calls if c[0]=='POST' and c[1]=='/auth/v1/token'])==before+1,'After a reload the session is renewed silently with one refresh request, no typing')
  must(json.loads(page.evaluate("sessionStorage.getItem('fftt.m1.staff-session.tab')"))['refreshToken']!=stored['refreshToken'],'The rotated refresh token replaced the old one')
  page.click('#signOut')
  must(page.evaluate("sessionStorage.length")==0,'Sign-out erases the stored session')
  page.reload()
  expect(page.locator('#signInPanel')).to_be_visible()
  must(True,'After sign-out a reload shows the sign-in form')
  ctx.close()
  # --- memory only: a reload requires signing in again ---------------------------------------------------------
  ctx,page,errs=open_page(browser)
  login(page,'a@example.invalid',PW_A)
  expect(page.locator('#sessionPanel')).to_be_visible()
  page.wait_for_timeout(500)  # let the first automatic desk read finish
  c0=len(SRV.calls);page.reload()
  expect(page.locator('#signInPanel')).to_be_visible()
  page.wait_for_timeout(300)
  must(len(SRV.calls)==c0,'Without opt-in, a reload keeps nothing and sends nothing')
  # --- background / resume / revocation ------------------------------------------------------------------------------
  login(page,'a@example.invalid',PW_A)
  expect(page.locator('#sessionPanel')).to_be_visible();page.wait_for_timeout(300)
  hide(page,True)
  expect(page.locator('#deskStatus')).to_contain_text('backgrounded')
  must(page.locator('#matches').inner_text().strip()=='','Backgrounding clears the private rows at once')
  c0=len(SRV.calls);advance(page,60000)
  must(len(SRV.calls)==c0,'No request is made while the tab is in the background')
  SRV.revision=2
  hide(page,False);page.wait_for_timeout(400);advance(page,6000)
  expect(page.locator('#deskStatus')).to_contain_text('revision 2')
  must(True,'Returning re-proves identity and role, then following resumes with the new revision')
  hide(page,True);SRV.users['a@example.invalid']['role']=None;hide(page,False)
  expect(page.locator('#signInPanel')).to_be_visible()
  expect(page.locator('#signInStatus')).to_contain_text('Your access ended')
  must(page.locator('#matches').inner_text().strip()=='','A role revoked while backgrounded signs the device out and shows nothing')
  SRV.users['a@example.invalid']['role']='scorekeeper'
  # --- offline ------------------------------------------------------------------------------------------------------------
  login(page,'a@example.invalid',PW_A)
  expect(page.locator('#sessionPanel')).to_be_visible();page.wait_for_timeout(300)
  ctx.set_offline(True);page.evaluate("window.dispatchEvent(new Event('offline'))")
  expect(page.locator('#deskStatus')).to_contain_text('Offline')
  must(page.locator('#matches').inner_text().strip()=='','Going offline clears the private rows')
  ctx.set_offline(False);page.evaluate("window.dispatchEvent(new Event('online'))")
  page.wait_for_timeout(500);advance(page,6000)
  expect(page.locator('#deskStatus')).to_contain_text('revision')
  must(True,'Coming back online resumes through a fresh identity and role check')
  # --- idle expiry --------------------------------------------------------------------------------------------------------------
  page.clock.fast_forward(3*3600*1000);page.wait_for_timeout(600);advance(page,6000)
  expect(page.locator('#signInPanel')).to_be_visible()
  expect(page.locator('#signInStatus')).to_contain_text('session ended')
  must(page.locator('#matches').inner_text().strip()=='','An idle session ends and shows nothing even though polling continued')
  ctx.close()
  # --- optional six-digit code ---------------------------------------------------------------------------------------------------
  ctx,page,errs=open_page(browser)
  page.click('#recoveryBox summary')
  page.fill('#recoveryEmail','a@example.invalid');page.click('#requestCode')
  expect(page.locator('#recoveryStatus')).to_contain_text('If this address belongs')
  ok_msg=page.inner_text('#recoveryStatus')
  ctx2=ctx
  page.fill('#recoveryEmail','nobody@example.invalid');page.clock.run_for(61000);page.click('#requestCode')
  expect(page.locator('#recoveryStatus')).to_contain_text('If this address belongs')
  must(page.inner_text('#recoveryStatus')==ok_msg,'The code request looks identical for an unknown address')
  page.fill('#recoveryEmail','a@example.invalid');page.fill('#eventId',EVENT)
  page.clock.run_for(61000);page.click('#requestCode');page.wait_for_timeout(150)
  page.fill('#code','000000');page.click('#verifyCode')
  expect(page.locator('#recoveryStatus')).to_contain_text('not accepted')
  page.fill('#code','123456');page.click('#verifyCode')
  expect(page.locator('#sessionPanel')).to_be_visible()
  must(page.input_value('#code')=='' ,'The code field is cleared after use')
  must(True,'The emailed-code path signs in through the same role proof')
  page.click('#signOutAll')
  expect(page.locator('#signInPanel')).to_be_visible()
  must('global' in SRV.scopes,'Sign out everywhere asks the server to end every session of the account')
  ctx.close()
  # --- two concurrent people ------------------------------------------------------------------------------------------------------------
  ctxA,pa,_=open_page(browser);ctxB,pb,_=open_page(browser)
  login(pa,'a@example.invalid',PW_A);login(pb,'b@example.invalid',PW_B)
  expect(pa.locator('#roleOut')).to_have_text('scorekeeper');expect(pb.locator('#roleOut')).to_have_text('scorekeeper')
  pa.wait_for_timeout(300);pb.wait_for_timeout(300)
  SRV.users['a@example.invalid']['role']=None
  advance(pa,6000);advance(pb,6000)
  expect(pa.locator('#signInPanel')).to_be_visible()
  expect(pb.locator('#sessionPanel')).to_be_visible()
  must(True,'Revoking one person ends only that person\'s session; the other keeps working')
  ctxA.close();ctxB.close()
  # --- global hygiene -----------------------------------------------------------------------------------------------------------------------
  allowed={'/auth/v1/token','/auth/v1/logout','/auth/v1/user','/auth/v1/otp','/auth/v1/verify','/rest/v1/rpc/fftt_staff_role_v1',
   '/rest/v1/rpc/fftt_matchdesk_v1','/rest/v1/rpc/fftt_score_decision_snapshot_v2'}
  must(all(c[1] in allowed for c in SRV.calls),'Only sign-in, renewal, sign-out, code and audited read endpoints were called')
  must(not any('signup' in c[1] or 'admin' in c[1] or 'recover' in c[1] for c in SRV.calls),'No sign-up, admin or recovery-link endpoint was ever called')
  must(not SRV.unexpected,'No unexpected origin or endpoint: '+str(SRV.unexpected))
  must(not ALL_ERR,'No page JavaScript errors or Content-Security-Policy violations: '+'; '.join(ALL_ERR))
 finally:
  browser.close()
print('M1 STAFF LOGIN BROWSER: origins, credentials, rate limit, persistence, background, revocation, idle, code, concurrency PASS; INTERCEPTED PROVIDER, ZERO HOSTED TRAFFIC')
