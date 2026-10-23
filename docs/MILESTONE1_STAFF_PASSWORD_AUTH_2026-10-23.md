# Milestone 1 — Game-day staff authentication candidate (email/password + optional emailed code)

_October 23, 2026 · **synthetic-only, local candidate**. Implements the organizer's [game-day authentication requirement](MILESTONE1_MULTI_DEVICE_OPERATIONS_2026-10-21.md). Password sign-in is **not enabled on the hosted Supabase project**, nothing here has contacted it, no email was sent, no account or grant exists for it, and the existing PKCE development evidence is untouched. Hosting and Supabase setup are in the [staging assessment](MILESTONE1_STAGING_HOSTING_2026-10-23.md)._

## 1. What exists

| Capability | Module | Notes |
| --- | --- | --- |
| Allowlisted Auth client | `contracts/milestone1_password_transport.mjs` | Password grant, refresh grant, logout (local/global), current user, existing-user-only email code request/verify, and the three audited read RPCs. **No sign-up, recovery link, admin call, redirect URL or privileged key.** Failures are classified (`invalid-credentials`, `rate-limited`, `network`, `unavailable`, `access-rejected`, …) and never carry server text; a session response is reduced to four fields. |
| Session lifecycle | `contracts/milestone1_password_session.mjs` | Described in section 3. No timers, no automatic retries, no score or publish path, passwords never stored. |
| Opt-in tab vault | `contracts/milestone1_staff_session_vault.mjs` | Strict-schema, `sessionStorage` only, refresh token and pins only. |
| Optional emailed code | `contracts/milestone1_email_code_recovery.mjs` | Section 5. Separate from password login. |
| Narrow origin profiles | `contracts/milestone1_device_origin_policy.mjs` | Staging/production public origins, exact and attested; shared account origin hard-denied. |
| Mobile-friendly page | `rehearsals/m1/staff-login.*` | Disabled unless the synthetic test harness is installed **and** the origin is approved. |
| Sanitized export | `tools/staging/build_export.py` | See the staging document. |

## 2. Authentication requirements and how each is met

* **Existing, authorized users only; no registration.** The client has no sign-up call; code requests send `create_user:false`; an authenticated account with no role for the event is refused and its server session is closed immediately. Server side, the proposal is to switch public sign-ups off.
* **No secrets in code.** Passwords exist only as the argument of one call (the field is emptied the moment the form is submitted); the page embeds only the project URL and publishable key; tests generate fixture passwords at run time. A source scan forbids storage APIs, timers, sign-up/admin paths and logging in these modules.
* **Independent identity and fresh authorization.** After sign-in, and before **every** private read, the session re-reads `/auth/v1/user`, pins it to the signing-in account, and re-reads the current event role. A revoked grant, a changed role (up or down) or a different identity ends the session on the very next read although the access token is still valid.
* **Uniform failure.** Wrong password and unknown account produce identical results; the code request answers identically for known and unknown addresses.
* **Rate limits.** The provider's limit is honored (`Retry-After` is best effort: a browser page can only read it if the server exposes it, so a 60 s fallback applies). Locally, after five wrong passwords the page stops sending requests and backs off 30 s, 60 s, … up to 15 min; a correct password is not even sent during a wait. All of this is advisory: the provider remains the enforcer.
* **Explicit sign-out.** "Sign out" revokes this device's session on the server and erases every local copy; "Sign out everywhere" revokes all of the account's sessions. If the server cannot be reached, the device is still signed out locally and says so.

## 3. Session lifecycle (design)

| Item | Design |
| --- | --- |
| Access token | Short-lived (provider default one hour), **memory only**, never stored. Renewed when less than 2 minutes remain, single-flight, only as part of a read or resume (no timers). |
| Refresh token | Rotating. The new token is stored the instant it arrives (a lost rotation would orphan the session). Reuse of a spent token outside the provider's 10 s window revokes the whole session family; the client treats that as `revoked`. |
| Absolute limit | 14 hours (configurable up to 24). Ends even an active session. |
| Idle limit | 2 hours without a person touching the page. **Automatic reads are not activity**, so an unattended phone signs out. |
| Clock safety | A clock that moves backwards counts as expired; nothing is "fresh" unless time moves forward. |
| Background / lock / offline | `suspend()` drops all views and gate authority at once, keeps tokens in memory only, reads nothing. `resume()` renews if needed, then re-proves identity **and** role, pinning both. Offline resume stays suspended and can be retried by a person. Backgrounding during a poll or a resume never destroys the suspended session. |
| Network or provider trouble | `network`, `unavailable` and `rate-limited` keep the session; private views are cleared; exactly one attempt per explicit call; nothing retries by itself. |
| Definitive failures | A refused refresh token, identity change, role change, revoked grant, expiry or sign-out end the session and erase storage. |
| Overlap | Reads are serialized; overlapping calls are refused as `busy` (concurrent identity proofs would otherwise invalidate one another). |
| Scores | Out of scope: this session has no scoring or publishing capability, and nothing in it retries a request that could change data. |

### Persistence: options and decision

| Option | Survives reload / discarded mobile tab | Exposure | Verdict |
| --- | --- | --- | --- |
| Memory only | No | Smallest | **Default.** Safest; costs a password entry after any reload. |
| `sessionStorage` (tab) holding only the refresh token | Yes (same tab) | Readable by script on the same origin; not shared with other tabs; gone when the tab closes | **Implemented, opt-in per person and permitted per build.** Mitigated by a dedicated origin, strict CSP, no inline code or third-party scripts, `textContent` rendering, rotation with reuse detection, absolute/idle limits and global sign-out. |
| `localStorage` | Yes, across tabs and restarts | Long-lived, shared across all tabs of the origin | **Rejected** for staff credentials. |
| Cookie | Yes | Needs a server to be `HttpOnly`; a script-set cookie is no better than storage and is sent automatically | **Rejected** (no server in a $0 static architecture). |

Residual risks to accept knowingly: script injection on the staff origin could read the stored refresh token (hence the dedicated origin and CSP); a **duplicated tab** copies `sessionStorage`, so two tabs hold one refresh token and, after the first renewal, the second one's use is treated as theft and **both sessions end** (fails closed; both people sign in again); a shared or unlocked device can be used until the idle limit or an explicit sign-out. A lost phone is handled by the organizer's global sign-out and password change, not by the client.

## 4. Mobile experience

Single-column layout; 16 px inputs (no iOS zoom); tap targets of at least 44 px; `username` / `current-password` / `one-time-code` autofill hints so password managers and the keyboard's code suggestion work; show/hide toggle; no horizontal scroll at phone width; safe-area padding; meaningful, non-technical messages; the password manager only fills on the exact origin it saved, which also defeats most look-alike pages.

## 5. Optional six-digit emailed code (recovery or exceptional sign-in)

Separate from password sign-in and never started automatically. The person asks for a code for an **existing** account (`create_user:false`); the answer is identical whether or not the address exists. Client limits (advisory): one request per minute (and longer if the provider says so), at most five guesses per code (failures of any kind count), a 15-minute client-side lifetime, one verification in flight, single use, and the code is bound to the address it was requested for. The verified session goes straight into the same identity-and-role proof as a password sign-in. **Needs a hosted change:** the Magic Link email must contain `{{ .Token }}` (alongside the existing link so the PKCE evidence flows keep working). No SMTP, template, rate-limit or email change was made. A password reset or a forced password change after code sign-in is a further design step, not implemented.

## 6. Verification (this checkout; simulated provider, intercepted network, fictional identities)

Results on this checkout (macOS, Node v26.3.0, Chromium 156 via an isolated Playwright virtualenv): **Node 393/393** (308 before this batch, 85 new); **14 Chromium suites pass**, including the new staff-login suite (48 checks) on a phone-sized viewport with every network call intercepted; Python guards (10, 8, 7, 5) and the new staging-export test (7) pass. The disposable PostgreSQL / local GoTrue jobs cannot run on this machine (no Docker, Supabase CLI or `psql`); they are unchanged by this batch and must be confirmed by CI after any push. Coverage: correct and wrong credentials; unknown accounts; uniform errors; local cooldown ladder; provider rate limit; unauthorized and revoked roles; role changes; identity swap; session revocation; renewal, rotation, expiry (idle, absolute, clock); renewal failures by class; single-flight; background, lock, offline and interrupted resume; persistence opt-in, tampered/corrupt vault, restore, duplicated tab and theft; sign-out (local, global, offline); concurrent users and devices; the six-digit flow; origin refusals; public/private data separation; the spectator path; real Chromium on a phone-sized viewport. Mutation checks: 28 safety gates were disabled one at a time, each fails at least one test (an early pass was discarded because a doc-dependent test made every mutant fail for the wrong reason; four genuine test gaps it then exposed were closed).

### Defects found while building (fixed, each with a test)

1. Overlapping reads near expiry invalidated each other and wrongly ended the session (reads are now serialized).
2. A server-rejected access token reported a confusing intermediate error; it now resolves once to `revoked` or renews.
3. Definitive outcomes were masked as "locked" after the epoch advanced.
4. A new sign-in over a live session orphaned the old one on the server (now revoked).
5. A module-level counter in the first draft of the recovery controller was shared across instances.

## 7. Decisions needed from the organizer

1. Persistence: confirm "memory by default, per-person opt-in to tab storage; never `localStorage`".
2. Limits: 2 h idle / 14 h absolute (tournament day) — shorter, longer, or keep.
3. Hosting: Cloudflare Pages (recommended) or a dedicated GitHub organization.
4. Whether to enable the emailed-code recovery (needs the email-template change) and how a forgotten password is handled (organizer reset is the simplest).
5. Who creates accounts, how passwords are issued (generated, 16+ characters, handed over out of band) and how a lost device is handled.
6. Whether to add a CAPTCHA at the provider (supported, optional, adds a third-party script and CSP changes; not implemented).

## 8. Not done / not claimed

Hosted password sign-in; any hosted setting; real emails; real accounts; scoring writes under this session; password change or reset flows; CAPTCHA; production hardening review; physical-device results; GitHub/Cloudflare behavior verified against live services.
