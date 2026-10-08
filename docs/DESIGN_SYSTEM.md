# FFTT Design System

The Bracket Manager follows the **design-system approach** described in BitSight's article [Building Our UI Design System](https://www.bitsight.com/blog/building-our-ui-design-system): clear brand definitions, a shared set of reusable UI patterns, and documentation that acts as a consistent reference. It does not use or copy BitSight's proprietary components.

## Identity and foundations

The canonical visual implementation is the inline stylesheet in `index.html`. Keep the application self-contained, with no runtime dependencies. Change shared tokens instead of creating more nearly identical colors, borders, or sizes.

| Token group | Meaning |
| --- | --- |
| `--brand-navy`, `--brand-deep` | Navigation background, brand anchor |
| `--brand-gold`, `--brand-red` | Primary accents and destructive cues |
| `--surface-page`, `--surface-card` | Layout surfaces |
| `--text-primary`, `--text-secondary` | Typography hierarchy |
| `--stroke-default`, `--focus-accent` | Borders and keyboard focus |
| `--space-1` through `--space-6` | Reusable spacing scale |
| `--corner-control`, `--corner-card`, `--shadow-card` | Shared radius and elevation |

Existing semantic aliases (`--background`, `--foreground`, `--navy`, `--yellow`) map to this foundation so existing views and scripts continue to work. Legacy literal values can be migrated into tokens incrementally, with visual regression testing.

## Component rules

- **Brand emblem:** the organizer's approved FFTT image replaces `FF` in the sidebar and browser favicon. An optimized copy is embedded as WebP for offline use; keep the approved artwork itself unchanged.
- **Navigation:** seven numbered sections, clear selected state, responsive horizontal scrolling on small screens.
- **Developer attribution:** display the exact credit **Developed by Chris Smith** discreetly at the bottom of the sidebar on desktop and below the compact controls on mobile. Keep it visible in the application, not printed on brackets.
- **BitSight reference states:** use restrained neutral form surfaces, a teal-blue interaction accent for checkboxes/radio buttons, visible hover/selected/focus/disabled states, small status pills, consistent card geometry, and clear section typography. Do not create sliders, toggles or pagination just to imitate the reference screenshot; introduce controls only when the product needs them.
- **Dashboard hierarchy:** put four tournament KPIs first on Overview, above the configuration cards; use distinct score/advancement and success/warning styling with accessible text labels.
- **Cards:** group relevant workflow actions; consistent padding, borders and restrained elevation.
- **Primary and destructive buttons:** one prominent task action per area; confirmations remain for destructive operations.
- **Form controls:** readable labels, sufficient hit targets, visible focus rings and explicit error feedback.
- **Status:** pair readable text with color for save state, match progress and consolation readiness.
- **Brackets and tables:** preserve readable names, round semantics and print behavior without exposing internal player ratings in spectator output.
- **Event data:** always describe storage accurately: browser-local autosave is **not** cloud synchronization.

## Review checklist for UI work

1. Inspect source and preserve current tournament logic, state format and event backup compatibility.
2. Check desktop and narrow-screen navigation, especially long names and horizontally scrolling brackets.
3. Exercise player entry, championship/consolation, match score dialog, undo, export/import, reset and printing as appropriate to the changed surface.
4. Verify contrast, keyboard focus, status labels and privacy.
5. Verify the deployed GitHub Pages version, not just the repository commit.
