# Milestone 1 — PKCE Volunteer Browser Integration & Physical-Device Gate

_October 20, 2026 · next consolidated development batch; synthetic-only._

## Scope and outcome being tested

Building on the successful one-time hosted synthetic browser scoring/recovery (permanently consumed Fixture #3), this batch integrates the previously tested PKCE cryptographic and staff-role primitives into a **working local web flow against intercepted, Supabase GoTrue/PostgREST-shaped endpoints**. The test includes real Chromium document navigation, same-browser pending verifier, signed session shape, separately confirmed current user, two independent scorekeeper identities, outsider denial, revocation, private Match Desk and authoritative V2 revision double-read. There are **no hosted sign-in attempts, changes to email templates/redirect allowlists, new users, hosted scores, published rows, real FFTT3 data, or production app edits**.

### Implemented modules

- `contracts/milestone1_pkce_supabase_transport.mjs`: endpoint-restricted PKCE transport contract for `POST /auth/v1/otp?redirect_to=...` with `create_user:false`, S256 challenge; `POST /auth/v1/token?grant_type=pkce` with authorization code + same-browser verifier; `GET /auth/v1/user`; signed event-role, Match Desk, and read-only V2 decision-snapshot RPCs. Pinned to the development host with a public publishable key. **All network is disabled by default**, and any explicit synthetic network enablement must be approved and scoped; no signup, refresh, grant management, result submission or publication RPC is included.
- `contracts/milestone1_pkce_staff_session.mjs`: memory-only bearer session lifecycle, independent user and event-role verification at sign-in, rechecks every authorized private read, checks two stable revisions around the allowlisted Match Desk, signs out on denied/expired/changed access. Returned UI status contains **no token, refresh secret, email or private identity**; cloud scoring always unavailable. There is no background retry or automatic session refresh.
- `rehearsals/m1/staff-pkce.html` + `staff-pkce.mjs`: responsive local synthetic volunteer sign-in/Match Desk demonstration. Captures one-time callback and immediately scrubs its URL code/state before performing any async work. The pending verifier/state is kept only in a tab-scoped transaction; access token is RAM-only. **The page deliberately disables all Auth network unless an isolated automated mock harness is injected**—it must not be used to send email or request a real dev login yet.
- Extended browser tests exercise **four independent Chromium profiles** (two scorekeepers, unauthorized outsider and tampered-state attempt), two distinct S256 challenges, identical authorized V2 event revision, authenticated private reads, revoked role immediately clearing private display, no replay, secret scrub, zero scoring/admin or remote network.
- Node tests verify GoTrue wire format, no account creation, strict redirect and event boundaries, token/role reads, network-disabled default, no score/publication endpoint.

Relevant upstream Supabase contract references: [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless). Actual provider-managed email template and redirect behavior remains **unverified**; do not claim production Auth ready because the mocked provider behaves correctly.

### Verified consolidated CI and independent hosted conservation (October 20)

[Full GitHub Actions run #39490768682](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/39490768682) **PASS** for final executable SHA `ea4c0a61a6d9b67e93cb7ce5d3141887ed933cdc`: **225/225 JavaScript tests**, **81/81 PostgreSQL pgTAP assertions**, signed disposable local GoTrue concurrency, and all pre-existing UI/tournament/spectator/one-time scoring/recovery suites. The new real **four-profile Chromium browser harness** passed two independent fictional scorekeeper PKCE exchanges, outsider private-read denial, revoked staff account access clearing, callback state tampering caught before exchange, URL code scrub, and no bearer/refresh persistence or forbidden endpoint. **Every outbound request in that harness was intercepted and handled by the synthetic mock; zero hosted Auth, scoring, or publication requests were made.**

Two initial CI builds exposed a missing unsigned-role client guard and an incomplete `127.0.0.1` callback loopback allowlist; both were corrected with explicit regression assertions before the all-green run. These are local browser safety fixes, not Supabase Auth setting changes.

A **separate read-only hosted Supabase audit** after the green run confirmed exactly **three** existing synthetic events/matches, consumed Fixture #3 at event revision **1** and complete match version **1**, four total durable V2 decisions, three accepted submissions, **four** existing Auth test users, and **zero** public published event/match rows. No new hosted fixture, account, role/grant, score, publication or schema was created. Production `main/index.html` remains byte-identical; draft PR #19 remains unmerged.

**Acceptance boundary:** The GoTrue-shaped PKCE **browser/mock integration is PASSED**. Actual email-link delivery/configuration, PKCE authorization-code redirect via Supabase's live Auth provider, verified role revocation on real devices, separately approved publication and organizer-directed offline device stand-down/reconciliation are **not yet accepted**. Do not interpret the mocked success as a production login or permission to run the old consumed scoring scripts.

## Test run

The consolidated CI executes:
```bash
node --test tests/phase1c*.test.mjs tests/milestone1_*.test.mjs
python tests/milestone1_pkce_staff_browser.py
```

The Chromium test runs a temporary loopback static file server and intercepts all outbound Supabase calls. It asserts `create_user:false`, S256 code challenge, same-browser code exchange, callback CSRF defense and immediate address scrub, distinct user IDs, RLS-like outsider denied response, rechecked staff role and private revision, session storage does not persist JWT/refresh token, and forbidden score/admin/publication routes absent. Earlier CI jobs additionally cover local signed Auth race and disposable PostgreSQL, consumed hosted fixture transport protections, public spectator privacy, offline organizer training, tournament and UI regression.

### Separate, bundled physical-device acceptance plan (not yet authorized or run)

> **Update October 21:** live provider PKCE has since passed once on localhost, and a more specific plan with approvals, order, stop conditions and cleanup is prepared in the [physical-device runbook](MILESTONE1_PHYSICAL_DEVICE_RUNBOOK_2026-10-21.md). The paragraph below is kept as the original plan.

For a future **fictional nonproduction event** (NOT any consumed fixture), use one Mac organizer, two independent volunteer phones/tablets on distinct identities, and a phone plus TV/projector showing explicitly approved public-only results. Before testing, approve the exact controlled Auth provider configuration, isolated resettable synthetic fixtures, event-scoped grants, a confidential operator run sheet and staged publication policy. Do not copy existing real FFTT3 registrants to test data.

One coordinated rehearsal should verify: independent real email PKCE login and expiry; scorekeeper A/B event authorization and outsider denial; two competing fictional submissions yield one accepted and one durably stale-rejected with own-receipt recovery; spectator/TV learns only approved public fields after organizer publication; background/resume/offline intervals clear stale views; physical stand-down of all scoring devices before protected single-device fallback; a dated incident log and **manual**, never automatic, reconciliation of individually reviewed offline results. Verify backup integrity and demonstrate fail-closed handling of an uncertain lost response and revoked staff account. Report sanitized result counts and no private contact data.

**Explicit future approvals remain required** before changing hosted Auth redirect URLs/email templates, granting access, creating a new hosted fixture, sending another hosted score, publishing synthetic/real results, moving code into production `index.html`, or merging draft PR #19. Prefer one carefully rehearsed batched operator session after provider integration is verified rather than another sequence of manual tests.

**Status: PASS — intercepted-provider browser integration.** The full suite and independent no-hosted-change audit passed on October 20. Live provider PKCE and physical-device acceptance remain blocked until separately approved.
