#!/usr/bin/env python3
"""Game-day V3: a whole fictional tournament over REAL local Supabase (GoTrue + PostgREST + PostgreSQL), with
real concurrent connections. Run only on a freshly started local stack with V2 and V3 applied.
Fictional accounts and data only; nothing here can reach a hosted project. No credentials are printed."""
from __future__ import annotations
import concurrent.futures, json, secrets, threading, uuid
from b2c_auth_concurrency import ensure, local_status, request, sql, denied

def make_user(api, anon, label):
    email = f"fftt-gd-{label}-{uuid.uuid4().hex[:12]}@example.test"
    password = secrets.token_urlsafe(24)
    r = request(api, anon, "POST", "/auth/v1/signup", body={"email": email, "password": password})
    ensure(r.code in (200, 201), f"{label} account created in the LOCAL auth server")
    uid = str(uuid.UUID(r.body["user"]["id"]))
    t = request(api, anon, "POST", "/auth/v1/token?grant_type=password", body={"email": email, "password": password})
    ensure(t.code == 200, f"{label} signed in")
    return uid, email, t.body["access_token"]

def run() -> None:
    api, anon, db = local_status()
    org_id, org_mail, org = make_user(api, anon, "organizer")
    a_id, a_mail, ka = make_user(api, anon, "scorekeeper-a")
    b_id, b_mail, kb = make_user(api, anon, "scorekeeper-b")
    o_id, o_mail, outsider = make_user(api, anon, "outsider")
    sql(db, f"insert into fftt_private.platform_organizers(user_id) values ('{org_id}')")

    def rpc(token, fn, body=None):
        return request(api, anon, "POST", "/rest/v1/rpc/" + fn, token=token, body=body or {})
    def ok(r, what):
        ensure(r.code == 200, f"{what} (HTTP {r.code})")
        return r.body

    ensure(denied(rpc(outsider, "fftt_create_event_v3", {"p_name": "X", "p_date": "2026-12-01", "p_table_count": 2})), "A non-platform account cannot create events")
    ensure(denied(rpc(None, "fftt_my_events_v3")), "Anonymous callers cannot list events")
    ev = ok(rpc(org, "fftt_create_event_v3", {"p_name": "Signed HTTP Rehearsal", "p_date": "2026-11-22", "p_table_count": 3}), "Organizer created an event")
    E = ev["event_id"]
    for mail in (a_mail, b_mail):
        ok(rpc(org, "fftt_set_staff_v3", {"p_event_id": E, "p_email": mail, "p_action": "grant", "p_role": "scorekeeper"}), "Organizer granted a scorekeeper by e-mail")
    ensure(denied(rpc(ka, "fftt_set_staff_v3", {"p_event_id": E, "p_email": o_mail, "p_action": "grant", "p_role": "organizer"})), "A scorekeeper cannot grant access")
    ensure(denied(rpc(outsider, "fftt_organizer_snapshot_v3", {"p_event_id": E})), "Outsider cannot read the organizer snapshot")
    ensure(denied(rpc(ka, "fftt_organizer_snapshot_v3", {"p_event_id": E})), "A scorekeeper cannot read the organizer snapshot (internal ratings)")

    names = [f"Fictional Player {chr(65 + i)}" for i in range(13)]
    ok(rpc(org, "fftt_upsert_players_v3", {"p_event_id": E, "p_players": [{"name": n, "rating": 1 + i % 5, "rating_status": "provisional"} for i, n in enumerate(names)]}), "Roster added")
    ensure(not denied(rpc(org, "fftt_set_checkin_bulk_v3", {"p_event_id": E, "p_player_ids": None, "p_checked_in": True})), "Bulk check-in")
    snap = ok(rpc(org, "fftt_organizer_snapshot_v3", {"p_event_id": E}), "Organizer snapshot")
    ids = [p["id"] for p in snap["players"]]
    ensure(len(ids) == 13 and all(p["checked_in"] for p in snap["players"]), "13 players checked in")

    def layout(player_ids):
        n = len(player_ids); size = 1
        while size < n: size *= 2
        byes = size - n; slots = [None] * size; it = iter(player_ids); nulls = 0
        for i in range(size):
            if i % 2 == 1 and nulls < byes: nulls += 1; continue
            slots[i] = next(it)
        return slots
    built = ok(rpc(org, "fftt_build_championship_v3", {"p_event_id": E, "p_slots": layout(ids), "p_expected_generation": 0, "p_confirm": False}), "Championship built by the server")
    ensure(built["generation"] == 1, "Generation 1")
    ensure(denied(rpc(org, "fftt_build_championship_v3", {"p_event_id": E, "p_slots": layout(ids), "p_expected_generation": 1, "p_confirm": False})), "Rebuild needs explicit confirmation")

    def desk(token): return ok(rpc(token, "fftt_matchdesk_v1", {"p_event_id": E}), "Match Desk")
    def score(token, row, winner_first, label=""):
        w = row["player_1_id"] if winner_first else row["player_2_id"]
        g = ("11-5, 11-6, 11-7" if row["is_championship_final"] else "11-7, 11-9") if winner_first else ("5-11, 6-11, 7-11" if row["is_championship_final"] else "7-11, 9-11")
        return rpc(token, "fftt_submit_match_result_v2", {"p_event_id": E, "p_match_id": row["match_id"], "p_bracket_generation": row["bracket_generation"],
            "p_expected_match_version": row["match_version"], "p_submission_id": str(uuid.uuid4()), "p_winner_id": w, "p_game_scores": g, "p_table_number": 1})

    def play_round(bracket):
        total = 0
        while True:
            rows = [r for r in desk(ka) if r["bracket"] == bracket]
            if not rows: return total
            barrier = threading.Barrier(2 * len(rows))
            def attempt(token, row, first):
                barrier.wait(timeout=20)
                return score(token, row, first)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2 * len(rows)) as pool:
                futs = [(i, pool.submit(attempt, ka, r, True)) for i, r in enumerate(rows)] + [(i, pool.submit(attempt, kb, r, False)) for i, r in enumerate(rows)]
                res = {}
                for i, f in futs: res.setdefault(i, []).append(f.result(timeout=40))
            for i, pair in res.items():
                statuses = sorted(x.body.get("status") for x in pair if x.code == 200)
                ensure(statuses == ["accepted", "rejected"], f"Match {i}: two simultaneous scorekeepers give exactly one accepted and one durable rejection ({statuses})")
                total += 1
    n1 = play_round("championship")
    ensure(n1 >= 12, f"Championship played to a champion ({n1} matches, concurrent scorekeepers)")
    snap = ok(rpc(org, "fftt_organizer_snapshot_v3", {"p_event_id": E}), "Snapshot after championship")
    ensure(all(b["status"] == "complete" for b in snap["brackets"]), "Championship complete, progression correct")
    cands = [c["player_id"] for c in snap["consolation_candidates"]]
    ensure(len(cands) >= 2, f"{len(cands)} consolation candidates")
    ok(rpc(org, "fftt_build_consolation_v3", {"p_event_id": E, "p_slots": layout(cands), "p_expected_generation": 1, "p_confirm": False}), "Consolation built")
    play_round("consolation")
    snap = ok(rpc(org, "fftt_organizer_snapshot_v3", {"p_event_id": E}), "Snapshot after consolation")
    ensure(all(b["status"] == "complete" for b in snap["brackets"]), "Both brackets complete")

    final = next(m for m in snap["matches"] if m["is_final"])
    placed = [c["player_id"] for c in snap["consolation_candidates"] if c["state"] == "placed" and c["player_id"] not in (final["player_1_id"], final["player_2_id"])]
    ok(rpc(org, "fftt_set_doubles_teams_v3", {"p_event_id": E, "p_partner_1": placed[0], "p_partner_2": placed[1]}), "Doubles teams set")
    ok(rpc(ka, "fftt_record_doubles_result_v3", {"p_event_id": E, "p_winner_team": 1, "p_game_scores": "11-8, 9-11, 11-7"}), "Doubles result recorded")

    ensure(request(api, anon, "GET", "/rest/v1/fftt_public_tournament_v1").body == [], "Nothing is public until the organizer publishes")
    ok(rpc(org, "fftt_set_visibility_v3", {"p_event_id": E, "p_visible": True}), "Published")
    pub = request(api, anon, "GET", "/rest/v1/fftt_public_tournament_v1")
    ensure(pub.code == 200 and len(pub.body) == 1 and pub.body[0]["finale"]["status"] == "complete", "Anonymous spectators read the published tournament")
    blob = json.dumps(pub.body)
    ensure(not any(p["id"] in blob for p in snap["players"]) and E not in blob and "rating" not in blob and "@" not in blob, "Public data carries no private ids, ratings or contacts")
    ensure(denied(request(api, anon, "GET", "/rest/v1/players", token=kb)) and denied(request(api, anon, "GET", "/rest/v1/platform_organizers", token=org)), "No private tables are exposed, even to signed-in staff")

    accepted = int(sql(db, f"select count(*) from fftt_private.audit_events where event_id='{E}' and operation='result_accepted'"))
    done = sum(1 for m in snap["matches"] if m["status"] == "complete")
    ensure(accepted == done, f"Audit has exactly one accepted-result entry per completed match ({accepted} == {done})")

    ok(rpc(org, "fftt_set_staff_v3", {"p_event_id": E, "p_email": b_mail, "p_action": "revoke", "p_role": None}), "Scorekeeper B revoked")
    ensure(denied(rpc(kb, "fftt_matchdesk_v1", {"p_event_id": E})), "Revoked scorekeeper is denied at once, with the same still-valid JWT")
    ensure(ok(rpc(org, "fftt_set_lifecycle_v3", {"p_event_id": E, "p_lifecycle": "complete"}), "Completed")["lifecycle"] == "complete", "Event completed")
    print("ALL GAME-DAY SIGNED HTTP CHECKS PASSED", flush=True)

if __name__ == "__main__":
    run()
