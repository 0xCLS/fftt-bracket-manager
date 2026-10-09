# Phase 1C C4 — Isolated browser rehearsal (mock data, no hosted connectivity)

**Status (October 9, 2026):** A standalone responsive browser prototype, its fake protocol/fixture layer and a real headless-Chromium test are staged in a **draft-only** branch. These are **not** the seven-screen FFTT Bracket Manager, a deployed GitHub Pages change, a real Supabase login, or a cloud write-capable app. There is no account setup, participant data import, staff change, production setting, or score mutation in this milestone.

## Files

- `rehearsals/c4/index.html` — a standalone no-scoring rehearsal view, with explicit banner **SYNTHETIC REHEARSAL ONLY · NO SUPABASE CONNECTION · NO SCORING**, role selector and online/offline/reconnect buttons. There is no score form, submit or publish control.
- `rehearsals/c4/rehearsal.css` — self-hosted, responsive, accessible styles; no external assets/fonts.
- `rehearsals/c4/rehearsal.mjs` — wires [C1's strict connectivity authority](PHASE1C_C1_OFFLINE_AUTHORITY.md), [C2's mock shared client](PHASE1C_C2_MOCKED_SHARED_CLIENT.md) and [C3's allowlisted read protocol](PHASE1C_C3_READONLY_PROTOCOL.md) together using an **injected JavaScript `fakeFetch` function**. `fakeFetch` inspects paths/verbs and returns only fictional fixed fixture data. It does **not** use the browser's global `fetch`.
- `tests/c4_browser_rehearsal.py` — starts a transient localhost-only static-file server, opens Chromium through Playwright, and checks real rendered UI behavior for organizer, scorekeeper, spectator, outsider, disconnect, stale labels, failed-safe reconnect, no secret leak/storage, and narrow phone viewport.
- `.github/workflows/phase1c-c4-browser.yml` — CI compiles JavaScript/Python and runs the browser test without a credential or hosted HTTP call.

## What the user-visible rehearsal demonstrates

| Situation | Visible simulated behavior | Safety requirement |
| --- | --- | --- |
| Initial organizer | One fictional eligible match from authorized-style private matchdesk read; one separate fictional public-projection match | No real player data; only C3 allowlisted fields |
| Scorekeeper | Same eligible fictional read; never a scoring button | Real server-side permissions still required in future |
| Spectator | No private staff desk; public presentation-only match labels | Ratings, raw contact info, staff information not present |
| Unassigned outsider | Staff role is denied, no staff match list; only fictional public presentation | No trusted role supplied by browser selector in production |
| Simulated disconnect | `cloud-paused` warning, stale visible rows, refresh and role changes disabled | No offline cloud queue, score POST or optimistic `saved` state |
| Simulated reconnect | `cloud-reloading`; prominent alert, controls remain blocked | C3 has **no trusted event revision/receipt snapshot RPC**, so cloud reads/writes cannot be considered ready |

The role selector represents **four fake test personas**, not real Auth credentials or an impersonation feature. Fixture IDs are fictional and unrelated to the real FFTT3 or completed B2i synthetic-hosted event. The CSP explicitly blocks external connections (`connect-src 'none'`); local module scripts and stylesheet come from the same isolated static-file server. The UI displays counters for simulated read requests and **zero score writes**. It intentionally has no persistence, cookie or browser storage migration.

## How to run locally

From a clone of the **C4 draft branch**:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8080/rehearsals/c4/index.html` on the same computer.

To run the automated browser rehearsal (requires Python Playwright and installed Chromium):

```sh
python3 tests/c4_browser_rehearsal.py
```

The automated suite uses an ephemeral localhost port and closes it afterward. GitHub Actions installs headless Chromium in an isolated CI environment. **Do not republish this rehearsal UI as an authenticated organizer/scorer interface.**

## Existing constraints and next steps

- Current [B2i hosted two-scorekeeper race](PHASE1B_B2I_HOSTED_SCORE_RACE.md) **already passed and completed its one fictional match**. Do not rerun its Mac launcher, reset the fixture or submit another test score without new approval.
- C1–C4 code remains in **stacked draft PRs** and does not modify `index.html`, `main`, localStorage, JSON backups, player registrations or GitHub Pages. The standalone rehearsal demonstrates only **mock** protocol/connection behavior; true connectivity, mobile volunteer sign-in and offline reconciliation have **not** been tested on real devices.
- Next safe work: a separate *draft-only*, browser-visible protocol/role read rehearsal with genuine **individually authenticated** hosted sessions, without embedding `sb_secret_` or Auth Admin links in client code. A new trusted revision/receipt snapshot backend contract is needed before real cloud reconnect can resume score writes. Any new hosted event/match, authenticated scores, staff changes, publication, real participant import or production cutover remains subject to a separate express organizer approval.
