# Phase 1C C6 — Existing individual email-OTP sign-in and real read-only browser interface

**Status (October 9, 2026):** A **draft, unmerged, independently authenticated read-only browser harness** is staged. The browser code can request an existing synthetic development account's six-digit email OTP **only after that person deliberately clicks the button**; no automatic OTP emails or real hosted Auth flows are initiated during GitHub CI. It cannot sign up new accounts, manage staff, submit scores, restore cloud writes, or publish anything. **Do not merge, deploy or use for FFTT3 participants.** Supabase's existing development Magic Link/OTP email template is **not yet verified to contain a six-digit code**: if it only delivers a magic link, this flow remains blocked pending a separately reviewed template decision.

## Current source and architecture

- `contracts/phase1c_c6_existing_user_otp.mjs` — minimal pure browser Auth boundary pinned to the existing synthetic dev Supabase host. A public `sb_publishable_` key and *injected fetch* are required; it makes exactly these **user-initiated login/validation** routes:
  - POST `/auth/v1/otp` with `email`, **`create_user:false`** (prevent silent new account creation).
  - POST `/auth/v1/verify` with the **six-digit token, type email, and the same requested account**.
  - GET `/auth/v1/user` with the returned bearer JWT to independently validate the user ID/email match. If verification or any policy check fails, no session is established. Only a successful authenticated response can make the UI signed-in.
- `rehearsals/c6/index.html`, `read-only.css`, `read-only.mjs` — a standalone browser interface, **not** the deployed seven-screen `index.html`, showing an existing-account email form, six-digit code verification, a private synthetic event UUID input (not hardcoded), authorized event-staff role and private matchdesk reads via the already tested C3 transport, and **anonymous published-only** public projection. The public `sb_publishable_` key is intentionally embedded in the test harness; it is **not a secret or an administrator key**. Test accounts, event UUIDs, JWTs, one-time codes, raw Auth response bodies, staff contact details and participant data are **never checked into GitHub**.
- `tests/phase1c_c6_existing_user_otp.test.mjs` — contract tests for explicit OTP request, no account creation, signed session role validation, wrong-email/identity, invalid JWT/lifetime, rate-limit/network failure, no automatic session refresh, token expiry, local sign-out, and logout during an in-flight verification.
- `tests/c6_browser_read_rehearsal.py` — headless Chromium rehearsal with **all hosted endpoints intercepted by in-memory fake responses**, fictional organizer/scorekeeper/outsider identities and event IDs. It verifies that no OTP request happens on page load, the public results are separate from private staff data, outsider cannot read matchdesk, authorized test accounts see only the permitted matchdesk fields, mobile usability, local sign-out and no browser-stored JWT.
- `.github/workflows/phase1c-c6-browser-read.yml` — runs both sets of tests **without any Supabase secrets, real login emails, score POSTs, database changes, or access to actual hosted participant data**.

### Auth security and practical limits

Only the public synthetic development project origin is allowed; no arbitrary hostname/redirect, query/fragment session parsing, OAuth exchange or Auth admin function is implemented. Content Security Policy limits scripts/styles to same-origin and outbound connections to the dev Supabase origin, blocks external images/frames, and prohibits form navigation. The individual JWT resides **only in a private in-memory instance**, is cleared on sign-out, is never logged and is not persisted via localStorage, sessionStorage or cookies. Reloading/closing the test tab discards it; the session does not auto-refresh or survive expiry. Authorization is based on **the actual server-signed identity and current event role**, not a fake organizer dropdown.

**Important sign-out limitation:** Clearing memory does **not** revoke a server-issued Supabase access token. A real production sign-out/revocation/refresh strategy needs a separate reviewed Auth session design. Untrusted browser JavaScript shares an origin with other scripts; a production deployment will also need an audited asset/CSP/origin policy.

**Email template condition:** Supabase's default template may contain a magic link rather than `{{ .Token }}`, which yields a six-digit OTP. C6 intentionally does **not** follow or process the magic link; it accepts only a six-digit code typed by the existing account owner. Changing hosted Auth email templates or redirect URL allowlists was **not authorized and has not been done**. In the current dev project, email sending/receipt or inbox access has not been independently verified for this flow. If the template or mail delivery is incompatible, C6 real-world sign-in is not proven; do not create, reset or recreate accounts to bypass it. Existing-user request via `create_user:false` does not prove mail delivery or role permission.

### Real hosted reads, if explicitly initiated by the individual test account owner

A tester can run a localhost-only copy of this draft branch:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/rehearsals/c6/index.html`. The standalone page may perform an **anonymous published-results GET** on opening; this is read-only and the current public publication is empty. It sends an OTP email request only on an intentional click by the person who controls the existing synthetic account inbox; verification and JWT-based role reads require subsequent explicit actions and a separately entered private synthetic event UUID. **Never paste an administrator `sb_secret_` key, privileged JWT, magic link, token hash, real FFTT3 participant email, or score data into this page.**

Ordinary volunteer-owned sign-in is not considered production verified until a human tester successfully receives a six-digit code and signs in through the real development Supabase Auth system with independently verified role/desk permissions, followed by a separate documented backend check. The mock CI **cannot** substantiate real email sending, Auth user-level policies or CORS behavior.

### Verified offline CI results — October 9, 2026

[C6 successful mock Auth + Chromium run #38000611540](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38000611540) completed **16/16 Node contract tests**, plus the full real Chromium rehearsal using **three entirely fictional identities** and intercepted HTTPS response fixtures (organizer, scorekeeper and outsider). The browser tested no unsolicited OTP on startup, `create_user:false` in the actual request body, six-digit verification, identity validation, signed role/desk reads, outsider denial, public-only published projection, local session clearance, zero localStorage/sessionStorage data, no score/grant/admin RPCs and the 375px mobile layout. CI never contacted real hosted Auth, sent an email or touched production.

The initial C6 browser CI run reached successful OTP-request/mock-verify assertions but failed because the Playwright test invoked `wait_for_function` with a JavaScript expression on a page whose **correct CSP forbids unsafe eval**. Fixed only the test to use Playwright's ordinary DOM `expect(...).to_contain_text(...)` checks; the page CSP remains strict. The later C6 CI run passed both the browser and pure Auth test jobs. This was a test harness issue, not a hosted account problem.

**Do not overclaim:** Passing three fake identities does not prove that the real project sends six-digit codes, that inbox owners receive them, that the dev project's CORS and email templates are compatible, or that an individual user has logged into the app. Those are the next externally controlled verification gates. C5 remains unapplied and all scoring/reconnect RPCs remain unavailable.

## Existing production and future gates

C6 does **not** update `main`, `index.html`, GitHub Pages, existing localStorage/JSON backups, live Supabase SQL/RPCs, C5's **unapplied** snapshot proposal, B2i's completed synthetic match/audit, or FFTT3 registrations. The C3 backend read adapter still refuses all score submissions and authoritative reconnect snapshots. Real hosted C6 browser reads remain an **optional organizer/test-account-owner controlled step**, not claimed completed. Expired or missing account grant must show denial.

Next work after this milestone: verify six-digit OTP email template/delivery with an individual test-account owner if desired; independently audit real browser JWT-backed role/desk reads; design reversible Auth session/logout policies; and only with separate approval consider applying C5's snapshot migration to isolated development Supabase, followed by real JWT and receipt-isolation tests. No production cutover or new hosted score fixture is approved.
