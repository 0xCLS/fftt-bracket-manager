# Phase 1C C9 — Independent individual role/denial rehearsal

**Status: prepared, NOT performed.** Based on the organizer-observed C8 sign-in and role-read PASS on October 13, 2026. Do not interpret C9 preparation as independently verified volunteer onboarding, production login, or scorekeeper authorization.

## Goal
Verify that a separately authenticated, **existing** synthetic scorekeeper can read their eligible matchdesk, and an existing **ungranted** synthetic outsider cannot. Both accounts must be tested independently in their own browsers/profiles; do not reuse organizer sessions or impersonate another person. Existing B2i fixture was consumed and cannot be scored again. Zero pending matches is expected and proves only an authorized empty desk, not scoring usability.

## Restrictions
- Synthetic Supabase development project only, existing approved accounts only.
- No signup or Auth admin, password resets, email-template edits, new grants/revocations, schema SQL, result/score writes, fixture resets, publication, real FFTT3 participants or production frontend changes.
- Never paste account email, UUID, Magic Link URL, JWT, query/fragment, browser network response, or private player details into GitHub, chat, or screenshots.
- Event UUID entered **privately in browser**; do not commit it.
- Stop immediately on unexpected data, unexpected HTTP behavior, or denied permission for an account believed to be authorized. Do not fix denials by broadening roles.

## Approved read-only tool
Reuse the reviewed **C8 rehearsal** at `http://localhost:3000/rehearsals/c8/index.html`, using `python3 tools/c8/local_readonly_server.py` from a checkout of this branch. C8 only requests /auth/v1/otp on explicit owner click, validates /auth/v1/user, calls existing read-only `fftt_staff_role_v1` and `fftt_matchdesk_v1`, and reads public projections. No score endpoints.

## Steps
1. Confirm C8 organizer session is cleared and browser tab closed. Stop old localhost server. Confirm port 3000 is free. Start the local C8 server from an up-to-date C9 checkout. Keep this server running.
2. **Authorized scorekeeper**: Owner of an **existing previously granted synthetic test account** uses their own browser profile (never organizer's profile), enters their email, clicks Request Magic Link **once**, opens link in that same profile, re-enters the same account email, and verifies.
3. Once `SIGNED IN · READ ONLY`, enter the private 2099 synthetic event UUID into C8 and click **Read authorized matchdesk** once. Expected: `Authorized scorekeeper · 0 eligible pending matchdesk rows. READ ONLY.` If no longer granted, stop rather than changing the grant.
4. Click **Clear local session**, close the tab, and use a separate, fresh profile for the next account. Remember this only clears browser memory; already issued server access JWTs expire later.
5. **Unauthorized outsider**: Owner of the **existing ungranted synthetic account** repeats Magic Link login in a distinct profile. If sign-in succeeds, event role/matchdesk read must display **access denied**, never an organizer/scorekeeper role or match data. Do not register a new outsider.
6. Confirm public projection still has zero published events. Exit the browser and stop local server.

## Evidence — SAFE STATUS TEXT ONLY
Record each outcome as status, not identifiers:
- Scorekeeper: magic-link delivered [yes/no]; signed in [yes/no]; authorized scorekeeper [yes/no]; eligible pending desk rows [count or unavailable].
- Outsider: magic-link delivered [yes/no]; signed in [yes/no]; private staff read denied [yes/no]; private match content leaked [yes/no].
- Public results: published event count; unexpected records [yes/no].
- Confirm no intentional scoring, staff/admin changes, or Supabase configuration changes.

A role error is not automatically a failure of JWT authentication. If an existing outsider is not available or another account owner cannot perform the sign-in, mark that check **NOT RUN**, not PASS.

## Automated mock-only continuation (October 13, 2026)
Added `tests/phase1c_c9_independent_roles.test.mjs` and branch-only GitHub Actions workflow `.github/workflows/phase1c-c9-mocked-roles.yml`. These use injected fictional identities and an in-memory fake HTTPS transport: signed-in scorekeeper role and empty eligible desk, outsider denied on both private read RPCs, mismatch/denied identity fail-closed, no automatic OTP, and no score/grant/admin endpoint. No Supabase credentials or hosted email are used. **Verified PASS:** [GitHub Actions C9 mock-only #38365235139](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38365235139) completed successfully on October 13, 2026. Simulated authorization cannot establish live volunteer access. The real scorekeeper test remains **BLOCKED by an observed HTTP 429**. Do not call C9 passed based on these mocks.

## Acceptance gate
C9 passes only with user-observed real hosted **independent browser sessions** for one existing scorekeeper and one existing outsider, respective role/denial responses, and no unexpected private exposure. A screenshot of organizer PASS does not establish these conditions. No production promotion or cloud scoring follows automatically. Further volunteer UX, logged-out JWT expiration, full cross-device operation, recovery, corrections and byes need separate tests.

## C8 limitations inherited
The browser's local implicit-link flow lacks production-grade request-binding/PKCE and durable logout/revocation. It must remain a trusted-Mac synthetic rehearsal. Neither published `main` nor the production event app is updated.
