# FFTT Bracket Manager — Product Roadmap

_Last organized: October 8, 2026. This roadmap is a planning record, **not** a claim that proposed features are implemented or approved for delivery. Christopher's latest explicit instructions supersede this document._

## Product direction and sequencing

**Current decision:** Complete and visually approve the interface before beginning further feature implementation. The event-day tournament format remains Championship Bracket + Consolation Bracket with one Mixed-Skill Doubles finale. Keep fellowship and a minimum of two competitive matches per player where practical.

**Requested future capabilities:** Multiple volunteers able to enter scores from separate devices, with live bracket updates visible to spectators on phones and a TV/projector. A secure, central, authoritative event database will be needed; GitHub Pages alone only serves the application. **No backend vendor has been selected.** Supabase has been suggested, not approved.

**Engineering principles:** Prefer a maintainable, small codebase; reuse the existing single-file deployment where sensible; avoid risking event-day result integrity; privacy and access control are non-negotiable for any public spectator or multi-device access. Keep backups and an offline contingency.

## Already implemented (baseline, not backlog)

These capabilities are described in the current README and app code. They are not to be counted as new features:

- Public, single-file, offline-capable HTML application hosted on GitHub Pages.
- Responsive organizer interface with seven numbered sections; current visual direction uses a light lavender surface system.
- Approved circular FFTT emblem used in sidebar and favicon.
- Event configuration, player check-in, manual add and bulk entry.
- Internal FFTT Level 1–5 ratings, presented using segmented accessible 1–5 selectors (not dropdowns), provisional/established status, rating-aware championship seeding and fairer byes.
- Championship bracket and reviewed first-match-loser consolation bracket.
- Match Desk showing eligible matches, game scoring and result entry, with existing score validation.
- Mixed-skill doubles partner suggestion/selection, **not** doubles result recording.
- Local browser autosave, Undo, JSON backup export/restore, text results export and print.
- Browser-based rehearsal/safety tests for tournament flow and backup operations.

**Current limitations:** No Google Sheets intake or automatic registration sync; no simultaneous cross-device scoring; no public/live bracket feed; no centrally saved event state; no active table reservations; no recorded doubles finale result.

## Now: Phase 0 — Visual design and UI/UX approval

**Status: current priority. No new feature work until this phase is visually approved.**

Reference: the [Figma Design System by Facundo Almiron](https://www.behance.net/gallery/125691923/Figma-Design-System) for a light, polished dashboard, with BitSight as a secondary inspiration for predictable controls. Christopher explicitly authorized a complete departure from previous FFTT colors or flyer-derived styling. **The only required branding is the existing FFTT emblem and the exact credit “Developed by Chris Smith.”** Do not copy proprietary assets.

- [ ] Review the seven screens as one cohesive product, including dense roster and bracket states and empty/loading/error states.
- [ ] Visually approve the Figma-aligned light dashboard: purple headings, gold marker, independent white floating cards, 8–10px corners, subtle shadows, unframed bracket/queue areas, spacing, labels, and interactive states. Preserve the emblem and developer credit.
- [ ] Build a consistent in-app component language for **checkboxes, radio choices, toggles (only where functionally needed), tags/labels, badges, links, pagination/previous-next controls (when relevant), buttons, fields and score controls**. Include default, hover, selected, disabled and focus states.
- [ ] Reduce UI friction: clear primary actions, logical screen layouts, readable brackets, legible statuses and appropriate sizing for volunteer phones.
- [ ] Verify desktop, tablet, phone, projected display/TV readiness and printing where relevant.
- [ ] Check keyboard navigation, accessibility contrast, text clipping and no regression of bracket/backup logic.
- [ ] Conduct a visual review and capture Christopher's explicit approval **before** starting implementation of the feature backlog.

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

## Proposed feature backlog, after visual approval

Priority ordering below is a **provisional recommendation**, not an implementation commitment.

### Phase 1 — Shared, reliable event state and access

- [ ] Evaluate and choose a hosted real-time backend (Supabase was one suggestion, not a decision).
- [ ] Set up authoritative event records, secure access, persistence and backups without publishing private player contact information or keys in the public repository.
- [ ] Define roles: organizer/admin (full tournament control), volunteer scorekeeper (authorized score submission), spectator (read-only public results), and TV display (read-only).
- [ ] Handle concurrent score entry, stale clients, retry/deduplication, corrections/auditability and device reconnection.
- [ ] Define offline/degraded-mode behavior and a rehearsed recovery plan; retain private JSON export where practical.

### Phase 2 — Live volunteer scoring and spectators

- [ ] Mobile-friendly volunteer score-entry view with assigned/eligible matches, game scores and confirmation.
- [ ] Instant propagation of results, bracket advancement and current-match information to every connected device.
- [ ] Public read-only bracket/result views via shareable links or QR codes; exclude internal ratings, emails, phone numbers and admin controls.
- [ ] TV/projector mode optimized for a large, distant display and automatically updating content.
- [ ] Organizer monitoring of score submissions, active tables and match progress.

### Phase 3 — Registration intake and smarter match suggestions

- [ ] Read the private `FFTT3 Registration` Google Sheet through an organizer-controlled workflow. Its responses include skill-assessment answers; avoid importing emails/phone numbers into public or unnecessary event views.
- [ ] Map playing-profile/experience answers to **suggested provisional** Level 1–5 ratings; organizer reviews and approves changes.
- [ ] Use returning-player evidence and observation to refine ratings rather than relying on self-description alone.
- [ ] Suggest balanced opening matchups: spread stronger players, avoid severe skill mismatches where practical, respect fair byes and let the organizer override.
- [ ] Make checked-in/no-show reconciliation predictable; avoid unintentional duplicate player entries.

### Phase 4 — Event-day operations and results

- [ ] Active table assignment and availability tracking to avoid simultaneous table conflicts.
- [ ] Dashboard of completed/remaining/ready matches and tournament progression.
- [ ] Record final **Mixed-Skill Doubles** result in addition to team selection.
- [ ] Polished, privacy-appropriate PDF/CSV export for brackets, scores, awards and post-event records; preserve existing text/print outputs.
- [ ] Record tournament outcomes and useful lessons for future FFTT installments.

### Later / optional: format flexibility and historical tracking

- [ ] Round robin for very small fields and optional pool play / playoffs.
- [ ] Three-match-guarantee or other formats when table count and time budget make them feasible.
- [ ] Explore full double elimination only if event constraints justify it.
- [ ] Prior-event match history and rating calibration over time, with organizer oversight.
- [ ] Optional additional scorekeeper delegation and deeper spectator presentation features as needs become clear.

## Explicit boundaries and unresolved decisions

- Current FFTT3 event rules are not changing merely because another bracket-making product offers other formats.
- Do not use public GitHub files as an event results database.
- Do not embed Google credentials, private sign-up responses, phone numbers, email addresses or raw JSON event backups in the public front end.
- Product-specific sign-in method, backend provider, exact sync behavior, offline policy, spectator access policy and eventual delivery scope **need confirmation**.
- **Next action:** refine the BitSight-inspired UI screens for Christopher's visual approval. Only after approval should the post-design features be scoped and implemented.

## Related canonical sources

- [README](README.md) — currently implemented functions and limitations
- [FFTT Design System](docs/DESIGN_SYSTEM.md) — existing styling foundation
- Private `0xCLS/forging-fellowship-table-tennis` repository: `events/2026-11-22/EVENT_RECORD.md`, `knowledge/PLAYER_RATING_SYSTEM.md`, and `knowledge/FUTURE_EVENT_PLAYBOOK.md` — tournament requirements and planning context
