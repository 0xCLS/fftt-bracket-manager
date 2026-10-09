"""B2f no-network tests: read-only public HTTP probe must fail closed."""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

PATH = pathlib.Path(__file__).with_name("b2f_anonymous_http_probe.py")
SPEC = importlib.util.spec_from_file_location("b2f_anonymous_http_probe", PATH)
assert SPEC and SPEC.loader
probe = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = probe
SPEC.loader.exec_module(probe)


class AnonymousHTTPGuardTests(unittest.TestCase):
    def env(self):
        return {
            "FFTT_B2F_APPROVE_READ_ONLY_HOSTED": probe.APPROVAL,
            "FFTT_B2F_PUBLISHABLE_KEY": "sb_publishable_just_a_local_mock",
            "FFTT_B2F_EVENT_ID": "12345678-1234-4234-9234-123456789abc",
        }

    def test_requires_explicit_read_only_opt_in(self):
        env = self.env()
        env.pop("FFTT_B2F_APPROVE_READ_ONLY_HOSTED")
        with self.assertRaises(probe.SafetyError):
            probe.config(env)

    def test_pinned_project_only(self):
        for alt in ("http://copmkalfkkrkzheohwuc.supabase.co",
                    "https://wrong.supabase.co",
                    "https://copmkalfkkrkzheohwuc.supabase.co.evil.test",
                    "https://copmkalfkkrkzheohwuc.supabase.co/rest",
                    "https://copmkalfkkrkzheohwuc.supabase.co?admin=1",
                    "https://username@copmkalfkkrkzheohwuc.supabase.co",
                    "https://copmkalfkkrkzheohwuc.supabase.co:443"):
            with self.subTest(alt=alt):
                env = self.env()
                env["FFTT_B2F_URL"] = alt
                with self.assertRaises(probe.SafetyError):
                    probe.config(env)

    def test_refuses_secret_and_legacy_keys(self):
        for key in ("", "sb_secret_bad", "sb_service_bad",
                    "eyJhbGciOi...", "sb_publishable_new\nInjected: 1"):
            with self.subTest(key=key):
                env = self.env()
                env["FFTT_B2F_PUBLISHABLE_KEY"] = key
                with self.assertRaises(probe.SafetyError):
                    probe.config(env)

    def test_requires_nonplaceholder_event(self):
        for event in ("", "not-a-uuid", "00000000-0000-0000-0000-000000000000"):
            with self.subTest(event=event):
                env = self.env()
                env["FFTT_B2F_EVENT_ID"] = event
                with self.assertRaises(probe.SafetyError):
                    probe.config(env)

    def test_config_accepts_safe_fixture(self):
        key, event = probe.config(self.env())
        self.assertEqual(key, "sb_publishable_just_a_local_mock")
        self.assertEqual(event, "12345678-1234-4234-9234-123456789abc")

    def test_get_targets_disallow_mutating_and_arbitrary_paths(self):
        for path in ("/rest/v1/rpc/fftt_manage_staff_v1",
                     "/rest/v1/rpc/fftt_submit_match_result_v1",
                     "/rest/v1/events", "/auth/v1/admin/users",
                     "/rest/v1/players", "http://other.invalid"):
            with self.subTest(path=path):
                with self.assertRaises(probe.SafetyError):
                    probe.target(path)
        self.assertIn("p_event_id=123", probe.target(
            "/rest/v1/rpc/fftt_staff_role_v1", {"p_event_id": "123"}))

    def test_public_field_allowlist_excludes_private_fields(self):
        self.assertTrue(probe.PUBLIC_FIELDS.isdisjoint(probe.PRIVATE_FIELDS))
        self.assertEqual(len(probe.PUBLIC_FIELDS), 6)

    def test_private_schema_header_only_for_staff(self):
        with self.assertRaises(probe.SafetyError):
            probe.get("sb_publishable_fake", "/rest/v1/fftt_public_results_v1",
                      private_schema=True, opener=object())

    def test_expected_responses_pass_without_network(self):
        seen = []
        def mock_client(key, path, params, **kwargs):
            seen.append((path, params, kwargs))
            if path == "/rest/v1/fftt_public_results_v1":
                return probe.Response(400 if params.get("select") == "email" else 200,
                                      {"code": "42703"} if params.get("select") == "email" else [])
            if path.startswith("/rest/v1/fftt_published_"):
                return probe.Response(200, [])
            return probe.Response(403, {"code": "42501"})
        probe.run_probe("sb_publishable_mock",
                        "12345678-1234-4234-9234-123456789abc",
                        client=mock_client)
        self.assertEqual(len(seen), 7)
        self.assertTrue(any(path.endswith("event_staff") and props.get("private_schema")
                            for path, _, props in seen))
        self.assertFalse(any("manage_staff" in path or "submit_match" in path
                             for path, _, _ in seen))

    def test_any_unexpected_success_of_private_rpc_fails(self):
        def mock_client(key, path, params, **kwargs):
            if path == "/rest/v1/fftt_public_results_v1":
                return probe.Response(400 if params.get("select") == "email" else 200,
                                      {} if params.get("select") == "email" else [])
            if path.startswith("/rest/v1/fftt_published_"):
                return probe.Response(200, [])
            return probe.Response(200, [])
        with self.assertRaises(probe.SafetyError):
            probe.run_probe("sb_publishable_mock",
                            "12345678-1234-4234-9234-123456789abc",
                            client=mock_client)

    def test_public_unexpected_publication_fails_closed(self):
        def mock_client(key, path, params, **kwargs):
            if path == "/rest/v1/fftt_public_results_v1":
                return probe.Response(200, [{"event_name": "UNEXPECTED"}])
            return probe.Response(200, [])
        with self.assertRaises(probe.SafetyError):
            probe.run_probe("sb_publishable_mock",
                            "12345678-1234-4234-9234-123456789abc",
                            client=mock_client)

    def test_probe_source_has_no_mutating_http_methods_or_bearer_headers(self):
        code = PATH.read_text(encoding="utf-8")
        self.assertIn('method="GET"', code)
        self.assertNotIn('method="POST"', code)
        self.assertNotIn('method="PUT"', code)
        self.assertNotIn('method="DELETE"', code)
        self.assertNotIn('"Authorization":', code)


if __name__ == "__main__":
    unittest.main()
