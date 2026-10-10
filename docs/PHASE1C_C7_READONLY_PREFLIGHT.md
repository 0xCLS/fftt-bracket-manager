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

## Verified C7 live hosted HTTP evidence and Mac handoff — October 9, 2026

[GitHub Actions C7 live public preflight #38008227033](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38008227033) **PASSED**, using Node 22 and the deliberately public publishable key:

- All **three** real `fftt_public_results_v1`, `fftt_published_events` and `fftt_published_matches` GET projections returned **zero** rows. Their contents were never logged or reproduced.
- `GET /auth/v1/settings` returned HTTP 200. It **does not prove anything about the actual email template**; the six-digit-code question is unresolved.
- All **five** required browser-oriented `OPTIONS` preflights accepted the localhost origin and intended method for `/auth/v1/otp`, `/auth/v1/verify`, `/auth/v1/user`, `fftt_staff_role_v1`, `fftt_matchdesk_v1`. No POST or Auth request was made.
- Five static test guards passed. The existing application browser regression suite remained independent and was not used to claim real signed-in usage.

To preserve reproducibility, committed the exact local Mac handoff **source** in `tools/c7/`: `C7_Readonly_Local_Server.py`, `Run_C7_Readonly_Login_Rehearsal.command` and `README_C7.txt`. The Python launcher fetches **seven reviewed public source files** pinned to immutable Git commit `355b916cf3e2905d1aa89a144e08da43e311b39a`, checks their exact Git blob SHA-1 values, serves only at `127.0.0.1`, opens the C6 page and clears downloaded files on exit. The terminal does not accept an email, OTP, admin key or private event ID. It does **not** request an OTP: only the actual user's explicit browser click can do that. Source tests mock downloads and verify digest/redirect/path behavior.

The user-delivered `FFTT_C7_Readonly_Login_Rehearsal_Mac.zip` contains those **exact three** text sources and was checked for valid ZIP integrity, `755` executable permission, Python compilation, shell syntax and a known Git-blob SHA test vector. Local artifact SHA-256: `15be3b304c422dd8ac51913d1b7241dd86d67fac343f6b0469907ec7e3dd7daa`. The ZIP was **not** published on a public release page, and the source-code checksum protects file integrity but is **not a code-signing certificate**. No Mac GUI/inbox user test has yet been performed by ChatGPT.

**C7 network preflight PASS ≠ real email-code/login PASS.** Any actual individual test requires the owner to run the launcher and click the OTP request button manually. Do not ask them to paste code, JWT or magic-link URL back into chat. An email template change or hosted Auth configuration change is a separate organizer gate.


