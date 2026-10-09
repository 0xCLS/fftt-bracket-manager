"""B2h no-network, no-credential test suite: synthetic magic-link signed Auth harness."""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

FILE = pathlib.Path(__file__).with_name("b2h_admin_magiclink_signed_auth.py")
SPEC = importlib.util.spec_from_file_location("b2h_admin_magiclink_signed_auth", FILE)
assert SPEC and SPEC.loader
app = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = app
SPEC.loader.exec_module(app)

IDS = {
    "ORGANIZER": "11111111-1111-4111-8111-111111111111",
    "SCOREKEEPER_A": "22222222-2222-4222-8222-222222222222",
    "SCOREKEEPER_B": "33333333-3333-4333-8333-333333333333",
    "OUTSIDER": "44444444-4444-4444-8444-444444444444",
}
EMAILS = {"ORGANIZER": "organizer@example.test", **app.TEST_ONLY}
EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def fake_users():
    return [{"email": EMAILS[label], "id": IDS[label],
             "is_anonymous": False, "email_confirmed_at": "2026-10-09T12:00:00Z",
             "deleted_at": None, "banned_until": None} for label in app.ROLE_ORDER]


def fake_match():
    return {"event_id": EVENT, "bracket_generation": 1,
            "match_id": "99999999-9999-4999-8999-999999999999",
            "match_code": "C-0-0", "match_version": 0, "bracket": "championship",
            "round_number": 0, "slot": 0,
            "player_1_id": "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
            "player_2_id": "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
            "player_1_name": "Synthetic Fixture Alpha",
            "player_2_name": "Synthetic Fixture Beta", "table_number": None,
            "is_championship_final": False}


class B2hTests(unittest.TestCase):
    def test_secret_uses_modern_only(self):
        self.assertEqual(app.check_secret("sb_secret_local_mock"), "sb_secret_local_mock")
        for key in ("", "service_role", "eyJheader.payload.sig",
                    "sb_publishable_wrong", "sb_secret_has space"):
            with self.subTest(key=key), self.assertRaises(app.StopTest):
                app.check_secret(key)

    def test_synthetic_event_format_and_placeholder_block(self):
        self.assertEqual(app.validate_event(EVENT), EVENT)
        for value in ("", "a", "00000000-0000-0000-0000-000000000000"):
            with self.subTest(value=value), self.assertRaises(app.StopTest):
                app.validate_event(value)

    def test_admin_reads_are_secret_only_and_fixed_routes(self):
        for method, path in (("POST", "/rest/v1/rpc/fftt_manage_staff_v1"),
                             ("POST", "/rest/v1/rpc/fftt_submit_match_result_v1"),
                             ("PUT", "/auth/v1/admin/users/x"),
                             ("POST", "/auth/v1/signup"),
                             ("POST", "/auth/v1/recover")):
            with self.subTest(path=path), self.assertRaises(app.StopTest):
                app.http(method, path, app.PUBLISHABLE_KEY)
        with self.assertRaises(app.StopTest):
            app.http("GET", "/auth/v1/admin/users", app.PUBLISHABLE_KEY)

    def test_admin_secret_never_used_for_public_api(self):
        with self.assertRaises(app.StopTest):
            app.http("POST", "/rest/v1/rpc/fftt_matchdesk_v1", "sb_secret_mock")
        with self.assertRaises(app.StopTest):
            app.http("GET", "/auth/v1/user", "sb_secret_mock")

    def test_restrict_headers_and_no_admin_jwt(self):
        with self.assertRaises(app.StopTest):
            app.http("GET", "/rest/v1/event_staff", app.PUBLISHABLE_KEY,
                     extra={"Authorization": "Bearer bad"})
        with self.assertRaises(app.StopTest):
            app.http("GET", "/auth/v1/admin/users", "sb_secret_test",
                     token="fake.signed.token")
        with self.assertRaises(app.StopTest):
            app.http("POST", "/rest/v1/rpc/fftt_matchdesk_v1", app.PUBLISHABLE_KEY,
                     extra={"Accept-Profile": "fftt_private"})

    def test_exact_preexisting_four_confirmed_users(self):
        with patch.object(app, "http", return_value=app.Response(200, {"users": fake_users()})):
            self.assertEqual(app.preflight_users("sb_secret_fake", EMAILS["ORGANIZER"]), IDS)

    def test_fail_closed_on_missing_or_extra_users(self):
        for users in (fake_users()[:-1], fake_users() + [fake_users()[0]]):
            with patch.object(app, "http", return_value=app.Response(200, {"users": users})):
                with self.assertRaises(app.StopTest):
                    app.preflight_users("sb_secret_fake", EMAILS["ORGANIZER"])

    def test_fail_closed_on_unknown_or_unconfirmed_account(self):
        invalid = fake_users()
        invalid[1]["email_confirmed_at"] = None
        with patch.object(app, "http", return_value=app.Response(200, {"users": invalid})):
            with self.assertRaises(app.StopTest):
                app.preflight_users("sb_secret_mock", EMAILS["ORGANIZER"])
        with patch.object(app, "http", return_value=app.Response(200, {"users": fake_users()})):
            with self.assertRaises(app.StopTest):
                app.preflight_users("sb_secret_mock", "someone-else@example.test")

    def test_exchange_real_auth_session_simulation(self):
        calls = []
        def fake(method, path, key, **opts):
            calls.append((method, path, key, opts))
            if path.endswith("/generate_link"):
                return app.Response(200, {"user": {"id": IDS["SCOREKEEPER_A"], "email": EMAILS["SCOREKEEPER_A"]},
                                          "properties": {"hashed_token": "token-hash"}})
            if path.endswith("/verify"):
                return app.Response(200, {"access_token": "header.payload.signature"})
            if path.endswith("/user"):
                return app.Response(200, {"id": IDS["SCOREKEEPER_A"],
                                          "email": EMAILS["SCOREKEEPER_A"],
                                          "email_confirmed_at": "yes",
                                          "is_anonymous": False})
            raise AssertionError("unexpected request")
        with patch.object(app, "http", side_effect=fake):
            jwt = app.exchange_link("sb_secret_fake", "SCOREKEEPER_A",
                                    EMAILS["SCOREKEEPER_A"], IDS["SCOREKEEPER_A"])
        self.assertEqual(jwt, "header.payload.signature")
        self.assertEqual([c[1] for c in calls], ["/auth/v1/admin/generate_link",
                                                  "/auth/v1/verify", "/auth/v1/user"])
        self.assertEqual(calls[0][3]["body"], {"type": "magiclink",
                                               "email": EMAILS["SCOREKEEPER_A"]})
        self.assertEqual(calls[1][3]["body"], {"type": "magiclink",
                                               "token_hash": "token-hash"})

    def test_flat_raw_gotrue_link_format_supported_and_verified(self):
        """Live raw /admin/generate_link is FLAT, unlike normalized supabase-js."""
        calls = []
        def fake(method, path, key, **opts):
            calls.append(path)
            if path.endswith("/generate_link"):
                return app.Response(200, {
                    "id": IDS["SCOREKEEPER_A"], "email": EMAILS["SCOREKEEPER_A"],
                    "hashed_token": "one-time-mock",
                    "verification_type": "magiclink",
                })
            if path.endswith("/verify"):
                self.assertEqual(opts["body"]["token_hash"], "one-time-mock")
                return app.Response(200, {"access_token": "header.payload.signature"})
            if path.endswith("/user"):
                return app.Response(200, {
                    "id": IDS["SCOREKEEPER_A"], "email": EMAILS["SCOREKEEPER_A"],
                    "email_confirmed_at": "confirmed", "is_anonymous": False,
                })
            raise AssertionError("Unexpected path")
        with patch.object(app, "http", side_effect=fake):
            self.assertEqual(
                app.exchange_link("sb_secret_fake", "SCOREKEEPER_A",
                                  EMAILS["SCOREKEEPER_A"], IDS["SCOREKEEPER_A"]),
                "header.payload.signature")
        self.assertEqual(calls, ["/auth/v1/admin/generate_link",
                                 "/auth/v1/verify", "/auth/v1/user"])

    def test_flat_raw_mismatched_id_never_redeems(self):
        calls = []
        def fake(method, path, key, **opts):
            calls.append(path)
            return app.Response(200, {
                "id": IDS["OUTSIDER"],
                "email": EMAILS["SCOREKEEPER_A"],
                "hashed_token": "should-not-redeem",
            })
        with patch.object(app, "http", side_effect=fake):
            with self.assertRaises(app.StopTest):
                app.exchange_link("sb_secret_fake", "SCOREKEEPER_A",
                                  EMAILS["SCOREKEEPER_A"], IDS["SCOREKEEPER_A"])
        self.assertEqual(calls, ["/auth/v1/admin/generate_link"])

    def test_flat_raw_mismatched_email_never_redeems(self):
        calls = []
        def fake(method, path, key, **opts):
            calls.append(path)
            return app.Response(200, {
                "id": IDS["SCOREKEEPER_A"],
                "email": EMAILS["OUTSIDER"],
                "hashed_token": "should-not-redeem",
            })
        with patch.object(app, "http", side_effect=fake):
            with self.assertRaises(app.StopTest):
                app.exchange_link("sb_secret_fake", "SCOREKEEPER_A",
                                  EMAILS["SCOREKEEPER_A"], IDS["SCOREKEEPER_A"])
        self.assertEqual(calls, ["/auth/v1/admin/generate_link"])

    def test_flat_raw_missing_identity_never_redeems(self):
        calls = []
        def fake(method, path, key, **opts):
            calls.append(path)
            return app.Response(200, {"email": EMAILS["SCOREKEEPER_A"],
                                      "hashed_token": "should-not-redeem"})
        with patch.object(app, "http", side_effect=fake):
            with self.assertRaises(app.StopTest):
                app.exchange_link("sb_secret_fake", "SCOREKEEPER_A",
                                  EMAILS["SCOREKEEPER_A"], IDS["SCOREKEEPER_A"])
        self.assertEqual(calls, ["/auth/v1/admin/generate_link"])

    def test_wrong_generated_identity_blocks_token_redemption(self):
        def fake(method, path, key, **opts):
            if path.endswith("/generate_link"):
                return app.Response(200, {"user": {"id": IDS["OUTSIDER"], "email": EMAILS["OUTSIDER"]},
                                          "properties": {"hashed_token": "foo"}})
            raise AssertionError("Unexpected verify attempt")
        with patch.object(app, "http", side_effect=fake):
            with self.assertRaises(app.StopTest):
                app.exchange_link("sb_secret_fake", "SCOREKEEPER_A",
                                  EMAILS["SCOREKEEPER_A"], IDS["SCOREKEEPER_A"])

    def test_incorrect_auth_server_identity_rejected(self):
        def fake(method, path, key, **opts):
            if path.endswith("/generate_link"):
                return app.Response(200, {"user": {"id": IDS["SCOREKEEPER_A"], "email": EMAILS["SCOREKEEPER_A"]},
                                          "properties": {"hashed_token": "foo"}})
            if path.endswith("/verify"):
                return app.Response(200, {"access_token": "header.payload.signature"})
            return app.Response(200, {"id": IDS["OUTSIDER"],
                                      "email": EMAILS["OUTSIDER"],
                                      "email_confirmed_at": "yes"})
        with patch.object(app, "http", side_effect=fake):
            with self.assertRaises(app.StopTest):
                app.exchange_link("sb_secret_fake", "SCOREKEEPER_A",
                                  EMAILS["SCOREKEEPER_A"], IDS["SCOREKEEPER_A"])

    def test_exact_single_match_and_permission_denials_pass(self):
        seen = []
        def fake(method, path, key, **opts):
            seen.append((method, path, opts))
            token = opts.get("token")
            if path.endswith("/fftt_staff_role_v1"):
                if not token or token == "jwt-outsider":
                    return app.Response(403, {"code": "42501"})
                return app.Response(200, "organizer" if token == "jwt-organizer"
                                    else "scorekeeper")
            if path.endswith("/fftt_matchdesk_v1"):
                return app.Response(403, {}) if token == "jwt-outsider" else app.Response(200, [fake_match()])
            if path.endswith("/event_staff"):
                return app.Response(406, {"code": "PGRST106"})
            if path.endswith("/fftt_public_results_v1"):
                return app.Response(200, [])
            raise AssertionError("unexpected path")
        tokens = {"ORGANIZER": "jwt-organizer", "SCOREKEEPER_A": "jwt-a",
                  "SCOREKEEPER_B": "jwt-b", "OUTSIDER": "jwt-outsider"}
        with patch.object(app, "http", side_effect=fake):
            app.check_access(tokens, EVENT)
        self.assertTrue(any(p.endswith("/event_staff") and opts.get("extra") ==
                            {"Accept-Profile": "fftt_private"} for _, p, opts in seen))

    def test_private_match_field_exposure_fails(self):
        def fake(method, path, key, **opts):
            if path.endswith("/fftt_staff_role_v1"):
                return app.Response(200, "organizer")
            if path.endswith("/fftt_matchdesk_v1"):
                return app.Response(200, [{**fake_match(), "email": "leak@example.test"}])
            return app.Response(403, {})
        with patch.object(app, "http", side_effect=fake):
            with self.assertRaises(app.StopTest):
                app.check_access({"ORGANIZER": "x"}, EVENT)

    def test_wrong_match_or_version_fails(self):
        def fake(method, path, key, **opts):
            if path.endswith("/fftt_staff_role_v1"):
                return app.Response(200, "organizer")
            if path.endswith("/fftt_matchdesk_v1"):
                return app.Response(200, [{**fake_match(), "match_version": 2}])
            return app.Response(403, {})
        with patch.object(app, "http", side_effect=fake):
            with self.assertRaises(app.StopTest):
                app.check_access({"ORGANIZER": "x"}, EVENT)

    def test_no_network_or_secret_logging_in_tests(self):
        src = FILE.read_text(encoding="utf-8")
        self.assertNotIn("fftt_submit_match_result_v1", src)
        self.assertNotIn("fftt_manage_staff_v1", src)
        self.assertNotIn("password=", src)
        self.assertIn("getpass.getpass", src)
        self.assertIn("NoRedirect", src)
        self.assertNotIn("file.write(", src)
        self.assertNotIn("with open(", src)


if __name__ == "__main__":
    unittest.main()
