#!/usr/bin/env python3
"""FFTT M1: one-time real Chromium/browser acceptance, fictional hosted fixture #3.

Default is DRY RUN: zero Auth or scoring requests. On a trusted operator Mac:
--execute-approved-browser-fixture, preflight four existing synthetic users,
admin-issue and redeem actual user JWTs in process memory, launch TWO
Playwright Chromium contexts, verify the actual C8 UI and its pinned
scorekeeper-only workflow, stage both conflicting fictional scores, persist
private recovery submission IDs in a 0600 one-time local incident marker,
send exactly TWO browser-origin score requests (one per independently signed
account), then read each own committed decision through the actual browser
UI, including a reload/relogin recovery. No retries even on network error.

Never deploy. No real FFTT3 data, new users, role changes, migrations,
publishing, old consumed fixtures, browser persistent profiles or admin JWT
in page. Admin key, user JWTs, and private event/match IDs are never printed
or included in saved incident file. Only submission IDs (needed for manual
crash recovery) are saved locally under the user's home directory, mode 0600.
Admin-generated sessions prove authenticated test accounts, NOT inbox login UX.
"""
from __future__ import annotations
import getpass
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import sys
import threading
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import b2h_admin_magiclink_signed_auth as auth

EVENT_DIGEST="52c86dee4d72893b490ab991924335962a34fb39a26ffc11239f034390e549e7"
MATCH_DIGEST="37e0555d5dd57fd9c93d12e93cdff6da45d26c1d63243d12eab1c0b9efc68015"
PROJECT="https://copmkalfkkrkzheohwuc.supabase.co"
APP_RELATIVE="/rehearsals/c8/index.html"
EXECUTE="--execute-approved-browser-fixture"
PHRASE="RUN ONE APPROVED FFTT HOSTED BROWSER RACE"
MARKER_NAME=".fftt_m1_hosted_browser_once_"+EVENT_DIGEST[:18]+".json"
ALLOWED_SCORES={"SCOREKEEPER_A":("Synthetic Browser Alpha","11-7, 11-8, 11-9"),
                "SCOREKEEPER_B":("Synthetic Browser Beta","7-11, 8-11, 9-11")}
SCORE_RPC="/rest/v1/rpc/fftt_submit_match_result_v2"
SNAP_RPC="/rest/v1/rpc/fftt_score_decision_snapshot_v2"
ALLOWED_ROLES={"ORGANIZER":"organizer",
               "SCOREKEEPER_A":"scorekeeper","SCOREKEEPER_B":"scorekeeper"}
EXPECTED_FIELDS={"event_id","bracket_generation","match_id","match_code","match_version",
                 "bracket","round_number","slot","player_1_id","player_2_id",
                 "player_1_name","player_2_name","is_championship_final","table_number"}

class Stop(RuntimeError): pass
def require(yes,label):
    if not yes: raise Stop(label)
    print("PASS: "+label,flush=True)

def pin(value,digest):
    try:
        u=str(uuid.UUID(value))
        if uuid.UUID(u).int==0: raise ValueError()
    except (ValueError,AttributeError,TypeError):
        raise Stop("Private fixture UUID invalid; no Auth or scores requested") from None
    if not hmac.compare_digest(hashlib.sha256(u.encode("ascii")).hexdigest(),digest):
        raise Stop("Private fixture is NOT the approved new 2099 browser match") from None
    return u

def saved_marker():
    return Path.home()/MARKER_NAME

def guarded_incident_marker(ids):
    """Atomic exclusive safety gate, immediately BEFORE any hosted score POST."""
    marker=saved_marker()
    if marker.exists(): raise Stop("One-time local attempt marker already exists. Never replay or reset.")
    if set(ids)!={"SCOREKEEPER_A","SCOREKEEPER_B"}:
        raise Stop("Two independent test submission IDs required")
    if len(set(ids.values()))!=2:
        raise Stop("Submission IDs must differ")
    for v in ids.values():
        try:
            if str(uuid.UUID(v))!=v: raise ValueError()
        except (TypeError,ValueError,AttributeError):
            raise Stop("Invalid private recovery ID; no score sent") from None
    doc={"fixture_digest":EVENT_DIGEST,"state":"attempt_started__never_replay",
         "private_submissions":ids,
         "instruction":"If an error occurs, do not rerun. Investigate own server receipts."}
    try:
        fd=os.open(str(marker),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except (FileExistsError,OSError):
        raise Stop("Cannot create durable one-time incident marker; no scores sent") from None
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as fh:
            json.dump(doc,fh,sort_keys=True)
            fh.write("\n");fh.flush();os.fsync(fh.fileno())
    except OSError:
        raise Stop("Incident marker write uncertain. STOP; do not rerun") from None
    require(marker.stat().st_mode&0o077==0,
            "Private 0600 recovery IDs recorded before any score request")
    return marker

def verify_preflight(tokens,event,match):
    require(auth.HOST==PROJECT and auth.PUBLISHABLE_KEY.startswith("sb_publishable_"),
            "Pinned synthetic development host and public browser key")
    desks=[]
    for role,expected in ALLOWED_ROLES.items():
        r=auth.http("POST","/rest/v1/rpc/fftt_staff_role_v1",
                    auth.PUBLISHABLE_KEY,token=tokens[role],
                    body={"p_event_id":event})
        require(r.code==200 and r.body==expected,
                role+" signed role is exactly approved")
    outsider=auth.http("POST","/rest/v1/rpc/fftt_staff_role_v1",
                       auth.PUBLISHABLE_KEY,token=tokens["OUTSIDER"],
                       body={"p_event_id":event})
    require(outsider.code in (400,401,403,404),"Outsider denied staff role")
    for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
        r=auth.http("POST","/rest/v1/rpc/fftt_matchdesk_v1",
                    auth.PUBLISHABLE_KEY,token=tokens[role],
                    body={"p_event_id":event})
        require(r.code==200 and isinstance(r.body,list) and len(r.body)==1
                and isinstance(r.body[0],dict),role+" sees exactly one pending match")
        row=r.body[0]
        require(set(row).issubset(EXPECTED_FIELDS)
                and row.get("event_id")==event and row.get("match_id")==match
                and row.get("match_code")=="C-0-0"
                and row.get("bracket_generation")==1 and row.get("match_version")==0
                and row.get("player_1_name")=="Synthetic Browser Alpha"
                and row.get("player_2_name")=="Synthetic Browser Beta"
                and row.get("player_1_id")!=row.get("player_2_id"),
                role+" reads exact pending new fictional 2099 match")
        desks.append(row)
    require(desks[0]==desks[1],"Independent signed desks match exactly")
    for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
        r=post_snapshot(tokens[role],event,None)
        require(r.code==200 and isinstance(r.body,dict)
                and r.body.get("event_id")==event
                and r.body.get("revision")==0
                and r.body.get("generation")==1
                and r.body.get("lifecycle")=="active"
                and r.body.get("decision") is None,
                role+" preflight revision zero, no committed result")
    denied=post_snapshot(tokens["OUTSIDER"],event,None)
    require(denied.code in (400,401,403,404),"Outsider denied decision snapshot")
    published=auth.http("GET","/rest/v1/fftt_public_results_v1",auth.PUBLISHABLE_KEY)
    require(published.code==200 and published.body==[],"No published synthetic results")
    return desks[0]

def post_snapshot(token,event,submission):
    """Allowlisted read-only RPC with actual user JWT (never privileged)."""
    from urllib import request,error
    body=json.dumps({"p_event_id":event,"p_submission_id":submission}).encode()
    headers={"apikey":auth.PUBLISHABLE_KEY,"Authorization":"Bearer "+token,
             "Accept":"application/json","Content-Type":"application/json"}
    req=request.Request(PROJECT+SNAP_RPC,body,headers,method="POST")
    try:
        with request.build_opener(auth.NoRedirect()).open(req,timeout=18) as res:
            code,raw=res.status,res.read(16384)
    except error.HTTPError as exc:
        code,raw=exc.code,exc.read(16384)
    except (OSError,error.URLError):
        raise Stop("Signed read unavailable; no scores sent") from None
    try: data=json.loads(raw) if raw else None
    except (ValueError,UnicodeError):
        raise Stop("Signed snapshot not JSON; no scores sent") from None
    return auth.Response(code,data)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass  # Never print tokens in fragment/requests.

class LocalSource:
    def __init__(self,root):
        self.server=ThreadingHTTPServer(("127.0.0.1",0),
            partial(Quiet,directory=str(root)))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.url=f"http://127.0.0.1:{self.server.server_port}"+APP_RELATIVE
    def __enter__(self):
        self.thread.start()
        return self.url
    def __exit__(self,*_):
        self.server.shutdown();self.server.server_close()
        self.thread.join(timeout=3)

def signed_browser_page(browser,local_url,role,token,email,contexts):
    """Distinct nonpersistent browser profiles, actual signed C8 callback validation."""
    ctx=browser.new_context(viewport={"width":1120,"height":840},accept_downloads=False)
    contexts.append(ctx)
    page=ctx.new_page()
    # Browser fragments are scrubbed synchronously by C8 on initial navigation.
    fragment="#access_token="+token+"&token_type=bearer&expires_in=1800&type=magiclink"
    page.goto(local_url+fragment,wait_until="domcontentloaded",timeout=25000)
    page.locator("#confirmForm").wait_for(state="visible",timeout=20000)
    page.locator("#confirmEmail").fill(email)
    page.locator("#confirmForm button").click()
    from playwright.sync_api import expect
    expect(page.locator("#authBadge")).to_contain_text("SIGNED IN",timeout=20000)
    require("access_token" not in page.url and "#" not in page.url,
            role+" browser callback secret scrubbed")
    page.locator("#hostControls").wait_for(state="visible",timeout=20000)
    return page

def prepare_browser(page,role,event,match_row):
    page.locator("#eventId").fill(event)
    page.locator("#hostRead").click()
    from playwright.sync_api import expect
    expect(page.locator("#hostStatus")).to_contain_text("Verified scorekeeper",timeout=20000)
    require(page.locator("#hostPrepare").is_enabled(),
            role+" hosted UI authorized at revision zero")
    winner,scores=ALLOWED_SCORES[role]
    page.locator("#hostWinner").select_option(label=winner)
    selected=page.locator("#hostWinner").input_value()
    wanted=match_row["player_1_id"] if role=="SCOREKEEPER_A" else match_row["player_2_id"]
    require(selected==wanted,role+" fictional winner belongs to approved match")
    page.locator("#hostScores").fill(scores)
    page.locator("#hostPrepare").click()
    expect(page.locator("#hostStatus")).to_contain_text("PREPARED ONLY",timeout=10000)
    submission=page.locator("#hostPrepared").inner_text().strip()
    try: uuid.UUID(submission)
    except (ValueError,TypeError): raise Stop(role+" failed to generate a private submission ID") from None
    require(page.locator("#hostSend").is_disabled(),
            role+" cannot send before incident acknowledgment")
    page.locator("#hostRecorded").check()
    require(page.locator("#hostSend").is_enabled(),
            role+" prepared fictional score without any hosted POST")
    return submission

def browser_race(local_url,tokens,emails,event,match,match_row,
                 marker_callback=guarded_incident_marker,launch=None):
    """Runs browser UI. Exactly two user-JWT score requests after durable marker.

    launch(browser context factory) is for offline mocks only; default uses
    actual installed Playwright Chromium. No fallback to API score POSTs.
    """
    try: from playwright.sync_api import sync_playwright
    except ImportError: raise Stop("Playwright absent; install playwright and Chromium locally") from None
    if launch is not None: raise Stop("External launcher injection forbidden for hosted operator")
    requests={"SCOREKEEPER_A":0,"SCOREKEEPER_B":0}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox"])
        contexts=[]
        try:
            pages={}
            for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
                pages[role]=signed_browser_page(
                    browser,local_url,role,tokens[role],emails[role],contexts)
                def observed(req,who=role):
                    if req.url==PROJECT+SCORE_RPC and req.method=="POST":
                        requests[who]+=1
                contexts[-1].on("request",observed)
            ids={role:prepare_browser(pages[role],role,event,match_row)
                 for role in ("SCOREKEEPER_A","SCOREKEEPER_B")}
            require(ids["SCOREKEEPER_A"]!=ids["SCOREKEEPER_B"],
                    "Two independent prepared scorekeeper submission IDs")
            require(all(n==0 for n in requests.values()),
                    "No score HTTP requests during the entire browser preflight")
            marker_callback(ids)  # Exclusive durable, private 0600 incident log.
            print("ONE-TIME SCORING GATE COMMITTED. Sending exactly two browser score requests.",flush=True)
            for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
                pages[role].locator("#hostSend").click(timeout=8000)
            # A missing response or bad UI is UNKNOWN, never retry or post manually.
            for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
                page=pages[role]
                from playwright.sync_api import expect
                expect(page.locator("#hostStatus")).to_contain_text(
                    re.compile(r"(Provisional score response|UNKNOWN|Result UNKNOWN)"),
                    timeout=20000)
            require(requests=={"SCOREKEEPER_A":1,"SCOREKEEPER_B":1},
                    "Exactly ONE browser-origin signed score POST per actor")
            # Recover from a fresh C8 page in the SAME isolated browser profile:
            # token goes through real user endpoint again, browser nonce not persisted.
            outcomes={}
            for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
                old=pages[role]
                old.close()
                context=contexts[0 if role=="SCOREKEEPER_A" else 1]
                page=context.new_page()
                fragment="#access_token="+tokens[role]+(
                    "&token_type=bearer&expires_in=1800&type=magiclink")
                page.goto(local_url+fragment,wait_until="domcontentloaded",timeout=25000)
                page.locator("#confirmForm").wait_for(state="visible")
                page.locator("#confirmEmail").fill(emails[role])
                page.locator("#confirmForm button").click()
                page.locator("#hostControls").wait_for(state="visible")
                require("access_token" not in page.url,
                        role+" recovery relogin scrubbed temporary Auth token")
                page.locator("#eventId").fill(event)
                require(page.locator("#hostSend").is_disabled(),
                        role+" browser one-attempt marker persists across tab reload")
                page.locator("#hostRecoveryId").fill(ids[role])
                page.locator("#hostRecover").click()
                expect(page.locator("#hostStatus")).to_contain_text(
                    "SERVER CONFIRMED:",timeout=20000)
                statement=page.locator("#hostStatus").inner_text()
                if "ACCEPTED" in statement: outcomes[role]="accepted"
                elif "REJECTED AS STALE" in statement: outcomes[role]="rejected"
                else: raise Stop(role+" own decision has unrecognized terminal state")
                print("RESULT:",role,outcomes[role],flush=True)
            require(sorted(outcomes.values())==["accepted","rejected"],
                    "One accepted and one durably stale-rejected browser decision")
            require(requests=={"SCOREKEEPER_A":1,"SCOREKEEPER_B":1},
                    "Own-decision recovery made zero additional score POSTs")
            return outcomes,ids
        finally:
            for c in contexts:
                try: c.close()
                except Exception: pass
            browser.close()

def verify_after(tokens,event,ids,outcomes):
    """Independent from browser UI: signed RPC own/foreign access and publication."""
    for role in ("SCOREKEEPER_A","SCOREKEEPER_B"):
        r=post_snapshot(tokens[role],event,ids[role])
        d=r.body.get("decision") if r.code==200 and isinstance(r.body,dict) else None
        require(isinstance(d,dict) and d.get("id")==ids[role]
                and d.get("status")==outcomes[role]
                and d.get("match_id") is not None
                and r.body.get("revision")==1,
                role+" independent signed own-receipt postflight")
        other="SCOREKEEPER_B" if role=="SCOREKEEPER_A" else "SCOREKEEPER_A"
        cross=post_snapshot(tokens[role],event,ids[other])
        require(cross.code==200 and isinstance(cross.body,dict)
                and cross.body.get("decision") is None,
                role+" cannot read other scorekeeper's private receipt")
    outsider=post_snapshot(tokens["OUTSIDER"],event,
                          ids[next(k for k,v in outcomes.items() if v=="accepted")])
    require(outsider.code in (400,401,403,404),
            "Signed outsider denied accepted private decision")
    public=auth.http("GET","/rest/v1/fftt_public_results_v1",auth.PUBLISHABLE_KEY)
    require(public.code==200 and public.body==[],
            "No score is published to public spectator projection")

def run(secret,organizer,event,match):
    if saved_marker().exists():
        raise Stop("Existing one-time Mac incident marker. NEVER replay hosted scoring.")
    users=auth.preflight_users(secret,organizer)
    emails={"ORGANIZER":organizer.casefold(),**auth.TEST_ONLY}
    tokens={role:auth.exchange_link(secret,role,emails[role],users[role])
            for role in auth.ROLE_ORDER}
    require(len(set(tokens.values()))==4,"Four independent real Supabase user JWTs")
    match_row=verify_preflight(tokens,event,match)
    repo_root=Path(__file__).resolve().parent.parent
    if not (repo_root/"rehearsals/c8/index.html").is_file():
        raise Stop("Approved local C8 browser application unavailable")
    with LocalSource(repo_root) as local_url:
        # NEVER reenter the browser race after any error or timeout.
        outcomes,ids=browser_race(local_url,tokens,emails,event,match,match_row)
    verify_after(tokens,event,ids,outcomes)
    print("HOSTED FFTT M1 BROWSER ACCEPTANCE AND TAB-LOSS OWN-RECOVERY: PASS",flush=True)
    print("THIS SYNTHETIC FIXTURE IS CONSUMED. No further score requests, resets or replay.",flush=True)
    print("Private incident marker retained on this Mac; do not share its contents.",flush=True)

def main():
    print("FFTT M1 Hosted Browser Acceptance — NEW approved 2099 fictional fixture only.")
    print("Two OLD fixtures permanently excluded. No real FFTT3 players or publication.")
    if len(sys.argv)!=2 or sys.argv[1]!=EXECUTE:
        print("DRY RUN: no Auth calls, no browser score writes, no marker created.")
        print("Guarded execution requires --execute-approved-browser-fixture on trusted Mac.")
        return
    if saved_marker().exists():
        raise Stop("Previously attempted browser race; STOP, NEVER rerun")
    event=pin(input("PRIVATE new browser fixture EVENT UUID: ").strip(),EVENT_DIGEST)
    match=pin(input("PRIVATE new browser fixture MATCH UUID: ").strip(),MATCH_DIGEST)
    organizer=input("Existing synthetic ORGANIZER email (private): ").strip().casefold()
    if "@" not in organizer or any(c.isspace() for c in organizer):
        raise Stop("Invalid synthetic organizer account")
    print("Approved: two independently signed existing test scorekeepers, TWO POSTs only.")
    if input("Type "+PHRASE+" to proceed: ").strip()!=PHRASE:
        raise Stop("One-time operator confirmation not provided; no scores sent")
    secret=auth.check_secret(getpass.getpass("PRIVATE sb_secret_ dev key (hidden): "))
    run(secret,organizer,event,match)

if __name__=="__main__":
    try:main()
    except (Stop,auth.StopTest) as exc:
        print("STOP: "+str(exc),file=sys.stderr)
        sys.exit(1)
    except BaseException:
        print("STOP: Browser or network result uncertain. NEVER RETRY this fixture. Investigate database first.",file=sys.stderr)
        sys.exit(1)
