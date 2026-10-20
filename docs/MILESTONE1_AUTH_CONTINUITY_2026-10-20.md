# Milestone 1 — Staff Authorization and Organizer Continuity Candidate

_Date: October 20, 2026 · one consolidated synthetic-only safety batch._

## Authority and limitations

All three earlier hosted synthetic score fixtures are permanently consumed. No new Auth user, test fixture, hosted scoring or publication is authorized. This work stays on unmerged draft PR #19 and leaves production `main/index.html` unchanged.

**Sign-in contract, not production sign-in:**
- `contracts/milestone1_pkce_guard.mjs` validates single-use callback state, exact redirect origin/path, code exchange shape and independently confirmed Auth identity. Rejects bearer fragments, replay, duplicate query data and expired verifier.
- `contracts/milestone1_pkce_browser_adapter.mjs` derives a real SHA-256/S256 PKCE challenge using Web Crypto and injects a short-lived tab-scoped vault that stores **only a pending code verifier, state and expiry**, not bearer or refresh tokens. The vault is consumed before processing callbacks.
- `contracts/milestone1_staff_access_gate.mjs` separately checks current user and event-scoped organizer/scorekeeper authorization, then rechecks identity and role before **each** private read. Account switch, revocation, expiry, disconnected browser and sign-out deny access. No score/post, staff management or publication method exists.
- End-to-end GoTrue PKCE login, redirect allowlist/template configuration, XSS/CSRF hardening, refresh lifetime, genuine Auth user revocation and real staff device acceptance are **NOT** complete. Existing localhost C8 Magic Link is not a production login. Hosted Auth settings remain untouched.

**Organizer continuity drill, never actual authority:**
- `contracts/milestone1_continuity_drill.mjs` reuses the existing C1 cloud/fallback state model. A synthetic organizer must be checked before an outage; simulated fallback requires matching backup revision/generation, organizer signoff, other-device stand-down acknowledgment, protected backup, incident log and explicit documentation of any ambiguous score. Offline edit logging increments only a counter.
- Reconnection **does not** replay or upload local data. Fresh organizer check, backup/manual log/each edit and unknown-score review, and a separate signed snapshot are mandatory before even simulated cloud resumption.
- `rehearsals/m1/continuity.html` provides a **zero-network**, interactive local training drill to exercise those refusal gates. Checkboxes **cannot verify** that another scoring device physically stopped. Cloud score writes are **always disabled**.

**Consolidated verification:**
- New Node tests for PKCE callback expiry/replay/CSRF, actual Web Crypto S256 derivation and pending-verifier-only vault, fresh event-scoped signed role checks, simulated unknown score/backup/manual reconciliation.
- `tests/milestone1_continuity_browser.py` uses real Chromium with all external network requests aborted; never creates an account, event, backend write or score.
- Existing CI additionally re-tests PostgreSQL security, GoTrue signed local race, spectator privacy, independent scored-browser recovery and baseline tournament UI.

## Independent consolidated CI acceptance — October 20

[GitHub Actions #39486552275](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/39486552275) **PASS** on executable commit `a1e45c0849bf30f6a8d54be94aefa7babdd81e0f`: **220/220 JavaScript** tests; real Chromium zero-network organizer continuity exercise (unknown-score and protected fallback, role denial, manual reconciliation and no cloud writes); original three-context spectator/volunteer tests and hosted-browser score/recovery mock; **81/81 PostgreSQL pgTAP**; independently signed local Supabase/GoTrue race and old UI/tournament regressions. This CI creates **no** remotely hosted scores, staff accounts, events, Auth configuration or publication.

Separate **read-only hosted Supabase verification after CI**: all three synthetic test events/matches remain, the one-time hosted fixture #3 stays revision **1**, its sole match status `complete` version 1; exactly four historic V2 decisions, three accepted submissions, four existing Auth users, **zero** public event/match rows. No real FFTT3 data, schema or production change.

**Acceptance:** Local synthetic PKCE/role-gate and offline-authority training checks **PASSED**, but real PKCE provider redirects/session lifecycle and physical organizer + two volunteer devices + spectator/TV failover **NOT YET ACCEPTED**.

**Remaining release gates:** actual independently verified PKCE login in a separately approved development Auth configuration; two physical volunteers plus organizer and spectator TV read/scoring; controlled offline backup/fallback and reconciliation; explicit real FFTT3/production approval. These cannot be inferred from mocked tests, and draft PR #19 must remain unmerged.
