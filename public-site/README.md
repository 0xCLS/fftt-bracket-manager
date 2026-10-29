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
