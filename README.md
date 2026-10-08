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

For the hosted edition, enable **GitHub Pages** in the repository settings:
**Settings → Pages → Build and deployment → Deploy from a branch → main → /(root) → Save**.

Expected published URL after Pages deployment:
https://0xcls.github.io/fftt-bracket-manager/

## Important data behavior

**Tournament data is saved only in the current browser's local storage.** This app does not synchronize brackets between devices, send data to GitHub, or provide a spectator feed. Use the **Export backup** button regularly during events; store the JSON backups privately. Opening the hosted URL on another computer or phone will not load the first device's data unless you explicitly import a backup.

The app displays individual players' names and internal skill ratings to operators. Keep this view with tournament staff, do not project ratings publicly, and do not commit participant rosters, backups, or other private player information to this public repository.

## Status

**v0.1 baseline:** This is the uploaded initial single-file application. Treat the first hosted deployment as a preview until the full match-flow and event-day backup/restore workflow have been tested with sample players. In particular, check the intended minimum-matches experience against the actual number of players, brackets, byes, and tables. The doubles finale in v0.1 supports team selection, not recording its match result.

## Development

The project intentionally starts with `index.html` as its only application file. Keep changes lightweight; preserve a testable backup before event day. This code repository is distinct from the private FFTT event-planning and historical-record repository.
