"""Fail-closed routing tests for the expedited CI lane (no network)."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ci_impact", ROOT / "tools" / "ci_impact.py")
impact = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(impact)
BEFORE = "a" * 40
AFTER = "b" * 40

def classify(files, patches=None):
    patches = patches or {}
    def fake_git(*args):
        if args[0] == "cat-file":
            return ""
        if args[0] == "diff" and "--name-only" in args:
            return "\n".join(files)
        if args[0] == "diff" and "--unified=0" in args:
            return patches.get(args[-1], "")
        raise AssertionError(args)
    with patch.object(impact, "git", side_effect=fake_git):
        return impact.classify("pull_request", "synchronize", BEFORE, AFTER)[0]

class ImpactTests(unittest.TestCase):
    def test_visual_css_uses_fast_lane(self):
        self.assertEqual(classify(["app/app.css"]), "ui-visual")

    def test_presentational_player_markup_uses_focused_interaction_lane(self):
        self.assertEqual(classify(["app/app.css", "app/view_players.mjs"],
                                  {"app/view_players.mjs": "+  path('M14 12', 'rank-chevron');"}), "ui-interaction")

    def test_action_changes_force_full_suite(self):
        self.assertEqual(classify(["app/view_players.mjs"],
                                  {"app/view_players.mjs": "+ await core.actions.setCheckinAll(true);"}), "full")
        self.assertEqual(classify(["app/view_registration.mjs"],
                                  {"app/view_registration.mjs": "- return await core.actions.saveRegistrationSource(x);"}), "full")

    def test_server_sql_auth_and_ci_changes_force_full(self):
        for f in ["server/registration/handler.mjs", "supabase/migrations/01.sql",
                  "contracts/gameday_engine.mjs", ".github/workflows/browser-tests.yml",
                  "tools/ci_impact.py", "app/session.mjs"]:
            self.assertEqual(classify([f]), "full", f)

    def test_docs_only_and_mixed_pushes(self):
        self.assertEqual(classify(["docs/README.md"]), "docs")
        self.assertEqual(classify(["app/app.css", "functions/api/registrations.js"]), "full")

    def test_unknown_and_release_events_force_full(self):
        self.assertEqual(impact.classify("push", "", BEFORE, AFTER)[0], "full")
        self.assertEqual(impact.classify("workflow_dispatch", "", BEFORE, AFTER)[0], "full")
        self.assertEqual(impact.classify("pull_request", "opened", BEFORE, AFTER)[0], "full")
        self.assertEqual(impact.classify("pull_request", "synchronize", "", AFTER)[0], "full")
        self.assertEqual(impact.classify("pull_request", "synchronize", BEFORE, "")[0], "full")
        self.assertEqual(classify([]), "full")

if __name__ == "__main__":
    unittest.main()
