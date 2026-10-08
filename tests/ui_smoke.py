"""Browser UI regression checks for the FFTT Bracket Manager.

Synthetic players only. No real sign-ups or persisted event data are used.
Run: python tests/ui_smoke.py
"""
from pathlib import Path
import os

from playwright.sync_api import sync_playwright

HTML = (Path(__file__).resolve().parent.parent / "index.html").read_text(encoding="utf-8")
BOOT = """() => {
  window.__testStorage = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() { return {
      setItem: (k, v) => window.__testStorage.set(k, v),
      getItem: k => window.__testStorage.get(k) || null,
      removeItem: k => window.__testStorage.delete(k),
      clear: () => window.__testStorage.clear()
    }}
  });
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("FFTT_CHROMIUM_BIN") or None,
        headless=True,
        args=["--no-sandbox"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("about:blank")
    page.evaluate(BOOT)
    page.set_content(HTML)

    assert page.title() == "FFTT Bracket Manager"
    assert page.get_by_text("Developed by Chris Smith").count() == 1
    assert page.locator(".brand-emblem").count() == 1
    assert page.locator("nav.tabs button").count() == 7
    print("PASS app and brand render")

    page.locator('nav.tabs button[data-tab="players"]').click()
    assert page.locator("#viewTitle").inner_text() == "Player management"
    geometry = page.locator("#playerRatingStatus").evaluate("""el => {
      const style = getComputedStyle(el);
      return {
        width: el.getBoundingClientRect().width,
        paddingRight: parseFloat(style.paddingRight),
        arrow: style.backgroundImage.includes("data:image/svg+xml"),
        appearance: style.appearance,
        labels: Array.from(el.labels || []).map(x => x.textContent.trim())
      };
    }""")
    assert geometry["width"] >= 170, geometry
    assert geometry["paddingRight"] >= 40, geometry
    assert geometry["arrow"] and geometry["appearance"] == "none", geometry
    assert geometry["labels"] == ["Status"], geometry
    print("PASS dropdown width, chevron and associated label")

    page.locator("#bulkPlayers").fill(
        "Example Alpha,1,provisional\n"
        "Example Beta,2,established\n"
        "Example Gamma,3,provisional\n"
        "Example Delta,4,established"
    )
    page.locator("#bulkAddBtn").click()
    assert page.locator(".roster-check").count() == 4

    unlabeled = page.evaluate("""() => Array.from(
      document.querySelectorAll('input, select, textarea')
    ).filter(el => {
      if (el.type === 'hidden' || el.type === 'file') return false;
      const hasLabel = (el.labels && el.labels.length > 0) ||
        el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
      return !hasLabel;
    }).map(el => el.outerHTML.slice(0, 160))""")
    assert not unlabeled, unlabeled
    print("PASS all roster and setup form controls have accessible names")

    page.locator("#buildChampBtn").click()
    page.locator('nav.tabs button[data-tab="desk"]').click()
    assert page.locator(".record-result").count() > 0
    page.locator(".record-result").first.click()
    assert page.get_by_role("radiogroup", name="Winner").count() == 1
    radios = page.locator('#winnerChoices input[type="radio"]')
    assert radios.count() == 2
    assert all(radios.nth(i).evaluate("el => el.labels.length > 0") for i in range(2))
    page.locator("#cancelResultBtn").click()
    print("PASS winner radio group labeling and match dialog")

    page.set_viewport_size({"width": 390, "height": 844})
    page.locator('nav.tabs button[data-tab="players"]').click()
    narrow = page.locator("#playerRatingStatus").evaluate("""el => {
      const rect = el.getBoundingClientRect();
      return {width: rect.width, fits: rect.right <= innerWidth + 1};
    }""")
    assert narrow["width"] >= 170 and narrow["fits"], narrow
    assert page.get_by_text("Developed by Chris Smith").count() == 1
    print("PASS mobile dropdown layout and developer credit")

    assert not errors, errors
    print("PASS no page JavaScript errors")
    browser.close()
