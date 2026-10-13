#!/usr/bin/env python3
"""C6 Chromium: REAL browser, MOCKED Auth + hosted reads, no external traffic.

CI uses only fictional accounts and intercepts every Supabase request.
No actual OTP emails, real JWTs, hosted score writes or staff mutations.
"""
from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import threading

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
SUPA = "https://copmkalfkkrkzheohwuc.supabase.co"
EVENT = "12345678-1234-4234-9234-123456789abc"
MATCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PERSON = "11111111-1111-4111-8111-111111111111"
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln"
EMAILS = {
    "organizer": "fictional-organizer@example.test",
    "scorekeeper": "fictional-scorekeeper@example.test",
    "outsider": "fictional-outsider@example.test",
}

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def check(value, reason):
    assert value, reason
    print("PASS:", reason, flush=True)

server = ThreadingHTTPServer((HOST, 0), partial(Quiet, directory=str(ROOT)))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
URL = f"http://{HOST}:{server.server_port}/rehearsals/c6/index.html"

def case(browser, role):
    context = browser.new_context(viewport={"width": 1200, "height": 900})
    page = context.new_page()
    calls = []
    leaks = []
    script_errors = []
    page.on("pageerror", lambda error: script_errors.append(str(error)))

    def mock_route(route):
        req = route.request
        path = req.url.removeprefix(SUPA)
        calls.append((req.method, path, req.post_data or ""))
        extra = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
            "Access-Control-Allow-Headers": "apikey, authorization, content-type, accept",
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        }
        if req.method == "OPTIONS":
            route.fulfill(status=200,body="",headers=extra)
            return
        status = 200
        body = None
        if path.startswith("/rest/v1/fftt_public_results_v1"):
            check(req.method=="GET","Public projection uses GET only")
            body = []
        elif path == "/auth/v1/otp":
            check(req.method=="POST", "OTP is a user-triggered POST")
            data=json.loads(req.post_data)
            check(data == {"email":EMAILS[role], "create_user":False},
                  "OTP cannot create a new user")
            body={}
        elif path == "/auth/v1/verify":
            data=json.loads(req.post_data)
            check(data=={"email":EMAILS[role],"token":"123456","type":"email"},
                  "One-time code verified for the requested individual account")
            body={
                "access_token":JWT, "token_type":"bearer", "expires_in":3600,
                "user":{"id":PERSON,"email":EMAILS[role]},
            }
        elif path == "/auth/v1/user":
            check(req.headers.get("authorization")==f"Bearer {JWT}",
                  "Auth user lookup requires generated signed session")
            body={"id":PERSON,"email":EMAILS[role]}
        elif path == "/rest/v1/rpc/fftt_staff_role_v1":
            check(req.headers.get("authorization")==f"Bearer {JWT}",
                  "Staff role read requires the same individual session")
            check(json.loads(req.post_data)=={"p_event_id":EVENT},
                  "Private event role request is strictly scoped")
            if role=="outsider":
                status=403
                body={"code":"42501"}
            else:
                body=role
        elif path == "/rest/v1/rpc/fftt_matchdesk_v1":
            if role=="outsider":
                leaks.append("outsider attempted matchdesk")
                status=403;body={}
            else:
                body=[{
                    "event_id":EVENT,"bracket_generation":1,
                    "match_id":MATCH,"match_code":"C-0-0",
                    "match_version":1,"bracket":"championship",
                    "round_number":0,"slot":0,
                    "player_1_id":"22222222-2222-4222-8222-222222222222",
                    "player_2_id":"33333333-3333-4333-8333-333333333333",
                    "player_1_name":"Synthetic Alpha",
                    "player_2_name":"Synthetic Beta",
                    "is_championship_final":True,
                    "table_number":1,
                }]
        else:
            leaks.append(path)
            status=403
            body={}
        route.fulfill(status=status,headers=extra,body=json.dumps(body))

    context.route(f"{SUPA}/**",mock_route)
    # Browser must not make any additional remote requests.
    def deny_or_dispatch(route):
        url=route.request.url
        if url.startswith(SUPA+"/"):
            route.fallback()  # pass to the strict synthetic Supabase interceptor
        elif url.startswith(f"http://{HOST}:{server.server_port}/"):
            route.continue_()
        else:
            leaks.append(url)
            route.abort()
    context.route("**/*", deny_or_dispatch)

    page.goto(URL,wait_until="networkidle")
    page.get_by_role("heading",name="Authorized matchdesk read rehearsal").wait_for()
    check(page.locator("#authBadge").inner_text()=="SIGNED OUT",
          "No automatic login or OTP requests")
    check(page.locator("#staffControls").is_hidden(),
          "Private staff controls hidden before sign-in")
    check(page.locator("#publicStatus").inner_text()=="No public event results have been published.",
          "Public projection shows genuine empty response without private fallback")
    check(not any(p in ["/auth/v1/otp","/auth/v1/verify"]
                  for _,p,_ in calls),"No unsolicited OTP or sign-in attempt")
    page.locator("#email").fill(EMAILS[role])
    page.locator("#requestCode").click()
    page.locator("#verifyForm").wait_for(state="visible")
    check(page.locator("#authBadge").inner_text()=="SIGNED OUT",
          "Requesting an OTP does not grant access")
    page.locator("#code").fill("123456")
    page.locator("#verifyCode").click()
    expect(page.locator("#authBadge")).to_contain_text("SIGNED IN", timeout=10000)
    check(page.locator("#staffControls").is_visible(),
          "Signed session permits attempting real role-gated read")
    page.locator("#eventId").fill(EVENT)
    page.locator("#readStaff").click()
    if role=="outsider":
        page.get_by_text("Staff access denied, expired, or unavailable.").wait_for()
        check(page.locator("#staffMatches .match").count()==0,
              "An existing but unassigned individual cannot see private matchdesk")
    else:
        page.get_by_text(f"Authorized {role}",exact=False).wait_for()
        check(page.locator("#staffMatches .match").count()==1,
              "Server-authorized staff receives one allowlisted fictional match")
        check("Synthetic Alpha" in page.locator("#staffMatches").inner_text(),
              "Private display uses only approved matchdesk names")
    check(not leaks,"No unauthorized endpoints or unexpected network requests")
    forbidden=(
        "/auth/v1/signup","/auth/v1/admin",
        "/auth/v1/recover","fftt_submit_match_result_v1",
        "fftt_manage_staff_v1","fftt_event_snapshot_v1",
    )
    check(not any(any(term in path for term in forbidden)
                  for _,path,_ in calls),"Browser cannot call scoring, admin or undeployed snapshot endpoints")
    check(all(method in ("GET","POST","OPTIONS") for method,_,_ in calls),
          "No DELETE/PATCH or mutation verbs")
    check(page.evaluate("localStorage.length===0 && sessionStorage.length===0"),
          "No persistence of JWT or Auth data in browser storage")
    check("access_token=" not in page.url and "#" not in page.url,
          "No signed JWT in browser location")
    page.locator("#end").click()
    check(page.locator("#staffControls").is_hidden() and
          page.locator("#staffMatches .match").count()==0 and
          page.locator("#authBadge").inner_text()=="SIGNED OUT",
          "Local sign-out clears private UI and session")
    check(not script_errors,"No browser Javascript exceptions")
    if role=="organizer":
        page.set_viewport_size({"width":375,"height":790})
        check(page.evaluate("document.documentElement.scrollWidth <= innerWidth+1"),
              "Phone-sized browser does not horizontally overflow")
        check(page.locator(".simulation-band").is_visible(),
              "Read-only development warning remains visible on mobile")
    context.close()

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox"])
        for role in ("organizer","scorekeeper","outsider"):
            print("REHEARSAL ROLE:",role,flush=True)
            case(browser,role)
        browser.close()
    print("C6 CHROMIUM PASS: 3 mocked identities, no Auth emails, no hosted score calls")
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)
