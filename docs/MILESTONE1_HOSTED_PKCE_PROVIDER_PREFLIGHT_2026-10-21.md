# FFTT Milestone 1 — First real-provider PKCE preflight

_October 21, 2026 · development-only · synthetic existing users · no score submissions._

## Evidence and strict boundary

One real Supabase development Magic Link was delivered through Brevo to the **existing** Scorekeeper A synthetic Yahoo mailbox (Spam folder); clicking it in the original C8 browser produced `SIGNED IN · SYNTHETIC ONLY`. **C8 implicit authentication passes; it is not a PKCE code-exchange test.** The Brevo sender is authenticated and the SMTP credential remains off GitHub.

The original local C8 page, existing redirect allowlist, Magic Link template, hosted users, staff grants, three permanently consumed synthetic scoring fixtures, and production `main/index.html` must not be replaced, modified or scored. Draft PR #19 stays unmerged. The isolated original `rehearsals/m1/staff-pkce.html` remains mock-only.

## New isolated development-only entry point

`rehearsals/m1/hosted-pkce.html` + `hosted-pkce.mjs` are a **separate** localhost-only development trial. They use the existing reviewed PKCE S256 guard, one tab-scoped pending verifier (never a persisted access/refresh token), existing-user-only OTP transport (`create_user:false`) and current signed event-role/read-only Match Desk. No network request occurs merely by opening the page. The operator must enter an already-approved synthetic email, check one-email consent and click once. A failed request never automatically retries. The sender's or recipient's private address is not embedded in this public GitHub source.

This page is staged for acceptance, **NOT YET provider-PKCE validated or production-ready**. Any callback (including error) is scrubbed from the address before asynchronous work. Opening the email in a different browser/profile or an implicit `#access_token` callback must fail closed. The pending verifier must survive switching to the mail tab; only explicit signout cancels it. Site use is pinned to exactly `http://localhost:3000/rehearsals/m1/hosted-pkce.html`. Do not serve it from another localhost port or a public host.

## Provider setup — preserve working C8

1. In the **existing development project** `copmkalfkkrkzheohwuc` go to **Authentication → URL Configuration**. Preserve Site URL `http://localhost:3000` and existing allowed C8 callback `http://localhost:3000/rehearsals/c8/index.html`.
2. Add an **additional**, tightly path-scoped callback entry matching the state-bearing requested redirect, for example `http://localhost:3000/rehearsals/m1/hosted-pkce.html?state=*` (Supabase glob matching treats `?` as a single-character glob and `*` as matching the non-separator state characters). Do **not** use `http://localhost:3000/**`, replace C8, or add an arbitrary public callback. Inspect saved settings before sending email; if the provider rejects or normalizes the entry unexpectedly, stop and review.
3. **Read, do not change** the existing Magic Link template. Supabase documents PKCE email token-hash verification and that its default `{{ .ConfirmationURL }}` template can differ from a PKCE-specific template. A global replacement could invalidate the existing C8 implicit flow. Do not change it as part of this initial preflight. Decide the compatibility mechanism before modifying template or requesting email. References: https://supabase.com/docs/guides/auth/sessions/pkce-flow ; https://supabase.com/docs/guides/auth/auth-email-passwordless ; https://supabase.com/docs/guides/auth/redirect-urls ; https://supabase.com/docs/guides/auth/auth-email-templates .
4. Before an operator sends one more email, require the new code's CI/static gates to pass, validate the actual hosted callback redirect/template semantics, and confirm the synthetic test event identifier privately. A successful email deliverability/implicit C8 test alone cannot satisfy this gate.

## Template compatibility determination (offline source review, October 21)

Reviewed `supabase/auth` (GoTrue) `internal/api/{otp,magic_link,mail,verify,pkce,token}.go` and `internal/utilities/request.go`, plus the Supabase PKCE, passwordless and redirect-URL guides. **No hosted setting was read or changed and no email was sent.**

- **The flow is chosen per `/otp` request, not by the template.** A non-empty `code_challenge` (+ `code_challenge_method`, case-insensitive `s256`) creates a flow state and prefixes the emailed token `pkce_`. A request without a challenge (the C8 page) stays implicit. Both use the same `{{ .ConfirmationURL }}` (`/auth/v1/verify?token=…&type=magiclink&redirect_to=…`).
- **`GET /verify` for a `pkce_` token 303-redirects to `redirect_to` with `code` set via URL query values**, keeping the existing `?state=` parameter: `…/hosted-pkce.html?code=<uuid>&state=<state>`. An implicit token is redirected with `#access_token=…` instead. So the **current template supports both C8 and the new page; no template change and no second compatibility mechanism are needed.**
- The `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` template in the passwordless guide is for server-rendered apps that call `verifyOtp` on their own endpoint. It is not required for this client-side page, and replacing the global template would risk C8. Keep it as a fallback only if a mail scanner proves to consume links (below).
- **Redirect allowlist.** Current GoTrue accepts any redirect on the Site URL's scheme and host (localhost ports are not compared) before consulting the allowlist, so the `?state=*` entry is defense in depth, not the control that makes the redirect work. The pattern is correct (`*` and `?` never match `.` or `/`; the generated state is base64url) and does not match the C8 URL. The real control is the client-side exact path/state/origin check. If the saved redirect is rejected, GoTrue silently falls back to the Site URL, which this page treats as a failed callback.
- **Failure shapes already fail closed:** PKCE error redirects carry `error*` query parameters and a `#error=…&sb=` fragment; implicit redirects carry a fragment. Both are rejected before exchange and burn the verifier (`tests/milestone1_pkce_gotrue_compat.test.mjs`).
- **Residual live risks (cannot be proven offline):** (1) the hosted GoTrue version may differ from the reviewed source; (2) the link, the code (5-minute issue-to-exchange window) and the 60-second per-user email frequency limit are single-use, so a spam-folder link scanner or earlier C8 request can burn the attempt; (3) the link must be opened in the same browser profile. These are covered by the stop conditions above.

## Single-request operator rehearsal after compatibility preflight

From the application repository root on the Mac, launch `python3 tools/c8/local_readonly_server.py` and leave it open. Navigate to `http://localhost:3000/rehearsals/m1/hosted-pkce.html` in the Mac browser/profile that will open the email. Enter the existing synthetic Scorekeeper A address **locally**, confirm a single real email, and click the request button exactly once. Inspect Yahoo Inbox/Spam, use the same browser profile, and confirm whether the callback is a query containing `code` and `state` (do **not** copy or share values) or whether it fails closed; then manually enter the private fictional event UUID and complete authorized read-only verification.

**Stop conditions:** rate-limit or any request error; unexpected Site URL/C8 redirect; callback lacks state or authorization code; `#access_token` implicit-flow redirect; email link opens in the wrong browser; mismatched state/verifier; missing/revoked event role; stale/different V2 revisions; source or CI error. On failure do not retry automatically, reuse the link, paste credentials/IDs or use a consumed fixture for writes. Only sanitized diagnostic/status phrases are shareable.

Success acceptance is **real PKCE token exchange**, independently verified `/auth/v1/user`, current event-scoped staff role, and authorized read-only Match Desk. The separate mock browser suite is not proof of hosted success. Yahoo spam placement remains an open deliverability item. No real FFTT3 data, staff edits, publication or scoring is approved by this document.

## Current pass/fail

- Brevo sender/DKIM/DMARC: **PASS**.
- Real email reaching existing synthetic Yahoo mailbox: **PASS, Spam folder**.
- Existing C8 implicit Magic Link signed-in: **PASS**.
- Live provider PKCE authorization-code redirect and token exchange: **NOT YET TESTED**.
- Live signed role/Match Desk and real device revocation: **NOT YET TESTED**.
- Production deployment, scoring or publication authorization: **NOT GRANTED**.
