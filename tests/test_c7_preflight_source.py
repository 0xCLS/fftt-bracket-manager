"""C7 public-only live preflight source guard (static, no network)."""
from pathlib import Path
import unittest

SRC = (Path(__file__).resolve().parent / "c7_live_readonly_preflight.mjs").read_text()

class C7OnlyPublicOperations(unittest.TestCase):
    def test_only_get_and_options_requested(self):
        self.assertIn('method:"GET"',SRC)
        self.assertIn('method:"OPTIONS"',SRC)
        for text in ['method:"POST"','method:"PATCH"','method:"DELETE"',
                     'method:"PUT"','method:"HEAD"']:
            self.assertNotIn(text,SRC)
    def test_scopes_read_endpoints_and_never_contains_score_rpc(self):
        for allowed in ["/auth/v1/otp","/auth/v1/verify","/auth/v1/user",
                        "/auth/v1/settings","/rest/v1/rpc/fftt_staff_role_v1",
                        "/rest/v1/rpc/fftt_matchdesk_v1"]:
            self.assertIn(allowed,SRC)
        for forbidden in ["fftt_submit_match_result_v1","fftt_manage_staff_v1",
                          "/auth/v1/signup","/auth/v1/admin",
                          "fftt_private","sb_secret_","service_role",
                          "sendMagicLink","requestCode(", "create_user:true"]:
            self.assertNotIn(forbidden,SRC)
    def test_no_identity_or_private_artifact_references(self):
        for forbidden in ["cls_2k@","fftttesting-","fb5afc65-",
                          "ce7937eb-","password","magic_token",
                          "access_token=","refresh_token=", "Authorization: Bearer"]:
            self.assertNotIn(forbidden,SRC)
    def test_only_empty_public_projection_is_accepted(self):
        self.assertIn("assert.equal(results.length,0",SRC)
        self.assertIn("assert.equal(events.length,0",SRC)
        self.assertIn("assert.equal(matches.length,0",SRC)
    def test_no_private_response_payload_logging(self):
        for forbidden in ["console.log(metadata","console.log(results",
                          "console.log(events","console.log(matches",
                          "console.log(response","JSON.stringify(metadata",
                          "console.error(response"]:
            self.assertNotIn(forbidden,SRC)

if __name__=="__main__":
    unittest.main()
