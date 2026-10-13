"""No-network B2i acceptance oracle unit tests. No hosted writes or secrets."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest

FILE = Path(__file__).with_name("b2i_hosted_race_oracle.py")
SPEC = importlib.util.spec_from_file_location("b2i_hosted_race_oracle", FILE)
assert SPEC and SPEC.loader
oracle = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = oracle
SPEC.loader.exec_module(oracle)


def before():
    return dict(
        synthetic_only=True,
        event_name=oracle.EVENT_NAME,
        event_date=oracle.DATE,
        lifecycle="active",
        event_count=1, event_revision=3, bracket_generation=1,
        auth_user_count=4, organizer_count=1, scorekeeper_count=2,
        outsider_grant_count=0, players=2, brackets=1, pending_matches=1,
        completed_matches=0, match_code="C-0-0", match_version=0,
        score_receipts=0, result_audits=0, audit_count=3,
        published_events=0, published_matches=0,
        player_one="Synthetic Fixture Alpha",
        player_two="Synthetic Fixture Beta",
        winner_is_null=True, scores_are_empty=True,
        event_id_confirmed_privately=True, match_id_confirmed_privately=True,
    )


def after():
    return dict(
        synthetic_only=True, event_count=1, event_revision=4,
        bracket_generation=1, match_code="C-0-0",
        match_status="complete", match_version=1,
        completed_matches=1, score_receipts=1, result_audits=1,
        audit_count=4, consolation_candidates=1,
        organizer_count=1, scorekeeper_count=2,
        outsider_grant_count=0, published_events=0,
        published_matches=0, event_id_confirmed_privately=True,
        match_id_confirmed_privately=True,
        winning_actor="SCOREKEEPER_B",
        winner_player="Synthetic Fixture Beta",
        accepted_winner_player="Synthetic Fixture Beta",
    )


class RaceOracleTests(unittest.TestCase):
    def test_exact_preflight(self):
        oracle.verify_before(before())

    def test_preflight_detects_any_missing_required_field(self):
        x = before()
        del x["event_date"]
        with self.assertRaises(oracle.RaceNotVerified):
            oracle.verify_before(x)

    def test_preflight_rejects_wrong_event_and_non_synthetic_data(self):
        for key, value in (
            ("event_date", "2026-11-22"),
            ("synthetic_only", False),
            ("event_name", "FFTT3"),
            ("event_count", 2),
            ("auth_user_count", 5),
            ("scorekeeper_count", 1),
            ("outsider_grant_count", 1),
        ):
            with self.subTest(key=key), self.assertRaises(oracle.RaceNotVerified):
                x = before()
                x[key] = value
                oracle.verify_before(x)

    def test_preflight_rejects_already_scored_or_changed_fixture(self):
        for key, value in (
            ("event_revision", 4), ("bracket_generation", 2),
            ("pending_matches", 0), ("completed_matches", 1),
            ("match_version", 1), ("winner_is_null", False),
            ("score_receipts", 1), ("result_audits", 1),
            ("published_events", 1),
            ("match_id_confirmed_privately", False),
        ):
            with self.subTest(key=key), self.assertRaises(oracle.RaceNotVerified):
                x = before()
                x[key] = value
                oracle.verify_before(x)

    def test_boolean_is_not_accepted_as_integer(self):
        x = before()
        x["event_revision"] = True
        with self.assertRaises(oracle.RaceNotVerified):
            oracle.verify_before(x)

    def test_one_winning_scorekeeper_a(self):
        a = oracle.SubmissionOutcome("SCOREKEEPER_A", 200, "accepted")
        b = oracle.SubmissionOutcome("SCOREKEEPER_B", 409, None)
        self.assertEqual(oracle.verify_race(a, b), "SCOREKEEPER_A")

    def test_one_winning_scorekeeper_b(self):
        a = oracle.SubmissionOutcome("SCOREKEEPER_A", 409, None)
        b = oracle.SubmissionOutcome("SCOREKEEPER_B", 200, "accepted")
        self.assertEqual(oracle.verify_race(a, b), "SCOREKEEPER_B")

    def test_double_success_or_double_denial_fails(self):
        for codes in ((200, 200), (409, 409)):
            with self.subTest(codes=codes), self.assertRaises(oracle.RaceNotVerified):
                oracle.verify_race(
                    oracle.SubmissionOutcome("SCOREKEEPER_A", codes[0], "accepted"),
                    oracle.SubmissionOutcome("SCOREKEEPER_B", codes[1], "accepted"))

    def test_ambiguous_failure_or_network_timeout_is_not_success(self):
        for code in (0, 302, 500, 503, 599):
            with self.subTest(code=code), self.assertRaises(oracle.RaceNotVerified):
                oracle.verify_race(
                    oracle.SubmissionOutcome("SCOREKEEPER_A", 200, "accepted"),
                    oracle.SubmissionOutcome("SCOREKEEPER_B", code, None))

    def test_fake_success_without_accepted_receipt_fails(self):
        with self.assertRaises(oracle.RaceNotVerified):
            oracle.verify_race(
                oracle.SubmissionOutcome("SCOREKEEPER_A", 200, "noop"),
                oracle.SubmissionOutcome("SCOREKEEPER_B", 409, None))

    def test_duplicate_actor_or_outsider_fails(self):
        for other in ("SCOREKEEPER_A", "OUTSIDER"):
            with self.subTest(other=other), self.assertRaises(oracle.RaceNotVerified):
                oracle.verify_race(
                    oracle.SubmissionOutcome("SCOREKEEPER_A", 200, "accepted"),
                    oracle.SubmissionOutcome(other, 409, None))

    def test_expected_persisted_state(self):
        oracle.verify_after(after(), "SCOREKEEPER_B")

    def test_postcondition_requires_exactly_one_result_and_audit(self):
        for key, value in (
            ("event_revision", 3), ("match_version", 2),
            ("score_receipts", 2), ("result_audits", 0),
            ("audit_count", 5), ("consolation_candidates", 0),
            ("published_matches", 1), ("scorekeeper_count", 1),
        ):
            with self.subTest(key=key), self.assertRaises(oracle.RaceNotVerified):
                x = after()
                x[key] = value
                oracle.verify_after(x, "SCOREKEEPER_B")

    def test_persisted_winner_must_match_accepted_result(self):
        for key, value in (
            ("winning_actor", "SCOREKEEPER_A"),
            ("winner_player", "Someone Real"),
            ("accepted_winner_player", "Synthetic Fixture Alpha"),
        ):
            with self.subTest(key=key), self.assertRaises(oracle.RaceNotVerified):
                x = after()
                x[key] = value
                oracle.verify_after(x, "SCOREKEEPER_B")

    def test_never_automatic_replay_or_delete(self):
        policy = oracle.safe_recovery_rule()
        self.assertIn("STOP ALL WRITES", policy)
        self.assertIn("Do not automatically replay", policy)
        self.assertIn("Ask organizer approval", policy)

    def test_offline_module_no_network_auth_or_database_write_code(self):
        content = FILE.read_text()
        for prohibited in ("urllib", "requests.", "supabase.", "psycopg",
                           "sqlite3", "socket", "subprocess", "service_role",
                           "sb_secret_", "Authorization", "execute(",
                           "fetch(", "http(", "open(", "DROP TABLE"):
            self.assertNotIn(prohibited, content)
        self.assertIn("No hosted score submissions", content)


if __name__ == "__main__":
    unittest.main()
