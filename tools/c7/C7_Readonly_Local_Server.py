#!/usr/bin/env python3
"""Mac C7 rehearsal: fetch immutable, SHA1-verified public-source files;
serve C6 browser UI on loopback. NO login emails unless user clicks in UI.
"""
from __future__ import annotations

import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import tempfile
import threading
import urllib.request
import webbrowser

REPO = "0xCLS/fftt-bracket-manager"
COMMIT = "355b916cf3e2905d1aa89a144e08da43e311b39a"
FILES = {
    "rehearsals/c6/index.html": "951ce1c277a93fed9f483a0b03ff6e16ca302dfe",
    "rehearsals/c6/read-only.css": "d81d5447770bda43a29e0eb3e29ea3d463afa2ab",
    "rehearsals/c6/read-only.mjs": "73543e77f1377423de4ce532fbf5bf69167f4d48",
    "rehearsals/c4/rehearsal.css": "1c5fffbd64813f626e40447874963ef1867d0a96",
    "contracts/phase1c_c6_existing_user_otp.mjs": "b47e38ee3aed12b7d23d91198c1c52315712d0c3",
    "contracts/phase1c_c3_readonly_supabase_transport.mjs": "60a461caebfe863511ea63de4e157e26386230a7",
    "contracts/phase1c_disconnect_reference.mjs": "8fc647ce83a0377245576dde7c0c82c5be18f548",
}
BASE = f"https://raw.githubusercontent.com/{REPO}/{COMMIT}/"


def git_blob_sha(data: bytes) -> str:
    prefix = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(prefix + data).hexdigest()


def fetch_verified(path: str, sha: str) -> bytes:
    if path.startswith("/") or ".." in Path(path).parts:
        raise ValueError("Invalid source path")
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "FFTT-C7-Local-Only-Read-Test/1"})
    with urllib.request.urlopen(req, timeout=20) as res:
        if res.geturl() != BASE + path:
            raise RuntimeError("Unexpected source redirect. No file accepted.")
        data = res.read(250_000)
    if len(data) >= 250_000 or git_blob_sha(data) != sha:
        raise RuntimeError(f"Pinned source integrity check failed for {path}")
    return data


class SilentHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def run():
    print("FFTT PHASE 1C C7 — EXISTING USER READ-ONLY LOGIN REHEARSAL")
    print("Synthetic development project ONLY. No scores, results or staff changes.")
    print("No email is sent until YOU choose 'Request six-digit code' in the browser.")
    print("Existing account only. The hosted email template might provide a link, not a code.")
    print("If no six-digit code arrives, DO NOT click or paste a magic link here.")
    print("No keys, OTPs, JWTs or private event IDs should ever be pasted into Terminal.")
    print(f"\nPinned public source commit: {COMMIT}")
    print("Fetching 7 publicly available source files; verifying exact Git blob checksums...")
    scratch = Path(tempfile.mkdtemp(prefix="fftt-c7-readonly-"))
    server = None
    thread = None
    try:
        for path, expected in FILES.items():
            data = fetch_verified(path, expected)
            output = scratch / path
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
        print("PASS: All 7 pinned source checksums match reviewed GitHub files.")
        class LocalHandler(SilentHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(scratch), **kwargs)
        server = ThreadingHTTPServer(("127.0.0.1", 0), LocalHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/rehearsals/c6/index.html"
        print("Serving ONLY on your Mac (127.0.0.1). Browser opens shortly.")
        print("Public results may be read automatically; private Auth requests require user action.")
        webbrowser.open(url)
        print("\nIn the browser: choose existing synthetic organizer email, not FFTT3 contacts.")
        print("After SIGNED IN, enter the private 2099 synthetic event UUID and click read-only matchdesk.")
        print("Share ONLY safe display statuses afterwards; NEVER share OTP, JWT, private keys or magic links.")
        input("\nWhen finished, CLOSE THE BROWSER TAB, then press Return here to stop: ")
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
        if thread is not None:
            thread.join(timeout=3)
        shutil.rmtree(scratch, ignore_errors=True)
        print("Local server stopped and temporary public-source files cleared.")


if __name__ == "__main__":
    try:
        run()
    except (OSError, RuntimeError, ValueError, TimeoutError) as error:
        # Never print browser/session details or stack traces to casual users.
        print("SAFE STOP:", type(error).__name__, "— verify internet, Python 3 and pinned source access.")
        print("No email was sent from the launcher. Browser login requires separate user click.")
        raise SystemExit(1)
