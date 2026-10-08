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
    assert page.locator("nav.tabs button .nav-icon").count() == 7
    assert page.locator("nav.tabs button .nav-index").count() == 0
    assert page.locator("nav.tabs button .nav-icon[aria-hidden='true']").count() == 7
    print("PASS app branding and seven accessible icon navigation entries")

    # Major visual composition: this is a genuinely new overview, not only
    # different background and corner-radius tokens.
    feature = page.locator(".overview-feature")
    assert feature.is_visible()
    assert page.get_by_role("heading", name="Ready for the next great match.").count() == 1
    assert page.locator(".overview-settings").is_visible()
    assert page.locator(".overview-snapshot").is_visible()
    assert page.locator(".overview-format").is_visible()
    assert page.get_by_text("Three stages. More play.").is_visible()
    layout = page.evaluate("""() => {
      const hero = document.querySelector('.overview-feature').getBoundingClientRect();
      const setup = document.querySelector('.overview-settings').getBoundingClientRect();
      const snapshot = document.querySelector('.overview-snapshot').getBoundingClientRect();
      return {
        heroWidth: hero.width, heroHeight: hero.height,
        setupX: setup.x, snapshotX: snapshot.x,
        sidebar: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
        hero: getComputedStyle(document.querySelector('.overview-feature')).backgroundColor,
        heroImage: getComputedStyle(document.querySelector('.overview-feature')).backgroundImage,
        heroCorner: parseFloat(getComputedStyle(document.querySelector('.overview-feature')).borderTopLeftRadius),
        heroDecoration: !!document.querySelector('.overview-feature-art'),
        setupBottom: setup.bottom, snapshotBottom: snapshot.bottom,
        setupWidth: setup.width, snapshotWidth: snapshot.width,
        format: document.querySelector('.overview-format').getBoundingClientRect().toJSON(),
        status: document.querySelector('.statusline').getBoundingClientRect().toJSON(),
        statusPosition: getComputedStyle(document.querySelector('.statusline')).position,
        statusAlignment: getComputedStyle(document.querySelector('.statusline')).justifyContent,
        formatColumns: getComputedStyle(document.querySelector('.format-steps')).gridTemplateColumns,
        statusFirst: document.querySelector('.statusline').compareDocumentPosition(document.querySelector('.page-intro')) & Node.DOCUMENT_POSITION_FOLLOWING

      };
    }""")
    assert 90 < layout["heroHeight"] < 365 and layout["heroWidth"] > 650, layout
    assert layout["hero"] == "rgba(0, 0, 0, 0)" and layout["heroImage"] == "none", layout
    assert layout["heroCorner"] == 0 and not layout["heroDecoration"], layout
    assert layout["snapshotX"] > layout["setupX"] + 250, layout
    assert layout["sidebar"] == "rgb(251, 252, 253)", layout
    palette = page.evaluate("""() => {
      const bg = selector => getComputedStyle(document.querySelector(selector)).backgroundColor;
      const color = selector => getComputedStyle(document.querySelector(selector)).color;
      return {
        canvas: bg('body'),
        headline: color('.overview-feature h2'),
        settings: bg('.overview-settings'),
        snapshotOuter: bg('.overview-snapshot'),
        kpis: [...document.querySelectorAll('.overview-snapshot .kpi')].map(el => getComputedStyle(el).backgroundColor),
        stages: [...document.querySelectorAll('.overview-format .format-steps li')].map(el => getComputedStyle(el).backgroundColor),
        primary: bg('.overview-save-row button')
      };
    }""")
    assert palette["canvas"] == "rgb(242, 243, 245)", palette
    assert palette["settings"] == "rgb(255, 255, 255)", palette
    assert palette["snapshotOuter"] == "rgba(0, 0, 0, 0)", palette
    assert palette["headline"] == "rgb(41, 49, 60)", palette
    assert palette["kpis"] == [
      "rgb(209, 239, 245)", "rgb(233, 215, 243)",
      "rgb(187, 217, 143)", "rgb(247, 233, 155)"
    ], palette
    assert len(set(palette["stages"])) == 3, palette
    assert palette["primary"] == "rgb(41, 49, 60)", palette
    print("PASS cool-neutral pastel Overview palette and independently colored KPI tiles")
    assert layout["format"]["y"] >= max(layout["setupBottom"],layout["snapshotBottom"]) - 1, layout
    assert layout["format"]["width"] >= layout["setupWidth"] + layout["snapshotWidth"], layout
    assert layout["formatColumns"].count("px") == 3, layout
    assert layout["statusPosition"] == "fixed" and layout["statusAlignment"] == "flex-end", layout
    assert abs(layout["status"]["y"]) < 1, layout
    assert abs(layout["status"]["x"] + layout["status"]["width"] - 1440) <= 45, layout
    original_pills = page.locator(".statusline").bounding_box()
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(120)
    scrolled_pills = page.locator(".statusline").bounding_box()
    assert original_pills and scrolled_pills, (original_pills, scrolled_pills)
    assert abs(original_pills["y"] - scrolled_pills["y"]) < 1, (original_pills, scrolled_pills)
    page.evaluate("window.scrollTo(0, 0)")
    assert layout["statusFirst"], layout
    assert page.locator(".statusline > .pill").count() == 4
    print("PASS balanced Overview cards and four viewport-fixed top-right status pills")

    print("PASS approved pastel Overview and balanced layout")
    page.locator('.overview-feature [data-go="players"]').click()
    assert page.locator("#players").is_visible()
    assert page.locator(".topbar").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(251, 252, 253)"
    assert page.locator("body").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(242, 243, 245)"
    assert page.locator("#players .card").first.evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(255, 255, 255)"
    assert page.locator("#players .section-pills .pill").count() == 3
    assert page.locator("#players .pill.good").count() >= 1
    print("PASS Players uses approved light surfaces, semantic pills and neutral background")
    page.locator('nav.tabs button[data-tab="setup"]').click()
    assert page.locator(".topbar").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(251, 252, 253)"
    assert feature.is_visible()
    print("PASS Overview hero action routes to Players and back")


    # Ensure the component system matches floating white tiles rather than
    # multiple heavily rounded / tinted nested trays.
    surfaces = page.evaluate("""() => {
      const read = (selector) => {
        const st = getComputedStyle(document.querySelector(selector));
        return {
          bg: st.backgroundColor, image: st.backgroundImage,
          radius: parseFloat(st.borderTopLeftRadius),
          border: parseFloat(st.borderTopWidth),
          shadow: st.boxShadow
        };
      };
      return {
        canvas: getComputedStyle(document.body).backgroundColor,
        card: read('.overview-settings'),
        kpi: read('.overview-snapshot .kpi'),
        bracket: read('#champBracket'),
        queue: read('#matchQueue')
      };
    }""")
    assert surfaces["card"]["bg"] == "rgb(255, 255, 255)", surfaces
    assert surfaces["card"]["radius"] <= 6 and surfaces["kpi"]["radius"] <= 6, surfaces
    assert surfaces["card"]["image"] == "none", surfaces
    assert surfaces["card"]["shadow"] != "none", surfaces
    assert surfaces["bracket"]["border"] == 0, surfaces
    assert surfaces["queue"]["bg"] == "rgba(0, 0, 0, 0)", surfaces
    print("PASS floating card surfaces and unframed match containers")


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
    print("PASS Status dropdown width, chevron and associated label")

    # FFTT 1–5 ratings use native accessible segmented radio choices.
    add_radios = page.locator('#addPlayerForm input[name="addRating"]')
    assert add_radios.count() == 5
    assert add_radios.nth(2).is_checked()
    assert page.locator("#playerRating").count() == 0
    assert page.locator("#ratingHint").inner_text() == "Level 3 · Intermediate"
    add_radios.nth(2).focus()
    add_radios.nth(2).press("ArrowRight")
    assert add_radios.nth(3).is_checked()
    assert page.locator("#ratingHint").inner_text() == "Level 4 · Strong Intermediate"
    page.locator("#addPlayerForm .rating-choice").nth(2).click()
    assert page.locator("#ratingHint").inner_text() == "Level 3 · Intermediate"
    assert page.get_by_role("group", name="FFTT rating").count() == 1
    print("PASS keyboard-operable add-player five-level rating selector")

    page.locator("#bulkPlayers").fill(
        "Example Alpha,1,provisional\n"
        "Example Beta,2,established\n"
        "Example Gamma,3,provisional\n"
        "Example Delta,4,established"
    )
    page.locator("#bulkAddBtn").click()
    assert page.locator(".roster-check").count() == 4
    assert page.locator("#playersPills .pill").count() == 3
    assert page.locator("#playersPills").get_by_text("4 registered").count() == 1
    assert page.locator("#playersPills").get_by_text("4 checked in").count() == 1
    assert page.locator("#playersPills").get_by_text("Ratings private").count() == 1
    print("PASS player-context pills show real roster counts")
    rating_rows = page.locator(".roster-rating-fieldset")
    assert rating_rows.count() == 4
    assert page.locator(".roster-rating").count() == 20
    first_rating = page.locator(".roster-rating-fieldset").first
    assert first_rating.locator('input[value="1"]').is_checked()
    first_rating.locator('label.rating-choice').nth(4).click()
    assert page.locator(".roster-rating-fieldset").first.locator('input[value="5"]').is_checked()
    saved = page.evaluate("JSON.parse(localStorage.getItem('fftt_bracket_manager_v01')).players")
    assert next(p["rating"] for p in saved if p["name"] == "Example Alpha") == 5
    page.locator("#undoBtn").click()
    restored = page.evaluate("JSON.parse(localStorage.getItem('fftt_bracket_manager_v01')).players")
    assert next(p["rating"] for p in restored if p["name"] == "Example Alpha") == 1
    print("PASS roster segmented rating change persists and Undo restores")

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
    match_style = page.evaluate("""() => {
      const m = document.querySelector('#champBracket .match');
      const st = getComputedStyle(m);
      return {radius: parseFloat(st.borderTopLeftRadius), shadow: st.boxShadow};
    }""")
    assert match_style["radius"] <= 10 and match_style["shadow"] != "none", match_style
    print("PASS compact match-card geometry")
    assert page.locator("#champPills .pill").count() == 3
    assert page.locator("#champBracket .match-head-meta .pill").count() > 0
    assert page.locator("#champBracket .match-head-meta .pill.blue").count() >= 1
    page.locator('nav.tabs button[data-tab="consolation"]').click()
    assert page.locator("#consPills .pill").count() >= 2
    for tab in ["championship","consolation","desk","finale","data"]:
        page.locator(f'nav.tabs button[data-tab="{tab}"]').click()
        assert page.locator(".topbar").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(251, 252, 253)"
        assert page.locator("body").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(242, 243, 245)"
        assert page.locator("#viewTitle").evaluate("el => getComputedStyle(el).color") == "rgb(41, 49, 60)"
        assert page.locator(".statusline > .pill").count() == 4
    print("PASS all seven tabs share cool-neutral approved color system")
    page.locator('nav.tabs button[data-tab="finale"]').click()
    assert page.locator("#finalePills .pill").count() == 2
    page.locator('nav.tabs button[data-tab="data"]').click()
    assert page.locator("#dataPills .pill").count() == 3
    assert page.locator("#dataPills").get_by_text("No cloud sync").count() == 1
    print("PASS contextual status pills across championship, consolation, finale and recovery")

    page.locator('nav.tabs button[data-tab="desk"]').click()
    assert page.locator(".record-result").count() > 0
    assert page.locator("#deskPills .pill").count() == 3
    assert page.locator(".queue-card-meta .pill.good").count() > 0
    assert page.locator("#tableLegend .pill").count() == 2
    print("PASS status and table pills in Match Desk")
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
    mobile_rating = page.locator(".rating-scale").first.bounding_box()
    assert mobile_rating is not None and mobile_rating["width"] <= 390
    assert page.locator('#addPlayerForm input[name="addRating"]').count() == 5
    print("PASS mobile segmented rating controls and developer credit")
    page.locator('nav.tabs button[data-tab="data"]').click()
    assert page.locator("#dataPills").is_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")
    print("PASS contextual pills fit mobile view")

    page.locator('nav.tabs button[data-tab="setup"]').click()
    feature_box = page.locator(".overview-feature").bounding_box()
    assert feature_box is not None and feature_box["width"] <= 390
    assert page.locator(".overview-settings").is_visible()
    assert page.locator(".overview-snapshot").is_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")
    mobile_format = page.locator(".overview-format").bounding_box()
    mobile_setup = page.locator(".overview-settings").bounding_box()
    assert mobile_format is not None and mobile_setup is not None
    assert mobile_format["y"] > mobile_setup["y"] + mobile_setup["height"]
    assert page.locator(".statusline > .pill").count() == 4
    mobile_pills = page.locator(".statusline").bounding_box()
    assert mobile_pills is not None and abs(mobile_pills["y"]) < 1, mobile_pills
    assert mobile_pills["width"] <= 390 and abs(mobile_pills["x"]) < 1, mobile_pills
    assert page.locator(".statusline").evaluate("el => getComputedStyle(el).position") == "fixed"
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(120)
    mobile_after_scroll = page.locator(".statusline").bounding_box()
    assert mobile_after_scroll is not None and abs(mobile_after_scroll["y"] - mobile_pills["y"]) < 1, (mobile_pills,mobile_after_scroll)
    assert page.locator(".overview-snapshot .kpi").count() == 4
    mobile_tiles = page.locator(".overview-snapshot .kpi").all()
    assert all(tile.is_visible() for tile in mobile_tiles)
    assert page.locator(".overview-format .format-steps li").count() == 3
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 2")
    print("PASS pastel Overview tiles and stages fit phone viewport")
    print("PASS four global pills remain anchored to viewport on desktop/mobile")


    assert not errors, errors
    print("PASS no page JavaScript errors")
    browser.close()
