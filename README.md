# FFTT Bracket Manager


## Current hosted status — October 29, 2026 (read before historical milestones)

The **`main` branch / GitHub Pages** is the original single-file browser-local implementation. The **active hosted FFTT3 implementation** is on the still-**draft, unmerged** [integration PR #19](https://github.com/0xCLS/fftt-bracket-manager/pull/19) and the two separately managed Cloudflare Pages staging sites:

- **Staff:** https://fftt3-staff-stg.pages.dev (Organizer and separately authenticated event Scorekeepers)
- **Spectator/TV:** https://fftt3-games-stg.pages.dev (read-only projection controlled by the Organizer)

An explicitly approved **single-project Supabase in-place upgrade was executed October 27**, preserving the existing fictional history; a separate **real-mode FFTT3 event was created privately, draft and unpublished**, with two provisional software tables that now match the Organizer's **two permanently accessible physical tables**. The October 29 Organizer confirms the **November 22 venue is secured**. This does **not** mean real registrations have been loaded, actual participants checked in, two volunteers granted Staff roles, or any public names published. Those are distinct launch operations.

The most recent **code-changing** integration update added a **21-fictional-player, two-table, at-least-two-played-singles regression**; [full CI 40922823847 passed](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/40922823847). Subsequent doc-only commits leave application behavior unchanged. Staff and Spectator staging were verified on the preceding approved visual release. Refer to [FFTT3 cutover evidence](docs/launch/FFTT3_CUTOVER_RECORD_2026-10-27.md), [rehearsal checklist](docs/launch/FFTT3_REHEARSAL_CHECKLIST_NOV8.md), and [scorekeeper onboarding](docs/launch/FFTT3_SCOREKEEPER_ONBOARDING.md). Historical prototype notes below are retained as provenance; their older pending statements are **not the current launch status**.


A lightweight, single-file tournament desk for **Forging Fellowship Table Tennis Games** at Ypsilanti SDA Church.

## What it does

- Check in and internally rate players (FFTT Levels 1–5) using compact, keyboard-accessible five-level selectors instead of rating dropdowns. The labels remain internal; selecting a rating still updates the original player data and Undo history.
- Seed and manage the championship bracket.
- Move players who lose their first actual championship match into a reviewed consolation pool.
- Record singles match results and manage a match queue for multiple tables.
- Select mixed-skill doubles finale partners for the championship finalists.
- Print the current view, export a JSON event backup, restore a backup, and export a text results summary.

**October 20 hosted browser acceptance — COMPLETE, SYNTHETIC ONLY:** The one-time Mac runner completed with individually signed Scorekeeper A **accepted** and Scorekeeper B **rejected as stale**, and demonstrated same-actor own-decision recovery after tab reload, cross-actor/outsider denial, and no public spectator publication. Independent **read-only** Supabase postflight confirmed one new fixture event revision **1**, one match with status **`complete`**, version **1**, **two** durable decisions (one accepted, one rejected for `stale-match-version`), **one** accepted receipt, unchanged four existing test Auth users and nine event-scoped grants, and **zero** public event/match rows. The two historic consumed fixtures are unchanged. **Fixture #3 is permanently consumed. Never rerun, reset, rescore or remove the private operator safety marker.** This does not establish production volunteer login UX, physical multi-device sync, spectator/TV operation, offline fallback, or authorize FFTT3 data/production rollout. [Acceptance runbook and evidence](docs/MILESTONE1_HOSTED_BROWSER_AUTOMATION_2026-10-20.md).

**Milestone 1 connected operations candidate (October 20, synthetic only):** Added opt-in 6-second signed Match Desk following and a separate anonymous public spectator-read page backed only by audited public projection. Both clear displayed information and stop upon offline, hidden tab, expired or denied session, or bad/private data; reads never enable scores or retries. [Operational readiness batch](docs/MILESTONE1_CONNECTED_READ_OPERATIONS_2026-10-20.md) includes deterministic supervisor tests and a three-context independent Chromium simulated-authority test, with all hosted requests intercepted. **These are not actual physical-device, realtime publication or production login acceptance.**

**Milestone 1 staff Auth and organizer continuity candidate (October 20, synthetic only):** Implemented guarded PKCE verifier/state/S256 Web Crypto and callback/identity contract, fresh event-scoped staff authorization checks and a local zero-network organizer offline continuity/reconciliation drill. No hosted Auth redirects, user accounts, score fixtures, production changes, real FFTT3 records or publication. All browser and provider behavior remains test/simulation until separately approved Auth integration and physical device rehearsal. [Security and continuity runbook](docs/MILESTONE1_AUTH_CONTINUITY_2026-10-20.md).

**Milestone 1 synthetic PKCE browser integration (October 20):** Integrated the existing S256/state Auth guards and event-scoped staff authorization with explicit Supabase-shaped existing-user /otp, one-time code exchange, current-user lookup and private signed V2 Match Desk, using a separate mock-gated local UI. The real Chromium test exercises two distinct signed fictional volunteers, outsider denial, role revocation, callback tampering and browser secret cleanup. **Network is disabled outside the injected test mock; no emails or live Auth settings were changed.** [Browser integration and future physical-device acceptance plan](docs/MILESTONE1_PKCE_STAFF_BROWSER_2026-10-20.md).

**October 21:** the first real hosted PKCE sign-in and authorized read-only Match Desk **passed** (operator-observed, synthetic only, localhost). A local multi-device operations batch (device-origin policy and staff page, revocation lifecycle, TV board, organizer fallback ledger, six-client acceptance harness) is implemented and tested against simulated infrastructure only; **physical-device acceptance has not been run and is not authorized**. See the [implementation record](docs/MILESTONE1_MULTI_DEVICE_OPERATIONS_2026-10-21.md) and the [prepared runbook](docs/MILESTONE1_PHYSICAL_DEVICE_RUNBOOK_2026-10-21.md).

**October 23:** game-day staff sign-in direction changed to a $0 web-hosted design with **email/password** (optional emailed code for recovery) and anonymous spectators. A synthetic local candidate with a fail-closed session lifecycle, narrow staging/production origin policy and sanitized export tooling is implemented and tested against simulated infrastructure only; **it is not enabled on the hosted project, not deployed and not released**. See [authentication design](docs/MILESTONE1_STAFF_PASSWORD_AUTH_2026-10-23.md) and [hosting and staging plan](docs/MILESTONE1_STAGING_HOSTING_2026-10-23.md).
**October 26 (game-day staging, synthetic only, unmerged PR #19):** configurable match formats (Best of 1 or 3, games to 11 or 21; Best of 5 only as a *historical* format), a read-only registration check-in workflow with a server-side adapter and a private CSV fallback, event filtering/archive/restore/guarded deletion, sign-in by event name, and a UI polish and accessibility pass. Additive SQL is in `supabase/proposals/GAMEDAY_TOURNAMENT_V4_STAGING.sql` and is **not applied to any hosted project**; nothing is deployed and no real participant data is involved. See [the V4 record](docs/GAMEDAY_V4_2026-10-26.md) and the [registration integration](docs/REGISTRATION_INTEGRATION_2026-10-26.md) (including what is still needed to connect a real sheet). Three-match guarantee, Swiss and double elimination remain **deferred**; Championship + Consolation is unchanged.
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

## Registration sheet integration (single-file app: planned; game-day staging app: implemented against synthetic data)

The organizer maintains event sign-ups in a separate private Google Sheet with playing-history and self-assessment questions. **This single-file build does not fetch that Sheet or automatically import its rows.** (The separate game-day staging app has an organizer-only, read-only adapter, documented in [REGISTRATION_INTEGRATION_2026-10-26.md](docs/REGISTRATION_INTEGRATION_2026-10-26.md); it is not connected to the real sheet.) Current seeding operates on FFTT ratings entered by staff. A future organizer-only, review-before-import workflow could read names and playing-assessment answers, suggest *provisional* ratings, let staff confirm them, and then build balanced opening matchups. Contact fields (email and phone) should not be imported into the bracket or exposed in a public-facing view. Avoid embedding private Sheet credentials, access tokens, or unprotected participant data in this public GitHub Pages app.

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

Game-day staging app tests (Node 22+; the SQL tests use an in-process PostgreSQL, the browser tests use installed Chrome):

```sh
node --test tests/gameday_*.test.mjs tests/registration_*.test.mjs tests/milestone1_*.test.mjs tests/phase1c*.test.mjs   # zero network
(cd tests/e2e && npm ci)
node --test tests/e2e/gameday_server.test.mjs tests/e2e/gameday_v4_server.test.mjs tests/e2e/gameday_core.test.mjs \
  tests/e2e/gameday_v4_core.test.mjs tests/e2e/registration_integration.test.mjs
node --test tests/e2e/gameday_browser*.test.mjs tests/e2e/gameday_v4_browser.test.mjs tests/e2e/gameday_registration_browser.test.mjs \
  tests/e2e/gameday_events_browser.test.mjs tests/e2e/gameday_ui_audit.test.mjs                                          # real Chrome, intercepted network
```

Keep changes lightweight; preserve a backup before event day. This public code repository is distinct from the private FFTT event-planning and historical-record repository.
