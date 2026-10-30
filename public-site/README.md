# FFTT public landing page (not yet deployed)

This independent static website is the planned public home at `https://fftt.clslifestyle.com/` for the recurring Forging Fellowship Table Tennis Games. It is **not** the organizer or scorer application, and it must **not** be deployed over the existing Cloudflare Pages Staff/Spectator staging projects or the legacy GitHub Pages root site.

## Confirmed information

- Next advertised event: Sunday, November 22, 2026, 1:00 PM EST, Ypsilanti SDA Church, 402 S. Adams St., Ypsilanti, MI 48197.
- Public registration link: `https://forms.gle/tZ9dizzfecyhHUxw8`.
- Spectators and all skill levels are welcome.
- The live-bracket feed and any player names/results are **not** published by this page.

## Safe publishing checklist

1. Confirm the existing Cloudflare account, Pages projects, `clslifestyle.com` zone and DNS baseline. The main personal website is hosted separately on cPanel. Preserve its apex, `www`, mail, and all unrelated records; do not move nameservers.
2. Check whether a standalone Pages project named `fftt-public` already exists; reuse it only if its intended purpose is verified. Otherwise create one new Free Pages project for this static landing page. Do not repurpose `fftt3-staff-stg` or `fftt3-games-stg`.
3. From the repository root, deploy **only** the `public-site` directory using the existing authenticated Wrangler setup (for example `wrangler pages deploy public-site --project-name fftt-public`). The `_headers` file must be included.
4. Verify the new Pages `*.pages.dev` URL first, including accessible navigation, date/location, registration destination, responsive layout, response headers, and that no private participant data is present.
5. In Cloudflare **Workers & Pages > [public project] > Custom domains**, register `fftt.clslifestyle.com` and follow the DNS setup. For a zone already managed in the same Cloudflare account, Pages can create the CNAME automatically. Do not create an unrelated DNS record before registering the domain with Pages.
6. Verify HTTPS certificate and content at `https://fftt.clslifestyle.com/`. Recheck the original site (`clslifestyle.com`, `www`) and email DNS records against the saved baseline. Confirm the two FFTT3 staging addresses remain unchanged.
7. Record the verified domain binding, Pages project name, DNS change, and release evidence in the private canonical project repository `0xCLS/forging-fellowship-table-tennis`. Do not report the domain as live before verification.

## Reuse

This page is intentionally static and has no authentication, database, live score feed or automatic registration import. Update the public event date and registration link only when the organizer approves each future event; do not silently carry over the November 2026 form. The legacy bracket manager `index.html` at repository root is unrelated to this landing page.

Never publish staff sign-in URLs as public participation links, change Supabase settings, expose registration responses or publish player names without separate organizer approval.

## Visual alignment — October 29, 2026

The public homepage follows the approved **Bracket Manager design system** (`docs/DESIGN_SYSTEM.md` and `app/app.css`): `#f2f3f5` canvas, `#fbfcfd` off-white responsive navigation rail, `#29313c` charcoal actions, white 6px cards, muted slate text, restrained ice/lavender/lime/butter summary tiles, semantic pills, and a `#538da1` keyboard focus treatment. The approved circular FFTT emblem is reused **byte-for-byte** from `app/assets/emblem.webp` (stored independently at `public-site/assets/emblem.webp`). The existing attribution `Developed by Chris Smith` remains visible. The former navy/yellow flyer-inspired landing page theme is superseded; the approved event flyer design is unchanged.

The page is responsive and has **no JavaScript, backend, login, score feed, private registration data, or external font dependency**. Its local stylesheet `styles.css` is allowed by the tightened `_headers` Content Security Policy. Keep the original public registration URL and November event facts unless separately approved. The landing page remains deployment-pending until Cloudflare Pages and the custom hostname are verified.

## Public navigation — October 30, 2026

- The public landing page now uses a **static, non-sticky top header**, not the Bracket Manager's staff sidebar. The same approved charcoal/cool-neutral/pastel visual system and circular FFTT emblem remain.
- Header navigation uses in-page links for **Event details** and **Join us**. All three **Register to play** links (header, hero, final CTA) open the verified public Google form in a **new tab** with `target="_blank"` and `rel="noopener noreferrer"`.
- A discreet **Staff sign-in** link opens the existing **authenticated staff staging** application at `https://fftt3-staff-stg.pages.dev/app/staff` in a new tab. The original October 30 version visibly said **STAGING**; the later organizer-approved update replaces that badge with a cyan **Staff sign-in** pill. The URL still points to staging and does **not** imply a live/production portal, and does not embed or create a second authentication system. Staff roles and access remain enforced by the existing application; do not remove the staging label or point the link at a different origin until that host has been separately verified and approved.
- Preserve the public site's lack of any client-side auth, Supabase connectivity, event data publication, or private registrant data.

## Desktop navigation rendering safeguard — October 30, 2026

**Browser-visible regression:** A screen recording from a large desktop viewport showed the **new horizontal-header HTML rendered with obsolete sidebar-era CSS**: left-aligned brand, navigation links stacked down the page, and a full-width registration button. The current CSS source already defines a compact horizontal header (`.header-inner{display:flex}`, `.site-nav{display:flex}`), so changing unrelated layouts or registration markup is not an appropriate fix. The likely cause is stale browser CSS under the reused `styles.css` URL; deploy content-addressed styles instead.

- The production HTML now loads `./styles-634f563b.css` containing the **exact same CSS blob** as the approved source CSS. Reuse the existing Git object: `634f563b7c6b9309613e6b712c29568fc8a33e47`. Any future stylesheet-content change must produce a new versioned filename and update `index.html` with it. Never edit a versioned stylesheet in place.
- The previous `styles.css` path remains available to avoid breaking already-cached HTML during this transition; its responses should revalidate. The HTML response also requests revalidation; the new content-addressed CSS may be immutable.
- **Release acceptance must test rendered geometry, not only file hashes**: with both a fresh browser context and a browser context primed by loading the previous release, at desktop widths 1440px and 1600px confirm logo/brand left and Event details, Join us, Staff sign-in pill and Register aligned horizontally in a single header (navigation not vertically stacked, CTA not full width); at mobile 375px verify a compact wrapped/stacked navigation and no horizontal overflow. Check the stylesheet response URL actually used by the document, CSS rules applied/computed `display`, registration new-tab behavior, and existing external destinations.
- Deploy only `public-site/` to `fftt-public` production `main` with no DNS, staff/spectator staging, Supabase or auth changes. The reported desktop defect is **not corrected live** until this new source commit is deployed and visually verified.

## Compact responsive header and staff pill — October 30, 2026

This is the latest explicit organizer correction and supersedes the earlier visible `STAGING` badge requirement for the public header. The **Staff sign-in** link itself is a soft-cyan rounded pill with a visible darker-cyan fill/border/text hover (no underline). The link continues to the **existing authenticated staging application**; removing the label **does not** make it a production application or change any permissions. No authentication is embedded in the public homepage.

At tablet/zoomed viewports up to 980 CSS pixels the header brand gets its own row with a compact, left-aligned, flex-wrapped navigation row below. At small widths the navigation wraps naturally with a compact header registration pill rather than the previous oversized two-column grid and full-width button. The hero and final-section registration buttons retain their intended mobile sizing.

The new stylesheet is content-addressed as `public-site/styles-489c7378.css` using Git blob `489c73784adcaa3aa19cc0e7af2752a2b1b11ed7`; previously published versioned CSS files remain unchanged so cached HTML continues to work. Rendered layout/hover verification is required on fresh and previously cached desktop/tablet/mobile browsers before calling the deployment complete.
