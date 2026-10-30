# FFTT public landing page (live)

This independent static website is the **live public home** at `https://fftt.clslifestyle.com/` for the recurring Forging Fellowship Table Tennis Games. It is **not** the organizer or scorer application, and it must **not** be deployed over the existing Cloudflare Pages Staff/Spectator staging projects or the legacy GitHub Pages root site.

## Current live release — October 30, 2026

- **Cloudflare Pages project:** `fftt-public` (production `main`), linked to `https://fftt.clslifestyle.com/`.
- **Source:** app commit `46a1df09043991eb769ea50f5aaba783e017ed2e`, incorporating homepage design source commit `520cfac8e1c99de2da3d9932bcc56000ea0b1615`.
- **Production deployment:** `ccc6df6e-c23e-48c3-bd99-b35afe2cd442` (`https://ccc6df6e.fftt-public.pages.dev/`). **Rollback reference:** `a19c574e-652d-4765-99ea-37241ffae7df`. Caution: that previous deployment carries an inert stray Functions bundle; current production has **no Functions bundle**.
- **Current design:** charcoal/cool-neutral/pastel Bracket Manager styling; compact `STAFF SIGN-IN` cyan pill linked to the existing authenticated staging staff app; header Event details and Join us links use color-only hover; no Register button in the header. The hero and lower-page registration calls to action open the verified Google Form in a new tab.
- **Approved hero:** motion-blur-refined v2 WebP, 1600×900, SHA-256 `623b56988b82b2a38c3369d5413c270efdab13e8ef6eac5efc18271e0ee3214a`. The image master is not hosted here. Event starts **1:00 PM EST on November 22, 2026**.
- **Evidence:** operator-reported Playwright checks at 1440, 820, 390 and 320 CSS px, image byte/hash checks and staging/personal-site preservation; independent public page and links fetch confirmed on October 30. The canonical `knowledge/FUTURE_EVENT_PLAYBOOK.md` and `maintenance/CHANGELOG.md` retain the complete deployment history.

**Historical context:** The dated sections below document successive October 29–30 revisions. Where older sections describe earlier styling, labels, image checksums or pending deployments, this current-release record supersedes them.

## Confirmed information

- Next advertised event: Sunday, November 22, 2026, 1:00 PM EST, Ypsilanti SDA Church, 402 S. Adams St., Ypsilanti, MI 48197.
- Public registration link: `https://forms.gle/tZ9dizzfecyhHUxw8`.
- Spectators and all skill levels are welcome.
- The live-bracket feed and any player names/results are **not** published by this page.

## Safe release checklist (existing project)

1. Use the **existing** Cloudflare Pages project `fftt-public`, production branch `main`. `fftt.clslifestyle.com` is already bound and live. This is a content-only update; **do not alter DNS, nameservers, cPanel hosting, email records or unrelated projects**.
2. Synchronize a clean checkout with the approved application commit, then build a **separate clean upload directory containing only the contents of `public-site/`** (for example with `git archive` of the exact commit scoped to `public-site/`). Deploy from that isolated directory, **not from the repository root**. Wrangler has previously discovered and uploaded root-level `functions/api/registrations.js` even when the static directory argument was `public-site`. No Functions bundle belongs on this public landing page.
3. Ensure the upload includes `index.html`, `_headers`, the active fingerprinted CSS, `assets/emblem.webp`, and `assets/fftt-fellowship-hero.webp`. Verify the hero's current approved SHA-256 below. Do not replace it with an earlier version or upload the PNG master.
4. Capture the existing production Pages deployment ID as the rollback reference. Release only to `fftt-public` production `main`; verify the new Pages deployment URL before the custom domain. Check that the **new deployment uses no Functions bundle**.
5. Check desktop, tablet and mobile **rendered layout** in a real browser (including a returning/warm-cache browser), hero image and correct crop, event details, hover/new-tab links, security headers and zero unintended public data or horizontal overflow. Check the custom-domain HTTPS URL and the unaffected personal site and both staging applications. Run focused tests only.
6. Record the exact Git commit, Pages deployment ID, current rollback reference, verified image hash and environment-preservation evidence in the canonical private repository `0xCLS/forging-fellowship-table-tennis`. Do not treat a successful upload alone as proof of release readiness.

## Reuse

This page is intentionally static and has no authentication, database, live score feed or automatic registration import. Update the public event date and registration link only when the organizer approves each future event; do not silently carry over the November 2026 form. The legacy bracket manager `index.html` at repository root is unrelated to this landing page.

Never publish staff sign-in URLs as public participation links, change Supabase settings, expose registration responses or publish player names without separate organizer approval.

## Visual alignment — October 29, 2026

The public homepage follows the approved **Bracket Manager design system** (`docs/DESIGN_SYSTEM.md` and `app/app.css`): `#f2f3f5` canvas, `#fbfcfd` off-white static header, `#29313c` charcoal actions, white 6px cards, muted slate text, restrained ice/lavender/lime/butter summary tiles, semantic pills, and a `#538da1` keyboard focus treatment. The approved circular FFTT emblem is reused **byte-for-byte** from `app/assets/emblem.webp` (stored independently at `public-site/assets/emblem.webp`). The existing attribution `Developed by Chris Smith` remains visible. The former navy/yellow flyer-inspired landing page theme is superseded; the approved event flyer design is unchanged.

The page is responsive and has **no JavaScript, backend, login, score feed, private registration data, or external font dependency**. Its local stylesheet `styles.css` is allowed by the tightened `_headers` Content Security Policy. Keep the original public registration URL and November event facts unless separately approved. The landing page was verified live on October 30, 2026; the current release is recorded above.

## Public navigation — October 30, 2026

- The public landing page now uses a **static, non-sticky top header**, not the Bracket Manager's staff sidebar. The same approved charcoal/cool-neutral/pastel visual system and circular FFTT emblem remain.
- Header navigation uses in-page links for **Event details** and **Join us**. Both **Register to play** links (hero and final CTA) open the verified public Google form in a **new tab** with `target="_blank"` and `rel="noopener noreferrer"`.
- A discreet **Staff sign-in** link opens the existing **authenticated staff staging** application at `https://fftt3-staff-stg.pages.dev/app/staff` in a new tab. The original October 30 version visibly said **STAGING**; the later organizer-approved update replaces that badge with a cyan **Staff sign-in** pill. The URL still points to staging and does **not** imply a live/production portal, and does not embed or create a second authentication system. Staff roles and access remain enforced by the existing application; do not change the staff destination until a separate live staff origin is explicitly approved.
- Preserve the public site's lack of any client-side auth, Supabase connectivity, event data publication, or private registrant data.

## Desktop navigation rendering safeguard — October 30, 2026

**Browser-visible regression:** A screen recording from a large desktop viewport showed the **new horizontal-header HTML rendered with obsolete sidebar-era CSS**: left-aligned brand, navigation links stacked down the page, and a full-width registration button. The current CSS source already defines a compact horizontal header (`.header-inner{display:flex}`, `.site-nav{display:flex}`), so changing unrelated layouts or registration markup is not an appropriate fix. The likely cause is stale browser CSS under the reused `styles.css` URL; deploy content-addressed styles instead.

- The October 30 cache-fix release loaded `./styles-634f563b.css` containing the **exact same CSS blob** as that release's approved source CSS. Reuse the existing Git object: `634f563b7c6b9309613e6b712c29568fc8a33e47`. Any future stylesheet-content change must produce a new versioned filename and update `index.html` with it. Never edit a versioned stylesheet in place.
- The previous `styles.css` path remains available to avoid breaking already-cached HTML during this transition; its responses should revalidate. The HTML response also requests revalidation; the new content-addressed CSS may be immutable.
- **Release acceptance must test rendered geometry, not only file hashes**: with both a fresh browser context and a browser context primed by loading the previous release, at desktop widths 1440px and 1600px confirm logo/brand left and Event details, Join us, and the Staff sign-in pill aligned horizontally in a single header (navigation not vertically stacked, CTA not full width); at mobile 375px verify a compact wrapped/stacked navigation and no horizontal overflow. Check the stylesheet response URL actually used by the document, CSS rules applied/computed `display`, registration new-tab behavior, and existing external destinations.
- The desktop regression was corrected and verified live in the subsequent October 30 release. For future changes, deploy only a clean `public-site/` bundle to `fftt-public` production `main`, with no DNS, staff/spectator staging, Supabase or auth changes.

## Compact responsive header and staff pill — October 30, 2026

This is the latest explicit organizer correction and supersedes the earlier visible `STAGING` badge requirement for the public header. The **Staff sign-in** link itself is a soft-cyan rounded pill with a visible darker-cyan fill/border/text hover (no underline). The link continues to the **existing authenticated staging application**; removing the label **does not** make it a production application or change any permissions. No authentication is embedded in the public homepage.

At tablet/zoomed viewports up to 980 CSS pixels the header brand gets its own row with a compact, left-aligned, flex-wrapped navigation row below. At small widths the navigation wraps naturally; the header registration button was later removed at the Organizer's request. The hero and final-section registration buttons retain their intended mobile sizing.

That release's stylesheet was content-addressed as `public-site/styles-489c7378.css` using Git blob `489c73784adcaa3aa19cc0e7af2752a2b1b11ed7`; the **current** homepage uses `styles-b39f1233.css`. Previously published versioned CSS files remain unchanged so cached HTML continues to work. Rendered layout/hover verification is required on fresh and previously cached desktop/tablet/mobile browsers before calling the deployment complete.


## Approved hero photo + navigation simplification — October 30, 2026

The organizer approved the enhanced near-white-floor scene (edited from the original FFTT table tennis photo) as the new **public homepage hero image**. Preserve the generated approved master asset; do not independently re-generate player or audience faces. The photo shows sharp players and table, a pale neutral floor, straight table undercarriage, a heavily blurred audience, and no adjacent support column. The finalized, motion-blur-refined **v2** image is now committed as `public-site/assets/fftt-fellowship-hero.webp` (1600×900 WebP, 114,946 bytes), SHA-256 `623b56988b82b2a38c3369d5413c270efdab13e8ef6eac5efc18271e0ee3214a`. It supersedes the earlier v1 image and checksum (`87ebf4be…`). Image-only application commit: `46a1df09043991eb769ea50f5aaba783e017ed2e`. The full-resolution approved PNG master (1672×941) remains outside the public repository and deployment.

Latest user-approved HTML/CSS changes:
- Header now contains Event details, Join us, and a smaller **STAFF SIGN-IN** pill (32px height, 11px uppercase font, cyan hover). No Register button in the top menu. Staff continues to link to the existing authenticated staging origin; this does not imply production staff access.
- Event details and Join us use text-color hover/focus instead of underline.
- Hero retains the existing copy and primary Register to play CTA; a full-width, responsive media block displays the approved image below the hero copy, preserving both players and table. There is still one secondary CTA at the bottom of the page. The existing form, November 22 **1:00 PM EST** event information, spectator invitation, and Bracket Manager design tokens are unchanged.
- All public registration links open the approved Google Form in a new tab with `noopener noreferrer`.
- The new content-addressed CSS file must be included in the deployed directory. Do not edit older fingerprinted CSS assets. Test at desktop and phone widths, warm-cache navigation, image loading, hover states, links, and absence of horizontal overflow.

## Image-led hero, icon cards, fellowship strip and sticky header — October 30, 2026 (source prepared)

The Organizer approved the fully integrated hero composition inspired by the earlier mockup, using the **exact already-approved v2 hero WebP** (`assets/fftt-fellowship-hero.webp`) without regeneration, recoloring, or asset changes. The HTML places the existing headline, fellowship copy and primary **Register to play** action in the upper-left of the photograph. A layered near-white CSS gradient makes the text readable while retaining the table surface, net, players, and motion-blurred background; the photo is still a normal accessible `<img>`, not a downloaded remote background.

Four white, bordered **event-detail cards with small pastel-backed inline SVG icons** overlap the lower photo, where table legs/wheels can be partially covered. The cards contain only confirmed event facts: **Sunday, November 22, 2026**, **1:00 PM EST**, **2 tables**, and an all-skill-level welcome. Do not use the incorrect 10:00 AM or invented doors-open time from earlier illustrative mockups.

A three-part **More Than a Game / All Are Welcome / Same Mission** white fellowship strip follows the tiles. The existing Ypsilanti SDA Church address, secondary registration CTA, exact live Google registration URL, compact uppercase cyan staff pill, and no-header-registration decision are preserved. All registration links open new tabs.

The topbar is now **sticky**, unlike earlier explicitly non-sticky releases. It uses a translucent off-white surface with a subtle blur, `top:0`, and strong stacking. Responsive scroll padding/anchor margins prevent it covering the Event details and Join us anchor targets. At narrow widths, the headline and controls move above the untouched image and the cards reorganize into two columns; the fellowship strip becomes a vertical list. Accessible keyboard focus and reduced-motion behavior remain.

The current source uses content-addressed `styles-61fb9e56.css` (Git blob `61fb9e5647181204790edb3395fed23f4ba6b637`); previously published fingerprinted styles remain untouched. This source change is **not live** until an isolated `public-site/`-only Cloudflare Pages deployment from the exact commit has passed rendered-layout checks on desktop, tablet, mobile and scroll/anchor behavior. Never deploy from the application repository root: Wrangler may unintentionally attach the root `functions/` bundle.
