"""Phase 1B B1 non-database guardrails. NOT a substitute for pgTAP/RLS tests.

These tests verify file/contract consistency without a provisioned Supabase service.
For actual security coverage, run supabase/tests/phase1b_permissions.sql against a
fresh isolated development project, then B2/B3 authenticated transaction tests.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POLICY = json.loads((ROOT / "contracts/phase1a_v1.json").read_text(encoding="utf-8"))
MIGRATION = (ROOT / "supabase/migrations/20261008000100_phase1b_foundation.sql").read_text(encoding="utf-8")
PGTAP = (ROOT / "supabase/tests/phase1b_permissions.sql").read_text(encoding="utf-8")

PRIVATE_TABLES = {
    "events", "event_staff", "players", "brackets", "matches",
    "consolation_reviews", "doubles_finale", "result_submissions", "audit_events",
}
PUBLIC_FIELDS = {"event_id", "event_name", "event_date", "status", "brackets", "updated_at"}

class SchemaGuardrailTests(unittest.TestCase):
    def test_schema_is_synthetic_and_not_a_live_adapter(self):
        self.assertEqual(POLICY["status"], "design-and-synthetic-tests-only")
        self.assertIn("synthetic_only boolean not null default true check (synthetic_only = true)", MIGRATION)
        self.assertIn("Supabase API Exposed Schemas must NOT include fftt_private", MIGRATION)
        self.assertNotIn("create policy fftt_private_", MIGRATION.lower())

    def test_every_private_table_enables_rls_and_has_no_browser_table_grants(self):
        for table in PRIVATE_TABLES:
            self.assertRegex(MIGRATION, rf"create table fftt_private\.{table}\s*\(")
            self.assertIn(f"alter table fftt_private.{table} enable row level security;", MIGRATION)
        self.assertIn(
            "revoke all on all tables in schema fftt_private from public, anon, authenticated;",
            MIGRATION,
        )
        self.assertIn(
            "revoke all on schema fftt_private from public, anon, authenticated;",
            MIGRATION,
        )

    def test_public_projection_is_read_only_and_invoker_security(self):
        for table in ("fftt_published_events", "fftt_published_matches"):
            self.assertIn(f"alter table public.{table} enable row level security;", MIGRATION)
            self.assertIn(f"create table public.{table}", MIGRATION)
        self.assertIn("create view public.fftt_public_results_v1 with (security_invoker = true)", MIGRATION)
        self.assertIn("grant select on public.fftt_public_results_v1 to anon, authenticated;", MIGRATION)
        self.assertIn("for select to anon, authenticated using (true);", MIGRATION)
        self.assertNotRegex(MIGRATION, r"grant\s+(insert|update|delete|all)\s+on\s+public\.fftt_",)
        self.assertIn("No browser role can INSERT/UPDATE/DELETE.", MIGRATION)

    def test_public_contract_fields_are_explicitly_projected(self):
        self.assertEqual(set(POLICY["public_event_fields"]), PUBLIC_FIELDS)
        view = MIGRATION.split("create view public.fftt_public_results_v1", 1)[1].split(
            "comment on schema fftt_private", 1
        )[0]
        for field in POLICY["public_event_fields"]:
            self.assertRegex(view, rf"\b{re.escape(field)}\b")
        for field in POLICY["public_match_fields"]:
            self.assertIn(f"'{field}'", view)
        self.assertNotIn("select *", view.lower())
        self.assertNotRegex(view, r"fftt_private\.")

    def test_submission_and_audit_structures_exist_but_no_mutation_rpc(self):
        self.assertIn("primary key (event_id, actor_id, submission_id)", MIGRATION)
        self.assertIn("match_version bigint not null default 0", MIGRATION)
        self.assertIn("generation integer not null", MIGRATION)
        self.assertIn("create trigger fftt_audit_no_update_delete", MIGRATION)
        self.assertNotIn("create function public.submit_", MIGRATION.lower())
        self.assertNotIn("grant execute on function", MIGRATION.lower())

    def test_database_security_suite_covers_roles_projection_and_mutations(self):
        self.assertIn("select plan(25);", PGTAP)
        self.assertIn("has_table_privilege('anon'", PGTAP)
        self.assertIn("has_table_privilege('authenticated'", PGTAP)
        self.assertIn("security_invoker=true", PGTAP)
        self.assertIn("No forbidden private columns", PGTAP)

if __name__ == "__main__":
    unittest.main()
