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

## Live hosted PKCE acceptance — operator-observed (October 21, 2026)

**Verdict: PASS for the single real-provider, synthetic-only PKCE login and authorized read-only Match Desk gate.** This is an **operator-observed browser acceptance**, not a captured raw HTTP transcript or approval for physical devices, scoring, publication, or production.

- **Environment:** local M1 hosted trial at `localhost:3000` against the existing development Supabase project; integration branch at tested commit `de1360f8fd2cb17dbb1517330e382fca045218d2`. The related [GitHub Actions run #39560369229](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/39560369229) completed successfully (233/233 Node checks, 81/81 baseline pgTAP checks, additional synthetic browser/SQL suites).
- **Operator-confirmed sequence:** exactly one Scorekeeper A synthetic PKCE Magic Link requested successfully; email link opened by navigating the original M1 browser tab to preserve its tab-scoped verifier; callback page displayed `Return received and URL scrubbed`; operator entered the private existing 2099-11-23 synthetic event UUID locally and clicked validation once; UI displayed `SIGNED IN · verified scorekeeper · synthetic only · read-only`; one manual Match Desk refresh displayed `Verified scorekeeper · revision … · generation … · pending … · READ ONLY`. The operator confirmed success; the **exact revision, generation, and pending counts were not supplied** for this record and must not be invented.
- **Interpretation:** successful staff-session UI state requires the PKCE authorization-code exchange, independent signed `/auth/v1/user` identity read, and current event-scoped staff-role verification; successful Match Desk status requires fresh role and V2 revision consistency checks. This evidence is operator-reported UI acceptance, not direct observation of raw tokens or network logs.
- **Independent, aggregate-only Supabase read audit after rehearsal:** 3 synthetic events, 3 private matches, 9 staff-grant rows, 4 Auth users, 4 durable V2 scoring decisions, 3 accepted submission rows, 0 publicly published event rows, 0 publicly published match rows. These match the prior documented conservation baseline. Only aggregate counts were retrieved; no event UUID, email address, session secret, auth code, or one-time link is recorded here.
- **No additional actions approved:** No hosted scoring attempt, fixture replay/reset, staff/account/grant mutation, schema/configuration change, new account, public result publication, real FFTT3 participant import, branch merge, or production rollout. Existing C8 flow was preserved but was not re-tested in this rehearsal.
- **Operator cleanup:** **CONFIRMED October 21, 2026.** After the successful read-only Match Desk check, the operator clicked `Clear session` in the original M1 tab and observed `Session cleared. No retained private rows.` Tab closure has not been independently confirmed. The one-time link must not be reused.
- **Still open:** live multi-device volunteer session and revocation tests; role and outsider denial on physical devices; controlled spectator/TV public synchronization and publication; organizer physical stand-down, protected fallback and manual reconciliation; explicit production authorization. A single staff PKCE PASS is not a full Milestone 1 gate.

## Current pass/fail (updated October 21, 2026)

- Brevo sender/DKIM/DMARC: **PASS** (existing evidence).
- Real email delivered to existing synthetic Yahoo mailbox: **PASS** (previously observed in Spam).
- Existing C8 implicit Magic Link signed-in: **PASS in earlier separate C8 rehearsal**; not re-run during this PKCE test.
- Live provider PKCE authorization-code exchange, signed identity and event-scoped Scorekeeper A role: **PASS — operator-observed M1 UI**.
- Live authorized, revision-checked read-only Match Desk: **PASS — operator-observed M1 UI**, exact displayed numeric values not transcribed.
- Aggregate-only hosted database conservation: **PASS — independent read-only audit**, zero public publication.
- Physical-device login, role revocation, spectator/TV, offline reconciliation: **NOT YET TESTED**.
- Production deployment, scoring, publication authorization: **NOT GRANTED**.
