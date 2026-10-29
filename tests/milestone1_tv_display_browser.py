#!/usr/bin/env python3
"""Milestone 1 TV/projector board in real Chromium with a controlled clock.
ALL Supabase traffic is intercepted; fictional data only. Proves: no request before Start,
anonymous GET-only traffic, LIVE -> STALE -> removed freshness labelling during an outage,
automatic recovery, immediate blanking on an invalid/private-field response, and Stop.
No hosted request, login, score, publication or private data.
"""
import json
import re
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
HOST='https://copmkalfkkrkzheohwuc.supabase.co'
EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
CANARY='do-not-display@example.test'
UUID=re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',re.I)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*_):pass
def require(ok,reason):
 assert ok,reason
 print('PASS:',reason,flush=True)
def rows(leak=False):
 match={'match_id':'champ-0-0','bracket':'championship','round':0,'slot':0,
  'player_1_name':'Ada Quill','player_2_name':'Bo Marsh','winner_name':None,
  'game_scores':'','status':'pending'}
 if leak: match['private_email']=CANARY
 return [{'event_id':EVENT,'event_name':'Fictional TV Rehearsal','event_date':'2099-11-27',
  'status':'active','updated_at':'2099-11-27T10:00:00Z',
  'brackets':[{'name':'championship','matches':[match]}]}]
mode={'v':'ok'}
calls=[];unexpected=[]
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}'
CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS',
 'Access-Control-Allow-Headers':'apikey,authorization,content-type,accept'}
def intercept(route):
 r=route.request
 if r.url.startswith(BASE+'/'):
  route.continue_();return
 if not r.url.startswith(HOST+'/'):
  unexpected.append('external origin');route.abort();return
 path=r.url[len(HOST):].split('?')[0]
 if r.method=='OPTIONS':
  route.fulfill(status=204,headers=CORS);return
 calls.append((r.method,path,'authorization' in r.headers))
 if mode['v']=='down':
  route.abort('failed');return
 body=rows(leak=mode['v']=='leak') if path=='/rest/v1/fftt_public_results_v1' else []
 route.fulfill(status=200,headers={**CORS,'Content-Type':'application/json'},body=json.dumps(body))
with sync_playwright() as p:
 browser=p.chromium.launch()
 ctx=browser.new_context(viewport={'width':1280,'height':720})
 page=ctx.new_page()
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 ctx.route('**/*',intercept)
 page.clock.install(time=4102444800000) # fixed fictional time; page timers are manual
 page.goto(BASE+'/rehearsals/m1/tv-display.html')
 banner=page.locator('#banner')
 def advance(ms):
  page.clock.run_for(ms)
  page.wait_for_timeout(150)   # let intercepted fetches settle in real time
  page.clock.run_for(1000)     # one more render tick
 expect(banner).to_contain_text('NOT STARTED')
 page.wait_for_timeout(150)
 require(calls==[],'Opening the board makes no request')
 page.click('#start');page.wait_for_timeout(250);page.clock.run_for(1000)
 expect(banner).to_contain_text('LIVE')
 expect(page.locator('#events')).to_contain_text('Ada Quill vs Bo Marsh')
 require(len(calls)>=1 and all(c[0]=='GET' and c[1]=='/rest/v1/fftt_public_results_v1' and c[2] is False for c in calls),
  'Only anonymous GET reads of the public projection occur')
 mode['v']='down'
 advance(6000)
 expect(banner).to_contain_text('LIVE')
 require(True,'A single missed refresh still shows young data as LIVE')
 advance(16000)
 expect(banner).to_contain_text('STALE')
 expect(banner).not_to_contain_text('LIVE')
 expect(page.locator('#events')).to_contain_text('Ada Quill vs Bo Marsh')
 expect(page.locator('#events.stale-data')).to_have_count(1)
 require(True,'Outage: old results stay visible but are labelled STALE and dimmed')
 advance(110000)
 expect(banner).to_contain_text('NO CURRENT DATA')
 require('Ada Quill' not in page.inner_text('#events'),'After two minutes the old results are removed entirely')
 mode['v']='ok'
 advance(61000)
 expect(banner).to_contain_text('LIVE')
 expect(page.locator('#events')).to_contain_text('Ada Quill vs Bo Marsh')
 require(True,'Display recovers by itself once the feed returns')
 mode['v']='leak'
 advance(61000)
 expect(banner).to_contain_text('rejected an invalid response')
 page_text=page.inner_text('body')
 require(CANARY not in page_text and 'Ada Quill' not in page.inner_text('#events'),
  'A response carrying a private field is rejected and nothing from it is shown')
 mode['v']='ok'
 advance(61000)
 expect(banner).to_contain_text('LIVE')
 before=len(calls)
 page.click('#stop')
 expect(banner).to_contain_text('NOT STARTED')
 require(page.inner_text('#events').strip()=='','Stop clears the board')
 page.clock.run_for(120000);page.wait_for_timeout(150)
 require(len(calls)==before,'No reads continue after Stop')
 body=page.inner_text('body')
 require(UUID.search(body) is None and CANARY not in body,'No identifiers or private text ever rendered')
 require(not unexpected,'No request left the intercepted Supabase host or local server')
 require(not errors,'No page JavaScript errors: '+'; '.join(errors))
 browser.close()
print('M1 TV BOARD: no-request-before-start, LIVE/STALE/removed freshness, recovery, private-field rejection, stop PASS; ZERO HOSTED TRAFFIC')
