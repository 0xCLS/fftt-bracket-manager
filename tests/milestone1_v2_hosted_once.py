#!/usr/bin/env python3
"""FFTT Milestone 1 V2: ONE organizer-approved hosted SYNTHETIC score race.

RUN ON TRUSTED MAC ONLY. No automatic score retry, no fixture reset, no
account creation/grant/revoke, no production API or public publication.
ONLY the new 2099 V2 fixture is permitted; consumed B2i fixture is refused.
Privileged Supabase sb_secret_ key, JWTs, Magic Links and UUIDs remain in
operator process memory and are never written to disk or printed.
Auth Admin generate_link issues fresh existing-user sessions; it is NOT
ordinary volunteer inbox authentication and does not modify staff grants.
"""
from __future__ import annotations
import concurrent.futures
import getpass
import hashlib
import hmac
import json
import sys
import threading
import urllib.error
import urllib.request
import uuid

import b2h_admin_magiclink_signed_auth as auth

HOST=auth.HOST
KEY=auth.PUBLISHABLE_KEY
EVENT_DIGEST="c6e058226513c738fced9bd3b10747b320516455a577f34f64c01c7549b27f7d"
MATCH_DIGEST="cbce1949d0ce6e9a1eb3487845096a599ad55d5c4927caf196c39f15660595fa"
SCORE_RPC="/rest/v1/rpc/fftt_submit_match_result_v2"
SNAP_RPC="/rest/v1/rpc/fftt_score_decision_snapshot_v2"
EXECUTE_FLAG="--execute-approved-v2-fixture"
APPROVAL="RUN ONE APPROVED FFTT V2 SYNTHETIC RACE"
ALLOWED_RPCS=frozenset((SCORE_RPC,SNAP_RPC))
SCORING_ENABLED=True

class Stop(RuntimeError): pass

def ensure(ok: bool, note: str) -> None:
    if not ok: raise Stop(note)
    print("PASS:",note,flush=True)

def pin(value: str, digest: str) -> str:
    try: ident=str(uuid.UUID(value))
    except (TypeError, ValueError, AttributeError): raise Stop("Invalid private fixture identifier") from None
    actual=hashlib.sha256(ident.encode("ascii")).hexdigest()
    ensure(hmac.compare_digest(actual,digest),
           "Exact privately pinned new V2 fixture identity verified")
    return ident

def rpc(path: str,token: str|None,payload: dict) -> tuple[int,dict|list|None]:
    if path not in ALLOWED_RPCS or HOST!="https://copmkalfkkrkzheohwuc.supabase.co":
        raise Stop("Unexpected project/endpoint: stopped")
    if path==SCORE_RPC and not token:
        raise Stop("Unsigned score submission forbidden")
    data=json.dumps(payload).encode("utf-8")
    headers={"apikey":KEY,"Accept":"application/json",
             "Content-Type":"application/json",
             "User-Agent":"FFTT-Milestone1-V2-Once/1"}
    if token: headers["Authorization"]="Bearer "+token
    req=urllib.request.Request(HOST+path,data=data,headers=headers,method="POST")
    try:
        with urllib.request.build_opener(auth.NoRedirect()).open(req,timeout=20) as res:
            code,raw=res.status,res.read(16384)
    except urllib.error.HTTPError as e:
        code,raw=e.code,e.read(16384)
    # Transient/timeout exceptions propagate; never repeat a score request.
    try: decoded=json.loads(raw) if raw else None
    except (ValueError,UnicodeError): raise Stop("Unparseable hosted response; STOP ALL WRITES") from None
    return code,decoded

def preflight(tokens: dict[str,str],event: str,match: str) -> dict:
    roles={"ORGANIZER":"organizer","SCOREKEEPER_A":"scorekeeper",
           "SCOREKEEPER_B":"scorekeeper"}
    for who,expected in roles.items():
        result=auth.http("POST","/rest/v1/rpc/fftt_staff_role_v1",KEY,
                         token=tokens[who],body={"p_event_id":event})
        ensure(result.code==200 and result.body==expected,
               who+" currently authorized for ONLY this new fixture role")
    for who in ("OUTSIDER",):
        result=auth.http("POST","/rest/v1/rpc/fftt_staff_role_v1",KEY,
                         token=tokens[who],body={"p_event_id":event})
        ensure(result.code in (400,401,403,404),
               "Ungrant­ed outsider denied an event staff role")
    found=[]
    for who in ("SCOREKEEPER_A","SCOREKEEPER_B"):
        result=auth.http("POST","/rest/v1/rpc/fftt_matchdesk_v1",KEY,
                         token=tokens[who],body={"p_event_id":event})
        ensure(result.code==200 and isinstance(result.body,list) and len(result.body)==1,
               who+" sees exactly one pending fictional match")
        item=result.body[0]
        checks={"event_id":event,"match_id":match,"match_code":"C-0-0",
                "bracket_generation":1,"match_version":0,
                "player_1_name":"Synthetic V2 Alpha",
                "player_2_name":"Synthetic V2 Beta"}
        ensure(all(item.get(k)==v for k,v in checks.items())
               and item.get("player_1_id")!=item.get("player_2_id"),
               who+" match desk matches approved unconsumed V2 fixture")
        found.append(item)
    ensure(found[0]==found[1],"Both independently signed users see same match")
    public=auth.http("GET","/rest/v1/fftt_public_results_v1",KEY)
    ensure(public.code==200 and public.body==[],"No published event or match data")
    for who in ("SCOREKEEPER_A","SCOREKEEPER_B"):
        code,snap=rpc(SNAP_RPC,tokens[who],
            {"p_event_id":event,"p_submission_id":None})
        ensure(code==200 and isinstance(snap,dict)
               and snap.get("event_id")==event and snap.get("revision")==0
               and snap.get("generation")==1 and snap.get("lifecycle")=="active"
               and snap.get("decision") is None,
               who+" signed preflight: active generation 1, revision 0, no decisions")
    code,_=rpc(SNAP_RPC,tokens["OUTSIDER"],
               {"p_event_id":event,"p_submission_id":None})
    ensure(code in (400,401,403,404),"Outsider cannot read private V2 snapshot")
    code,_=rpc(SNAP_RPC,None,{"p_event_id":event,"p_submission_id":None})
    ensure(code in (400,401,403,404),"Anonymous cannot read private V2 snapshot")
    return found[0]

def payloads(row: dict,event: str,match: str) -> dict[str,dict]:
    base={"p_event_id":event,"p_match_id":match,
          "p_bracket_generation":1,"p_expected_match_version":0,
          "p_table_number":1}
    return {
      "SCOREKEEPER_A":{**base,"p_submission_id":str(uuid.uuid4()),
                      "p_winner_id":row["player_1_id"],
                      "p_game_scores":"11-7, 11-8, 11-9"},
      "SCOREKEEPER_B":{**base,"p_submission_id":str(uuid.uuid4()),
                      "p_winner_id":row["player_2_id"],
                      "p_game_scores":"7-11, 8-11, 9-11"},
    }

def one_score(jwt: str,payload: dict,barrier: threading.Barrier) -> tuple[int,dict|list|None]:
    barrier.wait(timeout=15)
    return rpc(SCORE_RPC,jwt,payload)

def run(secret: str,organizer_email: str,event: str,match: str) -> None:
    expected_users=auth.preflight_users(secret,organizer_email)
    emails={"ORGANIZER":organizer_email.casefold(),**auth.TEST_ONLY}
    tokens={who:auth.exchange_link(secret,who,emails[who],expected_users[who])
            for who in auth.ROLE_ORDER}
    ensure(len(set(tokens.values()))==4,"Four distinct server-issued JWTs authenticated")
    row=preflight(tokens,event,match)
    submissions=payloads(row,event,match)
    print("Preflight PASS. Sending exactly TWO simultaneous irreversible synthetic V2 score POSTs.")
    barrier=threading.Barrier(2)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures={who:pool.submit(one_score,tokens[who],submissions[who],barrier)
                     for who in ("SCOREKEEPER_A","SCOREKEEPER_B")}
            outputs={who:futures[who].result(timeout=30) for who in futures}
    except Exception:
        print("UNCERTAIN SCORE RESULT. STOP. Never retry this fixture.",file=sys.stderr)
        raise
    accepted=[]
    rejected=[]
    for who,(code,data) in outputs.items():
        if code!=200 or not isinstance(data,dict):
            raise Stop("Score response indeterminate; STOP. No replay.")
        if data.get("submission_id")!=submissions[who]["p_submission_id"] or data.get("match_id")!=match:
            raise Stop("Score receipt identity mismatch; STOP. No replay.")
        if data.get("status")=="accepted" and data.get("reason") is None:
            accepted.append(who)
        elif data.get("status")=="rejected" and data.get("reason")=="stale-match-version":
            rejected.append(who)
        else:
            raise Stop("Unexpected score decision; STOP. No replay.")
        print("RESULT:",who,"HTTP",code,"decision",data.get("status"))
    ensure(len(accepted)==1 and len(rejected)==1,
           "ONE accepted, ONE durable stale-rejected; neither score submitted twice")

    for who,expected in [(accepted[0],"accepted"),(rejected[0],"rejected")]:
        own=submissions[who]["p_submission_id"]
        code,body=rpc(SNAP_RPC,tokens[who],{"p_event_id":event,"p_submission_id":own})
        ensure(code==200 and isinstance(body,dict)
               and body.get("event_id")==event and body.get("revision")==1
               and body.get("generation")==1 and body.get("lifecycle")=="active"
               and isinstance(body.get("decision"),dict)
               and body["decision"].get("id")==own
               and body["decision"].get("status")==expected
               and body["decision"].get("match_id")==match
               and body["decision"].get("reason")==("stale-match-version" if expected=="rejected" else None),
               who+" actor-scoped durable server snapshot confirms "+expected)
        opponent=submissions[rejected[0] if who==accepted[0] else accepted[0]]["p_submission_id"]
        cross_code,cross=rpc(SNAP_RPC,tokens[who],
                            {"p_event_id":event,"p_submission_id":opponent})
        ensure(cross_code==200 and isinstance(cross,dict) and cross.get("decision") is None,
               who+" cannot read another scorekeeper's decision")
    code,_=rpc(SNAP_RPC,tokens["OUTSIDER"],
               {"p_event_id":event,"p_submission_id":submissions[accepted[0]]["p_submission_id"]})
    ensure(code in (400,401,403,404),"Outsider denied accepted decision snapshot")
    public=auth.http("GET","/rest/v1/fftt_public_results_v1",KEY)
    ensure(public.code==200 and public.body==[],"No public results published by hosted scoring")
    print("HOSTED MILESTONE 1 V2 RACE AND OWN-DECISION RECOVERY READS: PASS")
    print("THIS FIXTURE IS CONSUMED. No repeat, reset, correction or publication.")

def main()->None:
    print("FFTT Milestone 1 V2: fresh 2099 synthetic hosted score race ONLY.")
    print("Historical B2i fixture is permanently excluded. No real FFTT3 data.")
    if len(sys.argv)!=2 or sys.argv[1]!=EXECUTE_FLAG:
        print("DRY RUN: no Auth session generated, no score requests.")
        return
    if SCORING_ENABLED is not True: raise Stop("Source score gate is disabled")
    event=pin(input("NEW approved synthetic event UUID (private): ").strip(),EVENT_DIGEST)
    match=pin(input("NEW pending synthetic match UUID (private): ").strip(),MATCH_DIGEST)
    organizer=input("Existing synthetic ORGANIZER account email (private): ").strip()
    if "@" not in organizer or any(c.isspace() for c in organizer):
        raise Stop("Invalid organizer email")
    print("Only this exact new fictional match may be completed (TWO score POSTs).")
    phrase=input("Type "+APPROVAL+" to continue: ").strip()
    if phrase!=APPROVAL:raise Stop("Explicit one-time local gate not confirmed")
    secret=auth.check_secret(getpass.getpass("Supabase development sb_secret_ key (hidden): "))
    run(secret,organizer,event,match)

if __name__=="__main__":
    try:main()
    except (Stop,auth.StopTest) as e:
        print("STOP:",str(e),file=sys.stderr);sys.exit(1)
    except Exception:
        print("STOP: uncertain operation; do not retry or re-run this fixture.",
              file=sys.stderr);sys.exit(1)
