#!/usr/bin/env python3
"""B2c integration: genuine local Supabase Auth tokens + concurrent PostgREST RPC.

Run ONLY with a locally started, isolated Supabase CLI stack. This script:
- generates unique non-deliverable synthetic logins and ephemeral passwords;
- uses local GoTrue to sign up, then independently sign in to get signed JWTs;
- grants event-scoped access via the local Postgres connection;
- exercises the actual PostgREST endpoint from independent HTTP clients;
- races two simultaneous scorekeepers and verifies one authoritative winner;
- revokes a staff grant and checks that even an identical retry is denied.

No production URL/key/project is accepted: localhost-only guard is mandatory.
Nothing is saved to disk; no service-role credentials, JWTs or passwords are printed.
CI runs in an ephemeral local database and never touches hosted Supabase.
"""

from __future__ import annotations

import concurrent.futures
import json
import secrets
import subprocess
import threading
import uuid
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


def ensure(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print("PASS:", message, flush=True)


def local_status() -> tuple[str, str, str]:
    process = subprocess.run(
        ["supabase", "status", "-o", "json"], check=True, text=True, capture_output=True
    )
    raw = process.stdout
    start = raw.find("{")
    if start < 0:
        raise RuntimeError("Supabase CLI did not return JSON status")
    status = json.loads(raw[start:])
    api = status.get("API_URL") or status.get("api_url")
    anon_key = status.get("ANON_KEY") or status.get("anon_key")
    db_url = status.get("DB_URL") or status.get("db_url")
    if not all([api, anon_key, db_url]):
        raise RuntimeError("Local Supabase status is missing API, anonymous key or DB URL")
    api_parts = urllib.parse.urlsplit(api)
    db_parts = urllib.parse.urlsplit(db_url)
    allowed = {"127.0.0.1", "localhost", "::1"}
    if api_parts.hostname not in allowed or db_parts.hostname not in allowed:
        raise RuntimeError("Refusing B2c synthetic test against any non-local Supabase host")
    if api_parts.scheme != "http":
        raise RuntimeError("Test expects plain HTTP only on isolated local loopback")
    return api.rstrip("/"), anon_key, db_url


@dataclass
class HttpResponse:
    code: int
    body: object


def request(
    api: str, anon: str, method: str, path: str,
    *, token: str | None = None, body: object | None = None,
) -> HttpResponse:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"apikey": anon, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    url = api + path
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=18) as res:
            code = res.status
            raw = res.read()
    except urllib.error.HTTPError as exc:
        code = exc.code
        raw = exc.read()
    payload: object
    try:
        payload = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        payload = {"unparseable": True}
    return HttpResponse(code=code, body=payload)


def sql(db_url: str, query: str) -> str:
    process = subprocess.run(
        ["psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", db_url],
        input=query, capture_output=True, text=True, check=False, timeout=25,
    )
    if process.returncode:
        # No SQL here includes tokens/passwords; do not emit connection URLs.
        raise RuntimeError("Local fixture SQL failed: " + process.stderr[-1200:])
    return process.stdout.strip()


def auth_user(api: str, anon: str, label: str) -> tuple[str, str]:
    email = "fftt-b2c-" + label + "-" + uuid.uuid4().hex + "@example.test"
    password = secrets.token_urlsafe(28)
    signup = request(api, anon, "POST", "/auth/v1/signup",
                     body={"email": email, "password": password})
    ensure(signup.code in (200, 201) and isinstance(signup.body, dict)
           and isinstance(signup.body.get("user"), dict),
           "Synthetic " + label + " signed up through real Supabase Auth")
    user_id = str(uuid.UUID(signup.body["user"]["id"]))
    signed_in = request(
        api, anon, "POST", "/auth/v1/token?grant_type=password",
        body={"email": email, "password": password}
    )
    ensure(signed_in.code == 200 and isinstance(signed_in.body, dict)
           and isinstance(signed_in.body.get("access_token"), str),
           "Synthetic " + label + " password sign-in returned a signed token")
    token = signed_in.body["access_token"]
    verified = request(api, anon, "GET", "/auth/v1/user", token=token)
    ensure(verified.code == 200 and isinstance(verified.body, dict)
           and verified.body.get("id") == user_id,
           "Auth server resolved " + label + " token to its own account")
    return user_id, token


def denied(r: HttpResponse) -> bool:
    return r.code >= 400


def run() -> None:
    api, anon, db_url = local_status()
    print("B2c environment: isolated local Supabase API + PostgreSQL", flush=True)

    organizer_id, organizer = auth_user(api, anon, "organizer")
    keeper_a_id, keeper_a = auth_user(api, anon, "scorekeeper-a")
    keeper_b_id, keeper_b = auth_user(api, anon, "scorekeeper-b")
    outsider_id, outsider = auth_user(api, anon, "outsider")
    _ = outsider_id

    event = str(uuid.uuid4())
    public_event = str(uuid.uuid4())
    other_event = str(uuid.uuid4())
    other_public = str(uuid.uuid4())
    bracket = str(uuid.uuid4())
    match = str(uuid.uuid4())
    player_a = str(uuid.uuid4())
    player_b = str(uuid.uuid4())

    # IDs have all been parsed or generated as UUIDs, never untrusted text.
    sql(db_url, f"""
        begin;
        insert into fftt_private.events
          (id,public_id,event_name,event_date,lifecycle,bracket_generation)
        values
          ('{event}','{public_event}','B2c Isolated Synthetic Tournament','2099-10-01','active',1),
          ('{other_event}','{other_public}','B2c Other Event','2099-10-02','active',1);
        insert into fftt_private.event_staff(event_id,user_id,role) values
          ('{event}','{organizer_id}','organizer'),
          ('{event}','{keeper_a_id}','scorekeeper'),
          ('{event}','{keeper_b_id}','scorekeeper');
        insert into fftt_private.players
          (id,event_id,display_name,rating,rating_status,checked_in)
        values
          ('{player_a}','{event}','Synthetic Alpha',5,'provisional',true),
          ('{player_b}','{event}','Synthetic Beta',1,'provisional',true);
        insert into fftt_private.brackets(id,event_id,generation,kind,status)
        values ('{bracket}','{event}',1,'championship','active');
        insert into fftt_private.matches(
          id,event_id,bracket_id,generation,match_code,
          round_number,slot,player_1_id,player_2_id)
        values (
          '{match}','{event}','{bracket}',1,'C-0-0',0,0,
          '{player_a}','{player_b}');
        commit;
    """)
    print("PASS: committed exclusively synthetic local fixture", flush=True)

    role_path = "/rest/v1/rpc/fftt_staff_role_v1"
    desk_path = "/rest/v1/rpc/fftt_matchdesk_v1"
    score_path = "/rest/v1/rpc/fftt_submit_match_result_v1"

    r = request(api, anon, "POST", role_path, token=organizer, body={"p_event_id": event})
    ensure(r.code == 200 and r.body == "organizer", "Organizer role resolved from database")
    r = request(api, anon, "POST", role_path, token=keeper_a, body={"p_event_id": event})
    ensure(r.code == 200 and r.body == "scorekeeper", "Scorekeeper role resolved from database")
    ensure(denied(request(api, anon, "POST", role_path,
                          token=outsider, body={"p_event_id": event})),
           "Signed-in unaffiliated user blocked from role API")
    ensure(denied(request(api, anon, "POST", role_path,
                          token=keeper_a, body={"p_event_id": other_event})),
           "Scorekeeper grant is not valid for another event")
    ensure(denied(request(api, anon, "POST", role_path,
                          body={"p_event_id": event})),
           "Anonymous request denied from organizer role API")
    ensure(denied(request(api, anon, "POST", desk_path,
                          body={"p_event_id": event})),
           "Anonymous request denied from match desk")

    desk = request(api, anon, "POST", desk_path,
                   token=keeper_b, body={"p_event_id": event})
    forbidden = {"email", "phone", "rating", "rating_status",
                 "checked_in", "first_champ_loss", "staff", "actor_id"}
    ensure(desk.code == 200 and isinstance(desk.body, list)
           and len(desk.body) == 1 and desk.body[0].get("match_id") == match
           and not (forbidden & set(desk.body[0])),
           "Signed-in scorekeeper sees only one eligible match with no rating/contact fields")

    # Explicit schema request must fail: fftt_private must not be exposed.
    ensure(denied(request(api, anon, "GET", "/rest/v1/players",
                          token=keeper_b)) and
           denied(request(api, anon, "GET", "/rest/v1/players?select=*",
                          token=keeper_b)),
           "No directly exposed private player endpoint")

    public = request(api, anon, "GET", "/rest/v1/fftt_public_results_v1")
    ensure(public.code == 200 and public.body == [],
           "Public projection is initially empty and anonymous read-only")

    sub_a = str(uuid.uuid4())
    sub_b = str(uuid.uuid4())

    def score_payload(winner: str, submission: str) -> dict[str, object]:
        scores = "11-7, 11-8" if winner == player_a else "8-11, 7-11"
        return {
            "p_event_id": event,
            "p_match_id": match,
            "p_bracket_generation": 1,
            "p_expected_match_version": 0,
            "p_submission_id": submission,
            "p_winner_id": winner,
            "p_game_scores": scores,
            "p_table_number": 1,
        }

    body_a, body_b = score_payload(player_a, sub_a), score_payload(player_b, sub_b)
    barrier = threading.Barrier(2)

    def simultaneous_score(token: str, body: dict[str, object]) -> HttpResponse:
        barrier.wait(timeout=15)
        return request(api, anon, "POST", score_path, token=token, body=body)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(simultaneous_score, keeper_a, body_a)
        second = pool.submit(simultaneous_score, keeper_b, body_b)
        outcomes = [first.result(timeout=25), second.result(timeout=25)]

    accepted = [n for n, x in enumerate(outcomes)
                if x.code == 200 and isinstance(x.body, dict)
                and x.body.get("status") == "accepted"]
    rejected = [n for n, x in enumerate(outcomes) if denied(x)]
    ensure(len(accepted) == 1 and len(rejected) == 1,
           "Two separately authenticated simultaneous submissions yield exactly one winner")
    winning_index = accepted[0]
    winning_body = [body_a, body_b][winning_index]
    winning_token = [keeper_a, keeper_b][winning_index]
    losing_body = [body_a, body_b][rejected[0]]
    losing_token = [keeper_a, keeper_b][rejected[0]]
    success = outcomes[winning_index].body
    repeat = request(api, anon, "POST", score_path,
                     token=winning_token, body=winning_body)
    ensure(repeat.code == 200 and repeat.body == success,
           "Exact retry from accepted actor returns original receipt")
    ensure(denied(request(api, anon, "POST", score_path,
                          token=winning_token,
                          body={**winning_body, "p_winner_id": losing_body["p_winner_id"]})),
           "Changing winner while reusing submission ID is rejected")
    ensure(denied(request(api, anon, "POST", score_path,
                          token=losing_token, body=losing_body)),
           "Competing stale result cannot overwrite the winner")
    ensure(denied(request(api, anon, "POST", score_path,
                          token=outsider, body={**winning_body,
                                               "p_submission_id": str(uuid.uuid4())})),
           "Unrelated signed-in account cannot score an authorized event")
    ensure(denied(request(api, anon, "POST", score_path,
                          body={**winning_body, "p_submission_id": str(uuid.uuid4())})),
           "Anonymous caller cannot submit a match result")

    state = sql(db_url, f"""
      select m.status || '|' || m.winner_id::text || '|' ||
        m.match_version::text || '|' || e.revision::text
      from fftt_private.matches m
      join fftt_private.events e on e.id=m.event_id
      where m.id='{match}';
    """)
    expected_winner = str(winning_body["p_winner_id"])
    ensure(state == f"complete|{expected_winner}|1|1",
           "Postgres persisted exactly one authoritative score and revision")
    audit_count = sql(db_url, f"""
      select (select count(*) from fftt_private.audit_events
               where event_id='{event}')::text || '|' ||
             (select count(*) from fftt_private.result_submissions
               where event_id='{event}')::text || '|' ||
             (select count(*) from fftt_private.consolation_reviews
               where event_id='{event}')::text;
    """)
    ensure(audit_count == "1|1|1",
           "Concurrent conflict created one audit, one receipt and one review candidate")

    revoked_id = [keeper_a_id, keeper_b_id][winning_index]
    sql(db_url, f"""
      update fftt_private.event_staff set active=false,revoked_at=now()
      where event_id='{event}' and user_id='{revoked_id}';
    """)
    ensure(denied(request(api, anon, "POST", score_path,
                          token=winning_token, body=winning_body)),
           "Revoked Auth user cannot replay previously accepted submission")
    ensure(denied(request(api, anon, "POST", desk_path,
                          token=winning_token, body={"p_event_id": event})),
           "Revoked Auth user loses match desk access immediately")
    ensure(request(api, anon, "POST", role_path,
                   token=organizer, body={"p_event_id": event}).body == "organizer",
           "Independent organizer grant remains valid after scorekeeper revocation")

    final_count = sql(db_url, f"""
       select count(*) from public.fftt_published_events
         where event_id='{public_event}';
    """)
    ensure(final_count == "0", "No public names/results were published by scoring")
    print("B2c PASS: signed local Auth sessions, HTTP RPC authorization, "
          "two-client conflict, retry, audit and revocation", flush=True)


if __name__ == "__main__":
    run()
