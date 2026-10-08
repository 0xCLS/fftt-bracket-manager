# FFTT Bracket Manager

A lightweight, single-file tournament desk for **Forging Fellowship Table Tennis Games** at Ypsilanti SDA Church.

## What it does

- Check in and internally rate players (FFTT Levels 1–5).
- Seed and manage the championship bracket.
- Move players who lose their first actual championship match into a reviewed consolation pool.
- Record singles match results and manage a match queue for multiple tables.
- Select mixed-skill doubles finale partners for the championship finalists.
- Print the current view, export a JSON event backup, restore a backup, and export a text results summary.

## Run it

Open `index.html` in a browser. No installation, database, or server is required.

The hosted version is deployed through **GitHub Pages** from the `main` branch and repository root. Live application:
https://0xcls.github.io/fftt-bracket-manager/

## Interface

The application uses a lightweight design system **inspired by [shadcn/ui](https://ui.shadcn.com/docs/theming)**: semantic CSS tokens, typography, accessible focus states, consistent field/button styles, and responsive navigation. FFTT navy/yellow branding is preserved. This is **not** a React/shadcn component installation: all styling is embedded locally in the original `index.html`, so the app stays usable offline.

## Registration sheet integration (planned)

The organizer maintains event sign-ups in a separate private Google Sheet with playing-history and self-assessment questions. **This build does not fetch that Sheet or automatically import its rows.** Current seeding operates on FFTT ratings entered by staff. A future organizer-only, review-before-import workflow could read names and playing-assessment answers, suggest *provisional* ratings, let staff confirm them, and then build balanced opening matchups. Contact fields (email and phone) should not be imported into the bracket or exposed in a public-facing view. Avoid embedding private Sheet credentials, access tokens, or unprotected participant data in this public GitHub Pages app.

## Important data behavior

**Tournament data is saved only in the current browser's local storage.** This app does not synchronize brackets between devices, send data to GitHub, or provide a spectator feed. Use the **Export backup** button regularly during events; store the JSON backups privately. Opening the hosted URL on another computer or phone will not load the first device's data unless you explicitly import a backup.

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
```

These tests run in an isolated browser with synthetic players and simulated local storage; they do not touch the live event's data. On systems with a separately installed Chromium, set `FFTT_CHROMIUM_BIN` to its executable path.

Keep changes lightweight; preserve a backup before event day. This public code repository is distinct from the private FFTT event-planning and historical-record repository.
