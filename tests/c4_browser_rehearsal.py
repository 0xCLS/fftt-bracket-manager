#!/usr/bin/env python3
"""Isolated C4 Chromium rehearsal: localhost static files + fake JS responses.

No Supabase network calls, no real event/participant data, no browser storage
writes, no web app integration, no scoring POSTs. CI runs headless Playwright.
"""
from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT_HOST = "127.0.0.1"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(condition, message):
    assert condition, message
    print("PASS:", message, flush=True)


server = ThreadingHTTPServer((PORT_HOST, 0), partial(QuietHandler, directory=str(ROOT)))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.environ.get("FFTT_CHROMIUM_BIN") or None,
            headless=True, args=["--no-sandbox"],
        )
        page = browser.new_page(viewport={"width": 1240, "height": 920})
        browser_errors = []
        external_requests = []
        page.on("pageerror", lambda error: browser_errors.append(str(error)))
        page.on("request", lambda request: (
            external_requests.append(request.url)
            if not request.url.startswith(f"http://{PORT_HOST}:{server.server_port}/")
            else None
        ))
        page.goto(
            f"http://{PORT_HOST}:{server.server_port}/rehearsals/c4/index.html",
            wait_until="networkidle",
        )
        page.get_by_role("heading", name="Shared matchdesk rehearsal").wait_for()
        page.get_by_role("heading", name="Cloud ready (mock)").wait_for()
        check(
            page.get_by_text("SYNTHETIC REHEARSAL ONLY").count() == 1,
            "Explicit synthetic rehearsal warning displayed",
        )
        check(
            page.locator("#matchdesk .match").count() == 1,
            "Organizer mock reads exactly one synthetic match",
        )
        check(
            page.locator("#publicResults .match").count() == 1,
            "Public projection shows only synthetic match presentation",
        )
        check(
            "Synthetic Red vs. Synthetic Blue"
            in page.locator("#matchdesk").inner_text(),
            "Fake match players displayed",
        )
        check(
            page.get_by_role("button", name="Read mock data").is_enabled(),
            "Read button available in mock-ready state",
        )
        check(
            page.get_by_text("Score writes: 0").count() == 1,
            "No scoring action/POST is present",
        )
        initial_reads = page.locator("#requestCount").inner_text()

        page.locator("#role").select_option("scorekeeper")
        page.wait_for_function(
            "document.querySelector('#deskMessage').textContent.includes('scorekeeper')"
        )
        check(
            page.locator("#matchdesk .match").count() == 1,
            "Fake scorekeeper can view only assigned synthetic matchdesk",
        )
        page.locator("#role").select_option("spectator")
        page.wait_for_function(
            "document.querySelector('#deskMessage').textContent.includes('Spectators')"
        )
        check(
            page.locator("#matchdesk .match").count() == 0
            and page.locator("#publicResults .match").count() == 1,
            "Spectator denied private desk yet reads allowlisted public preview",
        )
        page.locator("#role").select_option("outsider")
        page.wait_for_function(
            "document.querySelector('#deskMessage').textContent.includes('Access denied')"
        )
        check(
            page.locator("#matchdesk .match").count() == 0,
            "Unaffiliated mock identity is denied staff matchdesk",
        )

        page.locator("#role").select_option("organizer")
        page.wait_for_function(
            "document.querySelector('#deskMessage').textContent.includes('organizer')"
        )
        page.get_by_role("button", name="Simulate disconnect").click()
        page.get_by_role("heading", name="Cloud paused — offline simulation").wait_for()
        paused_read_count = page.locator("#requestCount").inner_text()
        check(
            not page.locator("#refresh").is_enabled()
            and page.locator("#role").is_disabled()
            and page.locator("#reconnect").is_enabled(),
            "Disconnect disables reads and role switching",
        )
        check(
            page.locator("#recoveryWarning").is_visible()
            and "STALE" in page.locator("#deskMessage").inner_text(),
            "Offline state warns about stale cached match data",
        )
        check(
            paused_read_count == page.locator("#requestCount").inner_text(),
            "No reads occur after mock network disconnect",
        )
        page.get_by_role("button", name="Simulate reconnect").click()
        page.get_by_role("heading", name="Reconnected — verification pending").wait_for()
        check(
            not page.locator("#refresh").is_enabled()
            and page.locator("#recoveryWarning").is_visible()
            and "Cloud scoring remains blocked."
            in page.locator("#recoveryWarning").inner_text(),
            "Reconnect cannot resume writes without trustworthy server snapshot",
        )
        check(
            not page.locator("#disconnect").is_enabled()
            and not page.locator("#reconnect").is_enabled(),
            "After reconnect mock stays fail-closed pending verification",
        )
        check(
            page.locator("#requestCount").inner_text() == paused_read_count,
            "No background retry or score POST after reconnection",
        )
        check(
            not external_requests,
            "Browser requested only localhost fixture assets",
        )
        check(
            not browser_errors,
            "C4 browser rehearsal produced no page script exceptions",
        )
        check(
            page.evaluate("localStorage.length") == 0,
            "C4 rehearsal never writes localStorage",
        )
        check(
            page.locator("button").count() == 3
            and page.locator("[type=submit]").count() == 0,
            "C4 screen contains no score or publish control",
        )
        # Desktop and mobile geometry/legibility; no horizontal scrolling.
        page.set_viewport_size({"width": 375, "height": 790})
        check(
            page.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth+1"
            ),
            "Responsive 375px rehearsal screen has no horizontal overflow",
        )
        check(
            page.locator("#recoveryWarning").is_visible(),
            "Recovery warning remains visible on mobile",
        )
        browser.close()

    print("C4 BROWSER REHEARSAL PASS: mock-only UI and fail-closed recovery")
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)
