#!/usr/bin/env python3
"""FFTT3 launch-mode acceptance over independently signed LOCAL GoTrue/PostgREST sessions.

This test runs AFTER the in-place SQL candidate has been applied to the disposable
local Supabase CI stack. All users/registrations/events are fictional. Never hosted.
"""
from __future__ import annotations

import concurrent.futures
import threading
import uuid

from b2c_auth_concurrency import ensure, local_status, request, sql, denied
from gameday_signed_http import make_user


def run() -> None:
    api, anon, db = local_status()
    # An actual SQL schema upgrade happened in CI on the local Supabase DB only.
    ensure(int(sql(db, "select count(*) from fftt_private.events where synthetic_only")) >= 1,
           "Historical fictional event rows survived local in-place release")
    org_id, _, org = make_user(api, anon, "launch-org")
    _, mail_a, scorer_a = make_user(api, anon, "launch-score-a")
    _, mail_b, scorer_b = make_user(api, anon, "launch-score-b")
    _, _, outsider = make_user(api, anon, "launch-outsider")
    sql(db, f"insert into fftt_private.platform_organizers(user_id) values ('{org_id}')")

    def rpc(token, name, body=None):
        return request(api, anon, "POST", "/rest/v1/rpc/" + name, token=token, body=body or {})

    def ok(reply, label):
        ensure(reply.code == 200, f"{label}: 200 expected, got {reply.code}")
        return reply.body

    created = ok(rpc(org, "fftt_create_event_v3", {
        "p_name": "FICTIONAL LIVE-MODE CI EVENT", "p_date": "2026-11-22", "p_table_count": 2
    }), "Create event with signed Organizer")
    e = str(uuid.UUID(created["event_id"]))
    ensure(sql(db, f"select synthetic_only from fftt_private.events where id='{e}'") == "f",
           "New live-mode event is non-synthetic")
    ensure(denied(rpc(outsider, "fftt_registration_source_v5", {"p_event_id": e})),
           "Unrelated signed user cannot view Google source")
    for mail in (mail_a, mail_b):
        ok(rpc(org, "fftt_set_staff_v3", {"p_event_id": e, "p_email": mail,
                                        "p_action": "grant", "p_role": "scorekeeper"}), "Grant independent scorer")
    ensure(denied(rpc(scorer_a, "fftt_registration_source_v5", {"p_event_id": e})),
           "Scorer cannot view registration source")

    fake_google = {"kind": "google-sheets", "spreadsheet_id": "FICTIONAL_LAUNCH_CI_SHEET_12345",
                   "worksheet": "Form Responses 1", "column_map": {}, "enabled": True}
    ok(rpc(org, "fftt_set_registration_source_v5", {"p_event_id": e, "p_source": fake_google}),
       "Organizer enabled a read-only Google source (metadata only)")
    src = ok(rpc(org, "fftt_registration_source_v5", {"p_event_id": e}), "Read event source as organizer")
    ensure(src["event_synthetic"] is False and src["enabled"] is True,
           "Live-mode Google source is permitted for authorized Organizer")
    ensure(denied(rpc(org, "fftt_set_registration_source_v5", {"p_event_id": e,
               "p_source": {"kind": "fixture", "enabled": True}})),
           "Synthetic registration fixture never enabled for live mode")

    names = ["Fictional Ada Quillfeather", "Fictional Ben Marlowe"]
    ok(rpc(org, "fftt_upsert_players_v3", {"p_event_id": e, "p_players": [
        {"name": names[0], "rating": 3, "rating_status": "provisional"},
        {"name": names[1], "rating": 2, "rating_status": "provisional"}
    ]}), "Add full-name fictional roster")
    ok(rpc(org, "fftt_set_checkin_bulk_v3", {"p_event_id": e, "p_player_ids": None, "p_checked_in": True}),
       "Check in fictional roster")
    snap = ok(rpc(org, "fftt_organizer_snapshot_v3", {"p_event_id": e}), "Read private roster")
    ensure(set(p["name"] for p in snap["players"]) == set(names), "Full names preserved on private roster")
    ids = [p["id"] for p in snap["players"]]
    ok(rpc(org, "fftt_build_championship_v3", {
        "p_event_id": e, "p_slots": ids, "p_expected_generation": 0, "p_confirm": False
    }), "Build two-player real-mode championship")
    desk_a = ok(rpc(scorer_a, "fftt_matchdesk_v2", {"p_event_id": e}), "Scorer A Match Desk")
    desk_b = ok(rpc(scorer_b, "fftt_matchdesk_v2", {"p_event_id": e}), "Scorer B Match Desk")
    ensure(len(desk_a) == len(desk_b) == 1, "Both scorers see the same match")
    m = desk_a[0]
    ensure(m["match_id"] == desk_b[0]["match_id"], "Same shared match id")
    winner = m["player_1_id"]
    barrier = threading.Barrier(2)

    def submit(token: str):
        body = {"p_event_id": e, "p_match_id": m["match_id"],
                "p_bracket_generation": m["bracket_generation"],
                "p_expected_match_version": m["match_version"],
                "p_submission_id": str(uuid.uuid4()),
                "p_winner_id": winner, "p_game_scores": "11-6, 11-8", "p_table_number": 1}
        barrier.wait(timeout=15)
        return rpc(token, "fftt_submit_match_result_v2", body)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        future_a = pool.submit(submit, scorer_a)
        future_b = pool.submit(submit, scorer_b)
        result_a, result_b = future_a.result(timeout=45), future_b.result(timeout=45)
    statuses = sorted(x.body.get("status") for x in (result_a, result_b) if x.code == 200)
    ensure(statuses == ["accepted", "rejected"],
           "Two independently signed scorers yield exactly one accepted match score")
    post = ok(rpc(org, "fftt_organizer_snapshot_v3", {"p_event_id": e}), "Private score audit")
    ensure(sum(1 for match in post["matches"] if match.get("status") == "complete") == 1,
           "Exactly one match became complete")
    ensure(denied(rpc(outsider, "fftt_organizer_snapshot_v3", {"p_event_id": e})),
           "Outsider cannot access private names or registration settings")
    anon_public = request(api, anon, "GET", "/rest/v1/fftt_public_tournament_v1")
    ensure(anon_public.code == 200 and all(x.get("event_name") != "FICTIONAL LIVE-MODE CI EVENT"
                                         for x in anon_public.body),
           "New real-mode event not public until approved publication")

    ok(rpc(org, "fftt_set_staff_v3", {"p_event_id": e, "p_email": mail_b,
                                    "p_action": "revoke", "p_role": None}), "Revoke scorer B")
    ensure(denied(rpc(scorer_b, "fftt_matchdesk_v2", {"p_event_id": e})),
           "Revoked scorer immediately denied with same independently signed token")
    print("PASS: LOCAL real-mode GoTrue/Auth, Google source authorization, full names, dual-scorer race, revoked access, no unapproved publication")


if __name__ == "__main__":
    run()
