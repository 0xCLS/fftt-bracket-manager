#!/usr/bin/env python3
"""Real Chromium mock acceptance of the SAME C8 browser flow used by hosted runner.
All Supabase requests intercepted: zero live network, zero new Auth users,
zero hosted score requests. First accepted result intentionally loses its
HTTP response, then is recovered after browser reload with a signed own read.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import milestone1_hosted_browser_once as runner

EVENT="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
MATCH="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
P1="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
P2="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
AUTH_USERS={
 "SCOREKEEPER_A":{"jwt":"head.payload.tokenA","email":"fake-score-a@example.test",
                  "id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
 "SCOREKEEPER_B":{"jwt":"head.payload.tokenB","email":"fake-score-b@example.test",
                  "id":"ffffffff-ffff-4fff-8fff-ffffffffffff"},
 "OUTSIDER":{"jwt":"head.payload.tokenO","email":"fake-outsider@example.test",
            "id":"11111111-1111-4111-8111-111111111111"},
}
# Test-only injected digest function. PRODUCTION RUNNER CANNOT INSTALL THIS.
# These fabricated fixture UUIDs are not valid real hosted pins.
JS_MOCK_DIGEST="""(()=>{
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const hA='52c86dee4d72893b490ab991924335962a34fb39a26ffc11239f034390e549e7';
 const hB='37e0555d5dd57fd9c93d12e93cdff6da45d26c1d63243d12eab1c0b9efc68015';
 const orig=crypto.subtle.digest.bind(crypto.subtle);
 Object.defineProperty(crypto.subtle,'digest',{configurable:true,value:async(alg,data)=>{
   const text=new TextDecoder().decode(data);
   if(text===a||text===b){
     const hex=text===a?hA:hB;
     return Uint8Array.from(hex.match(/../g),x=>parseInt(x,16)).buffer;
   }
   return orig(alg,data);
 }});
})();"""
DESK={"event_id":EVENT,"bracket_generation":1,"match_id":MATCH,
 "match_code":"C-0-0","match_version":0,"bracket":"championship",
 "round_number":0,"slot":0,"player_1_id":P1,"player_2_id":P2,
 "player_1_name":"Synthetic Browser Alpha","player_2_name":"Synthetic Browser Beta",
 "is_championship_final":True,"table_number":None}

class FakeDev:
 def __init__(self):
  self.revision=0
  self.done=False
  self.decisions={}
  self.posts=[]
  self.other=[]
  self.events=[]
 def route_for(self,who,local_url):
  user=AUTH_USERS[who]
  def route(route):
   r=route.request
   if r.url.startswith(local_url.split('/rehearsals')[0]+'/'):
    route.continue_();return
   if not r.url.startswith(runner.PROJECT+"/"):
    self.other.append("external");route.abort();return
   path=r.url[len(runner.PROJECT):].split("?")[0]
   headers={"Access-Control-Allow-Origin":"*",
            "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
            "Access-Control-Allow-Headers":"apikey,authorization,content-type,accept",
            "Content-Type":"application/json","Cache-Control":"no-store"}
   if r.method=="OPTIONS":
    route.fulfill(status=200,body="",headers=headers);return
   if path=="/auth/v1/user":
    reply={"id":user["id"],"email":user["email"],"email_confirmed_at":"2026-10-01T12:00:00Z"}
   elif path=="/rest/v1/fftt_public_results_v1":
    reply=[]
   elif path=="/rest/v1/rpc/fftt_staff_role_v1":
    reply="scorekeeper" if who!="OUTSIDER" else None
   elif path=="/rest/v1/rpc/fftt_matchdesk_v1":
    reply=[DESK] if who!="OUTSIDER" and not self.done else []
   elif path=="/rest/v1/rpc/fftt_score_decision_snapshot_v2":
    try: payload=json.loads(r.post_data)
    except: payload={}
    sub=payload.get("p_submission_id")
    reply={"event_id":EVENT,"revision":self.revision,"generation":1,
           "lifecycle":"active","submission_id":sub,
           "decision":self.decisions.get((who,sub))}
   elif path==runner.SCORE_RPC:
    payload=json.loads(r.post_data)
    self.posts.append((who,payload))
    if who=="OUTSIDER" or len(self.posts)>2:
     self.events.append("EXCESS SCORE REQUEST")
     route.fulfill(status=403,headers=headers,body="{}");return
    accepted=not self.done and payload.get("p_expected_match_version")==0
    if accepted:
     self.done=True;self.revision=1
    data={"id":payload["p_submission_id"],"status":"accepted" if accepted else "rejected",
          "match_id":MATCH,"match_version":1,"event_revision":1,
          "generation":1,"reason":None if accepted else "stale-match-version"}
    self.decisions[(who,data["id"])]=data
    if who=="SCOREKEEPER_A":
     # Server committed result, but browser receives NO response.
     route.abort()
     return
    reply={"submission_id":data["id"],**{
           k:v for k,v in data.items() if k!="id"}}
   else:
    self.events.append("FORBIDDEN ENDPOINT")
    route.fulfill(status=403,body="{}",headers=headers);return
   route.fulfill(status=200,body=json.dumps(reply),headers=headers)
  return route

class GuardBrowser:
 def __init__(self,browser,remote,local_url):
  self.browser=browser
  self.remote=remote
  self.url=local_url
  self.nextRole=iter(("SCOREKEEPER_A","SCOREKEEPER_B","OUTSIDER"))
  self.contextByRole={}
 def new_context(self,**kwargs):
  who=next(self.nextRole)
  c=self.browser.new_context(**kwargs)
  c.add_init_script(JS_MOCK_DIGEST)
  c.route("**/*",self.remote.route_for(who,self.url))
  self.contextByRole[who]=c
  return c

def require(cond,label):
 assert cond,label
 print("PASS:",label,flush=True)

def main():
 repo=Path(__file__).resolve().parent.parent
 state=FakeDev()
 with runner.LocalSource(repo) as local_url, sync_playwright() as p:
  chromium=p.chromium.launch(headless=True,args=["--no-sandbox"])
  guard=GuardBrowser(chromium,state,local_url)
  ctx=[]
  try:
   pages={}
   for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
    pages[role]=runner.signed_browser_page(
     guard,local_url,role,AUTH_USERS[role]["jwt"],AUTH_USERS[role]["email"],ctx)
   ids={role:runner.prepare_browser(pages[role],role,EVENT,DESK)
        for role in pages}
   require(len(set(ids.values()))==2,"Two distinct browser sessions prepared one fictional match")
   require(state.posts==[],"Read/prepare UI triggered no score POST")
   for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
    pages[role].locator("#hostSend").click()
   expect(pages["SCOREKEEPER_A"].locator("#hostStatus")).to_contain_text("UNKNOWN")
   expect(pages["SCOREKEEPER_B"].locator("#hostStatus")).to_contain_text("Provisional")
   require([x[0] for x in state.posts]==["SCOREKEEPER_A","SCOREKEEPER_B"],
           "One browser score POST for each independent actor")
   require(state.decisions[("SCOREKEEPER_A",ids["SCOREKEEPER_A"])]["status"]=="accepted",
           "Lost HTTP ACK did not undo accepted committed result")
   require(state.decisions[("SCOREKEEPER_B",ids["SCOREKEEPER_B"])]["status"]=="rejected",
           "Second stale browser score was durably rejected")
   for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
    pages[role].close()
    c=guard.contextByRole[role]
    page=c.new_page()
    token=AUTH_USERS[role]["jwt"]
    page.goto(local_url+"#access_token="+token+"&token_type=bearer&expires_in=1800&type=magiclink")
    page.locator("#confirmForm").wait_for(state="visible")
    page.locator("#confirmEmail").fill(AUTH_USERS[role]["email"])
    page.locator("#confirmForm button").click()
    page.locator("#hostControls").wait_for(state="visible")
    require(page.locator("#hostSend").is_disabled(),
            role+" cannot replay after browser reload")
    page.locator("#eventId").fill(EVENT)
    page.locator("#hostRecoveryId").fill(ids[role])
    page.locator("#hostRecover").click()
    expect(page.locator("#hostStatus")).to_contain_text("SERVER CONFIRMED:")
    status=page.locator("#hostStatus").inner_text()
    require(("ACCEPTED" if role=="SCOREKEEPER_A" else "REJECTED AS STALE") in status,
            role+" independently recovered own result after tab loss")
   require(len(state.posts)==2,"Receipt lookups never create another score write")
   require(not state.other and not state.events,
           "No real external host, admin request, publication or unexpected RPC used")
   outsider=runner.signed_browser_page(
       guard,local_url,"OUTSIDER",AUTH_USERS["OUTSIDER"]["jwt"],
       AUTH_USERS["OUTSIDER"]["email"],ctx)
   outsider.locator("#eventId").fill(EVENT)
   outsider.locator("#hostRead").click()
   expect(outsider.locator("#hostStatus")).to_contain_text("NO hosted score sent")
   require(outsider.locator("#hostSend").is_disabled(),
           "Outsider never exposes a prepared hosted score")
   print("HOSTED BROWSER MOCK: two distinct real Chromium sessions, "
         "lost ACK, stale rejection, tab-loss recovery and outsider privacy PASS; ZERO HOSTED TRAFFIC")
  finally:
   for c in ctx:c.close()
   chromium.close()

if __name__=="__main__":main()
