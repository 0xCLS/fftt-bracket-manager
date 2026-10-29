# Phase 1B B2h — Password-free, genuine hosted Auth session rehearsal

**Environment:** isolated Supabase Free `fftt-bracket-manager-dev`, exact project ref `copmkalfkkrkzheohwuc`. **Application status:** draft feature branch, not merged to `main` or GitHub Pages; no production volunteers or FFTT3 registration data.

## Why this path

Four confirmed Auth accounts already exist, and the event-scoped database grants and one-matched **2099-01-01 synthetic-only** fixture are verified. The three disposable Yahoo testing-alias passwords were never retained. Earlier discussions deferred unnecessary password resets rather than recreating accounts. **Supabase Auth Admin supports `generateLink(type=magiclink,email)` without delivering any email**, and `POST /auth/v1/verify` can exchange the one-time `hashed_token` for an **actual server-issued signed JWT**. That permits the backend/API permissions rehearsal without changing passwords or creating replacement accounts.

This is an **admin-initiated test-session path**, not proof that a genuine volunteer can independently receive an email and sign in. The operator must have a project `sb_secret_` key available **locally**; such keys must never go to ChatGPT, public GitHub, browser JavaScript or CI. The existing code does not and cannot obtain that key from the Supabase connector. The script uses a project `sb_publishable_` key for token exchange and all signed/anonymous client calls.

**Scope limitation:** Generating/redeeming magic links creates one-time Auth tokens and ordinary sign-in/session metadata. The test is **read-only with respect to all FFTT event/staff/bracket/match/results data**, not completely read-only in Supabase Auth. It does not alter passwords, user grants, account email confirmation flags, or scores. It may replace an existing Auth recovery-token/magic-link state for that development account; do not use this operator method for real users or production.

## October 9 live operator attempt: compatibility fix required

The organizer ran the first B2h Mac launcher locally with a valid modern project `sb_secret_` key. The real hosted Auth Admin `GET /users` preflight **passed**: exactly four confirmed existing synthetic accounts (organizer, two assigned scorekeepers, outsider) with distinct IDs. The next admin `POST /generate_link` for the organizer returned successfully, but the original Python script **stopped before redeeming** that one-time link with `generated link did not identify existing preflight user`.

**Root cause (source contract):** GoTrue's **raw** `/auth/v1/admin/generate_link` JSON contains top-level `id`, `email`, and `hashed_token` fields. The Supabase JavaScript SDK transforms this into `{user:{id,email,...},properties:{hashed_token,...}}`. The original Python script incorrectly checked only `generated.body.user.id`, so a valid flat GoTrue response would have been interpreted as missing identity. Official raw schema: https://github.com/supabase/supabase/blob/master/apps/docs/spec/auth_v1_openapi.json ; SDK normalization: https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueAdminApi.ts.

**Correction:** `exchange_link` now detects the raw flat or SDK-wrapped result explicitly and **requires both exact user ID and case-insensitive email match** before looking up and redeeming the `hashed_token`. No fallback bypasses identity verification. Added tests for successful flat input and missing/wrong ID or email; all token contents and private keys remain out of logs. The original launcher was pinned to commit `af5d9c9cefde125f85dc0e2e793c5c708605f75c` and **must not be reused**, because it always downloads the uncorrected source. The replacement `FFTT_B2h_Passwordless_Auth_Mac_FIXED.zip` is pinned to corrected commit `18f405804d6e1954aa9f6b583fbcc2108512c2c3`; the launcher ZIP was locally syntax-checked and its contents verified. All **19 offline B2h guards** and browser regression tests passed for the corrected source in GitHub Actions (B2h guard run #37957916973; browser run #37957916980). This does **not** count as a successful hosted JWT test.

**Observed after stopped attempt:** Read-only hosted database check: **4** Auth accounts remain, **1** organizer and **2** scorekeeper grants remain, **1** pending match at revision **3**, zero score submissions and zero public results. One Auth magic link was generated but **no verify/redeem request and no signed JWT success occurred**. No participant/event/bracket/staff/score mutation occurred. A magic-link generation can update transient Auth token metadata, so do not claim absolutely no Auth state changed. Do not label B2h hosted as passed until the new operator attempt actually succeeds. Do not share the private API key, generated magic links, token hashes, or JWTs in chat/screenshots.

## October 9 operator rerun — B2h HOSTED PASS (actual signed JWTs)

The organizer reran the corrected, fixed-commit Mac launcher. The user-provided Terminal screenshot shows the **complete test finishing with** `B2h HOSTED PASS: real signed Auth event access verified; NO score/staff/event writes or password changes` and `B2h runner finished.` No secret key, magic-link token, JWT or refresh token was displayed in the output.

Confirmed checks **from the actual organizer-local hosted execution**, not GitHub Actions mocks:

- Auth Admin account inventory verified **exactly four** pre-existing, confirmed independent synthetic accounts: organizer, scorekeeper A, scorekeeper B and an unassigned outsider.
- Each account exchanged a separate administrator-generated one-time magic link for a real Supabase-issued JWT; **all four** JWTs were independently resolved back to their expected original account with `GET /auth/v1/user`.
- Staff-role API returned exactly **organizer** for organizer and **scorekeeper** for both scorekeepers, using those genuine JWTs. Each authorized identity saw exactly **one pending synthetic `C-0-0` match** and the expected fake player names/version, with private-field allowlist checks passing.
- The **signed-in outsider** was denied staff-role and matchdesk RPCs; an **anonymous** role RPC was also denied.
- Crucially, the authenticated request with `Accept-Profile: fftt_private` against `event_staff` was **denied over actual hosted HTTP**, closing the earlier *authenticated* private-schema header verification gap. The original B2f **anonymous** seven-request Python probe itself is still not recorded as having run; do not conflate the two.
- Anonymous public-results projection remained **empty** at the time of the hosted HTTP test.
- The B2h harness has no scoring, staff-write, bracket-write or password-reset endpoint in its strict allowlist; **no such operation was invoked by the runner**. Normal Auth sessions and temporary magic-link state were created as designed.

**Scope of evidence:** This PASS comes from the organizer's supplied Terminal screenshot of genuine hosted HTTP requests, not a fabricated SQL JWT context. An additional read-only Supabase SQL count verification was attempted afterward, but the connector blocked that read; therefore a new independent post-B2h SQL snapshot is **not claimed** here. The passed hosted HTTP matchdesk/public-results observations remain valid.

**Remaining gates:** These were **administrator-initiated** sessions, not a test of independent volunteer invitation, email delivery, account recovery or login UX. No concurrent hosted score-submission test, authenticated organizer staff grant/revoke, bye propagation, corrections, publication, live app cloud cutover or production readiness has been completed. Do **not** assume B2h authorizes a later hosted match write or staff revocation. The private project changelog holds dated outcome/provenance. The original old launcher remains superseded; no further B2h rerun is needed to establish this completed read-only milestone.

## Implementation

`tests/b2h_admin_magiclink_signed_auth.py` is a standard-library Python 3 command-line probe for the organizer's **trusted personal Mac**, never a GitHub Action deployment or public web app. It contains a public client key only; no secret key, JWT, refresh token or password is checked into source.

Safety controls:

- Exact HTTPS Supabase project pin; fixed GET/POST allowlist for Auth list/link/verify/user and **read-only** staff-role, matchdesk and public-results RPCs, plus one private-schema deny test. No DELETE/PUT or score/staff-write endpoints, no redirect following.
- `getpass` hidden prompt for modern `sb_secret_` project key on the operator's own machine; secret used **only** in Auth Admin list/generate-link HTTP `apikey` header. JWTs and one-time token hashes remain in process memory and are never printed or written to disk.
- Exact four-account Auth inventory, with independent IDs and email-confirmed, unbanned/non-anonymous state **before** generating any links; checks a typed existing organizer email and three hard-pinned *synthetic-only* aliases. No creation, invitations, deletion, password reset or enrollment of any user. The generate-link response must match each preflight user ID before redemption.
- An additional explicit local confirmation phrase `RUN B2H SIGNED AUTH READONLY` before any administrator-generated links.
- Genuine Auth server `POST /verify` one-time token exchange and `GET /auth/v1/user` JWT identity verification for each of four distinct accounts; role and one-pending-match read checks for organizer and scorekeepers; outsider/anonymous denial; authenticated private `Accept-Profile: fftt_private` header rejection; public-results empty.
- Fail closed on unexpected users, mismatched identities, forbidden fields, wrong fixture, 5xx, malformed JSON, unsuccessful magic-link exchange, or an accidental public result.
- No stored credentials, score writes, staff grant/revoke, bracket changes or event updates. The test sessions are short-lived and remain in memory.

**Public-source privacy:** Only the three deliberately synthetic testing aliases are embedded. The organizer's personal address and the private event UUID must be entered locally; neither is hardcoded into public repository source.

## Operator steps — completed for B2h signed-Auth verification

1. Have Python 3 installed on your personal Mac. Retrieve the project `sb_secret_` key from [Supabase project API Keys](https://supabase.com/dashboard/project/copmkalfkkrkzheohwuc/settings/api-keys). **Do not paste that key into this chat or GitHub.**
2. Obtain the synthetic event UUID from private `0xCLS/forging-fellowship-table-tennis/maintenance/CHANGELOG.md`, or your approved private project notes. Do not use the real FFTT3 event ID. Know the existing organizer login email.
3. From the checked-out application repository on this **unmerged B2h branch**, run `python3 tests/b2h_admin_magiclink_signed_auth.py` in your own Terminal. The tool prompts for organizer email, synthetic event UUID, a hidden secret key, and the exact confirmation phrase.
4. When it reports `B2h HOSTED PASS`, share **only the non-secret pass/fail outcome**, not key, email, JWTs, returned links, or hidden prompt contents. On any failure, the script stops with the test label and a safe short error; do not retry multiple times in a row without investigating existing sessions/rate limits.

An **updated** Mac operator launcher archive `FFTT_B2h_Passwordless_Auth_Mac_FIXED.zip` has been prepared and verified for delivery in the chat. Its `.command` file downloads the **corrected, pinned public source at commit `18f405804d6e1954aa9f6b583fbcc2108512c2c3`** directly on the organizer's Mac, then runs Python 3 locally. The **original** launcher pinned to commit `af5d9c9...` must not be reused. The archive does **not** contain credentials or pre-generated Auth links. The exact project secret is still entered only by the organizer in a hidden Terminal prompt. Its wrapper has not been executed here or on hosted Auth. A connected GitHub/Supabase tool does **not** itself provide the private project secret required to run this.

## Checks and acceptance criteria

| Case | Expected |
| --- | --- |
| Four pre-existing accounts/IDs confirmed; no new user created | PASS from actual Admin `GET /users` |
| One-time links generated only after local confirmation | PASS |
| Each link exchanged for real JWT and verified by Auth server | PASS |
| Organizer sees `organizer` and one pending synthetic match | PASS |
| Both scorekeepers see `scorekeeper` and one pending synthetic match | PASS |
| Outsider role/matchdesk access | Denied |
| Authenticated private staff schema with `Accept-Profile: fftt_private` | Denied |
| Anonymous staff-role access | Denied |
| Public results | Empty |
| Score submissions, staff writes, password changes | **Never invoked** |
| Ordinary real-volunteer inbox/login UX | **NOT tested by admin-issued sessions** |
| Hosted score race, idempotency, event-day offline fallback | **Pending separate approval** |

**Current status (October 9, 2026):** **B2h HOSTED PASS** documented from actual organizer-local Terminal execution with four real signed sessions and hosted permission checks. The separate post-run Supabase SQL-count attempt was blocked by the connector and is marked **not independently verified**. No password reset or tournament/scoring/staff-write endpoint was invoked. The volunteer-controlled login UX and hosted score/concurrency/recovery gates remain pending.

Official Supabase references: https://supabase.com/docs/reference/javascript/auth-admin-generatelink , https://supabase.com/docs/reference/javascript/auth-verifyotp , https://supabase.com/docs/guides/getting-started/api-keys and https://supabase.com/docs/guides/auth/jwts .
