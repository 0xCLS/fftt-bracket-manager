# FFTT Bracket Manager — Product Roadmap

_Last organized: October 12, 2026. This roadmap is a planning record, **not** a claim that proposed features are implemented or approved for delivery. Christopher's latest explicit instructions supersede this document._

## Product direction and sequencing

**Design decision (October 8, 2026):** Christopher explicitly accepted the current UI ("I'm satisfied with the design for now. Let's move on"). **Phase 0 visual approval is complete. On October 12, Christopher approved consolidating the remaining work into three milestones (1–3), while keeping Phase 1 security and production authorization gates intact.** The format remains Championship Bracket + Consolation Bracket with one Mixed-Skill Doubles finale, preserving fellowship and at least two competitive matches per player when practical.

**Requested future capabilities:** Multiple volunteers able to enter scores from separate devices, with live bracket updates visible to spectators on phones and a TV/projector. A secure, central, authoritative event database will be needed; GitHub Pages alone only serves the application. **Supabase is approved for an isolated synthetic-data prototype only.** An organizer-owned synthetic Free development project has subsequently been used for limited hosted tests on unmerged Phase 1 branches; **the released app remains browser-local**, and production service, real participant migration, and cutover are not approved.

**Engineering principles:** Prefer a maintainable, small codebase; reuse the existing single-file deployment where sensible; avoid risking event-day result integrity; privacy and access control are non-negotiable for any public spectator or multi-device access. Keep backups and an offline contingency.

## Already implemented (baseline, not backlog)

These capabilities are described in the current README and app code. They are not to be counted as new features:

- Public, single-file, offline-capable HTML application hosted on GitHub Pages.
- Responsive organizer interface with seven icon-labeled sections using the approved charcoal-and-pastel palette.
- Approved circular FFTT emblem used in sidebar and favicon.
- Event configuration, player check-in, manual add and bulk entry.
- Internal FFTT Level 1–5 ratings, presented using segmented accessible 1–5 selectors (not dropdowns), provisional/established status, rating-aware championship seeding and fairer byes.
- Championship bracket and reviewed first-match-loser consolation bracket.
- Match Desk showing eligible matches, game scoring and result entry, with existing score validation.
- Mixed-skill doubles partner suggestion/selection, **not** doubles result recording.
- Local browser autosave, Undo, JSON backup export/restore, text results export and print.
- Browser-based rehearsal/safety tests for tournament flow and backup operations.

**Current limitations:** No Google Sheets intake or automatic registration sync; no simultaneous cross-device scoring; no public/live bracket feed; no centrally saved event state; no active table reservations; no recorded doubles finale result.

### Design follow-up — reusable contextual panels (October 8, 2026)

Christopher approved the Players-screen dotted-outline, notched contextual guidance treatment ("I like it"). The component now provides concise, task-specific guidance in the upper-right header area of the six operational sections: Players, Championship, Consolation, Match Desk, Doubles Finale, and Data & Restore. The Overview retains its accepted open layout. The panels use neutral surfaces and charcoal text, avoid duplicated status metrics, stack on narrower screens, and change text with the selected section; no new data fields or tournament actions were introduced. This is a minor approved visual refinement, **not** a reopening of the completed Phase 0 gate or a change to the parallel Phase 1B backend work.

## Phase 0 — Design accepted and closed (October 8, 2026)

**Status:** Christopher approved the complete current interface as sufficient to move on. Cool-gray, off-white, charcoal and pastel styling is deployed across all seven screens, and UI/tournament regression tests passed. Further visual tweaks are optional and do not block Phase 1. Earlier Phase 0 open items below are historical quality-improvement candidates, not the approval gate.

Reference: the [Figma Design System by Facundo Almiron](https://www.behance.net/gallery/125691923/Figma-Design-System) for a light, polished dashboard, with BitSight as a secondary inspiration for predictable controls. Christopher explicitly authorized a complete departure from previous FFTT colors or flyer-derived styling. **The only required branding is the existing FFTT emblem and the exact credit “Developed by Chris Smith.”** Do not copy proprietary assets.

- [ ] Review the seven screens as one cohesive product, including dense roster and bracket states and empty/loading/error states.
- [x] Approve the cool-gray, charcoal and pastel color scheme across the application, preserving the emblem and developer credit; earlier purple styling is superseded.
- [ ] Build a consistent in-app component language for **checkboxes, radio choices, toggles (only where functionally needed), tags/labels, badges, links, pagination/previous-next controls (when relevant), buttons, fields and score controls**. Include default, hover, selected, disabled and focus states.
- [ ] Reduce UI friction: clear primary actions, logical screen layouts, readable brackets, legible statuses and appropriate sizing for volunteer phones.
- [ ] Verify desktop, tablet, phone, projected display/TV readiness and printing where relevant.
- [ ] Check keyboard navigation, accessibility contrast, text clipping and no regression of bracket/backup logic.
- [x] Capture Christopher's explicit approval of the current design before progressing to feature planning — October 8, 2026.

The screenshot demonstrates several styles, such as triple sliders and grade badges, but **does not imply all pictured widgets should be added** to the tournament app.

### Phase 0 lavender surface refinement — October 8, 2026

- Christopher requested that the **card and surface hierarchy** adopt the Figma-inspired visual direction, not just the navigation and controls, and particularly liked the purple heading color in his screenshot.
- Applied a lavender-gray page canvas, deeper purple section titles and major headings, small gold header marker, white subtly elevated primary cards, pale lavender inset surfaces for tables/brackets/match queues/notices, and coordinated score/result dialog styling. Preserved the emblem and the exact `Developed by Chris Smith` credit.
- Kept tournament JavaScript and event data unchanged; print styling keeps bracket outputs on white surfaces.
- **User visual acceptance is pending.** Continue Phase 0 review before new backend, registration, or tournament features.

### Phase 0 implementation checkpoint — October 8, 2026

**Visual direction update:** A source-only light-dashboard redesign has been committed, replacing the former navy/yellow styling with white navigation, slate typography, soft surfaces and blue interactions. The user requested this design freedom. The emblem and developer credit remain; visual acceptance is still pending.



- Added **Developed by Chris Smith** in the desktop sidebar footer and compact mobile header.
- Applied the BitSight screenshot's interaction-state vocabulary to existing checkboxes, radio choices, labels, badges, cards, bracket rows, Match Desk cards and controls; preserved FFTT navy/yellow branding and approved emblem.
- Moved tournament KPI cards to the top of Overview.
- Tournament JavaScript, event data schema, backup compatibility and match rules were deliberately left unchanged.
- **Visual acceptance still pending:** review the deployed desktop and phone interface with Christopher; do not mark Phase 0 approved or begin subsequent feature work without his approval.



### Phase 0 card-system fidelity correction — October 8, 2026

- Christopher clarified that the rounded boxes/surfaces still did not resemble the [Facundo Almiron Figma Design System](https://www.behance.net/gallery/125691923/Figma-Design-System) closely enough.
- Replaced large (18–20px) rounded lavender-framed nesting with a restrained floating-card language: predominantly white 8–10px-radius cards, subtle single-layer shadows, quiet borders, simpler summary tiles, flatter tables and no redundant lavender wrapper around bracket scroll or Match Desk queue.
- Preserved the liked purple heading and gold header marker, plus the only required identity elements: the FFTT emblem and **Developed by Chris Smith**.
- Added computed-style browser regression checks for tile corner radii, backgrounds, shadows and unframed bracket/queue areas. This remains **pending visual approval**, not an implemented feature request.

### Phase 0 structural reset — October 8, 2026

Christopher shared a current Overview screenshot and said the repeated styling iterations did not look meaningfully different. The next design pass therefore **changes layout and information hierarchy**, not just CSS tokens: plum left navigation, large tournament command hero, primary setup workspace, smaller live stats snapshot, and three-stage competition guide. The underlying seven-section application and tournament engine remain intact.

This composition is a candidate for Christopher's visual review; do not consider it approved merely because tests or GitHub Pages deployment pass. Subsequent major design decisions should be judged against screenshots of the rendered application, not just repository CSS diffs.

### Phase 0 refinement — icon navigation and unboxed header (October 8, 2026)

- Christopher liked the major Overview restructure but requested removal of its purple banner/background, seven navigation icons similar to the Figma reference, and sharper card edges.
- The current version removes the purple hero surface and CSS illustration, retains the heading and working buttons on the plain page background, substitutes consistent inline SVG line icons for numbered navigation, and uses **6px card / 5px compact-control corners**.
- Emblem and exact `Developed by Chris Smith` credit are retained; tournament JavaScript and persistence format are unchanged.
- **Still pending visual approval.** Design refinements precede any new bracket, syncing, or registration feature.

### Phase 0 refinement — contextual pills and lighter sidebar (October 8, 2026)

- Christopher liked the four top-right summary pills and requested the same status treatment **throughout the application**, plus a less dark navigation rail.
- The current candidate keeps the global summary visible across tabs and introduces dynamic, context-specific pills for Players, Championship, Consolation, Match Desk, Doubles Finale and Data & Restore; bracket match cards, playable-match cards, configured-table labels and selected doubles teams also use the shared pill language.
- The sidebar moves from near-black plum to lighter `#56496e`. The FFTT emblem, `Developed by Chris Smith`, 6px/5px card radii and existing tournament state schema remain unchanged.
- Status pills describe *implemented behavior only*: configured tables are not table reservations, local autosave is not cloud sync, and the finale is team selection rather than result recording.
- Still **awaiting visual approval** before feature development.

### Phase 0 refinement — balanced panels and pinned global status (October 8, 2026)

- Christopher's screenshot showed an unbalanced Overview: the tall three-stage guide occupied the bottom right while the left side remained empty. He also requested the four tournament-wide pills at the **top right**.
- The new candidate places the Event Setup card beside the 2×2 Live Snapshot, then spans the three-stage guide across a **full-width second row**, with its stages arranged horizontally on desktop and vertically on mobile.
- Moved the four unchanged global status pills ahead of the page intro, right aligned in a desktop **sticky header strip**, so they remain in view when scrolling.
- Updated the KPI label from **Active tables** to **Tables configured** to avoid implying automatic table assignment. All existing data IDs, match/scoring logic and browser-local persistence remain.
- Explicit visual approval is still required. Do not start feature implementation based on test/deployment success.

### Phase 0 correction — fixed top-right status strip (October 8, 2026)

- Christopher clarified that the four top-right global status pills should **remain fixed relative to the browser viewport** and must not shift down when scrolling or when switching tabs. The earlier sticky positioning was insufficient.
- The statusline now uses `position: fixed` at the viewport's top-right on desktop. At mobile widths, the fixed strip wraps above the navigation and the layout reserves enough space to avoid overlap.
- Added browser regression assertions that the status-strip top coordinate remains unchanged when scrolling both desktop and mobile views. All tournament logic and player/event data remain unchanged.
- The design remains **pending Christopher's visual acceptance**; this correction does not advance feature implementation.

### Phase 0 concept — cool-neutral/pastel Overview only (October 8, 2026)

- Christopher provided a new light product-design reference and agreed to preview its color scheme on **Overview only** before changing the other six screens.
- Introduced a cool-gray canvas, off-white sidebar, charcoal headings/actions, white event-setup surface, independently colored four-tile KPI bento (ice-blue, lavender, lime, yellow), and three lightly tinted format panels.
- The previous plum palette remains on the other six tabs for A/B visual comparison. Fixed top-right tournament status pills, icon navigation, FFTT emblem and `Developed by Chris Smith` remain.
- CSS is scoped to `body:has(#setup.panel.active)`; the original tournament engine, data fields, storage/backup format and match flow are unchanged.
- **Awaiting Christopher's visual approval** before considering a full-app palette rollout or any feature development.

### Phase 0 accepted color direction and all-screen rollout (October 8, 2026)

Christopher approved the cool-neutral, charcoal and selective pastel color scheme after reviewing the isolated Overview preview. The design has now been applied to all seven sections, maintaining the accepted Overview KPI tiles, white surfaces, off-white navigation, four fixed tournament-status pills, original FFTT emblem, and exact "Developed by Chris Smith" credit.

The rollout is CSS-only: it does not modify tournament logic, match handling, data, browser-local storage, or backup compatibility. Automated browser, tournament-safety, and bracket-rehearsal tests passed.

**Approved:** visual color direction. **Still available for review:** details of the six other sections now using that palette. New feature development is a separate decision.

**Historical note:** Previous Phase 0 updates below may say the palette is purple or Overview-only, or that color approval is pending. Those were accurate at the time but are **superseded by this approval and rollout**.

### Phase 0 small spacing refinement — October 8, 2026

- In response to Christopher's screenshots, the **Add Player** FFTT rating scale now occupies its own full-width form row with five equal choices and the selected-level description; provisional/established Status occupies a separate, left-aligned row below it.
- The Mixed-Skill Doubles setup actions now have a dedicated wrapping button row, with 16px separation on desktop and 12px on smaller screens, so **Save teams** no longer crowds **Suggest balanced partners**.
- Retained the approved charcoal/pastel scheme, original player rating values, existing buttons, data model, and tournament logic. The compact roster rating control remains unchanged. Browser layout checks cover desktop and mobile spacing.

### Phase 0 user correction — rating label location (October 8, 2026)

- Christopher rejected the full-width neutral-track Add Player rating control shown in the latest screenshot. Restore the earlier **five separate 1–5 radio buttons beside Status** on desktop, with both controls sharing a row.
- Move the selected skill description from beneath the 1–5 buttons **up beside the FFTT rating label**, updating live (e.g., "FFTT rating · Intermediate"). On mobile, the two form fields can stack naturally.
- Preserve the previously approved charcoal/pastel palette, compact rating appearance in the roster, numeric values and keyboard operation; retain the approved 16px/12px responsive spacing around **Save teams**.
- This supersedes the preceding full-width rating-row experiment. Visual approval of these precise refinements remains with Christopher.

## Phase 1 onward — Consolidated development roadmap (approved October 12, 2026)

Christopher approved **three remaining milestones**, replacing the previous four-phase feature sequence. Phase 0 is already complete. The consolidation batches closely related implementation and testing work; **it does not waive independently verified security, score-integrity, recovery, publication/consent, or production-cutover gates**. This is a planning decision, not authorization to ship cloud features or ingest actual participants.

| Milestone | Scope | Status |
| --- | --- | --- |
| **1 — Secure Shared Foundation** | Authoritative shared data, individual staff access, restricted public results, concurrency, audit, backups, offline authority and recovery | **In progress**, synthetic prototype only |
| **2 — Player & Tournament Preparation** | Organizer-controlled registration intake, reviewed player identity/ratings, check-in/no-shows and fair bracket creation | Planned; may prototype UI with fictional data during Phase 1 |
| **3 — Live Tournament Operations & Results** | Volunteer match scoring, synchronized brackets, spectators/TV, table coordination, organizer dashboard, doubles finale scoring, exports and basic event history | Planned; end-to-end release requires Phase 1 acceptance |

### Milestone 1 — Secure Shared Foundation (current)

Deliver the smallest trustworthy shared backend and explicit local/cloud separation before enabling real multi-device operation.

- [x] Provider-neutral contract, role/field allowlists, authoritative score semantics, offline rules and in-memory synthetic reference tests — [Phase 1A contract](docs/PHASE1A_SHARED_EVENT_CONTRACT.md).
- [x] Supabase authorized **for synthetic prototyping only**; separate organizer-authorized accounts, public allowlisted read-only results and controlled single-device fallback agreed.
- [ ] Complete and verify the integrated synthetic security and multi-device gates: schema/RLS, authenticated individual staff access, public projections, transactional score submission, race and retry handling, trusted snapshot/receipt reconciliation, audit, authorization revocation, client adapter, recovery and multi-device rehearsal.
- [ ] Prove that unauthenticated or revoked users cannot read protected data or submit scores; two competing submissions cannot both win; published projections contain no private contacts, ratings, raw player IDs, staff grants or backups.
- [ ] Keep local browser operation, manual JSON backup/restore and printed fallback valid; pause cloud writes on disconnect with no automatic local-to-cloud merge.
- [ ] Design **forward-compatible** player identity, event history, match results, table assignments and doubles-result relationships now, without implementing speculative analytics or moving live participant records.
- [ ] Obtain a **separate explicit production approval** after synthetic end-to-end security, disaster-recovery and device rehearsal. No real player migration or cloud-score cutover is included in this planning approval.

**Source/status reconciliation (October 13, 2026):** The October 12 three-milestone plan remains authoritative. [Integrated evidence and batching](docs/MILESTONE1_INTEGRATION_STATUS.md) now supersedes the stale Phase 1C roadmap carried in later branches. B2i passed a genuine isolated hosted two-scorekeeper scoring race (the consumed fixture must not be replayed). The organizer read-only Match Desk rehearsal passed; a later Scorekeeper A screenshot confirms authenticated, event-scoped read-only Match Desk authorization (zero eligible matches). A subsequent synthetic outsider browser screenshot showed successful sign-in followed by a fail-closed private read (`Denied, expired or unavailable. No private result shown.`) and no private data. The UI does not distinguish actual role denial from transport/session failure, so the underlying server-side denial still requires verification in the consolidated security suite; no repeated sign-in or cloud scoring is authorized. C10/C11 are **mock-only** recovery/durable-decision models. C5 authoritative snapshot SQL remains **unapplied**; no genuinely durable rejected-outcome ledger or trusted cloud-write recovery exists. The new C8 local public-result rendering remains synthetic-only and read-only. The approved live app is still browser-local; the consolidation approves no database migration, staff changes, real registration transfer or production cutover.

**Milestone 1 integrated backend checkpoint (October 13, synthetic-only):** [Original candidate and tests](docs/MILESTONE1_BACKEND_CLIENT_CANDIDATE.md) passed 156 Node checks, 81 disposable PostgreSQL pgTAP assertions and a genuinely signed **local** two-scorekeeper race. Christopher subsequently authorized and the maintainer applied the exact reviewed v2 migration **only** to the existing isolated hosted synthetic development project (migration `20261013101523`). The v1 scoring endpoint is revoked for browser roles, and a fresh fictional 2099 fixture with one pending match is ready. The [one-time signed **hosted V2 race and independent database audit**](docs/MILESTONE1_HOSTED_V2_AUDIT.md) subsequently **PASSED on October 13**: Scorekeeper B's fictional result accepted and Scorekeeper A's stale result durably rejected, with one match advancement, linked acceptance audit, authorized own-decision snapshots, no public publication and the original B2i evidence intact. **Both hosted scoring fixtures are now consumed and must never be replayed.** The live GitHub Pages app stays browser-local and unchanged. No production operation or real participant migration is authorized.

**Browser integration validation (October 13):** [Consolidated CI run #38430476452](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38430476452) **PASS, first attempt** — 165/165 JavaScript, 81/81 existing PostgreSQL assertions, original tournament tests, signed local Auth race, and a real Chromium two-browser/outsider zero-network rehearsal. This certifies the isolated read-only client implementation, not live cloud scoring, Realtime or physical-device operation.

**Browser integration progress (October 13):** [Connected browser read rehearsal](docs/MILESTONE1_CONNECTED_BROWSER.md) adds a real signed role/Match Desk/V2 revision double-read to the existing localhost C8 demo, conservative privacy cleanup, and an intercepted two-device/outsider Chromium regression. This is **manual-refresh read-only integration**, not authorized cloud scoring or completed live synchronization. Controlled writer/recovery adapter and multi-device operational rehearsal remain necessary.

**Signed scoring/recovery client preparation (October 13):** [Integrated Score & Recovery Lab](docs/MILESTONE1_SCORE_RECOVERY_LAB.md) adds a **strictly loopback-only** local signed V2 score transport, one-attempt-only score IDs with advance incident logging, an own-receipt recovery state machine that never retries unknown outcomes, an organizer fallback checklist, and a browser rehearsal with two in-memory fictional scorekeepers and privacy-safe spectator display. The actual hosted C8 browser remains read-only; **no additional hosted fixture, database edit, or production scoring is authorized**. A fresh separately approved fictional fixture, production-safe individual Auth, trusted recovery after tab loss, and real multi-device/browser synchronization are still required.

**October 20 hosted browser acceptance — COMPLETE, SYNTHETIC ONLY:** The one-time Mac runner completed with individually signed Scorekeeper A **accepted** and Scorekeeper B **rejected as stale**, and demonstrated same-actor own-decision recovery after tab reload, cross-actor/outsider denial, and no public spectator publication. Independent **read-only** Supabase postflight confirmed one new fixture event revision **1**, one match with status **`complete`**, version **1**, **two** durable decisions (one accepted, one rejected for `stale-match-version`), **one** accepted receipt, unchanged four existing test Auth users and nine event-scoped grants, and **zero** public event/match rows. The two historic consumed fixtures are unchanged. **Fixture #3 is permanently consumed. Never rerun, reset, rescore or remove the private operator safety marker.** This does not establish production volunteer login UX, physical multi-device sync, spectator/TV operation, offline fallback, or authorize FFTT3 data/production rollout. [Acceptance runbook and evidence](docs/MILESTONE1_HOSTED_BROWSER_AUTOMATION_2026-10-20.md).

**Milestone 1 connected operations candidate (October 20, synthetic only):** Added opt-in 6-second signed Match Desk following and a separate anonymous public spectator-read page backed only by audited public projection. Both clear displayed information and stop upon offline, hidden tab, expired or denied session, or bad/private data; reads never enable scores or retries. [Operational readiness batch](docs/MILESTONE1_CONNECTED_READ_OPERATIONS_2026-10-20.md) includes deterministic supervisor tests and a three-context independent Chromium simulated-authority test, with all hosted requests intercepted. **These are not actual physical-device, realtime publication or production login acceptance.**

**Milestone 1 staff Auth and organizer continuity candidate (October 20, synthetic only):** Implemented guarded PKCE verifier/state/S256 Web Crypto and callback/identity contract, fresh event-scoped staff authorization checks and a local zero-network organizer offline continuity/reconciliation drill. No hosted Auth redirects, user accounts, score fixtures, production changes, real FFTT3 records or publication. All browser and provider behavior remains test/simulation until separately approved Auth integration and physical device rehearsal. [Security and continuity runbook](docs/MILESTONE1_AUTH_CONTINUITY_2026-10-20.md).

### Milestone 2 — Player & Tournament Preparation

One organizer workflow spanning registration through a reviewed championship draw:

- [ ] Import names and relevant playing-assessment answers from the **private FFTT3 Registration Google Sheet** via an authorized organizer-controlled, review-before-commit workflow; support validated manual/paper entries and de-duplication.
- [ ] Keep contact data outside public projections and outside any unnecessary bracket/player model. Never embed private Sheet credentials in GitHub Pages.
- [ ] Recognize returning players using stable organizer-reviewed player identities; present provisional Level 1–5 suggestions from registration, previous verified play and observations. **Organizer approves ratings**; do not infer missing historical player-level evidence.
- [ ] Reconcile registered, checked-in and no-show players before finalizing brackets; prevent unintended duplicates.
- [ ] Use existing rating-aware seeding and bye logic to propose fair opening matchups, spread stronger entrants, avoid severe mismatches when practical and permit documented organizer overrides.
- [ ] Preserve Championship + reviewed first-match-loser Consolation + one Mixed-Skill Doubles finale. Maintain the aim of at least two real matches per player when the field permits.

**Batching rule:** Implement registration parsing, preview, rating review, check-in and bracket-setup UX together, with synthetic fixtures first. Work may proceed alongside remaining Phase 1 backend verification, but **real Sheets data access/import into the app requires a separately authorized, privacy-reviewed integration**.

### Milestone 3 — Live Tournament Operations & Results

One end-to-end, authoritative match lifecycle, instead of independent feature launches:

- [ ] Volunteer phone-friendly eligible-match list and score entry with winner/game confirmation; organizer-authorized accounts only.
- [ ] Single trusted server score acceptance and bracket advancement, then fresh synchronized organizer, volunteer and restricted public results/TV views; do not broadcast private state.
- [ ] Organizer overview of ready/playing/completed matches, accurate **table assignment and availability** (not merely previously recorded table number), plus public **Now Playing / Up Next**.
- [ ] Public read-only responsive bracket/results link or QR, and large-screen TV/projector presentation with automatic updates and no internal FFTT ratings or participant contacts.
- [ ] Complete the **Mixed-Skill Doubles finale result** using appropriate, independently tested rules; maintain the existing team-selection flow.
- [ ] Add export of verified brackets, scores, awards and results in useful privacy-appropriate PDF/CSV or equivalent formats; preserve the original text/print and private JSON backup workflows.
- [ ] Persist basic per-event tournament and match history suitable for future ratings and operational lessons, without publishing private cross-event profiles by default.
- [ ] Rehearse the full lifecycle with fictional players on **two scorekeeper devices plus organizer and spectator/TV**, including contested submissions, delayed/failed connectivity, audited correction, recovery, consolation and doubles.

**Release rule:** A pretty spectator dashboard or a passing synthetic UI test is not acceptance of secure live scoring. Cloud result submission, realtime publication and real-event deployment remain gated by Milestone 1 and a specific authorized production cutover.

### Later / optional enhancements (not event-day blockers)

- Advanced cross-event performance/rating analytics, streaks, rivalries and personalized player history; ratings remain organizer-reviewed and internal.
- Personalized spectator notifications, richer branded TV rotations, optional approved player introductions and optional delegated scorekeeper assignment.
- Small-field round robin, pool play/playoffs, extra match guarantees or full double elimination **only after** validating time/table constraints and preserving current FFTT3 rules.

### Historical phase-number mapping (supersedes the October 8 feature sequence)

- **Old Phase 1** → **Milestone 1**; Phase 1A/1B/1C technical substeps retain their names and historical PR references.
- **Old Phase 3** + registration-adjacent pieces of **old Phase 4** → **Milestone 2**.
- **Old Phase 2** + remaining live-operations/results pieces of **old Phase 4** → **Milestone 3**.
- **Old Phase 0** remains closed. Historical detailed design notes and existing source artifacts are preserved, not rewritten.

## Delivery discipline and boundaries

- Optimize for coherent vertical slices and batched regression tests, not unnecessary per-button approvals. Keep explicit checkpoints for security-sensitive actions, real participant information, production services and event-day cutover.
- Phase 1 synthetic security, reliable event authority and recovery are release prerequisites even when Milestone 2's offline/mock preparation is developed in parallel.
- Never commit real registration responses, email/phone, private backups or privileged keys to the public repository, and never use public GitHub files as a live results database.
- Do not change the current FFTT3 bracket format, seeding invariants or approved visual identity just because roadmap items are merged.
- Do not interpret this consolidation as approving a paid plan, deploying a production backend, publishing real participant names, changing staff access, migrating player data or turning on multi-device scoring.
- **Immediate next engineering action:** Reconcile the open synthetic Phase 1B/1C PR stack, the real hosted dev state, the unresolved six-digit OTP/read-only login flow, and remaining score/snapshot/recovery integration gates. Advance only with independently evidenced tests, preserving the single-device fallback.

## Related canonical sources

- [README](README.md) — currently implemented functions and limitations
- [FFTT Design System](docs/DESIGN_SYSTEM.md) — existing styling foundation
- Private `0xCLS/forging-fellowship-table-tennis` repository: `events/2026-11-22/EVENT_RECORD.md`, `knowledge/PLAYER_RATING_SYSTEM.md`, and `knowledge/FUTURE_EVENT_PLAYBOOK.md` — tournament requirements and planning context
