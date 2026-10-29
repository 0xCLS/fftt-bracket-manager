"""C7 Mac runner static/byte-integrity safeguards, WITHOUT network use."""
from pathlib import Path
import importlib.util
import io
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "tools/c7/C7_Readonly_Local_Server.py"
SHELL = HERE.parent / "tools/c7/Run_C7_Readonly_Login_Rehearsal.command"
README = HERE.parent / "tools/c7/README_C7.txt"

spec = importlib.util.spec_from_file_location("c7_mac_runner", SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Response(io.BytesIO):
    def __init__(self, url, data):
        super().__init__(data)
        self.url = url
    def geturl(self):
        return self.url


class C7MacLauncherTests(unittest.TestCase):
    def test_pinned_source_commit_not_branch(self):
        self.assertEqual(runner.COMMIT,
                         "355b916cf3e2905d1aa89a144e08da43e311b39a")
        self.assertEqual(len(runner.FILES), 7)
        self.assertEqual(len(set(runner.FILES.values())), 7)
        self.assertTrue(all(len(digest) == 40 for digest in runner.FILES.values()))

    def test_known_git_blob_vector(self):
        self.assertEqual(runner.git_blob_sha(b"hello\n"),
                         "ce013625030ba8dba906f756967f9e9ca394464a")

    def test_source_integrity_accepts_exact_expected_body(self):
        blob = b"test-only-source\n"
        path = "contracts/phase1c_disconnect_reference.mjs"
        digest = runner.git_blob_sha(blob)
        with mock.patch.object(runner.urllib.request, "urlopen",
                               return_value=Response(runner.BASE+path, blob)):
            self.assertEqual(runner.fetch_verified(path, digest), blob)

    def test_source_integrity_rejects_wrong_byte_or_redirect(self):
        path = "contracts/phase1c_disconnect_reference.mjs"
        with mock.patch.object(runner.urllib.request, "urlopen",
                               return_value=Response(runner.BASE+path, b"tampered")):
            with self.assertRaises(RuntimeError):
                runner.fetch_verified(path, "0"*40)
        with mock.patch.object(runner.urllib.request, "urlopen",
                               return_value=Response("https://evil.example/", b"test")):
            with self.assertRaises(RuntimeError):
                runner.fetch_verified(path, runner.git_blob_sha(b"test"))

    def test_source_path_escape_rejected_before_network(self):
        with mock.patch.object(runner.urllib.request, "urlopen",
                               side_effect=AssertionError("unexpected network")):
            for value in ("/tmp/hidden", "../other", "x/../../secret"):
                with self.assertRaises(ValueError):
                    runner.fetch_verified(value, "0"*40)

    def test_launcher_loopback_and_no_embedded_credentials(self):
        src = SCRIPT.read_text()
        shell = SHELL.read_text()
        note = README.read_text()
        self.assertIn('("127.0.0.1", 0)', src)
        self.assertIn('ThreadingHTTPServer', src)
        self.assertIn('webbrowser.open(url)', src)
        self.assertIn('command -v python3', shell)
        self.assertIn('close the browser tab', note.lower())
        self.assertIn('six-digit', note.lower())
        for contents in (src, shell, note):
            for forbidden in ("sb_secret_", "fftt_submit_match_result_v1",
                              "fftt_manage_staff_v1", "FFTT3_PLAYER_EMAIL",
                              "storage.setItem", "admin.generateLink",
                              "auth/v1/otp"):
                self.assertNotIn(forbidden, contents)


if __name__ == "__main__":
    unittest.main()
