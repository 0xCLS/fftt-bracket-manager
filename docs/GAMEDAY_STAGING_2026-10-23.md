# FFTT Bracket Manager — game-day synthetic staging (October 23, 2026)

_Scope: the organizer's October 23 consolidated, $0, **fictional-data-only** staging approval. Production, real FFTT3 data and PR #19's merge remain unauthorized. This document states what exists and what was actually verified; it does not claim game-day readiness._

## 1. What was built (one application, not isolated prototypes)

| Part | Where | What it does |
| --- | --- | --- |
| Server logic (additive SQL) | `supabase/proposals/GAMEDAY_TOURNAMENT_V3_STAGING.sql` | Event creation (platform organizers only) and selection; roster with contact-detail rejection; bulk check-in; server-**built** championship and consolation brackets from organizer-proposed seed layouts (structure, byes, progression decided by the database); table assignment (never bumps a scorer's match version); no-show forfeit; audited organizer correction with downstream guards; Mixed-Skill Doubles teams + result; lifecycle; organizer-controlled public visibility with an allowlisted projection; organizer snapshot, audit log, private export; revocable staff by e-mail (also after completion). Scoring is still the audited V2 function, unchanged. |
| Staff app | `app/staff.html` (+ `staff_core`, `staff_ui`) | E-mail/password sign-in (no sign-up), event select/create, Players, Championship, Consolation, Match Desk (tables, scoring, no-show, correction), Doubles Finale, Results & Export (standings, publish toggle, JSON/text/CSV, audit log, fallback guidance), Staff. Scorekeepers see only the Match Desk. |
| Spectator + TV | `app/spectator.html`, `app/tv.html` | Anonymous, no sign-in, no e-mail: Now playing, Up next, bracket, results, doubles finale, champion; freshness always labelled (LIVE / OUT OF DATE / blank). |
| Shared engine | `contracts/gameday_engine.mjs` | Seeding, partner suggestion, standings, score rules; checked against the approved single-file engine. |
| Session extensions | `contracts/milestone1_password_session.mjs`, `..._staff_access_gate.mjs` | `authorized()` (fresh identity + current role per operation; an application error is never mistaken for a lost session) and `selectEvent()`. Existing behavior and tests unchanged. |

Existing PKCE evidence, the hosted V2 audit and the three consumed fixtures are untouched.

## 2. Security posture

* Memory-only access tokens; optional tab-scoped (`sessionStorage`) refresh key, erased on sign-out; never `localStorage` for credentials.
* Two **different** origins: staff (`app/staff.html`) and anonymous spectators (`app/spectator.html`, `app/tv.html`). The spectator bundle contains no session, sign-in, scoring or organizer code (enforced by a bundle test).
* Strict response headers generated per bundle (CSP `default-src 'self'`, no inline script/style, `frame-ancestors 'none'`, HSTS, no-referrer, nosniff, noindex).
* Public data is a separate allowlisted table fed by a trigger **only** when the organizer turns publication on; names, results, tables only. `events.synthetic_only` is CHECK-constrained true, so the database refuses non-fictional events.
* Anonymous callers can execute none of the V3 functions; private helpers are executable by no API role (asserted in CI).
* No privileged key exists in any shipped file. The publishable key is public by design.

## 3. Verification evidence (what was actually run)

* **Local, real SQL (PGlite):** 8 server tests — bracket structure identical to the approved engine for 21 field sizes (2–48), consolation entrants and champion identical after full championships, a full tournament, simultaneous-scorekeeper race, revocation, corrections, forfeits, privacy, validation.
* **Real client stack against the real SQL (fake HTTP):** 11 tests — organizer + two scorekeepers play a whole tournament; conflicts; lost acknowledgments resolved from server receipts; unsent scores never auto-retried and remembered across reloads; revocation; outsider; outage pause; event create/select.
* **Real Chrome, isolated contexts:** a full rehearsal (organizer desktop, two phone-sized scorekeepers, spectator phone, TV, outsider) and six failure-path tests. **These are browser-simulated contexts on one machine, not physical devices.**
* **CI (GitHub Actions):** includes real local Supabase GoTrue + PostgreSQL with concurrent scorekeepers. The run for each commit is recorded in the batch record that introduced it (latest: [GAMEDAY_V4_2026-10-26.md](GAMEDAY_V4_2026-10-26.md)); this page does not carry a run number that could go stale.

**Update, October 27, 2026:** V5 (event-specific registration sources) and the UI/UX polish pass are deployed; see [REGISTRATION_SETTINGS_2026-10-27.md](REGISTRATION_SETTINGS_2026-10-27.md) section 8.

**Update, October 26, 2026:** V4 (formats, registration check-in, event management) was applied to the synthetic project and both bundles were redeployed from commit `c1e589c`; the exact record is in [GAMEDAY_V4_2026-10-26.md](GAMEDAY_V4_2026-10-26.md) section 8. The older statements below describe the October 23 V3 build and are kept as history.

## 4. Not yet verified / open

* **Hosted staging does not exist until the owner steps below are done.** No Cloudflare project or hosted V3 migration is claimed.
* Physical-device rehearsal (real phones/tablet/TV, real mobile networks, password-manager behavior) has **not** been performed.
* Hosted Supabase Free behavior (rate limits, e-mail quotas, pausing) is unmeasured. The free plan has no point-in-time restore: the organizer's **Private backup (JSON)** download is the backup; there is no in-app restore (rebuild from the backup's roster or re-enter results).
* Realtime is not used; screens poll every 7 s (spectators 6 s).
* Doubles finale scoring format is now **configurable** (V4: Best of 1 or 3, to 11 or 21; default Best of 3 to 11). The organizer should confirm the choice.
* Third place is not invented: both beaten semifinalists are listed.
* Google Sheets: V4 adds an organizer-only, read-only adapter and a private CSV fallback (see [REGISTRATION_INTEGRATION_2026-10-26.md](REGISTRATION_INTEGRATION_2026-10-26.md)). It is **not connected to the real sheet**; staging uses synthetic sample data only.

## 5. Owner steps (the minimum Christopher must do)

**Supabase (synthetic project `fftt-bracket-manager-dev`) — sign in to the dashboard once, then:**

1. *Authentication → Sign In / Providers → Email:* turn **"Allow new users to sign up" OFF** (it is currently ON: `GET /auth/v1/settings` shows `disable_signup:false`). Keep anonymous sign-ins off.
2. *SQL editor:* run `supabase/proposals/GAMEDAY_TOURNAMENT_V3_STAGING.sql` (once; it is one transaction), then `supabase/proposals/GAMEDAY_STAGING_BOOTSTRAP_TEMPLATE.sql` (edit the four e-mail placeholders first). Store the generated passwords it prints in your password manager; copy the printed **EVENT ID**.
3. *Authentication → Rate limits / SMTP:* leave defaults for the rehearsal; note the e-mail quota before testing the optional emailed code.

**Cloudflare Pages (free):** create two Direct Upload projects with unique `*.pages.dev` names (one staff, one spectator), then upload the two bundles produced by `tools/staging/build_export.py` from the exact reviewed commit (see section 6). No custom domain, no paid plan, no card.

## 6. Building and publishing the bundles

```
git checkout <exact commit>      # clean tree
python3 tools/staging/build_export.py --checkout . --commit <sha> --environment staging \
  --origin https://<spectator-project>.pages.dev --target spectator --out /tmp/fftt-spectator
python3 tools/staging/build_export.py --checkout . --commit <sha> --environment staging \
  --origin https://<staff-project>.pages.dev --spectator-origin https://<spectator-project>.pages.dev \
  --target staff --out /tmp/fftt-staff
```
Each output contains only the files reachable from its pages, a generated `origin-profile.json` (staff), `_headers`, `_redirects` and `MANIFEST.json` (SHA-256 of every file). Verify the live site's headers and manifest hashes after upload before using it.

## 7. Rollback

Site: roll the Pages project back to the previous deployment or delete it (the origin ceases to exist). Accounts: global sign-out, disable the user, or revoke the grant (works even after the event is complete). Database: V3 is additive; to stop public data, turn publication off (rows are removed) — nothing real is stored.

## 8. Physical-device rehearsal checklist (to be performed on real hardware)

For each phone/tablet: open the staff link, let the password manager fill, sign in; background for 1 and 5 minutes then return; lock screen; airplane mode and back; close and reopen the tab with/without "keep me signed in"; wrong password; organizer revokes the device; score a match, then cut the network mid-send and resolve from "Check what the server recorded". TV: open the board link, confirm LIVE, then block the network and confirm OUT OF DATE. Record outcomes without links, passwords or event identifiers.
