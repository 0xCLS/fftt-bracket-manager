# FFTT3 — direct launch-readiness plan
**Decision: October 27, 2026.** Christopher prioritizes **simplicity and moving straight to safe real-event launch readiness**. Do not make further synthetic milestones or new infrastructure the default. The previous suggestion for a second Supabase project and two additional Pages sites is superseded by this direction (preserve it as historical analysis).

## Preferred architecture — reuse what exists
- **One Supabase project:** `fftt-bracket-manager-dev` (`copmkalfkkrkzheohwuc`), **upgraded in place**, subject to a verified, non-destructive migration and explicit hosted-cutover authorization. Project naming alone is not a reason to duplicate it.
- **Two existing Cloudflare Pages projects:** Staff `fftt3-staff-stg.pages.dev` including server-only Google registration Function; Spectator/TV `fftt3-games-stg.pages.dev` with no staff code. Promote accepted builds on these projects, keeping their private/public isolation. Optional friendly production URLs should not block functionality.
- **One codebase:** existing `0xCLS/fftt-bracket-manager` repository and draft PR #19; preserve historical rehearsals and existing event-scoped grants. No new application/repository or subscription.
- **Google:** keep the already verified service account and real FFTT3 sheet. The October 27 diagnostic passed (12 columns, 21 response rows) but **read no participant answers**. It does not authorize actual importing, and response count is not proof of unique registrants.

## October 27 staging UI deployments — verified by Claude Code report

Claude Code reported the successful **synthetic staging-only** release of approved application commit `00068134f3fa74cd1bec6e9b32071cd17c2e0544` after GitHub Actions [run 40550825642](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/40550825642) **passed both jobs**. These reports describe operator verification, not an independently authenticated Organizer UI review by ChatGPT.

| Existing staging service | Cloudflare deployment ID | Deployment-specific preview | Prior deployment (rollback reference) |
| --- | --- | --- | --- |
| Staff (`fftt3-staff-stg`) | `944c112b-25ad-4ef2-9d81-c47acf1eb477` | https://944c112b.fftt3-staff-stg.pages.dev | `6ffe2598` |
| Spectator/TV (`fftt3-games-stg`) | `d877dd90-7e75-476c-8c27-204ac84e1352` | https://d877dd90.fftt3-games-stg.pages.dev | `a367d9f9` |

**Stable site URLs:** https://fftt3-staff-stg.pages.dev and https://fftt3-games-stg.pages.dev. The operator reported **36/36 Staff** and **17/17 Spectator** served files matching manifests/hashes at both stable and deployment-specific URLs. Both served the expected `staging` target, approved Git SHA, `_headers` security policies (including no-store/noindex), and resolved the public site/Staff/Spectator/TV pages without console errors or horizontal overflow in tested viewports. The Cloudflare-consumed `_headers` and `_redirects` files returning 404 when requested directly is expected. Live CSS confirmed `--tile:26px` on Staff, Spectator and TV, with the intended Players workspace code on the Staff bundle. The operator did **not** sign in to inspect the Organizer-only Players tab, so **visual acceptance still awaits Christopher**.

**Non-changes / safeguards:** The existing Staff registration Function and Cloudflare environment variables were preserved. GET to `/api/registrations` returned 405; unauthenticated POST returned 401. No SQL migration, new infrastructure, real participant import, PR merge, production release or changes to synthetic data. Cloudflare Pages deployments changed **only** the two existing staging projects. Do not confuse this UI release with a production-ready registration cutover: Google response reading remains diagnostic-only, and the existing single-project in-place migration remains pending approval and launch acceptance.

## Registration settings polish — launch-directed UI update

The October 27 screenshot showed a lengthy rehearsal-oriented Registration settings form, with repeated source labels, duplicate read-only instructions and column mapping presented before connection testing. The integration branch now offers a shorter workflow: choose **Google Sheet** (first, and the only listed option for a real event), enter link, check tabs and test connection, review the mapping only after test results, and save. The previously selected source is labelled as **current** while an unsaved change is being prepared; verbose sharing instructions disappear when the selected spreadsheet's access has already been verified. The demo source remains available only for synthetic events, with clear diagnostic-only wording on synthetic staging. No data loading, credentials, source persistence or access rules were changed by this UI polish.

**Current deployment status:** the revised registration UI is deployed on the existing Staff **synthetic staging** URL at `944c112b` (see staging-release record above). Live Google response loading is still disabled; real-data operation requires the reviewed in-place migration, launch gates and distinct organizer approval.

## Players & check-in and score-tile polish — October 27

Christopher supplied screenshots of the Players & check-in workspace and recent results. The branch now presents the **registration setup and list** together as the primary workflow, with **quick walk-in check-in alongside on sufficiently wide content areas**; on tablet and phone these stack. The roster is full-width beneath the workspace, with concise private-rating guidance and clearer mobile table labels. Important bracket-rebuild warnings, roster permissions, duplicate review, CSV/manual entry and check-in behavior are retained. The existing synthetic demo is still labeled honestly; no real registrations are loaded.

Result display-only score squares are reduced **30 → 26 CSS px** (compact bracket squares **24 → 22 CSS px**) with slightly tighter spacing and smaller text while preserving square geometry, winner/loser colors, tabular numerals and accessibility text. No match scores or winning logic changed.

The existing Chromium regression now checks workspace layout at desktop/tablet/phone widths and 26px score tiles. **Deployed to the existing synthetic Cloudflare staging sites from `00068134` as recorded above; PR #19 remains draft/unmerged.**

## October 27 approved final UI: rank shields, compact check-in, form-aware mapping

The organizer approved the final **five-color rank-shield visual language**, superseding the earlier separate-square/circle/hexagon/diamond/Level 5 shield experiment. Each rank icon has an equal **40 × 40 CSS px** footprint and a matching **40 × 40 SVG viewBox**. The shared shield silhouette is gray (Level 1 Beginner), green (Level 2 Recreational), blue (Level 3 Intermediate), orange (Level 4 Strong intermediate), or purple (Level 5 Advanced/Competitive). Levels 1–4 contain one to four white chevrons; Level 5 has a **classic five-point white star** with broad horizontal arms and pointed top, as in the organizer-provided star reference. There are **no feathers, laurels, or additional bottom stars**. The adjacent text still names the precise level for accessibility.

The Staff registration list now has the full container width beneath the registration-settings/quick-walk-in workspace; compact responsive rows keep name, masked matching hint, level and one-click Check in/Edit together, without a repetitive **Not checked in** pill. Alert, duplicate and checked-in states are still visible. The optional separate First name, Last name and Self-described level mapping rows are hidden **only when absent and unnecessary**, while their existing parser contract remains supported for other forms.

Changes are presentation-only in `app/view_players.mjs`, `app/view_registration.mjs`, and `app/app.css`, with updated `tests/e2e/gameday_polish_browser.test.mjs`; no hosted database, Google permissions, registration rows or check-in decisions are modified. **Not yet deployed** to the FFTT3 Staff site. The application remains on draft PR #19 pending completed CI, visual review and separate staging-release decision.

## New October 27 decision: full names and operational Google Sheets are launch-critical

Christopher explicitly accepted **full first-and-last names** by default for new Staff registration/check-in, walk-ins and manual players; do not truncate to an initial. Preserve historic synthetic names. Public spectator displays should recognize participants by full names **only after verifying notice/publication policy**, never contact details or private playing-level assessments.

He also accepted enabling the actual **read-only Google Sheets registration workflow as part of the launch package**, not as a post-launch feature or a reason to duplicate Supabase infrastructure. Operational access remains event-allowlisted and Organizer-only; the successful existing connection diagnostic is not yet an authorization to turn on reading actual answers before the controlled in-place upgrade, independent Auth/backup checks, and release approval. Exact operational gates are in [the single-project activation runbook](FFTT3_SINGLE_PROJECT_ACTIVATION_2026-10-27.md).

**Implementation checkpoint:** `app/view_players.mjs` now defaults to the sanitized full `r.name` instead of `r.shortName`, and walk-in/manual placeholders request full names; browser tests have been updated with fictional full names. Added `tests/gameday_single_project_postgres.sh` and paired SQL fixture/acceptance files to validate migration on a **populated disposable PostgreSQL database**, in addition to the earlier PGlite test. Hosted project was inspected **read-only**: healthy, 4 synthetic events/0 real, 18 players, 25 matches, 20 score decisions, 13 grants, 52 audit events, 0 saved registration sources. The original `synthetic_only=true` constraint remains. CI verification for these new changes was in progress at record time. No database DDL or actual registration reads performed.

## Critical path to launch
1. **Implement a safe, in-place event-mode release, not a fresh-database replacement.** Current live schema enforces `synthetic_only=true` and multiple staff/score RPCs filter on that field. Create a reviewed change that preserves all existing synthetic events and historical results, allows clearly identified new real events, authorizes each operation by active event-scoped Auth grant and lifecycle, audits changes, and prevents a fictional fixture from being used for a real event. The existing *real-only fresh-database* SQL generator is a reference candidate, **not safe to run unchanged on the populated Supabase project**.
2. **Preflight with a populated disposable clone**: preserve synthetic fixtures, score decisions, event revisions, staff roles, export and rollback. Test every relevant V3–V5 operation, real-event creation, cross-event denial, staff revoke, check-in, 1-match/Bo3 formats, bracket generation, table reservation, consolation and doubles.
3. **Independent signed authentication and concurrency acceptance**: actual GoTrue Auth sessions (not just in-process JWT stubs), organizer and two scorekeepers plus outsider, simultaneous score attempts, stale/retry handling, reconnection and no public access to sensitive details.
4. **Private snapshot and recovery before hosted schema changes**: verify backups, restore on disposable instance, record before/after fingerprint; never delete or overwrite completed fictional tournament data. Establish paper-score and manual export fallback.
5. **Reuse existing Staff and Spectator deployments**: verify signed login, server-only Google credentials, origin allowlist, private registration data handling, read-only spectator projection, device/TV performance, fail-closed errors and publication defaults. Explicitly authorize the hosted migration and any real registration loads; do not expose contacts or private ratings.
6. **Onsite rehearsal:** **November 8, 2026 at 10:00 AM** (confirmed). **Event:** **November 22, 2026 at 1:00 PM** (confirmed). Reverify access, sync, backup and device recovery before game day.

## New single-project upgrade candidate — tested offline

- `tools/release/build_single_project_upgrade.py` generates a **source-pinned, non-destructive, in-place SQL candidate** which retains existing synthetic history, opens a separate real-event mode for newly created events, and makes each event's mode immutable. The effective V2–V4 authorization and scoring RPCs continue to enforce current, active, event-scoped staff grants. Registration fixtures stay prohibited on real events, and Google sources stay disabled for synthetic events.
- `tests/e2e/gameday_single_project_upgrade.test.mjs` creates a **populated fictional synthetic tournament**, upgrades its disposable PGlite DB, checks that the original roster, staff access and event survive, confirms synthetic-mode immutability, creates a new real event, exercises Google/fixture guards, verifies both private exports mark their correct mode and confirms zero unapproved publication.
- The new CI test **passed in run [40544275690](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/40544275690)**. The existing disposable PostgreSQL job also passed; the full browser regression was still running at documentation time. **This is not a hosted migration or proof of signed real GoTrue sessions.**

**New local verification:** the populated-postgreSQL promotion step and **independently signed GoTrue real-event authorization/concurrent scoring step** both passed in disposable GitHub Actions run `40563013082`. The earlier in-process migration test remains green. The authenticated Organizer browser review on Cloudflare, private hosted backup/restore and authorized cutover remain pending. Current Staff deployment is still application code `00068134`; the full-name change is integration-branch code and is **not yet redeployed**.

## Launch-readiness engineering package — October 27 (evening), pre-approval

Everything that can be done **without** touching the hosted database, Cloudflare configuration or real registration answers is done; the runbooks are in `docs/launch/`.

* **Full names:** table pills and the score dialog no longer shorten names to the first word (two players named "Alexandria" were indistinguishable); the bulk-entry example and the duplicate-name message no longer ask for initials; registrations with a one-word name or an initial last name carry an Organizer-review note; one-word walk-in/manual names are asked about once. Historical synthetic names are untouched.
* **Real-mode acceptance (local, signed + PGlite):** the server, client-stack, V4 and browser suites now also run on the **upgraded** schema with real-mode events (`FFTT_UPGRADED=1`); a new browser test drives the whole Google Sheets path on a real-mode event with a fake Google (organizer-only, allowlist, diagnostic switch, full names, no contact data in rows, audit, export or public projection); a long-name layout test covers staff, spectator and TV.
* **Hosted facts established read-only:** the hosted schema fingerprint (148 columns, 88 constraints, 93 functions with every body hash and grant, 14 RLS tables, 4 triggers, 2 views) is **identical** to a database built from the repository's SQL; public sign-ups, anonymous sign-ins are off and e-mail confirmation is on; Staff Production variables hold the Google credentials, `REGISTRATION_GOOGLE_MODE=diagnostic` and no event allowlist or reference secret yet.
* **Backup and recovery:** a private backup of the existing project was taken and **restored into a disposable database with equal counts and fingerprints and all 35 foreign keys satisfied**; the in-place upgrade preserved every table, the matching rollback restored the exact pre-upgrade schema fingerprint, and the rollback refuses once a real event exists (`docs/launch/FFTT3_BACKUP_RECOVERY.md`, `tools/ops/`, CI test `ops_restore_rehearsal.test.mjs`).
* **Release build:** Staff (36 files) and Spectator (17 files) were built from the exact CI-verified commit and their manifests verified hash for hash; the Spectator bundle contains no staff, session or Function code.
* **Still requires the organizer's approval:** the hosted migration, creating the real event, enabling Google reads for it, deploying the verified bundles, publishing real names, and merging PR #19 (kept as a draft). See `docs/launch/FFTT3_CUTOVER_RUNBOOK.md`.

## Readiness acceptance
| Area | Must-pass evidence | Status as of decision |
| --- | --- | --- |
| In-place schema | Tested migration on **populated** disposable DB, no synthetic-data loss, verified backup/restore | **Targeted PGlite in-place preservation test passed** (CI run 40544275690); populated hosted Auth/backup/restore acceptance pending |
| Access | Independent signed Auth, event-scoped organizer/scorers, outsider denial and instant revocation | **Pending in real-event mode** |
| Scoring | Two-scorer concurrency, formats, brackets, table conflict, consolation, doubles, audit and recovery | Synthetic tests passed; **real-mode acceptance pending** |
| Registration | Private verified Google source, reviewed heading mapping, per-player reconciliation, no contact leakage | Metadata diagnostic passed; **no real answers imported** |
| Spectators | Separate bundle and allowlisted, organizer-controlled publication; no staff APIs, ratings or contact data | Synthetic checks exist; **release acceptance pending** |
| Operations | Current Pages sites, health, offline score fallback, private backups, onsite real-device rehearsal | **Pending** |

**Priority:** launch-critical correctness and recovery before cosmetic polish or optional features. Batch engineering + tests; avoid serial approval requests for code-only changes. No paid services. The preferred one-project route should change only if a verified technical/security blocker makes it unsafe.

**Boundaries:** This direction authorizes preparation and disposable tests, **not** changing the populated hosted database, sharing/importing real participant answers, publishing real player information, altering protected keys, merging PR #19, or deploying an unverified production release. Seek one focused approval for the ready-to-run hosted cutover after evidence is complete.

**Source conflict / resolution:** Prior October 27 separate-production-project plan was a recommendation under the earlier synthetic-prototype scope. Christopher's later simplicity/direct-launch instruction overrides that recommendation while maintaining strong authentication, privacy and data-integrity requirements.
