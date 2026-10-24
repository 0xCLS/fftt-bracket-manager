# Milestone 1 — Zero-cost hosting assessment and proposed staging deployment

_October 23, 2026 · **assessment and preparation only**. Nothing was published, no DNS or Supabase setting was changed, no account was created, no service was purchased. Every vendor statement below is from general knowledge and is marked **verify** where terms or limits could have changed; confirm each at sign-up._

Context: the organizer approved a $0 web-hosted architecture (static site + Supabase), anonymous spectators, individual staff accounts, email/password sign-in and an optional emailed code. See the [game-day authentication design](MILESTONE1_STAFF_PASSWORD_AUTH_2026-10-23.md) for the client side.

## 1. Bottom line

* **Do not serve staff sign-in from the current public GitHub Pages origin** (`https://0xcls.github.io`). It is shared by every Pages site of the account and it already hosts the tournament app, whose event data lives in that origin's browser storage. The policy now hard-refuses it for staff sign-in even if someone lists it.
* **Recommended ($0): a dedicated Cloudflare Pages project for staff (one project for staging, a different one for production)**, because it gives each environment its own origin *and* real HTTP security headers (CSP with `frame-ancestors`, HSTS, referrer and permissions policies), which GitHub Pages cannot set.
* **Fallback ($0): a dedicated GitHub organization whose only Pages site is the staff app** (`https://<org>.github.io`). Origin isolation is the same; there are no custom headers, so clickjacking relies on the page's own top-level check and the meta CSP.
* Keep the **public spectator view on its own, separate origin** (the existing public site is fine for it: it holds no staff secrets). Never put the staff app and the public view on one origin.
* Password and emailed-code sign-in need **no Supabase redirect-URL change at all**, which removes the hosted-redirect gate that the earlier link-based flows needed.

## 2. GitHub Pages: what it does and does not isolate

| Property | Finding |
| --- | --- |
| Origin per site | A **user or organization site** (`<name>.github.io`) has its own origin. **Project sites** (`<name>.github.io/<repo>/`) all share the owner's origin. Path does not isolate: storage, same-origin framing and `fetch` are per-origin. |
| Consequence for this project | The public app is a project site under `0xcls.github.io`. Any other Pages repo under that account (now or later) is same-origin with it. An XSS or a hostile page there could open the staff page in a same-origin frame and drive or read it. |
| Storage and sessions | `sessionStorage`/`localStorage` are per origin (and `sessionStorage` per tab). Sharing the origin shares the storage namespace. |
| Callback / origin restrictions | Password and code sign-in have no callback. Link-based flows (PKCE) need an exact redirect-allowlist entry per origin. |
| Response headers | Not configurable: **no `frame-ancestors`/`X-Frame-Options`, no custom CSP header** (meta CSP only, and meta CSP cannot restrict framing), no `Permissions-Policy`. |
| Public source | The repository must be public on the free plan; this is already true and is acceptable because the only embedded values are the project URL and the publishable key, which are public by design. Authorization is enforced by the database functions, not by hiding code. |
| HTTPS | Enforced on `github.io` (**verify** HSTS behavior). |
| Free-tier limits (**verify**) | About 1 GB site size, ~100 GB/month soft bandwidth, soft build limits; not for commercial transactions (a church tournament app is within the intent). |

**Verdict:** GitHub Pages can meet the *storage/origin* requirement only through a **dedicated organization site**, and cannot meet the *response-header* requirement at all. It is therefore the fallback, not the first choice. Using the existing project-site URL for staff authentication is **rejected**.

## 3. Cloudflare Pages (free) — recommended

| Property | Finding (**verify** all) |
| --- | --- |
| Origin | Each project is `<project>.pages.dev`, its own origin (the suffix is on the public-suffix list). Preview deployments get extra sub-hosts (`<hash>.<project>.pages.dev`); the policy refuses those (exactly one label before `pages.dev`). |
| Headers | A `_headers` file sets CSP including `frame-ancestors 'none'`, HSTS, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, `Cache-Control`, `X-Robots-Tag`. A proposed file is in section 8. |
| Deploy | Git integration or direct upload of a pre-built folder (preferred here: we upload the **sanitized export**, not the repository). |
| Cost | A free plan exists (static requests are not metered; a monthly build cap applies; no card should be needed). It is a **new vendor account** and needs your approval. |
| Risks | Account takeover is the main one: use a strong unique password and MFA. A compromised deploy account can ship a malicious page, so keep the account used for deploys separate from daily browsing and review each deployment. |

## 4. Alternatives considered

* **Netlify / Vercel / similar free tiers:** workable technically, but plan terms change often and Vercel's free plan restricts commercial use; no advantage over Cloudflare for this purpose. The policy keeps them denied unless a future review changes that.
* **Supabase Storage as a static host:** not suitable (HTML is served in a way that prevents running it as a site).
* **Private network only (Tailscale, local HTTPS):** dropped by the organizer; remains a possible *development* aid but is not the game-day architecture.
* **Custom domain:** best long-term for phishing resistance, but costs money (not authorized).

## 5. Security model that follows from this

1. **Origins are a client-side safety check, not a server control.** Supabase's API accepts browser calls from any origin and the publishable key is public, so anyone can call the sign-in endpoint from anywhere. What protects accounts is: long random per-person passwords, Supabase's rate limits, server-side authorization (event roles are checked inside the database functions on every request), optional CAPTCHA, and revocation. What the origin policy protects is *honest users*: staff pages refuse to run on an unapproved or shared origin.
2. **Look-alike pages are the realistic phishing risk.** Free sub-domains are easy to imitate. Counter-measures: one printed/QR link per environment, a password manager (it fills credentials only on the exact origin it saved them for), and short, distinctive project names.
3. **Public vs. staff separation.** Separate origins mean the public view can never read staff storage, even if it were compromised; both are also kept free of dynamic HTML (`textContent` only) and under a strict CSP.
4. **No secret ever ships.** Only the project URL and publishable key are in the pages. No service-role key, no passwords, no event identifiers, no real participant data.
5. **Environment separation.** Staging uses the existing synthetic development project and fictional users. Production must be a **different Supabase project** (the free plan allows two) so that staging mistakes cannot touch real data. A build declares its environment in `origin-profile.json`; a staging build refuses the production origin and the reverse.

## 6. Free-tier operating restrictions to plan around (**verify**)

* **Supabase free projects pause after about a week of inactivity.** A paused project does not answer until someone restores it in the dashboard. Restore it well before event day and rehearse on the actual project in the days before. A keep-alive request would be a hosted action needing its own approval.
* **No automatic database backups on the free plan** (verify): export data by hand before and after each event; the app's own JSON backup remains the organizer's fallback.
* **Auth email** must use the custom SMTP already configured (the built-in sender is tightly limited); the SMTP provider's daily cap bounds code emails.
* **Auth rate limits are per IP.** Volunteers on one venue Wi-Fi share one address, so limits that are too tight can lock legitimate people out while limits that are too loose help a guesser on the same Wi-Fi. Review them once with realistic numbers (about 10 staff).
* **Pro-only controls we therefore cannot rely on:** server-side session time-boxing/inactivity timeout and leaked-password protection. The client enforces its own absolute and idle limits, and the organizer's emergency tool is global sign-out of an account plus a password change.
* Database size, monthly active users and egress are far above what a one-day tournament needs.

## 7. Supabase configuration changes this would need (NONE made; each needs approval)

| Setting | Proposed | Why |
| --- | --- | --- |
| Allow new users to sign up | **Off** | No public registration; accounts are created only by the organizer. |
| Email provider (password) | On (already the default provider) | Routine sign-in. |
| Minimum password length / requirements | At least 12 characters (random 16+ issued) | Brute-force resistance. |
| Refresh-token rotation and reuse detection | On, default 10 s reuse interval | A leaked or duplicated token revokes the session family. |
| JWT expiry | Keep the default (1 h) | The client renews 2 minutes before expiry. |
| Rate limits | Review sign-in, token refresh and email limits for ~10 staff on one IP | See section 6. |
| Magic Link email template | Add `{{ .Token }}` **in addition to** `{{ .ConfirmationURL }}` | Enables the optional 6-digit code without breaking the link-based development evidence. Not needed for password login. |
| Users | Organizer creates each account in the dashboard with a generated password, auto-confirmed | No self-service registration. |
| Staff grants | Existing event-scoped grant procedure | Authorization stays in the database. |
| Redirect URLs / Site URL / SMTP | **Unchanged** | Password and code sign-in use no redirect. |

## 8. Proposed staging deployment (not published)

Structure produced by `tools/staging/build_export.py` (tested by `tests/test_staging_export.py`) from an exact commit (tracked files only; nothing from the working tree; it refuses a dirty tree and any origin the runtime policy would refuse):

```
rehearsals/m1/staff-login.html|mjs|css
rehearsals/m1/origin-profile.json   GENERATED for the chosen environment, e.g.
                                    {"environment":"staging","approvedPublicStaticOrigins":[{"origin":"https://<project>.pages.dev","environment":"staging","dedicatedOrigin":true}],"approvedHttpsOrigins":[]}
contracts/                          10 modules: password session, password transport, staff session vault,
                                    email-code recovery, device origin policy, read supervisor, connected desk,
                                    staff access gate, read-only Supabase transport, disconnect reference
_headers                            GENERATED security headers (below)
MANIFEST.json                       commit and SHA-256 of every file (16 files in total)
```

Excluded by construction: `tests/`, `docs/`, `supabase/`, `tools/`, `.github/`, `.git`, any `*.local.json`, scripts, SQL, logs, anything not reachable from the page.

Proposed `_headers` (Cloudflare Pages):

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://copmkalfkkrkzheohwuc.supabase.co; img-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
```

### Deployment runbook (to run only after approval)

1. Pre-checks: CI green on the exact commit; `build_export.py` run from that commit; read the generated `MANIFEST.json` and `_headers`.
2. Create the staging Pages project (new vendor account: strong unique password + MFA; no payment details). Pick a short distinctive name. Upload the export folder (direct upload).
3. Confirm the response headers with a single manual request, the sign-in page loads, and an unapproved path returns 404.
4. Set the project to **not** deploy previews publicly (or delete previews after use).
5. Supabase (separately approved, in this order): sign-ups off; password policy; rate-limit review; create *fictional* staging accounts with generated passwords; confirm grants for a fictional event; (optional) template change for the code.
6. Device tests (section 9). 
7. Record sanitized results; do not paste links, passwords, tokens or event identifiers anywhere.

### Rollback

* **Site:** roll the Pages project back to the previous deployment, or delete the project (the staging origin then ceases to exist and no build can use it).
* **Accounts:** global sign-out of each affected account, change or disable the password, remove its grant.
* **Supabase settings:** restore the values recorded (screenshots) before the change; re-enable the previous template if it was edited.
* **Origin profile:** a build with an empty list refuses every public origin.

## 9. Device-test procedure for staging

Run the same Tier 1 style rehearsal as the [physical-device runbook](MILESTONE1_PHYSICAL_DEVICE_RUNBOOK_2026-10-21.md), replacing "request an email link" with **password sign-in**: for every phone/tablet/browser (a) open the one printed link and confirm the origin, (b) let the password manager offer to fill, (c) sign in, follow the desk, (d) switch apps for a minute and return, (e) lock the screen for several minutes and return, (f) enable airplane mode and return, (g) close the tab and reopen with and without "keep me signed in", (h) wrong password and rate-limit behavior, (i) one organizer revokes a scorekeeper's grant and that device must lose access within one poll, (j) use the emailed code once as the recovery path, (k) sign out everywhere. Target: **zero routine login emails during active play** (an operational target, not a guarantee).

## 10. Remaining production-readiness requirements

A separate production Supabase project and project-level review; the real-account provisioning and offboarding procedure; password issuing and recovery procedure; security review (including a review of the interplay with scoring, which this candidate does not enable); backup/export routine; monitoring and an incident contact; a privacy notice before any real participant data; accessibility and device-matrix sign-off; a full fictional event on real devices; the pause/keep-alive plan; and written approvals for each hosted change above. **Not implemented, not tested on hosted infrastructure, not released.**
