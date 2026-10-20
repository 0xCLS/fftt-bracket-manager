# FFTT Bracket Manager

A lightweight, single-file tournament desk for **Forging Fellowship Table Tennis Games** at Ypsilanti SDA Church.

## What it does

- Check in and internally rate players (FFTT Levels 1–5) using compact, keyboard-accessible five-level selectors instead of rating dropdowns. The labels remain internal; selecting a rating still updates the original player data and Undo history.
- Seed and manage the championship bracket.
- Move players who lose their first actual championship match into a reviewed consolation pool.
- Record singles match results and manage a match queue for multiple tables.
- Select mixed-skill doubles finale partners for the championship finalists.
- Print the current view, export a JSON event backup, restore a backup, and export a text results summary.

**Approved hosted browser rehearsal (October 19, 2026):** [One new pinned fictional fixture and signed C8 browser scoring workflow](docs/MILESTONE1_HOSTED_BROWSER_REHEARSAL_2026-10-19.md) are staged for the separately authorized one-time dual-scorekeeper browser test. The two previous hosted fixtures are consumed and cannot be selected. No new score has been submitted; no production deployment or participant migration. 

## Roadmap

Christopher approved a **three-milestone delivery plan** on October 12, 2026. See [ROADMAP.md](ROADMAP.md) for scope, sequencing, original phase-number mapping and explicit approval gates:

1. **Secure Shared Foundation (in progress):** trustworthy central state, organizer-authorized accounts, privacy-safe public projections, score conflicts, audit and offline recovery.
2. **Player & Tournament Preparation:** organizer-reviewed private Google Sheets registration intake, provisional rating suggestions, check-in, deduplication and bracket seeding.
3. **Live Tournament Operations & Results:** mobile volunteer scoring, synchronized bracket/Now Playing views, public spectator/TV displays, table tracking, doubles-result recording, exports and basic event history.

**Latest integrated backend/client candidate:** [Atomic decision and recovery implementation with verification boundaries](docs/MILESTONE1_BACKEND_CLIENT_CANDIDATE.md). V2 scoring SQL was **explicitly approved and applied to the isolated synthetic Supabase development project on October 13**; the old v1 score RPC is disabled for browser roles, and a fresh fictional 2099 fixture is ready. The **hosted signed V2 race and independent Supabase audit PASSED October 13**: one accepted, one durable stale-rejected decision; the fixture is consumed. See [verified hosted evidence](docs/MILESTONE1_HOSTED_V2_AUDIT.md). See [one-time hosted runbook](docs/MILESTONE1_HOSTED_V2_RUNBOOK.md). The browser adapter remains disabled-write, the public app is unchanged and no real data was transferred.

**Connected synthetic browser rehearsal (development only):** [Milestone 1 signed revision/Match Desk integration](docs/MILESTONE1_CONNECTED_BROWSER.md) extends the localhost C8 read-only view to read the deployed V2 server revision twice around the private desk, fail closed on conflicting reads and clear data on disconnect. Two-device/outsider mock-browser regression is included. **No score writes, automatic synchronization, hosted fixture rerun or production rollout.**

**Synthetic score/recovery workflow (new):** [Milestone 1 Score & Recovery Lab](docs/MILESTONE1_SCORE_RECOVERY_LAB.md) includes a **loopback-only** signed V2 scoring transport, strict pre-send submission-ID record and own-receipt recovery controls, organizer-only offline fallback preview and a usable **zero-network in-memory two-scorekeeper browser lab**. These are test/development components, **not enabled against hosted Supabase or the live application**. The previously consumed B2i and V2 hosted fixtures remain immutable.

**Synthetic integration status:** [Milestone 1 evidence and remaining integrated delivery batches](docs/MILESTONE1_INTEGRATION_STATUS.md). The production GitHub Pages app is unchanged, while an isolated localhost rehearsal can display allowlisted synthetic public results.

**Phase 0 design is approved.** Supabase is authorized **only for isolated synthetic development**. An organizer-owned Free development project has been used for hosted synthetic tests in **unmerged** Phase 1B/1C draft branches. The public `main` application is still **browser-local, not a shared scoring service**. The [architecture proposal](docs/PHASE1_SHARED_EVENT_ARCHITECTURE.md), [Phase 1A contract](docs/PHASE1A_SHARED_EVENT_CONTRACT.md) and [machine-readable policies](contracts/phase1a_v1.json) remain security references. The development milestone consolidation **does not approve real participant migration, production infrastructure, public participant-name publication or live cutover**.

## Run it

Open `index.html` in a browser. No installation, database, or server is required.

The hosted version is deployed through **GitHub Pages** from the `main` branch and repository root. Live application:
https://0xcls.github.io/fftt-bracket-manager/

## Social sharing preview

The public GitHub Pages link uses static Open Graph and Twitter Card metadata for supported messaging and social apps.

- Public URL: https://0xcls.github.io/fftt-bracket-manager/
- **Approved social card (October 8, revised for clarity):** [1200×630 PNG](assets/fftt-bracket-manager-og-v2.png)
- **Full-resolution approved source:** [1731×909 PNG](assets/fftt-bracket-manager-og-v2-source.png)
- Display title: `FFTT Bracket Manager`
- Description: `Forging Fellowship Table Tennis Games · Building community through fellowship.`

The [social image build workflow](.github/workflows/render-social-card.yml) can regenerate the 1200×630 PNG from the full-resolution approved source using high-quality resampling. The previous [SVG card](assets/fftt-bracket-manager-og.svg) and its initial [render](assets/fftt-bracket-manager-og.png) are historical provenance and are **not** the active social image; they had used an 80-pixel emblem scaled up in the share preview. Pixel-region and file-size tests protect the current image against a blank or severely degraded logo. Messaging apps cache link previews independently, so existing conversations may show an older card for a while. The card contains no real participant details, private ratings, or live results and does not imply cloud synchronization.

## Interface

The interface uses Christopher's approved light-gray, charcoal and pastel [FFTT design system](docs/DESIGN_SYSTEM.md), with an off-white icon sidebar, readable forms, status pills and bracket controls. The design phase was accepted on October 8, 2026. The organizer's FFTT artwork is embedded as the app icon and browser favicon. Styling is still embedded locally in `index.html`, with no framework, font request or runtime image dependency.

## Registration sheet integration (planned)

The organizer maintains event sign-ups in a separate private Google Sheet with playing-history and self-assessment questions. **This build does not fetch that Sheet or automatically import its rows.** Current seeding operates on FFTT ratings entered by staff. A future organizer-only, review-before-import workflow could read names and playing-assessment answers, suggest *provisional* ratings, let staff confirm them, and then build balanced opening matchups. Contact fields (email and phone) should not be imported into the bracket or exposed in a public-facing view. Avoid embedding private Sheet credentials, access tokens, or unprotected participant data in this public GitHub Pages app.

## Important data behavior

**Tournament data is saved only in the current browser's local storage.** GitHub Pages hosts the code but does not store tournament results or synchronize devices. It does not send data to GitHub or provide a live spectator feed. The hosted URL, a locally opened HTML file, a different browser profile, and a second computer can each have separate data. Browser storage may disappear if site data is cleared, in a private/incognito session, or after a device/browser failure.

**FFTT3 event-day procedure:** Run the tournament on one organizer device in a normal browser profile. Use **Export backup** after check-in and bracket creation, after each major round, and before making a risky change. Keep at least one private copy outside the device (e.g., a secure Drive folder or USB), and rehearse **Import JSON** on a second device before the event. Never commit event backups, phone numbers or email addresses to this public repository.

If simultaneous organizers or live spectators become necessary later, add a separately authenticated backend with access roles and a privacy-safe public read-only view. Do not place Google Sheets credentials or a writable database secret in this static frontend.

The app displays individual players' names and internal skill ratings to operators. Keep this view with tournament staff, do not project ratings publicly, and do not commit participant rosters, backups, or other private player information to this public repository.

## Status

**v0.1, rehearsal-hardened:** The championship and consolation flows have automated browser tests across 17 different player counts (2–48) plus alternative winner paths. A second test checks score validation, destructive-rebuild confirmation, backup export/restore, and malformed-import rejection. Ratings guide first-round matchmaking and stronger expected winners are distributed across the bracket. On uneven fields, higher-rated players receive byes.

**Minimum matches:** Tests confirmed at least two real matches per player for the simulated 4–48-player fields **when the consolation bracket is played through**. A 2- or 3-player field cannot reliably guarantee two matches in this bracket format; use a manual round robin or rematch plan. The consolation bracket can be built only after all checked-in players have completed their first actual championship match.

**Before event-day use:** Do an organizer rehearsal on the device and browser that will run the tournament, export a backup, verify a restore, and bring a printed bracket or score-sheet fallback. JSON backup/restore is manual, not live synchronization. The Match Desk lists playable matches and records their table numbers after play; it does not reserve tables or block simultaneous scheduling conflicts. The doubles finale supports team selection but **does not yet record the doubles match result**.

**Scores:** You may record only the winner (leave scores blank). If entering scores, use per-game scores in the displayed player order, such as `11-8, 8-11, 11-7`; the app checks the winner, game count, and 11-point win-by-two rule.

## Development

The application is intentionally a single file, `index.html`. The optional browser tests are kept separately in `tests/` and need Python Playwright plus its Chromium browser:

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/rehearsal.py
python tests/safety.py
python tests/ui_smoke.py
python -m unittest discover -s tests -p 'test_phase1a_contract.py' -v
```

The three Playwright suites run in an isolated browser with synthetic players and simulated local storage. The Phase 1A standard-library suite tests an **in-memory contract reference**, not real authorization, synchronization, or Supabase. No suite touches the live event's data. A GitHub Actions browser-regression workflow also runs these checks when the application or tests change. The UI smoke test covers select arrow/spacing, roster labels, winner radio-group labeling, and the mobile player form. On systems with a separately installed Chromium, set `FFTT_CHROMIUM_BIN` to its executable path.

Keep changes lightweight; preserve a backup before event day. This public code repository is distinct from the private FFTT event-planning and historical-record repository.
