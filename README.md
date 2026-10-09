# FFTT Bracket Manager

A lightweight, single-file tournament desk for **Forging Fellowship Table Tennis Games** at Ypsilanti SDA Church.

## What it does

- Check in and internally rate players (FFTT Levels 1–5) using compact, keyboard-accessible five-level selectors instead of rating dropdowns. The labels remain internal; selecting a rating still updates the original player data and Undo history.
- Seed and manage the championship bracket.
- Move players who lose their first actual championship match into a reviewed consolation pool.
- Record singles match results and manage a match queue for multiple tables.
- Select mixed-skill doubles finale partners for the championship finalists.
- Print the current view, export a JSON event backup, restore a backup, and export a text results summary.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the current feature inventory and proposed sequence. **The current design is approved. Phase 1 now focuses on a secure, authoritative shared event database and permission model** before adding multiple scorekeeping devices or spectator feeds. Start with [the architecture proposal](docs/PHASE1_SHARED_EVENT_ARCHITECTURE.md). Christopher approved Supabase **for an isolated synthetic-data prototype only**. An isolated Supabase Free development database is now provisioned, but the public application is **not connected to it**, and no production deployment or real participant migration is approved. The provider-neutral [Phase 1A contract](docs/PHASE1A_SHARED_EVENT_CONTRACT.md) and [machine-readable permission/field policy](contracts/phase1a_v1.json) define the next security gates. **Phase 1B backend** now includes verified synthetic-only hosted Supabase migrations, actual signed-JWT authentication/role/privacy tests (B2h), and an **independently audited hosted two-scorekeeper score conflict PASS** on one fictional match (B2i). That isolated match is complete and must not be replayed. [Milestone details](docs/PHASE1B_SUPABASE_IMPLEMENTATION.md). **Phase 1C draft C1–C4** includes a tested no-network offline/reconnection authority state machine ([C1](docs/PHASE1C_C1_OFFLINE_AUTHORITY.md)), mock client orchestration ([C2](docs/PHASE1C_C2_MOCKED_SHARED_CLIENT.md)), strictly read-only development-Supabase protocol mapper ([C3](docs/PHASE1C_C3_READONLY_PROTOCOL.md)), and a **standalone localhost Chromium rehearsal** for mock organizer/scorekeeper/spectator views and blocked reconnect ([C4](docs/PHASE1C_C4_BROWSER_REHEARSAL.md)). The C4 browser rehearsal **uses only fake responses and is not integrated into the actual app**. Ordinary volunteer login/recovery, real connected multi-device UI, private backup reconciliation, corrections/byes, publication and event-day cutover remain pending. **The live application still saves only to its browser's existing localStorage.**

## Run it

Open `index.html` in a browser. No installation, database, or server is required.

The hosted version is deployed through **GitHub Pages** from the `main` branch and repository root. Live application:
https://0xcls.github.io/fftt-bracket-manager/

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
