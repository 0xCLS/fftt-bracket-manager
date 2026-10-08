# FFTT Bracket Manager — Interface Design System

_Last revised October 8, 2026._

## Approved visual direction

A clean, airy, **light dashboard** inspired by the [Figma Design System by Facundo Almiron](https://www.behance.net/gallery/125691923/Figma-Design-System) (Behance, 2021). Use that work as *visual inspiration*, not as a source for copying proprietary assets or components. BitSight's system remains a secondary reference for consistent control states and reusable design rules.

**Christopher's explicit direction:** The only mandatory FFTT branding is (1) the existing circular table-tennis emblem, preserved, and (2) the exact visible attribution **Developed by Chris Smith**. The previous navy/yellow color palette, typography, sidebar background, and flyer-derived visual language are **no longer requirements**. This supersedes the earlier branding instruction in this document and older roadmap notes.

## Current implementation

The application remains self-contained in `index.html`, with no external UI framework, remote font, stylesheet, or server required to render the organizer screen.

| Purpose | CSS token | Current palette |
| --- | --- | --- |
| App canvas | `--canvas` | `#f6f8fd` |
| Cards | `--surface` | White |
| Main text | `--ink`, `--ink-strong` | Slate / deep ink |
| Subtle text | `--muted` | Muted blue-gray |
| Borders | `--line` | Pale cool gray |
| Primary interactions | `--accent` | `#4875f5` |
| Focus | `--focus` | Blue |
| Information / secondary accent | `--teal` | `#0e9db7` |
| Success | `--positive` | Green |
| Caution | `--warning` | Amber |
| Destructive action | `--negative` | Red |

A minimal design should use consistent alignment, generous spacing, lightweight shadows, rounded controls, and readable brackets. Colors are semantic and may evolve with visual review.

## Component guidelines

- **Brand:** Keep the currently embedded FFTT emblem as the sidebar logo and favicon, and preserve **Developed by Chris Smith** in the organizer view on desktop and mobile. The credit stays off printed brackets.
- **Navigation:** A simple, pale sidebar with distinct active state. On narrow screens it becomes horizontally scrollable.
- **Cards / KPIs:** White and lightly elevated on a soft canvas. Four summary metrics lead the Overview screen.
- **Buttons:** Solid blue for primary actions, unobtrusive white secondary controls, neutral ghost actions, and clear red destructive controls.
- **Inputs, checkboxes, radio choices:** Consistent height, visible labels, generous touch targets, selected/hover/focus/disabled states.
- **Status labels:** Compact contextual pills for autosave, attendance, matches, readiness, and internal ratings; do not rely on color alone.
- **Bracket / match desk:** Prioritize readable player names, results and state changes above decorative treatment.
- **Dialog:** Clear winner selection and scoring controls, clear cancel/save actions, keyboard focus.
- **Responsiveness and print:** Verify common desktop and phone widths and preserve print behavior. No decorative components just because a reference depicts them.

## Acceptance and safeguards

This is **Phase 0 visual work** only. The existing tournament rules, score validation, seeding, backup data format, and local browser save behavior must remain functional. No real contact data belongs in this public repository.

Before calling the phase done:

1. Review all seven existing screens in empty and populated states; desktop and narrow-screen layouts.
2. Check keyboard access, focus, labels, text clipping, long player names, and bracket horizontal scrolling.
3. Verify navigation, scoring dialogs, undo, JSON export/import and print as appropriate.
4. Confirm the live GitHub Pages deployment reflects the intended code.
5. Request Christopher's explicit visual approval before starting the next roadmap feature phase.
