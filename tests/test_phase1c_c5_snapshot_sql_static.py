"""C5 SQL proposal security guardrails. Offline ONLY, never runs proposed SQL.

Also parse the proposed SQL using pglast in the CI runner when installed.
An offline parse/test pass does NOT establish RLS or signed hosted JWT safety.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "supabase/proposals/PHASE1C_C5_SNAPSHOT_DRAFT_DO_NOT_APPLY.sql"
SQL = FILE.read_text(encoding="utf-8")
EXECUTABLE = "\n".join(
    line.split("--")[0] for line in SQL.splitlines()
).lower()


class ProposedSnapshotSecurityTests(unittest.TestCase):
    def test_sql_syntax_via_actual_postgresql_parser(self):
        try:
            from pglast import parse_sql
        except ImportError:
            self.fail("pglast parser is required in C5 CI for actual SQL syntax checks")
        stmts = parse_sql(SQL)
        self.assertGreaterEqual(len(stmts), 7)

    def test_proposal_explicitly_not_applied(self):
        self.assertIn("DO NOT APPLY", SQL)
        self.assertIn("begin;", EXECUTABLE)
        self.assertTrue(EXECUTABLE.rstrip().endswith("commit;"))

    def test_no_table_data_mutations_or_dynamic_sql(self):
        for operation in ("insert into", "delete from", "truncate ", "update ",
                          "drop table", "alter table", "execute format(",
                          "execute immediate"):
            self.assertNotIn(operation, EXECUTABLE, operation)

    def test_private_and_public_functions_are_stable_and_search_path_empty(self):
        self.assertIn("create or replace function fftt_private.event_snapshot_for_staff_v1(",
                      EXECUTABLE)
        self.assertIn("create or replace function public.fftt_event_snapshot_v1(",
                      EXECUTABLE)
        self.assertEqual(EXECUTABLE.count("stable"), 2)
        self.assertEqual(EXECUTABLE.count("set search_path to ''"), 2)
        self.assertEqual(EXECUTABLE.count("security definer"), 1)

    def test_role_and_caller_identity_from_existing_trusted_helper(self):
        self.assertIn("fftt_private.staff_role_for_event(p_event_id)", EXECUTABLE)
        self.assertIn("v_user := auth.uid()", EXECUTABLE)
        self.assertIn("v_role not in ('organizer', 'scorekeeper')", EXECUTABLE)

    def test_one_callers_receipt_only_not_other_staff_receipts(self):
        self.assertIn("s.event_id = p_event_id", EXECUTABLE)
        self.assertIn("s.actor_id = v_user", EXECUTABLE)
        self.assertIn("s.submission_id = p_submission_id", EXECUTABLE)
        self.assertNotIn("p_actor_id", EXECUTABLE)
        self.assertNotIn("p_target_user_id", EXECUTABLE)

    def test_missing_receipt_is_null_never_rejected(self):
        self.assertIn("v_receipt jsonb := null", EXECUTABLE)
        self.assertNotRegex(EXECUTABLE, r"'status'\s*,\s*'rejected'")
        self.assertIn("'resolved_submission', v_receipt", EXECUTABLE)
        self.assertIn("if found then", EXECUTABLE)

    def test_all_untrusted_receipt_fields_null_safe(self):
        self.assertIn("v_status is distinct from 'accepted'", EXECUTABLE)
        self.assertIn("v_receipt_generation is null", EXECUTABLE)
        self.assertIn("v_receipt_response ->> 'match_id' is distinct from",
                      EXECUTABLE)
        self.assertIn("v_receipt_event_revision is null", EXECUTABLE)
        self.assertIn("v_receipt_match_version is null", EXECUTABLE)

    def test_only_minimal_receipt_and_event_metadata_is_returned(self):
        # No player, winner, score, address, email, phone, rating or user id.
        for sensitive in ("'game_scores'", "'winner_id'", "'email'",
                          "'player_1_name'", "'player_2_name'", "'phone'",
                          "'rating'", "'actor_id'", "'user_id'", "'audit'"):
            self.assertNotIn(sensitive, EXECUTABLE)
        for field in ("'event_id'", "'revision'", "'generation'",
                      "'lifecycle'", "'resolved_submission'",
                      "'match_version'", "'event_revision'"):
            self.assertIn(field, EXECUTABLE)

    def test_anon_public_execution_revoked_in_transaction(self):
        for function in ("fftt_private.event_snapshot_for_staff_v1(uuid,uuid)",
                         "public.fftt_event_snapshot_v1(uuid,uuid)"):
            self.assertRegex(
                EXECUTABLE,
                r"revoke all on function " + re.escape(function) +
                r"\s+from public, anon;"
            )
            self.assertRegex(
                EXECUTABLE,
                r"grant execute on function " + re.escape(function) +
                r"\s+to authenticated;"
            )

    def test_public_wrapper_cannot_select_private_tables_directly(self):
        wrapper = EXECUTABLE.split(
            "create or replace function public.fftt_event_snapshot_v1(", 1
        )[1].split("$c5$;", 1)[0]
        self.assertIn("fftt_private.event_snapshot_for_staff_v1(", wrapper)
        self.assertNotIn("fftt_private.result_submissions", wrapper)
        self.assertNotIn("fftt_private.events", wrapper)

    def test_synthetic_only_event_boundary(self):
        self.assertIn("e.synthetic_only = true", EXECUTABLE)

    def test_no_privileged_schema_exposure_or_real_seed_data(self):
        for bad in ("grant usage on schema fftt_private to anon",
                    "grant all on schema",
                    "grant select on",
                    "fftttesting-scorea@", "2026-11-22",
                    "fb5afc65-153e-4b50-9384-05128a818f84",
                    "ce7937eb-8925-4071-ae1a-41f323a8763a"):
            self.assertNotIn(bad, EXECUTABLE)


if __name__ == "__main__":
    unittest.main()
