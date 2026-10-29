"""Zero-network safety checks for the ONE approved 2099 hosted V2 operator.

Never contacts Supabase, reads passwords, generates sessions, or sends scores.
"""
import inspect
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

import milestone1_v2_hosted_once as operator

SOURCE = pathlib.Path(operator.__file__).read_text(encoding="utf-8")


class HostedV2OperatorSafeguards(unittest.TestCase):
    def test_pins_new_fixture_not_consumed_b2i(self):
        self.assertEqual(len(operator.EVENT_DIGEST),64)
        self.assertEqual(len(operator.MATCH_DIGEST),64)
        self.assertNotEqual(operator.EVENT_DIGEST,operator.MATCH_DIGEST)
        self.assertNotIn("e3a03a5c037688c745116476122fca6c457c00e9925d41522f14930cd4a9f9b8",SOURCE)
        self.assertNotIn("7ef9cfc81a5b6bd7292a286a84085317c36d6b2a8c63014ab1b7ba8a94b419eb",SOURCE)
        with self.assertRaises(operator.Stop):
            operator.pin("11111111-1111-4111-8111-111111111111",operator.EVENT_DIGEST)

    def test_exact_approved_endpoint_and_no_legacy_score(self):
        self.assertEqual(operator.HOST,"https://copmkalfkkrkzheohwuc.supabase.co")
        self.assertEqual(operator.SCORE_RPC,"/rest/v1/rpc/fftt_submit_match_result_v2")
        self.assertEqual(operator.SNAP_RPC,"/rest/v1/rpc/fftt_score_decision_snapshot_v2")
        self.assertEqual(operator.ALLOWED_RPCS,frozenset((operator.SCORE_RPC,operator.SNAP_RPC)))
        self.assertNotIn("fftt_submit_match_result_v1",SOURCE)
        self.assertNotIn("fftt_manage_staff_v1",SOURCE)
        self.assertNotIn("insert into",SOURCE.lower())
        self.assertNotIn("delete from",SOURCE.lower())

    def test_dry_run_no_auth_or_network(self):
        with mock.patch.object(sys,"argv",["operator.py"]), \
             mock.patch.object(operator.auth,"preflight_users",side_effect=AssertionError("auth")), \
             mock.patch.object(operator,"rpc",side_effect=AssertionError("rpc")), \
             mock.patch("builtins.input",side_effect=AssertionError("input")):
            operator.main()

    def test_score_worker_calls_exactly_one_pinned_score_post(self):
        calls=[]
        def fake(path,token,payload):
            calls.append((path,token,payload));return (200,{"status":"accepted"})
        with mock.patch.object(operator,"rpc",side_effect=fake):
            result=operator.one_score("fictional.jwt.signed",{"x":"y"},operator.threading.Barrier(1))
        self.assertEqual(result,(200,{"status":"accepted"}))
        self.assertEqual(calls,[(operator.SCORE_RPC,"fictional.jwt.signed",{"x":"y"})])

    def test_private_scope_and_two_distinct_submission_ids(self):
        row={"player_1_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
             "player_2_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
        event="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        match="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        payloads=operator.payloads(row,event,match)
        self.assertEqual(set(payloads),{"SCOREKEEPER_A","SCOREKEEPER_B"})
        self.assertNotEqual(payloads["SCOREKEEPER_A"]["p_submission_id"],payloads["SCOREKEEPER_B"]["p_submission_id"])
        self.assertNotEqual(payloads["SCOREKEEPER_A"]["p_winner_id"],payloads["SCOREKEEPER_B"]["p_winner_id"])
        for x in payloads.values():
            self.assertEqual(x["p_event_id"],event)
            self.assertEqual(x["p_match_id"],match)
            self.assertEqual(x["p_expected_match_version"],0)
            self.assertEqual(x["p_bracket_generation"],1)
            self.assertEqual(len(x["p_game_scores"].split(",")),3)

    def test_one_time_attempt_marker_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(operator.Path,"home",return_value=pathlib.Path(directory)):
                operator.irreversible_once_marker()
                files=list(pathlib.Path(directory).iterdir())
                self.assertEqual(len(files),1)
                content=files[0].read_text()
                self.assertIn("Never repeat",content)
                self.assertNotIn("sb_secret_",content)
                with self.assertRaisesRegex(operator.Stop,"Previously attempted"):
                    operator.irreversible_once_marker()

    def test_no_hidden_automatic_score_retry(self):
        worker=inspect.getsource(operator.one_score)
        self.assertEqual(worker.count("rpc(SCORE_RPC"),1)
        self.assertNotIn("retry",worker.lower())
        self.assertNotIn("sleep",worker.lower())
        self.assertNotIn("storage",SOURCE.lower())
        self.assertIn("irreversible_once_marker()",inspect.getsource(operator.run))
        self.assertIn("approval",inspect.getsource(operator.main).lower())

if __name__=="__main__":
    unittest.main()
