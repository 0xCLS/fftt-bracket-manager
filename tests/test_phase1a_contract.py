"""FFTT Phase 1A contract tests: SYNTHETIC in-memory reference, not production backend.

Deliberately does not import index.html or connect to a database. Future Supabase
adapters must pass equivalent integration/security tests against real RLS + RPC.
"""
from __future__ import annotations

import copy
import json
import re
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

CONTRACT = json.loads((Path(__file__).resolve().parent.parent / "contracts" / "phase1a_v1.json").read_text(encoding="utf-8"))

class Rejected(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

class ReferenceEvent:
    """Small serializable reference state machine for synthetic contract checks."""
    def __init__(self):
        self.lock = threading.Lock()
        self.event_id = "synthetic-only-event"
        self.generation = 1
        self.revision = 0
        self.connected = True
        self.grants = {"organizer-test": "organizer", "volunteer-one": "scorekeeper", "volunteer-two": "scorekeeper"}
        self.players = {
            "p1": {"name": "Synthetic Ada", "rating": 5, "ratingStatus": "established", "checkedIn": True},
            "p2": {"name": "Synthetic Ben", "rating": 2, "ratingStatus": "provisional", "checkedIn": True},
            "p3": {"name": "Synthetic Cara", "rating": 4, "ratingStatus": "provisional", "checkedIn": True},
            "p4": {"name": "Synthetic Dax", "rating": 3, "ratingStatus": "established", "checkedIn": True},
        }
        self.matches = {
            "C-0-0": self.match(0, 0, "p1", "p2", False),
            "C-0-1": self.match(0, 1, "p3", "p4", False),
            "C-1-0": self.match(1, 0, None, None, True),
        }
        self.receipts = {}
        self.audit = []
        self.first_losses = set()

    @staticmethod
    def match(round_number, slot, p1, p2, is_final):
        return dict(round=round_number, slot=slot, p1=p1, p2=p2,
                    is_final=is_final, version=0, resolved=False, winner=None,
                    game_scores="", table_number=None)

    def require(self, actor, permission):
        role = self.grants.get(actor)
        if not role or permission not in CONTRACT["role_permissions"][role]:
            raise Rejected("forbidden")
        return role

    def game_score(self, match, winner, raw):
        if raw == "":
            return ""
        if not isinstance(raw, str):
            raise Rejected("validation_error")
        best = 5 if match["is_final"] else 3
        needed = (best + 1) // 2
        games = [s.strip() for s in raw.split(",")]
        if not needed <= len(games) <= best:
            raise Rejected("validation_error")
        wins = [0, 0]
        output = []
        for i, game in enumerate(games):
            parts = re.fullmatch(r"(\d+)\s*[-–—]\s*(\d+)", game)
            if not parts:
                raise Rejected("validation_error")
            a, b = (int(x) for x in parts.groups())
            high, low = max(a, b), min(a, b)
            if high < 11 or high - low < 2 or (high > 11 and high - low != 2):
                raise Rejected("validation_error")
            wins[0 if a > b else 1] += 1
            if i < len(games) - 1 and max(wins) >= needed:
                raise Rejected("validation_error")
            output.append(f"{a}-{b}")
        expected_winner_index = 0 if winner == match["p1"] else 1
        if wins[expected_winner_index] != needed or wins[1 - expected_winner_index] >= needed:
            raise Rejected("validation_error")
        return ", ".join(output)

    def submit(self, actor, match_id, winner, game_scores="", submission_id="request-1",
               expected_match_version=0, bracket_generation=1, event_id="synthetic-only-event",
               table_number=1):
        with self.lock:
            self.require(actor, "match.submit")
            if not self.connected:
                raise Rejected("offline")
            if event_id != self.event_id or not isinstance(submission_id, str) or not submission_id:
                raise Rejected("validation_error")
            payload = (event_id, match_id, winner, game_scores, expected_match_version,
                       bracket_generation, table_number)
            key = (event_id, actor, submission_id)
            if key in self.receipts:
                existing, response = self.receipts[key]
                if existing != payload:
                    raise Rejected("submission_id_reused")
                return copy.deepcopy(response)
            if bracket_generation != self.generation:
                raise Rejected("stale_generation")
            match = self.matches.get(match_id)
            if match is None:
                raise Rejected("not_found")
            if match["version"] != expected_match_version or match["resolved"]:
                raise Rejected("conflict")
            if winner not in (match["p1"], match["p2"]) or not match["p1"] or not match["p2"]:
                raise Rejected("validation_error")
            if type(table_number) is not int or table_number < 1 or table_number > 12:
                raise Rejected("validation_error")
            score = self.game_score(match, winner, game_scores)
            loser = match["p2"] if winner == match["p1"] else match["p1"]
            match.update(resolved=True, winner=winner, game_scores=score,
                         table_number=table_number, version=match["version"] + 1)
            if match["round"] == 0:
                self.first_losses.add(loser)
                downstream = self.matches["C-1-0"]
                downstream["p1" if match["slot"] == 0 else "p2"] = winner
                downstream["version"] += 1
            self.revision += 1
            self.audit.append({"actor": actor, "kind": "result", "match_id": match_id, "revision": self.revision})
            response = {"status": "accepted", "match_id": match_id,
                        "match_version": match["version"], "event_revision": self.revision}
            self.receipts[key] = (payload, copy.deepcopy(response))
            return response

    def correct(self, actor, match_id, expected_match_version, winner, score, reason, bracket_generation=1):
        with self.lock:
            self.require(actor, "match.correct")
            if not self.connected:
                raise Rejected("offline")
            if bracket_generation != self.generation:
                raise Rejected("stale_generation")
            if not isinstance(reason, str) or not reason.strip():
                raise Rejected("reason_required")
            m = self.matches.get(match_id)
            if not m or not m["resolved"] or m["version"] != expected_match_version:
                raise Rejected("conflict")
            if winner not in (m["p1"], m["p2"]):
                raise Rejected("validation_error")
            validated = self.game_score(m, winner, score)
            if m["round"] == 0 and self.matches["C-1-0"]["resolved"]:
                raise Rejected("dependent_results_exist")
            previous = copy.deepcopy(m)
            m.update(winner=winner, game_scores=validated, version=m["version"] + 1)
            if m["round"] == 0:
                downstream = self.matches["C-1-0"]
                downstream["p1" if m["slot"] == 0 else "p2"] = winner
                downstream["version"] += 1
                old_loser = previous["p2"] if previous["winner"] == previous["p1"] else previous["p1"]
                new_loser = m["p2"] if winner == m["p1"] else m["p1"]
                self.first_losses.discard(old_loser)
                self.first_losses.add(new_loser)
            self.revision += 1
            self.audit.append({"actor": actor, "kind": "correction", "match_id": match_id,
                               "old_winner": previous["winner"], "new_winner": winner,
                               "reason": reason.strip(), "revision": self.revision})
            return {"status": "corrected", "event_revision": self.revision}

    def public(self):
        return {"event_id": "public-synthetic-event", "event_name": "Synthetic FFTT Rehearsal",
                "event_date": "2099-01-01", "status": "in_progress",
                "updated_at": "2099-01-01T00:00:00Z",
                "brackets": [
                    {"name": "championship",
                     "matches": [
                         {"match_id": mid, "bracket": "championship", "round": m["round"],
                          "slot": m["slot"],
                          "player_1_name": self.players[m["p1"]]["name"] if m["p1"] else None,
                          "player_2_name": self.players[m["p2"]]["name"] if m["p2"] else None,
                          "winner_name": self.players[m["winner"]]["name"] if m["winner"] else None,
                          "game_scores": m["game_scores"],
                          "status": "complete" if m["resolved"] else "pending"}
                         for mid, m in self.matches.items()]}]}

def submit_ok(event, actor, mid, winner, **kwargs):
    return event.submit(actor, mid, winner, **kwargs)

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.event = ReferenceEvent()

    def assert_rejected(self, code, callback):
        before = (self.event.revision, copy.deepcopy(self.event.matches), copy.deepcopy(self.event.audit))
        with self.assertRaises(Rejected) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)
        self.assertEqual((self.event.revision, self.event.matches, self.event.audit), before)

    def test_contract_is_design_only_and_roles_are_least_privilege(self):
        self.assertEqual(CONTRACT["status"], "design-and-synthetic-tests-only")
        roles = CONTRACT["role_permissions"]
        self.assertEqual(set(roles["spectator"]), {"event.read_public"})
        self.assertEqual(roles["tv"], roles["spectator"])
        self.assertNotIn("player.manage", roles["scorekeeper"])
        self.assertNotIn("event.read_private", roles["scorekeeper"])
        self.assertIn("match.correct", roles["organizer"])
        self.assertEqual(CONTRACT["authority"]["offline"].startswith("reject cloud writes"), True)

    def test_unauthorized_or_revoked_staff_cannot_write(self):
        self.assert_rejected("forbidden", lambda: submit_ok(self.event, "anonymous", "C-0-0", "p1"))
        self.assert_rejected("forbidden", lambda: submit_ok(self.event, "intruder", "C-0-0", "p1"))
        del self.event.grants["volunteer-one"]
        self.assert_rejected("forbidden", lambda: submit_ok(self.event, "volunteer-one", "C-0-0", "p1"))

    def test_idempotent_retry_and_payload_tampering(self):
        first = submit_ok(self.event, "volunteer-one", "C-0-0", "p1", submission_id="stable-uuid")
        self.assertEqual(first["status"], "accepted")
        self.assertEqual(first, submit_ok(self.event, "volunteer-one", "C-0-0", "p1", submission_id="stable-uuid"))
        self.assertEqual(self.event.revision, 1)
        self.assertEqual(len(self.event.audit), 1)
        self.assert_rejected("submission_id_reused", lambda: submit_ok(self.event, "volunteer-one", "C-0-0", "p2", submission_id="stable-uuid"))
        del self.event.grants["volunteer-one"]
        self.assert_rejected("forbidden", lambda: submit_ok(self.event, "volunteer-one", "C-0-0", "p1", submission_id="stable-uuid"))

    def test_competing_scorekeepers_only_one_accepted(self):
        def attempt(actor, winner):
            try:
                return submit_ok(self.event, actor, "C-0-0", winner, submission_id=actor)
            except Rejected as ex:
                return ex.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda x: attempt(*x),
                                     [("volunteer-one", "p1"), ("volunteer-two", "p2")]))
        self.assertEqual(sum(isinstance(x, dict) for x in outcomes), 1)
        self.assertEqual(outcomes.count("conflict"), 1)
        self.assertEqual(self.event.revision, 1)

    def test_generation_and_event_identity_are_checked(self):
        self.assert_rejected("stale_generation", lambda: submit_ok(self.event, "volunteer-one", "C-0-0", "p1", bracket_generation=0))
        self.assert_rejected("validation_error", lambda: submit_ok(self.event, "volunteer-one", "C-0-0", "p1", event_id="other-event"))
        self.assert_rejected("validation_error", lambda: submit_ok(self.event, "volunteer-one", "C-0-0", "not-a-participant"))
        self.assert_rejected("validation_error", lambda: submit_ok(self.event, "volunteer-one", "C-0-0", "p1", table_number=0))

    def test_score_validation_and_blank_winner_only_results(self):
        for score, winner in [("banana", "p1"), ("11-10, 11-8", "p1"),
                              ("12-9, 11-8", "p1"), ("11-8, 11-7, 11-2", "p1"),
                              ("11-8, 11-8", "p2")]:
            self.assert_rejected("validation_error", lambda s=score, w=winner: submit_ok(self.event, "volunteer-one", "C-0-0", w, game_scores=s))
        accepted = submit_ok(self.event, "volunteer-one", "C-0-0", "p1", game_scores="11-8, 8-11, 12-10")
        self.assertEqual(accepted["status"], "accepted")
        self.assertEqual(self.event.matches["C-0-0"]["game_scores"], "11-8, 8-11, 12-10")
        self.assertEqual(submit_ok(self.event, "volunteer-one", "C-0-1", "p3", submission_id="blank")["status"], "accepted")

    def test_advancement_first_loss_and_championship_final(self):
        submit_ok(self.event, "volunteer-one", "C-0-0", "p1")
        submit_ok(self.event, "volunteer-two", "C-0-1", "p3", submission_id="second-match")
        self.assertEqual(self.event.matches["C-1-0"]["p1"], "p1")
        self.assertEqual(self.event.matches["C-1-0"]["p2"], "p3")
        self.assertEqual(self.event.first_losses, {"p2", "p4"})
        self.assert_rejected("validation_error", lambda: submit_ok(self.event, "volunteer-one", "C-1-0", "p1", game_scores="11-5, 11-5", expected_match_version=2, submission_id="final-short"))
        self.assertEqual(submit_ok(self.event, "volunteer-one", "C-1-0", "p1", game_scores="11-5, 11-5, 11-5", expected_match_version=2, submission_id="final")["status"], "accepted")

    def test_correct_requires_organizer_reason_and_safe_downstream(self):
        submit_ok(self.event, "volunteer-one", "C-0-0", "p1")
        self.assert_rejected("forbidden", lambda: self.event.correct("volunteer-one", "C-0-0", 1, "p2", "", "typo"))
        self.assert_rejected("reason_required", lambda: self.event.correct("organizer-test", "C-0-0", 1, "p2", "", ""))
        self.assertEqual(self.event.correct("organizer-test", "C-0-0", 1, "p2", "", "wrong winner")["status"], "corrected")
        self.assertEqual(self.event.matches["C-1-0"]["p1"], "p2")
        self.assertEqual(self.event.first_losses, {"p1"})
        self.assertEqual(self.event.audit[-1]["reason"], "wrong winner")
        submit_ok(self.event, "volunteer-two", "C-0-1", "p3", submission_id="second")
        submit_ok(self.event, "volunteer-one", "C-1-0", "p2", expected_match_version=3, submission_id="final")
        self.assert_rejected("dependent_results_exist", lambda: self.event.correct("organizer-test", "C-0-0", 2, "p1", "", "new observation"))

    def test_public_projection_allowlist_and_privacy(self):
        public = self.event.public()
        self.assertEqual(set(public), set(CONTRACT["public_event_fields"]))
        match_fields = set(CONTRACT["public_match_fields"])
        for bracket in public["brackets"]:
            for match in bracket["matches"]:
                self.assertEqual(set(match), match_fields)
        serialized = json.dumps(public)
        for forbidden in CONTRACT["prohibited_public_fields"]:
            self.assertNotIn(f'"{forbidden}"', serialized)
        self.assertNotIn('"p1"', serialized)
        self.assertNotIn('"5"', serialized)

    def test_offline_rejects_writes_without_queueing(self):
        self.event.connected = False
        self.assert_rejected("offline", lambda: submit_ok(self.event, "volunteer-one", "C-0-0", "p1"))
        self.assertEqual(len(self.event.receipts), 0)
        self.event.connected = True
        self.assertEqual(submit_ok(self.event, "volunteer-one", "C-0-0", "p1")["status"], "accepted")

if __name__ == "__main__":
    unittest.main()
