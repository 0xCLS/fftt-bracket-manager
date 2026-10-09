# Phase 1B B2h — Password-free, genuine hosted Auth session rehearsal

**Environment:** isolated Supabase Free `fftt-bracket-manager-dev`, exact project ref `copmkalfkkrkzheohwuc`. **Application status:** draft feature branch, not merged to `main` or GitHub Pages; no production volunteers or FFTT3 registration data.

## Why this path

Four confirmed Auth accounts already exist, and the event-scoped database grants and one-matched **2099-01-01 synthetic-only** fixture are verified. The three disposable Yahoo testing-alias passwords were never retained. Earlier discussions deferred unnecessary password resets rather than recreating accounts. **Supabase Auth Admin supports `generateLink(type=magiclink,email)` without delivering any email**, and `POST /auth/v1/verify` can exchange the one-time `hashed_token` for an **actual server-issued signed JWT**. That permits the backend/API permissions rehearsal without changing passwords or creating replacement accounts.

This is an **admin-initiated test-session path**, not proof that a genuine volunteer can independently receive an email and sign in. The operator must have a project `sb_secret_` key available **locally**; such keys must never go to ChatGPT, public GitHub, browser JavaScript or CI. The existing code does not and cannot obtain that key from the Supabase connector. The script uses a project `sb_publishable_` key for token exchange and all signed/anonymous client calls.

**Scope limitation:** Generating/redeeming magic links creates one-time Auth tokens and ordinary sign-in/session metadata. The test is **read-only with respect to all FFTT event/staff/bracket/match/results data**, not completely read-only in Supabase Auth. It does not alter passwords, user grants, account email confirmation flags, or scores. It may replace an existing Auth recovery-token/magic-link state for that development account; do not use this operator method for real users or production.

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

## Operator steps — not yet executed

1. Have Python 3 installed on your personal Mac. Retrieve the project `sb_secret_` key from [Supabase project API Keys](https://supabase.com/dashboard/project/copmkalfkkrkzheohwuc/settings/api-keys). **Do not paste that key into this chat or GitHub.**
2. Obtain the synthetic event UUID from private `0xCLS/forging-fellowship-table-tennis/maintenance/CHANGELOG.md`, or your approved private project notes. Do not use the real FFTT3 event ID. Know the existing organizer login email.
3. From the checked-out application repository on this **unmerged B2h branch**, run `python3 tests/b2h_admin_magiclink_signed_auth.py` in your own Terminal. The tool prompts for organizer email, synthetic event UUID, a hidden secret key, and the exact confirmation phrase.
4. When it reports `B2h HOSTED PASS`, share **only the non-secret pass/fail outcome**, not key, email, JWTs, returned links, or hidden prompt contents. On any failure, the script stops with the test label and a safe short error; do not retry multiple times in a row without investigating existing sessions/rate limits.

A small Mac operator launcher archive was also prepared and verified for delivery in the chat. Its `.command` file downloads this **pinned public source at commit `af5d9c9cefde125f85dc0e2e793c5c708605f75c`** directly on the organizer's Mac, then runs Python 3 locally. The archive does **not** contain credentials or pre-generated Auth links. The exact project secret is still entered only by the organizer in a hidden Terminal prompt. Its wrapper has not been executed here or on hosted Auth. A connected GitHub/Supabase tool does **not** itself provide the private project secret required to run this.

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

**Current status:** Only offline test suite and CI source are prepared; **operator has not run real hosted Auth magic-link session test**. No Auth session success may be claimed until real operator output is verified and hosted event invariant checked.

Official Supabase references: https://supabase.com/docs/reference/javascript/auth-admin-generatelink , https://supabase.com/docs/reference/javascript/auth-verifyotp , https://supabase.com/docs/guides/getting-started/api-keys and https://supabase.com/docs/guides/auth/jwts .
