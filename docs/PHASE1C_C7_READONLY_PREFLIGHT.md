# Phase 1C C7 — Live anonymous read/CORS preflight and safe user-owned sign-in handoff

**Status (October 9, 2026):** C7 verifies the *actual isolated hosted Supabase development project's anonymous read availability and browser CORS response* without asking an individual to sign in. It can safely progress beyond C6's mock-only browser tests without creating any Auth users, sending login emails, modifying existing staff grants, submitting scores, deploying C5 SQL, publishing any results, or merging/deploying the public app.

## Verified source and scope

The canonical [C6 browser sign-in harness](PHASE1C_C6_OTP_BROWSER_READ.md) is a standalone read-only localhost UI that submits an email OTP request **only after the individual existing-account owner clicks the request button**. No template/redirect/Auth configuration is changed. The current Supabase connector exposes project status, publishable keys, Postgres metadata and logs but **not hosted email template markup**. A positive public Auth settings response **does not** prove that the email content includes the six-digit `{{ .Token }}` or that the inbox can receive email. *Real account-owner delivery and login remain unverified until the owner conducts the test.*

## C7 live network preflight (PUBLIC, read-only)

- `tests/c7_live_readonly_preflight.mjs` accesses only the development origin `https://copmkalfkkrkzheohwuc.supabase.co` with a **publishable public client key**, never a secret key or signed JWT.
- Exactly three anonymous public projection **GETs** through the already tested C3 allowlist:
  - `fftt_public_results_v1`
  - `fftt_published_events`
  - `fftt_published_matches`
  All must be empty in this isolated dev project. If something becomes published unexpectedly, CI should **fail closed** rather than logging participant data.
- One public **GET** to `/auth/v1/settings`, verifying only that the public settings route responds; **never print raw settings or treat it as evidence of the hosted email template contents**.
- Browser-style **OPTIONS preflights only** to `/auth/v1/otp`, `/auth/v1/verify`, `/auth/v1/user`, and the two authorized staff-read RPCs, checking the localhost origin and needed request methods. OPTIONS requests do **not send OTP email** or authenticate any user. If host-specific CORS is incompatible, fix the test/browser design through review; never loosen actual server Auth security casually.
- `tests/test_c7_preflight_source.py`: static restrictions for GET/OPTIONS-only, no private account/fixture identifiers, no Auth admin or score/staff mutation, and no raw payload logging.
- `.github/workflows/phase1c-c7-hosted-readonly.yml`: actual HTTPS preflight plus static guards in GitHub Actions with no credentials beyond the intentionally public key. **No account sign-in, permission grant or data write is attempted.**

## Separate individual-owned sign-in rehearsal: Mac handoff

A safe local Mac launcher may retrieve the exact **reviewed immutable Git commit** containing C6's isolated read-only HTML, scripts/styles and C3 Auth adapter, verify checksums, then host the files only at `127.0.0.1` and open the user's usual browser. **Do not package any `sb_secret_`, private event UUID, test-account email, JWT, OTP or magic link.** Browser requests are restricted by the page CSP to the isolated Supabase origin.

Once the owner personally decides to test the existing synthetic organizer account:
1. Confirm that this is the existing synthetic dev project only, not the real FFTT3 app.
2. Open the local read-only test page, enter the **existing synthetic account email** and click **Request six-digit code** once. This deliberately sends a login email request; CI and ChatGPT do not do so on the account owner's behalf.
3. If the inbox receives a **six-digit OTP**, enter it in the local page. If it only contains a **magic link**, stop. **Do not paste/click the link in C6** and do not alter hosted email templates without review.
4. Once verified as the individual Auth account through `/auth/v1/user`, enter the existing privately held **synthetic event UUID**, click **Read authorized matchdesk**, and share only non-secret displayed statuses (e.g., `Authorized organizer · 0 matchdesk rows`, no emails/JWTs/codes).
5. Close the local page and launcher. The in-memory browser session clears on reload/close; note **local sign-out does not revoke a server token already issued**, so use a trusted personal Mac, not public/shared computers.

**No automatic mail delivery** or external browser login is part of C7 CI. The current C6 desk RPC may return zero pending rows after the legitimately completed B2i test match; that is not a failure to sign in or a reason to reset or create a new match.

## Remaining gate

Real email template markup and delivery, actual Auth/CORS browser sign-in, full organizer/scorekeeper/outsider device rehearsals, the not-deployed C5 RPC, durable **rejected** submission decisions for safe reconnect, physical controlled offline fallback, and production event-day user onboarding remain unproven. Every hosted score write/new fixture, grant/revoke, SQL migration, email template configuration change, or production change requires its own review and express organizer approval. Do not rerun the consumed B2i match or merge C7 as a production-ready feature.

This source should be updated with exact CI evidence only after the live preflight succeeds.
