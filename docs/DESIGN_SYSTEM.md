# FFTT Bracket Manager — Interface Design System

_Last revised October 8, 2026._

## Approved visual direction

A clean, airy, **light dashboard** inspired by the [Figma Design System by Facundo Almiron](https://www.behance.net/gallery/125691923/Figma-Design-System) (Behance, 2021). Use that work as *visual inspiration*, not as a source for copying proprietary assets or components. BitSight's system remains a secondary reference for consistent control states and reusable design rules.

**Christopher's explicit direction:** The only mandatory FFTT branding is (1) the existing circular table-tennis emblem, preserved, and (2) the exact visible attribution **Developed by Chris Smith**. The previous navy/yellow color palette, typography, sidebar background, and flyer-derived visual language are **no longer requirements**. This supersedes the earlier branding instruction in this document and older roadmap notes.

## Current implementation

The application remains self-contained in `index.html`, with no external UI framework, remote font, stylesheet, or server required to render the organizer screen.

| Purpose | CSS token | Current palette |
| --- | --- | --- |
| Page canvas | `--canvas` | `#f3f4f9`, lavender-gray |
| Primary card | `--surface`, `--surface-elevated` | White, subtly raised |
| Inset surface | `--surface-inset` | `#faf9fd`, used sparingly for notices and labels |
| Secondary surface | `--surface-soft` | `#faf9fc`, nearly white |
| Page and section headings | `--heading`, `--heading-deep` | `#65538e`, deep purple |
| Small header marker | `--gold` | `#f3bb35`, gold |
| Main text | `--ink`, `--ink-strong` | Slate / deep ink |
| Subtle text | `--muted` | Muted blue-gray |
| Borders | `--line`, `--line-strong` | Pale lavender-gray |
| Primary interactions | `--accent`, `--accent-dark` | Indigo blue `#586dcf` |
| Focus | `--focus` | Purple `#6c60a9` |
| Information / secondary accent | `--teal` | Muted teal `#3b92a2` |
| Success | `--positive` | Green |
| Caution | `--warning` | Amber |
| Destructive action | `--negative` | Red |

A minimal design should use generous white space between separate card tiles, consistent 5–6px corners (except true pill controls), soft low-contrast shadows and mostly white content surfaces. Avoid visually heavy box-within-box treatments. Colors are semantic and may evolve with visual review.

## Component guidelines

- **Brand:** Keep the currently embedded FFTT emblem as the sidebar logo and favicon, and preserve **Developed by Chris Smith** in the organizer view on desktop and mobile. The credit stays off printed brackets.
- **Navigation:** A **lighter medium-plum** sidebar (`#56496e`) with a consistent 18px stroke-icon beside each of the seven text labels. Maintain adequate contrast for text, active states, and the sidebar controls. On narrow screens it becomes horizontally scrollable.
- **Cards / KPIs:** Standalone white tiles with **6px corner radius** (5px on compact controls), barely visible borders and one restrained soft shadow. No decorative top bars. The compact 2×2 KPI snapshot stays beside the setup workspace.
- **Surface hierarchy:** Follow the Figma reference's **floating-card** language. Outer panels and match cards are independent white rectangles with restrained elevation. Do **not** enclose brackets or match queues in additional rounded lavender trays. Tables use flat white backgrounds, subtle row separators, and minimal chrome. Muted lavender is for background canvas and occasional semantic notices, not every nested container.
- **Headings:** Use the approved screenshot's purple for major page headings and section headings, with a small gold dot in the EVENT OPERATIONS eyebrow.
- **Buttons:** Indigo-blue for primary actions, unobtrusive white secondary controls, neutral ghost actions, and clear red destructive controls.
- **Inputs, checkboxes, radio choices:** Consistent height, visible labels, generous touch targets, selected/hover/focus/disabled states.
- **Status labels:** Reuse the existing top-right semantic pill component as the **shared status language across the app**. Global pills report autosave, total checked-in players, completed matches and consolation state on every screen. Contextual pill rows report accurate per-section states (registration/check-in, championship progress, consolation readiness, playable matches/table count, finale partners, browser-local backups). Match cards use `Ready`, `Waiting`, `Completed`, or `BYE`; Match Desk uses `Ready to play` and table pills. Never color-code a status without written text. Do not misrepresent table configuration as reserved/assigned tables or browser autosave as cloud sync.
- **Bracket / match desk:** Prioritize readable player names, results and state changes above decorative treatment.
- **Dialog:** Clear winner selection and scoring controls, clear cancel/save actions, keyboard focus.
- **Responsiveness and print:** Verify common desktop and phone widths and preserve print behavior. No decorative components just because a reference depicts them.

## Structural Overview redesign — October 8, 2026

The previous iterations changed colors, shadows and radii but retained essentially the same screen structure, which Christopher found insufficient. **Visual differentiation now requires a layout redesign, not another cosmetic CSS pass.**

The new Overview introduces:

- A **distinct plum navigation rail** with seven lightweight line icons for Overview, Players, Championship, Consolation, Match Desk, Doubles Finale and Data & Restore. The FFTT emblem and exact `Developed by Chris Smith` credit remain.
- A **plain, unboxed Overview header** retaining the headline, explanation, and working Players/Match Desk actions. Christopher explicitly rejected the large purple hero background and its decorative ball/orbits.
- A full-height **event-configuration workspace** on the left, with labeled fields and the original Save event setup control.
- A compact **2×2 live snapshot** on the right, reusing all four existing KPI elements and IDs.
- A separate **three-stage tournament guide** on the right, describing championship, reviewed consolation and mixed-skill doubles finale.

All seven sections, player form operations, IDs and the existing tournament JavaScript are retained. The Overview has a new spatial hierarchy, deliberately different from the original four equal stat cards + two equally styled content boxes.

**Pending approval:** this is a bold concept candidate, not the approved final look. Ask Christopher to judge the live desktop and mobile composition before proceeding to features or further reskinning.


### User review correction — October 8, 2026

Christopher liked the new split Overview composition but explicitly requested (a) removal of the purple banner/background at the top, (b) icons beside each sidebar menu item, and (c) noticeably sharper rectangular card edges. This overrides the earlier hero background and illustration direction. The Overview remains an unboxed title and actions above the event workspace, snapshot, and format guide. Treat the latest rendered UI as a **design candidate pending approval**.

### Current design feedback — October 8, 2026: lighter sidebar and pills

Christopher approved the general style of the top-right global status pills and requested that it be used throughout the app. He also found the left navigation rail too dark. The color of the rail was lightened from `#2c2641` to `#56496e`, with accompanying icon, text and button contrast adjustments. The same `.pill` classes now appear in context-specific summaries for the six non-Overview tabs, on Match Desk cards and table labels, in bracket match headers, and on selected doubles teams. Pill text is derived from existing tournament state. No new tournament fields, synchronization or table assignment capability was introduced.

The established 6px card corners, 5px compact corners, FFTT emblem, and exact attribution `Developed by Chris Smith` remain unchanged. **Visual approval is still pending.**

## Acceptance and safeguards

This is **Phase 0 visual work** only. The existing tournament rules, score validation, seeding, backup data format, and local browser save behavior must remain functional. No real contact data belongs in this public repository.

Before calling the phase done:

1. Review all seven existing screens in empty and populated states; desktop and narrow-screen layouts.
2. Check keyboard access, focus, labels, text clipping, long player names, and bracket horizontal scrolling.
3. Verify navigation, scoring dialogs, undo, JSON export/import and print as appropriate.
4. Confirm the live GitHub Pages deployment reflects the intended code.
5. Request Christopher's explicit visual approval before starting the next roadmap feature phase.
