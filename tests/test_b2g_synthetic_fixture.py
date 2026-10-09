"""B2g offline guard tests for a NEVER-autoprovisioned synthetic hosted fixture.

Checks the trusted SQL template's deterministic scope and fail-closed
requirements. These tests NEVER connect to Supabase or execute any SQL.
"""
from pathlib import Path
import re
import unittest

SQL = (Path(__file__).resolve().parent.parent /
       "docs/B2G_TRUSTED_SYNTHETIC_FIXTURE_TEMPLATE.sql").read_text(encoding="utf-8")


class GuardedSyntheticFixture(unittest.TestCase):
    def test_not_a_migration_or_live_fixture(self):
        self.assertIn("NOT A MIGRATION", SQL)
        self.assertIn("NOT APPROVED TO EXECUTE", SQL)
        self.assertNotIn("sb_secret_", SQL)
        self.assertNotIn("service_role", SQL.lower())

    def test_disabled_by_default_with_exact_approval_string(self):
        self.assertIn("v_approval text := 'APPROVAL_NOT_GRANTED'", SQL)
        self.assertIn("if v_approval <> 'YES_B2G_ONE_SYNTHETIC_FIXTURE_WRITE'", SQL)
        self.assertIn("B2g fixture write has not been explicitly approved", SQL)

    def test_zero_event_uuid_hard_stop(self):
        self.assertIn("'00000000-0000-0000-0000-000000000000'::uuid", SQL)
        self.assertIn("v_event_id =", SQL)
        self.assertIn("synthetic event UUID placeholder must be replaced", SQL)

    def test_exact_project_and_fake_event_scope(self):
        for value in ("copmkalfkkrkzheohwuc",
                      "B2e Synthetic Hosted Rehearsal — NOT FFTT3",
                      "'2099-01-01'::date", "synthetic_only = true",
                      "event_name =", "lifecycle = 'active'"):
            self.assertIn(value, SQL)

    def test_requires_database_admin_and_event_lock(self):
        self.assertIn("current_user not in ('postgres', 'supabase_admin')", SQL)
        self.assertRegex(SQL, r"(?s)select \* into v_event.*?for update;", msg="Must lock event")
        self.assertIn("count(*) from fftt_private.events) <> 1", SQL)

    def test_expected_revision_and_staff_baseline(self):
        for token in ("bracket_generation = 0", "revision = 2",
                      "fftt_private.event_staff",
                      "role='organizer') <> 1",
                      "role='scorekeeper') <> 2",
                      "fftt_private.audit_events",
                      "actor_id is null) <> 2"):
            self.assertIn(token, SQL)

    def test_no_existing_synthetic_match_state_allowed(self):
        for table in ("players", "brackets", "matches", "result_submissions",
                      "consolation_reviews", "doubles_finale"):
            self.assertIn(f"fftt_private.{table} where event_id=v_event_id) <> 0", SQL)

    def test_unpublished_only(self):
        for table in ("fftt_published_events", "fftt_published_matches"):
            self.assertIn(f"public.{table}) <> 0", SQL)

    def test_preflight_checks_precede_any_insert(self):
        idx_first_insert = SQL.lower().index("insert into fftt_private.players")
        for guard in ("v_approval <>", "current_user not in",
                      "if v_event_id =", "if not found",
                      "if (select count(*) from fftt_private.event_staff"):
            self.assertLess(SQL.lower().index(guard.lower()), idx_first_insert)

    def test_only_five_whitelisted_mutation_targets(self):
        inserts = re.findall(r"insert\s+into\s+([\w.]+)", SQL, flags=re.I)
        updates = re.findall(r"update\s+([\w.]+)\s+set", SQL, flags=re.I)
        self.assertEqual(inserts, ["fftt_private.players", "fftt_private.brackets",
                                   "fftt_private.matches", "fftt_private.audit_events"])
        self.assertEqual(updates, ["fftt_private.events"])
        self.assertNotRegex(SQL.lower(), r"\b(delete from|truncate|drop table|alter table)\b")

    def test_two_fake_players_no_private_contact_data(self):
        self.assertIn("'Synthetic Fixture Alpha'", SQL)
        self.assertIn("'Synthetic Fixture Beta'", SQL)
        self.assertIn("3,'provisional',true,1", SQL)
        self.assertIn("3,'provisional',true,2", SQL)
        for forbidden in ("fftt3 registration", "participant_email", "phone_number",
                          "@yahoo.com", "auth.users"):
            self.assertNotIn(forbidden, SQL.lower())

    def test_single_playable_match_generation(self):
        self.assertIn("'championship','active',null", SQL)
        self.assertIn("'C-0-0',0,0,v_alpha,v_beta,'pending',0", SQL)
        self.assertIn("bracket_generation = 1", SQL)
        self.assertIn("v_revision <> 3", SQL)

    def test_bracket_audit_explicitly_administrative(self):
        self.assertIn("'bracket_built'", SQL)
        self.assertIn("'bracket_id',v_bracket", SQL)
        self.assertIn("NOT authenticated organizer bracket build", SQL)
        self.assertIn("event_revision", SQL)

    def test_transaction_and_no_remote_calls(self):
        self.assertRegex(SQL.lower(), r"(?s)^--.*?\nbegin;\s+do \$b2g_fixture\$")
        self.assertTrue(SQL.rstrip().endswith("commit;"))
        for token in ("http_get(", "net.http_", "dblink(", "pg_read_file(",
                      "copy ", "curl ", "https://"):
            self.assertNotIn(token, SQL.lower())


if __name__ == "__main__":
    unittest.main()
