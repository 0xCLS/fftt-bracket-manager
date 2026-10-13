#!/usr/bin/env python3
"""Milestone 1 V2: locally signed Supabase Auth + concurrent scorekeeper HTTP.
ALL TEST ACCOUNTS/DB/HTTP ARE IN LOCAL SYNTHETIC SUPABASE, NEVER HOSTED.
Run only on a freshly started local stack with the V2 SQL candidate applied.
No fixtures from B2i are touched, no test account emails/passwords/JWTs printed.
"""
from __future__ import annotations
import concurrent.futures
import threading
import uuid
from b2c_auth_concurrency import (
    HttpResponse, ensure, local_status, request, sql, auth_user, denied,
)

def run() -> None:
    api, anon, db_url = local_status()
    print("Milestone 1 V2: disposable local signed Supabase Auth + PostgreSQL", flush=True)

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
          ('{event}','{organizer_id}','organizer');
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
    score_path = "/rest/v1/rpc/fftt_submit_match_result_v2"
    snapshot_path = "/rest/v1/rpc/fftt_score_decision_snapshot_v2"
    legacy_score_path = "/rest/v1/rpc/fftt_submit_match_result_v1"
    staff_path = "/rest/v1/rpc/fftt_manage_staff_v1"

    def staff_body(target: str, action: str, role: str | None) -> dict[str, str | None]:
        return {"p_event_id": event, "p_target_user_id": target,
                "p_action": action, "p_role": role}

    ensure(denied(request(api, anon, "POST", role_path,
                          token=keeper_a, body={"p_event_id": event})),
           "Unassigned synthetic scorekeeper starts with NO access")
    ensure(denied(request(api, anon, "POST", staff_path,
                          body=staff_body(keeper_a_id, "grant", "scorekeeper"))),
           "Anonymous caller cannot manage staff")
    ensure(denied(request(api, anon, "POST", staff_path, token=outsider,
                          body=staff_body(outsider_id, "grant", "organizer"))),
           "Unaffiliated account cannot elevate itself")
    ensure(denied(request(api, anon, "POST", staff_path, token=organizer,
                          body=staff_body(organizer_id, "revoke", None))),
           "Organizer cannot revoke own access")
    for target in (keeper_a_id, keeper_b_id):
        grant = request(api, anon, "POST", staff_path, token=organizer,
                        body=staff_body(target, "grant", "scorekeeper"))
        ensure(grant.code == 200 and isinstance(grant.body, dict)
               and grant.body.get("status") == "granted",
               "Organizer granted one verified synthetic scorekeeper")
    repeat_grant = request(api, anon, "POST", staff_path, token=organizer,
                           body=staff_body(keeper_a_id, "grant", "scorekeeper"))
    ensure(repeat_grant.code == 200 and repeat_grant.body.get("status") == "unchanged",
           "Identical staff grant is idempotent without a new event revision")
    ensure(denied(request(api, anon, "POST", staff_path, token=keeper_a,
                          body=staff_body(outsider_id, "grant", "organizer"))),
           "Scorekeeper cannot promote unrelated account")
    ensure(denied(request(api, anon, "POST", staff_path, token=organizer,
                          body={**staff_body(keeper_a_id, "grant", "scorekeeper"),
                                "p_event_id": other_event})),
           "Organizer cannot grant access to a different event")

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
    ensure(denied(request(api, anon, "POST", legacy_score_path,
                          token=keeper_a, body=body_a)),
           "Legacy V1 scoring RPC is inaccessible after V2 atomic cutover")
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
    rejected = [n for n, x in enumerate(outcomes)
                if x.code == 200 and isinstance(x.body, dict)
                and x.body.get("status") == "rejected"
                and x.body.get("reason") == "stale-match-version"]
    ensure(len(accepted) == 1 and len(rejected) == 1,
           "Two independently signed and concurrent scorekeepers yield one accepted and one durable stale rejection")
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
    lost_repeat = request(api, anon, "POST", score_path,
                          token=losing_token, body=losing_body)
    ensure(lost_repeat.code == 200 and lost_repeat.body == outcomes[rejected[0]].body,
           "Exactly-once stale submission replays its durable rejected decision")
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
    ensure(state == f"complete|{expected_winner}|1|3",
           "Postgres persisted exactly one authoritative score and revision")
    audit_count = sql(db_url, f"""
      select (select count(*) from fftt_private.audit_events
               where event_id='{event}' and operation='result_accepted')::text || '|' ||
             (select count(*) from fftt_private.result_submissions
               where event_id='{event}')::text || '|' ||
             (select count(*) from fftt_private.consolation_reviews
               where event_id='{event}')::text;
    """)
    ensure(audit_count == "1|1|1",
           "Concurrent conflict created one audit, one receipt and one review candidate")

    decisions = sql(db_url, f"""
       select count(*)::text || '|' ||
         count(*) filter (where status='accepted')::text || '|' ||
         count(*) filter (where status='rejected')::text
        from fftt_private.score_decisions_v2 where event_id='{event}';
    """)
    ensure(decisions == "2|1|1",
           "V2 ledger durably stores one accepted and one rejected decision")

    def snapshot_for(token: str, submission: str) -> HttpResponse:
        return request(api, anon, "POST", snapshot_path, token=token,
                       body={"p_event_id":event,"p_submission_id":submission})

    own_accept = snapshot_for(winning_token, str(winning_body["p_submission_id"]))
    own_reject = snapshot_for(losing_token, str(losing_body["p_submission_id"]))
    cross_actor = snapshot_for(losing_token, str(winning_body["p_submission_id"]))
    ensure(own_accept.code == 200 and isinstance(own_accept.body, dict)
           and isinstance(own_accept.body.get("decision"), dict)
           and own_accept.body["decision"].get("status") == "accepted",
           "Only current actor sees their accepted score decision")
    ensure(own_reject.code == 200 and isinstance(own_reject.body, dict)
           and isinstance(own_reject.body.get("decision"), dict)
           and own_reject.body["decision"].get("status") == "rejected",
           "Only current actor sees their durable rejected score decision")
    ensure(cross_actor.code == 200 and isinstance(cross_actor.body, dict)
           and cross_actor.body.get("decision") is None,
           "Signed other scorekeeper cannot inspect opponent's decision")
    ensure(denied(snapshot_for(outsider, str(winning_body["p_submission_id"])))
           and denied(request(api, anon, "POST", snapshot_path,
             body={"p_event_id":event,"p_submission_id":sub_a})),
           "Outsider and anonymous clients cannot read private decisions")
    forbidden_receipt_keys = {"email","phone","rating","game_scores",
                              "actor_id","request_fingerprint","staff"}
    ensure(all(not (forbidden_receipt_keys & set(x.body))
               and not (forbidden_receipt_keys & set(x.body.get("decision",{})))
               for x in (own_accept,own_reject)),
           "Signed snapshots contain no private contacts, ratings or score payloads")

    revoked_id = [keeper_a_id, keeper_b_id][winning_index]
    revoked = request(api, anon, "POST", staff_path, token=organizer,
                      body=staff_body(revoked_id, "revoke", None))
    ensure(revoked.code == 200 and isinstance(revoked.body, dict)
           and revoked.body.get("status") == "revoked",
           "Organizer revoked winning scorekeeper through authenticated API")
    staff_audits = sql(db_url, f"""
      select count(*) from fftt_private.audit_events
       where event_id='{event}' and operation='staff_grant_changed';
    """)
    ensure(staff_audits == "3", "Two staff grants and one revocation are audited")

    ensure(denied(request(api, anon, "POST", score_path,
                          token=winning_token, body=winning_body)),
           "Revoked Auth user cannot replay previously accepted submission")
    ensure(denied(request(api, anon, "POST", desk_path,
                          token=winning_token, body={"p_event_id": event})),
           "Revoked Auth user loses match desk access immediately")
    ensure(denied(snapshot_for(winning_token, str(winning_body["p_submission_id"]))),
           "Revocation blocks accepted-decision reads even with old signed JWT")
    ensure(request(api, anon, "POST", role_path,
                   token=organizer, body={"p_event_id": event}).body == "organizer",
           "Independent organizer grant remains valid after scorekeeper revocation")

    final_count = sql(db_url, f"""
       select count(*) from public.fftt_published_events
         where event_id='{public_event}';
    """)
    ensure(final_count == "0", "No public names/results were published by scoring")
    print("MILESTONE1 V2 PASS: independent signed Auth, concurrent accepted/rejected "
          "decisions, scoped snapshots, audit, no-score replay and revocation", flush=True)


if __name__ == "__main__":
    run()
