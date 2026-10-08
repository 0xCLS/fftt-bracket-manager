# FFTT Bracket Manager — Design System

_Last updated: October 8, 2026._

## Approved direction

**Christopher approved the cool-neutral/charcoal/pastel color direction on October 8, 2026** ("I think this is it") following the Overview-only visual preview. That approval supersedes the older plum/lavender/blue design experiments. The same language now applies to **all seven Bracket Manager screens**, while the accepted Overview bento composition remains unchanged.

Inspiration: the neutral, restrained surfaces and pastel accents in Christopher's most recent website reference, informed by the earlier [Facundo Almiron Figma Design System](https://www.behance.net/gallery/125691923/Figma-Design-System). References are inspiration, not templates or license to copy third-party assets.

The **only fixed FFTT branding** is the existing embedded circular FFTT emblem and the exact on-screen attribution **Developed by Chris Smith**. Keep both on desktop and mobile. Attribution need not print on bracket reports.

## Palette and visual tokens

| Usage | Color / token | Guidance |
| --- | --- | --- |
| Canvas | `#f2f3f5` | Cool, neutral gray |
| Sidebar | `#fbfcfd` | Off-white; charcoal navigation and line icons |
| Content surfaces | `#fff` | Simple white cards, minimal borders |
| Main text and primary buttons | `#29313c` | Charcoal, not the superseded purple |
| Secondary text | muted slate `#586672` / `#63707a` | Maintain adequate contrast |
| Ice blue | `#d1eff5` | Overview KPI tile; useful neutral-information accent |
| Soft lavender | `#e9d7f3` | Overview KPI tile; low-intensity accent |
| Pastel lime | `#bbd98f` | Overview KPI tile |
| Butter yellow | `#f7e99b` | Overview KPI tile |
| Informational semantic pill | `#e6f3f7` | Blue/cyan with readable dark text |
| Good / complete semantic pill | `#e3f2e0` | Soft green |
| Warning / not ready semantic pill | `#fff4d6` | Soft amber |
| Focus | `#538da1` | Teal-blue visible keyboard focus |

Use pastels selectively for useful distinctions. Do **not** tint every panel simply for decoration.

## Layout

- **Seven-screen navigation:** Off-white left rail, one consistent line icon next to each label. On narrow screens, navigation scrolls horizontally.
- **Global tournament status:** Four compact semantic pills are **fixed to the viewport's top-right** (not merely sticky in page content). On phones, they wrap above navigation without overlap. Per-screen contextual pills continue reporting existing tournament states.
- **Overview:** Unboxed charcoal header with two working navigation buttons; white Event Setup workspace; four **independent** blue/lavender/lime/yellow KPI tiles in a 2×2 grid; full-width three-stage guide in subtle pastel panels below. Preserve the accepted composition and spacing.
- **Other six sections:** Same cool-gray canvas, off-white sidebar, charcoal headings/buttons, simple white forms and cards. Use the shared restrained pill and pastel semantics for roster, bracket, Match Desk, finale and recovery. Do not imply table reservations, synced/cloud saving or unimplemented result tracking.
- **Card surfaces:** Mostly white, 6px corner radius (5px compact surfaces), quiet borders and a single subdued shadow. No bulky nested lavender trays.
- **Buttons:** Charcoal primary actions, white or lightly tinted secondary actions; soft pill shape is suitable for action buttons, not all content cards.
- **Forms:** Clear labels, hover/selected/focus/disabled states and readable select chevrons. FFTT Level 1–5 ratings use five native, keyboard-accessible radio segments. The provisional/established selector remains separate.
- **Brackets/queue/dialogs:** Flat readable round labels, white match/queue/dialog surfaces, subtle meaningful semantic accents and readable player names/scores. Keep scrollable brackets, print output and score entry usable at event time.
- **Print:** Preserve clear, predominantly white printed brackets and controls hidden from print where appropriate.

## Scope and safeguards

The app remains self-contained in `index.html` on GitHub Pages. It stores event state **locally in the browser** unless a future backend is deliberately added; the color rollout does not implement cloud sync, live spectator feeds or volunteer scoring.

The October 8 rollout changed CSS only and did not change HTML controls, event fields, tournament logic, save format, Undo, backups or the embedded emblem. Automated desktop/mobile UI tests and safety/bracket rehearsal suites are the release checks.

**Status:** Color direction approved by Christopher. Global application of the palette is implemented. Further visual refinements may be requested, but do not revert to plum/lavender or treat the earlier Overview-only experiment as a current constraint.

For historical decisions and superseded iterations, see Git history, `ROADMAP.md` and the FFTT project maintenance changelog.
