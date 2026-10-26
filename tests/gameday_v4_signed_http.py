#!/usr/bin/env python3
"""Game-day V4: match formats, registration check-in, archive/restore and guarded deletion over REAL local Supabase
(GoTrue + PostgREST + PostgreSQL) with real concurrent connections. Run only on a freshly started local stack with V2,
V3 and V4 applied. Fictional accounts and data only; nothing here can reach a hosted project. No credentials printed."""
from __future__ import annotations
import concurrent.futures, json, secrets, threading, uuid
from b2c_auth_concurrency import ensure, local_status, request, sql, denied
from gameday_signed_http import make_user

def run() -> None:
    api, anon, db = local_status()
    org_id, org_mail, org = make_user(api, anon, "v4-organizer")
    a_id, a_mail, ka = make_user(api, anon, "v4-scorekeeper-a")
    b_id, b_mail, kb = make_user(api, anon, "v4-scorekeeper-b")
    o_id, o_mail, outsider = make_user(api, anon, "v4-outsider")
    sql(db, f"insert into fftt_private.platform_organizers(user_id) values ('{org_id}')")

    def rpc(token, fn, body=None):
        return request(api, anon, "POST", "/rest/v1/rpc/" + fn, token=token, body=body or {})
    def ok(r, what):
        ensure(r.code == 200, f"{what} (HTTP {r.code})")
        return r.body

    ev = ok(rpc(org, "fftt_create_event_v3", {"p_name": "Signed HTTP V4", "p_date": "2026-11-22", "p_table_count": 3}), "Event created")
    E = ev["event_id"]
    for mail in (a_mail, b_mail):
        ok(rpc(org, "fftt_set_staff_v3", {"p_event_id": E, "p_email": mail, "p_action": "grant", "p_role": "scorekeeper"}), "Scorekeeper granted")

    # ---- formats: Best of 5 and odd points are refused; the approved choices are accepted; scorekeepers cannot change them
    for bad in ({"champ": {"best_of": 5, "points": 11}}, {"cons": {"best_of": 3, "points": 15}}, {"x": {"best_of": 1, "points": 11}}, {}):
        ensure(rpc(org, "fftt_set_formats_v4", {"p_event_id": E, "p_formats": bad}).code == 400, f"format {json.dumps(bad)} is refused")
    ensure(denied(rpc(ka, "fftt_set_formats_v4", {"p_event_id": E, "p_formats": {"cons": {"best_of": 3, "points": 21}}})), "A scorekeeper cannot change formats")
    ensure(denied(rpc(outsider, "fftt_set_formats_v4", {"p_event_id": E, "p_formats": {"cons": {"best_of": 3, "points": 21}}})), "An outsider cannot change formats")
    ok(rpc(org, "fftt_set_formats_v4", {"p_event_id": E, "p_formats": {"champ_final": {"best_of": 3, "points": 21}}}), "Final set to Best of 3 to 21")

    # ---- registration: check-in by opaque reference, merge a duplicate, a walk-in; no contact detail is accepted
    refs = [("REGREF" + str(i).zfill(12) + "abcd") for i in range(13)]
    regs = [{"ref": refs[i], "name": f"Fictional Player {chr(65 + i)}", "rating": 1 + i % 5, "rating_status": "provisional", "source": "registration"} for i in range(12)]
    ensure(rpc(org, "fftt_checkin_registrants_v4", {"p_event_id": E, "p_registrants": [{**regs[0], "email": "x@example.test"}]}).code == 400, "A contact field is refused")
    ensure(rpc(org, "fftt_checkin_registrants_v4", {"p_event_id": E, "p_registrants": [{**regs[0], "name": "x@example.test"}]}).code == 400, "A name that is an e-mail is refused")
    ensure(denied(rpc(ka, "fftt_checkin_registrants_v4", {"p_event_id": E, "p_registrants": regs[:1]})), "A scorekeeper cannot check in registrants")
    r = ok(rpc(org, "fftt_checkin_registrants_v4", {"p_event_id": E, "p_registrants": regs}), "Bulk registration check-in")
    ensure(r["created"] == 12 and r["changed"] == 12, "Twelve players created and checked in")
    merged = ok(rpc(org, "fftt_checkin_registrants_v4", {"p_event_id": E, "p_registrants": [{"ref": refs[12], "name": "Fictional Player A", "rating": 3, "source": "registration", "same_as_ref": refs[0]}]}), "Duplicate merged")
    ensure(merged["created"] == 0 and merged["linked"] == 1, "A duplicate registration is merged into the same player, nothing created")
    ok(rpc(org, "fftt_checkin_registrants_v4", {"p_event_id": E, "p_registrants": [{"name": "Fictional Walk In", "rating": 3, "source": "walk_in"}]}), "Walk-in checked in")
    snap = ok(rpc(org, "fftt_organizer_snapshot_v3", {"p_event_id": E}), "Snapshot")
    ensure(len(snap["players"]) == 13 and snap["event"]["formats"]["champ_final"] == {"best_of": 3, "points": 21}, "Roster and formats are in the snapshot")
    ensure(any(len(p["registration_refs"]) == 2 for p in snap["players"]), "The merged player holds both references")
    ensure(int(sql(db, f"select count(*) from information_schema.columns where table_schema='fftt_private' and table_name='players' and column_name ~* 'mail|phone|contact'")) == 0, "No contact column exists")
    ids = [p["id"] for p in snap["players"]]
    ok(rpc(org, "fftt_confirm_ratings_v4", {"p_event_id": E, "p_items": [{"id": p["id"], "rating": p["rating"]} for p in snap["players"]]}), "Ratings confirmed")

    def layout(player_ids):
        n = len(player_ids); size = 1
        while size < n: size *= 2
        byes = size - n; slots = [None] * size; it = iter(player_ids); nulls = 0
        for i in range(size):
            if i % 2 == 1 and nulls < byes: nulls += 1; continue
            slots[i] = next(it)
        return slots
    ok(rpc(org, "fftt_build_championship_v3", {"p_event_id": E, "p_slots": layout(ids), "p_expected_generation": 0, "p_confirm": False}), "Championship built")

    def desk(token): return ok(rpc(token, "fftt_matchdesk_v2", {"p_event_id": E}), "Match Desk v2")
    def win_text(row, first):
        bo, pts = row["best_of"], row["points_to_win"]
        games = [(pts, pts - 4), (pts, pts - 2), (pts, pts - 6)][: (bo + 1) // 2]
        return ", ".join(f"{a}-{b}" if first else f"{b}-{a}" for a, b in games)
    def score(token, row, first, text=None):
        w = row["player_1_id"] if first else row["player_2_id"]
        return rpc(token, "fftt_submit_match_result_v2", {"p_event_id": E, "p_match_id": row["match_id"], "p_bracket_generation": row["bracket_generation"],
            "p_expected_match_version": row["match_version"], "p_submission_id": str(uuid.uuid4()), "p_winner_id": w,
            "p_game_scores": text or win_text(row, first), "p_table_number": 1})

    rows = desk(ka)
    ensure(all(r["best_of"] == 3 and r["points_to_win"] == 11 for r in rows), "Championship rounds default to Best of 3 to 11")
    # a wrong-format score is refused with a validation error and records nothing
    bad = score(ka, rows[0], True, "11-5")
    ensure(bad.code == 400, "A one-game score for a Best of 3 is refused")
    ensure(int(sql(db, f"select count(*) from fftt_private.result_submissions where event_id='{E}'")) == 0, "A refused score recorded nothing")
    # per-match override, then the matching score is accepted
    one = rows[0]
    ok(rpc(org, "fftt_set_match_format_v4", {"p_event_id": E, "p_match_id": one["match_id"], "p_best_of": 1, "p_points": 21}), "Match overridden to Best of 1 to 21")
    ensure(denied(rpc(ka, "fftt_set_match_format_v4", {"p_event_id": E, "p_match_id": one["match_id"], "p_best_of": 3, "p_points": 11})), "A scorekeeper cannot override a format")
    fresh = next(r for r in desk(ka) if r["match_id"] == one["match_id"])
    ensure(fresh["match_version"] == one["match_version"] and fresh["best_of"] == 1 and fresh["points_to_win"] == 21, "Override keeps the match version")
    ensure(score(ka, fresh, True, "21-15").code == 200, "A Best of 1 to 21 score is accepted")
    ensure(rpc(org, "fftt_set_match_format_v4", {"p_event_id": E, "p_match_id": one["match_id"], "p_best_of": 3, "p_points": 11}).code == 400, "A recorded match's format is locked")

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
                ensure(statuses == ["accepted", "rejected"], f"Match {i}: two simultaneous scorekeepers give one accepted and one durable rejection ({statuses})")
                total += 1
    play_round("championship")
    snap = ok(rpc(org, "fftt_organizer_snapshot_v3", {"p_event_id": E}), "Snapshot after championship")
    final = next(m for m in snap["matches"] if m["is_final"])
    ensure([final["best_of"], final["points"], final["format_legacy"]] == [3, 21, False], "The final was played as Best of 3 to 21")
    cands = [c["player_id"] for c in snap["consolation_candidates"]]
    ok(rpc(org, "fftt_build_consolation_v3", {"p_event_id": E, "p_slots": layout(cands), "p_expected_generation": 1, "p_confirm": False}), "Consolation built")
    crows = [r for r in desk(ka) if r["bracket"] == "consolation"]
    ensure(crows and all(r["best_of"] == 1 and r["points_to_win"] == 21 for r in crows), "Consolation defaults to Best of 1 to 21")
    play_round("consolation")
    snap = ok(rpc(org, "fftt_organizer_snapshot_v3", {"p_event_id": E}), "Snapshot after consolation")
    ensure(all(b["status"] == "complete" for b in snap["brackets"]), "Both brackets complete")
    ensure(rpc(org, "fftt_set_formats_v4", {"p_event_id": E, "p_formats": {"cons": {"best_of": 3, "points": 11}}}).code == 400, "A played category is locked at event level")

    # ---- public view carries formats and nothing private
    ok(rpc(org, "fftt_set_visibility_v3", {"p_event_id": E, "p_visible": True}), "Published")
    pub = request(api, anon, "GET", "/rest/v1/fftt_public_tournament_v1")
    ensure(pub.code == 200 and len(pub.body) == 1, "Anonymous spectators read the tournament")
    matches = [m for b in pub.body[0]["brackets"] for m in b["matches"] if m["status"] == "complete"]
    ensure(matches and all(m["best_of"] in (1, 3) and m["points_to_win"] in (11, 21) for m in matches), "Public matches carry their formats")
    blob = json.dumps(pub.body)
    ensure("REGREF" not in blob and "registration" not in blob and "@" not in blob and "rating" not in blob, "Public data carries no registration data, ratings or contacts")

    # ---- archive -> restore (never public); deletion only for an empty draft
    ok(rpc(org, "fftt_set_lifecycle_v3", {"p_event_id": E, "p_lifecycle": "archived"}), "Archived")
    ensure(request(api, anon, "GET", "/rest/v1/fftt_public_tournament_v1").body == [], "An archived event is not public")
    restored = ok(rpc(org, "fftt_restore_event_v4", {"p_event_id": E}), "Restored")
    ensure(restored["lifecycle"] == "active", "Restored to the state it came from")
    ensure(request(api, anon, "GET", "/rest/v1/fftt_public_tournament_v1").body == [], "A restore does not re-publish")
    ensure(rpc(org, "fftt_delete_event_v4", {"p_event_id": E, "p_confirm_name": "Signed HTTP V4"}).code in (400, 409), "An event with results can never be deleted")
    spare = ok(rpc(org, "fftt_create_event_v3", {"p_name": "Spare Draft", "p_date": "2026-12-01", "p_table_count": 2}), "Spare draft created")
    S = spare["event_id"]
    mine = ok(rpc(org, "fftt_my_events_v4"), "My events")
    ensure(next(e for e in mine if e["event_id"] == S)["deletable"] is True and next(e for e in mine if e["event_id"] == E)["deletable"] is False, "Only the empty draft is deletable")
    ensure(denied(rpc(ka, "fftt_delete_event_v4", {"p_event_id": S, "p_confirm_name": "Spare Draft"})), "A scorekeeper cannot delete")
    ensure(rpc(org, "fftt_delete_event_v4", {"p_event_id": S, "p_confirm_name": "spare draft"}).code == 400, "The name must match exactly")
    ensure(ok(rpc(org, "fftt_delete_event_v4", {"p_event_id": S, "p_confirm_name": "Spare Draft"}), "Deleted")["status"] == "deleted", "The empty draft was deleted")
    ensure(int(sql(db, f"select count(*) from fftt_private.deleted_events where event_id='{S}'")) == 1, "A tombstone keeps the deleted event's audit trail")
    ensure(int(sql(db, f"select count(*) from fftt_private.audit_events where event_id='{E}'")) > 10, "The real event's audit trail is intact")
    print("ALL GAME-DAY V4 SIGNED HTTP CHECKS PASSED", flush=True)

if __name__ == "__main__":
    run()
