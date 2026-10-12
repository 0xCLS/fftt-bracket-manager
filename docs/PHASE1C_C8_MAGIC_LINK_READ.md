# Phase 1C C8 — Default Magic Link, local read-only prototype

**Development branch only.** The isolated project sends the default Magic Link email and its Free-tier template is not editable without SMTP. C8 therefore uses Supabase's implicit redirect, not a custom OTP email. No production deployment, staff/score/database modifications, participant data, or B2i replay.

## Exact callback for manual allowlisting
`http://localhost:3000/rehearsals/c8/index.html`

Keep the existing development Site URL unchanged. Add ONLY this exact redirect URL to Auth URL Configuration, no wildcard. C8 requests `/auth/v1/otp?redirect_to=` that exact allowlisted URL with `create_user:false`; it does not create users. The server binds only to `127.0.0.1:3000` and never logs requests.

## Running
From a local checkout of this branch, run `python3 tools/c8/local_readonly_server.py` at repository root. No scores are submitted. The tester must deliberately request a link using an existing synthetic Auth account, then open the email link in the SAME BROWSER on the same trusted Mac while the server is running. After redirect, re-enter the **same** email and let the server's `/auth/v1/user` validate the returned signed bearer token. Then enter the private development test event ID to read role/matchdesk. The consumed B2i fixture may legitimately show zero pending matches.

C8 consumes the hash immediately and removes it from the address bar before any network/UI work. The JWT stays only in memory; the refresh token is deliberately discarded. The page refuses unknown callback fields/types, wrong account, expired or malformed sessions. It makes no `/token` refresh call; tab close/reload forgets the session. A callback opened in a different browser or device will not authenticate the rehearsal and should be treated as a failure rather than copied into a different address bar. Closing the tab and stopping the server are required. Local clearing cannot revoke a server-issued JWT.

## Unverified / next gates
This implementation has NOT established a real hosted browser login or user delivery. Before organizer test: run mock callback tests, static network allowlist review and browser security checks. It has no CSRF nonce bound to the original request; a signed-in callback must be separately confirmed against the test account email, and cannot be considered production login design. The implicit flow's URL-fragment bearer is acceptable only for this explicitly isolated rehearsal, not for public GitHub Pages. Separate production PKCE/redirect, logout, invitation, offline/recovery and score permission gates remain.
