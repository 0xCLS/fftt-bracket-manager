"""B2i approved operator: mock-only gates and exactly-two-call rehearsal tests.

No live network, admin key, token exchange, or score POST in these tests.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import threading
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).parent
for name in ("b2h_admin_magiclink_signed_auth", "b2i_hosted_race_oracle",
             "b2i_hosted_race_operator_APPROVED"):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
auth = sys.modules["b2h_admin_magiclink_signed_auth"]
oracle = sys.modules["b2i_hosted_race_oracle"]
app = sys.modules["b2i_hosted_race_operator_APPROVED"]

GOOD_EVENT = "fb5afc65-153e-4b50-9384-05128a818f84"
GOOD_MATCH = "ce7937eb-8925-4071-ae1a-41f323a8763a"
WRONG = "00000000-0000-4000-8000-000000000001"
ROW = {
    "event_id": GOOD_EVENT, "match_id": GOOD_MATCH,
    "bracket_generation": 1, "match_version": 0, "match_code": "C-0-0",
    "player_1_name": "Synthetic Fixture Alpha",
    "player_2_name": "Synthetic Fixture Beta",
    "player_1_id": "11111111-1111-4111-8111-111111111111",
    "player_2_id": "22222222-2222-4222-8222-222222222222",
}


class ApprovedOperatorTests(unittest.TestCase):
    def test_exact_limited_source_gate_and_auth_project(self):
        self.assertIs(app.HOSTED_SCORE_WRITES_ENABLED, True)
        self.assertEqual(app.EXECUTE_FLAG, "--execute-approved-one-match")
        self.assertEqual(app.auth.HOST, "https://copmkalfkkrkzheohwuc.supabase.co")

    def test_only_exact_private_fixture_is_allowed(self):
        self.assertEqual(app.validate_pinned_fixture(GOOD_EVENT, GOOD_MATCH),
                         (GOOD_EVENT, GOOD_MATCH))
        for event, match in ((WRONG, GOOD_MATCH), (GOOD_EVENT, WRONG),
                             (GOOD_MATCH, GOOD_EVENT), ("junk", GOOD_MATCH)):
            with self.subTest(event=event, match=match):
                with self.assertRaises((oracle.RaceNotVerified, auth.StopTest)):
                    app.validate_pinned_fixture(event, match)

    def test_missing_confirmation_phrase_stops(self):
        for p in ("", "yes", "RUN B2H SIGNED AUTH READONLY"):
            with self.subTest(p=p), self.assertRaises(oracle.RaceNotVerified):
                app.require_live_approval(p)
        app.require_live_approval(app.ONE_MATCH_APPROVAL_PHRASE)

    def test_default_main_dry_run_no_auth_no_http(self):
        with patch.object(sys, "argv", ["operator.py"]), patch.object(
             auth, "http", side_effect=AssertionError("Unexpected call")):
            app.main()

    def test_bad_fixture_stops_before_entering_secret(self):
        answers = iter(["organizer@example.test", GOOD_EVENT, WRONG])
        with patch.object(sys, "argv", ["operator.py", app.EXECUTE_FLAG]), \
             patch("builtins.input", side_effect=lambda *a: next(answers)), \
             patch.object(app.getpass, "getpass", side_effect=AssertionError("Key requested")), \
             patch.object(auth, "http", side_effect=AssertionError("network")):
            with self.assertRaises(oracle.RaceNotVerified):
                app.main()

    def test_missing_phrase_stops_before_entering_secret(self):
        answers = iter(["organizer@example.test", GOOD_EVENT, GOOD_MATCH, "not approved"])
        with patch.object(sys, "argv", ["operator.py", app.EXECUTE_FLAG]), \
             patch("builtins.input", side_effect=lambda *a: next(answers)), \
             patch.object(app.getpass, "getpass", side_effect=AssertionError("Key requested")), \
             patch.object(auth, "http", side_effect=AssertionError("network")):
            with self.assertRaises(oracle.RaceNotVerified):
                app.main()

    def test_score_submit_rejects_fake_token_without_http(self):
        barrier = threading.Barrier(1)
        with patch.object(app.urllib.request, "build_opener",
                          side_effect=AssertionError("NO network")):
            with self.assertRaises(oracle.RaceNotVerified):
                app.submit_once("invalid token", {}, app.ONE_MATCH_APPROVAL_PHRASE,
                                barrier)

    def test_only_two_competing_valid_score_payloads(self):
        payloads = app.score_payloads(dict(ROW), GOOD_EVENT, GOOD_MATCH)
        a, b = payloads["SCOREKEEPER_A"], payloads["SCOREKEEPER_B"]
        self.assertEqual(a["p_winner_id"], ROW["player_1_id"])
        self.assertEqual(b["p_winner_id"], ROW["player_2_id"])
        self.assertNotEqual(a["p_submission_id"], b["p_submission_id"])
        self.assertEqual(a["p_game_scores"], "11-7, 11-8")
        self.assertEqual(b["p_game_scores"], "8-11, 7-11")
        self.assertEqual(a["p_expected_match_version"], 0)
        self.assertEqual(b["p_expected_match_version"], 0)

    def test_mocked_two_client_race_emits_only_two_post_calls(self):
        calls = []
        def fake_send(jwt, payload, approval, barrier):
            calls.append((jwt, payload, approval))
            self.assertEqual(approval, app.ONE_MATCH_APPROVAL_PHRASE)
            return (200, "accepted") if jwt == "jwt-a" else (409, None)
        fake_uuids = {label: label for label in auth.ROLE_ORDER}
        tokens = {"ORGANIZER": "jwt-org", "SCOREKEEPER_A": "jwt-a",
                  "SCOREKEEPER_B": "jwt-b", "OUTSIDER": "jwt-outsider"}
        def fake_read(method, path, key, **kwargs):
            self.assertEqual(path, "/rest/v1/rpc/fftt_matchdesk_v1")
            return auth.Response(200, [dict(ROW)])
        with patch.object(auth, "preflight_users", return_value=fake_uuids), \
             patch.object(auth, "exchange_link", side_effect=lambda secret, label, email, user_id: tokens[label]), \
             patch.object(auth, "check_access", return_value=None), \
             patch.object(auth, "http", side_effect=fake_read), \
             patch.object(app, "submit_once", side_effect=fake_send):
            app.run_approved_one_match("sb_secret_local_mock", "organizer@example.test",
                                       GOOD_EVENT, GOOD_MATCH,
                                       app.ONE_MATCH_APPROVAL_PHRASE)
        self.assertEqual(len(calls), 2)
        self.assertEqual({x[0] for x in calls}, {"jwt-a", "jwt-b"})
        self.assertEqual({x[1]["p_submission_id"] for x in calls}.__len__(), 2)

    def test_ambiguous_mocked_race_causes_stop_not_replay(self):
        seen = []
        def fake_send(jwt, payload, approval, barrier):
            seen.append(jwt)
            return (503, None) if jwt == "jwt-a" else (200, "accepted")
        with patch.object(auth, "preflight_users", return_value={label: label for label in auth.ROLE_ORDER}), \
             patch.object(auth, "exchange_link", side_effect=lambda secret, label, email, user_id: "jwt-" + label), \
             patch.object(auth, "check_access", return_value=None), \
             patch.object(auth, "http", return_value=auth.Response(200, [dict(ROW)])), \
             patch.object(app, "submit_once", side_effect=fake_send):
            with self.assertRaises(oracle.RaceNotVerified):
                app.run_approved_one_match("sb_secret_local_mock", "organizer@example.test",
                                           GOOD_EVENT, GOOD_MATCH,
                                           app.ONE_MATCH_APPROVAL_PHRASE)
        self.assertEqual(len(seen), 2)

    def test_no_hosted_admin_write_or_result_reset(self):
        source = (HERE / "b2i_hosted_race_operator_APPROVED.py").read_text()
        self.assertEqual(source.count('SCORE_PATH = "/rest/v1/rpc/fftt_submit_match_result_v1"'), 1)
        for forbidden in ("fftt_manage_staff_v1", "TRUNCATE", "DELETE FROM",
                          "sb_secret_LOCAL_REAL_KEY", "service_role", "password_reset"):
            self.assertNotIn(forbidden, source)
        self.assertIn("POST-RACE SQL NOT YET VERIFIED", source)
        self.assertIn("PERSISTENCE", "PERSISTENCE")


if __name__ == "__main__":
    unittest.main()
