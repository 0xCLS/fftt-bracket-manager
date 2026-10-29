"""B2i operator static hard-stop and pure payload guards, never hosted HTTP."""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

DIR = pathlib.Path(__file__).parent
for name in ("b2h_admin_magiclink_signed_auth", "b2i_hosted_race_oracle",
             "b2i_hosted_race_operator_DISABLED"):
    spec = importlib.util.spec_from_file_location(name, DIR / (name + ".py"))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
auth = sys.modules["b2h_admin_magiclink_signed_auth"]
oracle = sys.modules["b2i_hosted_race_oracle"]
op = sys.modules["b2i_hosted_race_operator_DISABLED"]

EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
MATCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ROW = {
    "event_id": EVENT, "match_id": MATCH,
    "match_code": "C-0-0", "match_version": 0,
    "bracket_generation": 1,
    "player_1_name": "Synthetic Fixture Alpha",
    "player_2_name": "Synthetic Fixture Beta",
    "player_1_id": "11111111-1111-4111-8111-111111111111",
    "player_2_id": "22222222-2222-4222-8222-222222222222",
}


class DisabledOperatorTests(unittest.TestCase):
    def test_source_static_execution_is_disabled(self):
        self.assertIs(op.HOSTED_SCORE_WRITES_ENABLED, False)

    def test_live_gate_never_opens(self):
        for text in ("", op.ONE_MATCH_APPROVAL_PHRASE):
            with self.subTest(text=text), self.assertRaises(oracle.RaceNotVerified):
                op.require_live_approval(text)

    def test_import_and_main_never_generate_tokens_or_network(self):
        with patch.object(auth, "http", side_effect=AssertionError("Auth call forbidden")):
            with self.assertRaises(oracle.RaceNotVerified):
                op.main()

    def test_score_submit_blocked_before_barrier_or_network(self):
        class DoNotCall:
            def wait(self, **kwargs):
                raise AssertionError("Cannot await/POST in disabled mode")
        with self.assertRaises(oracle.RaceNotVerified):
            op.submit_once("header.payload.signature", {}, op.ONE_MATCH_APPROVAL_PHRASE,
                           DoNotCall())

    def test_run_blocked_before_preflight_auth_or_http(self):
        with patch.object(auth, "preflight_users",
                          side_effect=AssertionError("No Auth Admin reads")):
            with self.assertRaises(oracle.RaceNotVerified):
                op.run_approved_one_match("sb_secret_NOT_REAL", "private@example.test",
                                          EVENT, MATCH, op.ONE_MATCH_APPROVAL_PHRASE)

    def test_valid_pure_matchdesk_preflight(self):
        op.verify_matchdesk_row(dict(ROW), EVENT, MATCH)

    def test_wrong_match_version_or_identity_rejected(self):
        for field, value in (("event_id", MATCH), ("match_id", EVENT),
                             ("match_code", "C-9-9"), ("match_version", 1),
                             ("bracket_generation", 2),
                             ("player_1_name", "Real Player")):
            with self.subTest(field=field), self.assertRaises(oracle.RaceNotVerified):
                row = dict(ROW)
                row[field] = value
                op.verify_matchdesk_row(row, EVENT, MATCH)

    def test_missing_or_duplicate_player_uuids_rejected(self):
        for bad in ("not-a-uuid", ROW["player_2_id"]):
            with self.subTest(bad=bad), self.assertRaises(oracle.RaceNotVerified):
                row = dict(ROW)
                row["player_1_id"] = bad
                op.verify_matchdesk_row(row, EVENT, MATCH)

    def test_two_incompatible_scores_unique_submissions(self):
        results = op.score_payloads(dict(ROW), EVENT, MATCH)
        self.assertEqual(set(results), {"SCOREKEEPER_A", "SCOREKEEPER_B"})
        a, b = results["SCOREKEEPER_A"], results["SCOREKEEPER_B"]
        for entry in (a, b):
            self.assertEqual(entry["p_bracket_generation"], 1)
            self.assertEqual(entry["p_expected_match_version"], 0)
            self.assertEqual(entry["p_table_number"], 1)
            self.assertEqual(entry["p_match_id"], MATCH)
            self.assertEqual(entry["p_event_id"], EVENT)
        self.assertEqual(a["p_game_scores"], "11-7, 11-8")
        self.assertEqual(b["p_game_scores"], "8-11, 7-11")
        self.assertEqual(a["p_winner_id"], ROW["player_1_id"])
        self.assertEqual(b["p_winner_id"], ROW["player_2_id"])
        self.assertNotEqual(a["p_submission_id"], b["p_submission_id"])

    def test_no_auto_retry_or_privilege_change_in_runner(self):
        content = (DIR / "b2i_hosted_race_operator_DISABLED.py").read_text()
        self.assertNotIn("fftt_manage_staff_v1", content)
        self.assertNotIn("auth/v1/admin/users/", content)
        self.assertNotIn("DELETE", content)
        self.assertNotIn("revoke_staff", content)
        self.assertNotIn("method=\"PUT\"", content)
        self.assertIn("HOSTED_SCORE_WRITES_ENABLED = False", content)
        self.assertIn("NO retries", content)


if __name__ == "__main__":
    unittest.main()
