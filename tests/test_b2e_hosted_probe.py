"""Unit guard tests for the B2e *read-only* hosted Auth probe.

These tests require no hosted accounts, credentials, HTTP or local database.
"""
import importlib.util
from pathlib import Path
import unittest


PROBE = Path(__file__).with_name("b2e_hosted_auth_probe.py")
SPEC = importlib.util.spec_from_file_location("b2e_hosted_auth_probe", PROBE)
assert SPEC and SPEC.loader
import sys
probe = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = probe
SPEC.loader.exec_module(probe)


class HostedProbeGuards(unittest.TestCase):
    def test_exact_expected_origin_only(self):
        self.assertEqual(
            probe.valid_target("https://copmkalfkkrkzheohwuc.supabase.co/"),
            probe.HOST
        )
        for other in (
            "https://example.supabase.co",
            "http://copmkalfkkrkzheohwuc.supabase.co",
            "https://copmkalfkkrkzheohwuc.supabase.co.evil.test",
            "https://user@copmkalfkkrkzheohwuc.supabase.co",
            "https://copmkalfkkrkzheohwuc.supabase.co:444",
            "https://copmkalfkkrkzheohwuc.supabase.co/path",
            "https://copmkalfkkrkzheohwuc.supabase.co/?x=1",
        ):
            with self.subTest(other=other):
                with self.assertRaises(probe.PreflightError):
                    probe.valid_target(other)

    def test_refuses_privileged_and_legacy_keys(self):
        self.assertEqual(probe.public_key("sb_publishable_test_only"), "sb_publishable_test_only")
        for key in ("", "eyJ.mock.legacy", "sb_secret_test", "sb_service_test",
                    "service_role", "other"):
            with self.subTest(key=key):
                with self.assertRaises(probe.PreflightError):
                    probe.public_key(key)

    def fixture(self):
        event = "12345678-1234-4234-9234-123456789abc"
        values = {
            "FFTT_B2E_PUBLISHABLE_KEY": "sb_publishable_for_unit_test",
            "FFTT_B2E_EVENT_ID": event,
        }
        for name in probe.AUTH_USERS:
            values[f"FFTT_B2E_{name}_EMAIL"] = name.lower() + "@example.test"
            values[f"FFTT_B2E_{name}_PASSWORD"] = "fake-not-used"
        return values

    def test_four_distinct_test_accounts_and_event(self):
        origin, key, event, accounts = probe.config(self.fixture())
        self.assertEqual(origin, probe.HOST)
        self.assertEqual(key, "sb_publishable_for_unit_test")
        self.assertEqual(event, "12345678-1234-4234-9234-123456789abc")
        self.assertEqual(len(accounts), 4)

    def test_missing_duplicate_or_malformed_identity_fails_closed(self):
        for defect in ("missing", "duplicate", "malformed", "wrong_project", "bad_uuid"):
            env = self.fixture()
            if defect == "missing":
                del env["FFTT_B2E_OUTSIDER_PASSWORD"]
            elif defect == "duplicate":
                env["FFTT_B2E_OUTSIDER_EMAIL"] = env["FFTT_B2E_ORGANIZER_EMAIL"].upper()
            elif defect == "malformed":
                env["FFTT_B2E_OUTSIDER_EMAIL"] = "not-an-address"
            elif defect == "wrong_project":
                env["FFTT_B2E_URL"] = "https://elsewhere.supabase.co"
            else:
                env["FFTT_B2E_EVENT_ID"] = "not-a-uuid"
            with self.subTest(defect=defect):
                with self.assertRaises(probe.PreflightError):
                    probe.config(env)

    def test_denial_status_rules(self):
        self.assertTrue(probe.denied(probe.Response(401, {})))
        self.assertTrue(probe.denied(probe.Response(403, {})))
        self.assertFalse(probe.denied(probe.Response(200, {})))
        self.assertFalse(probe.denied(probe.Response(500, {})))

    def test_prohibited_public_fields(self):
        self.assertTrue({"email", "rating", "staff", "actor_id"} <= probe.PROHIBITED)
        self.assertFalse({"match_id", "match_code", "player_1_name"} & probe.PROHIBITED)


if __name__ == "__main__":
    unittest.main()
