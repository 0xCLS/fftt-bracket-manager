# Milestone 1 — Connected Read-Only Operations & Spectator Rehearsal

_Date: October 20, 2026 · cohesive synthetic-only operations batch; no hosted writes._

## Position after hosted score acceptance

The October 20 one-time hosted scoring/browser recovery for fictional Fixture #3 **PASSED**, independently audited and permanently **CONSUMED**. The three historical/synthetic hosted fixtures must never be replayed, reset, republished or reopened for score writes. Draft PR #19 remains unmerged; approved production `main/index.html` is unchanged, and real FFTT3 data are still prohibited from synthetic test tooling.

The next scope is a **read-only integration candidate**, designed to reduce repetitive manual Refresh clicks without undermining private authorization or score certainty. This is **not** Supabase Realtime, publication, production hosting, service credentials, a production-ready auth flow, physically verified device synchronization or full tournament readiness.

## Delivered in one batch

1. `contracts/milestone1_read_supervisor.mjs` is a generic fail-closed, injected read supervisor. It only invokes a caller-provided **read** function, after explicit Start. On the signed staff desk it requires a still-authenticated, online, foreground browser; on the anonymous spectator it requires online/foreground. It clears prior displayed data before each read, never overlaps reads or timers, and stops (clearing data) on failed validation, expired credentials, offline/hidden tab, revised event identity or revision regression. Restart is **manual**. It has no mutation, replay, store, automatic login, privileged API or fallback promotion method.
2. The existing **local-only** `rehearsals/c8/index.html` gains **Follow signed reads (6s)** and **Stop following**. The original C8 JWT remains memory-only; each update uses the existing strict staff-role + V2 snapshot revision double-read + private matchdesk validator. Legacy manual refresh still exists. Sign-out, role denial, event field edits, paused tab, offline and read failure clear private display. The consumed fixture's old writer remains strictly pinned as historical C8 test provenance; its backend match is already complete and **must not** be rescored.
3. New `rehearsals/m1/live-spectator.html` provides a separate **anonymous**, no-login spectator readiness screen. It uses **only** the existing audited public `fftt_public_results_v1` projection, strict `projectPublishedResults` conversion and DOM text nodes—no private matchdesk, Auth, score, admin or secret-key path. The user opts in to public 6-second reads; a failed/contaminated public payload drops the entire view, no stale cache and no automatic reconnect or polling restart. It displays an explicit “no approved public event yet” message if the projection is empty, which is the correct state of the current dev project.
4. `tests/milestone1_read_supervisor.test.mjs` validates cancellation, race invalidation, monotonic revision, signed/online/visible gating, manual restart, failure and missing write routes.
5. `tests/milestone1_live_read_browser.py` exercises three **real isolated Chromium contexts**, with every hosted request intercepted: two anonymous spectators and one signed volunteer. It changes a common **mock** authoritative revision/public projection, verifies all three independently observe approved data, confirms UI treats injection-looking text literally, denies contact/private-field contamination, pauses after denial/disconnect, and proves no score/admin/publication requests.

## Local read-only demonstration

On the trusted Mac (same integration checkout), start the already available local HTTP server, then open:
- Signed staff: `http://localhost:3000/rehearsals/c8/index.html`; existing individual synthetic test Auth required for private staff reads. The human must explicitly start and stop periodic reads. **Do not attempt any hosted scoring of the consumed fixture.**
- Anonymous spectator: `http://localhost:3000/rehearsals/m1/live-spectator.html`; click **Start public live reads**. Real hosted development currently has **zero approved published rows**, so a blank/no-event state is expected—not a bug.

For automated acceptance, CI executes `node --test tests/milestone1_*.test.mjs` and `python tests/milestone1_live_read_browser.py`; the latter intercepts all hosted network, simulates data changes and uses **no real credentials**.

## Independent consolidated CI acceptance (October 20)

[GitHub Actions #39478921322](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/39478921322) **PASS** at integration SHA `93b53a64eb8e8d4b5a828051257091a2ada6b9c7`: **197/197** JavaScript tests (seven new read-supervisor lifecycle assertions), the real three-isolated-Chromium mock with spectator/staff revision following and private-field fail-closed checks, **81/81** PostgreSQL assertions, local signed Auth/score concurrency, existing hosted operator safeguards and tournament/UI regression suites. All hosted browser simulation requests were intercepted. No new hosted event, test user, scoring, publication or database edit was made.

**Result:** simulated read-only connected operations gate PASS; physical multi-device sync, real publication, production Auth and organizer disconnected fallback remain outstanding. This does not authorize merging PR #19 or modifying production `main/index.html`.

## Non-negotiable remaining gates before FFTT production

- Production-safe, organizer-authorized individual sign-in (PKCE/CSRF protections, account lifecycle, revocation and session expiration/recovery) rather than localhost-only C8 implicit Magic Link.
- A real public projection with organizer-controlled authorization, explicit publication checks, security/RLS tests and a spectator/TV layout tested on actual hardware. **Do not publish existing 2099 synthetic fixtures or actual players** to fake a demo.
- Physical-device end-to-end proof (two volunteer scoring devices, organizer, phone and TV) over shared network, including delayed or failing connections, race handling, suspended tabs, corrected results, check-in and match advancement.
- Organizer-led disconnected operation and *manual* reconciliation using protected snapshots, staff stand-down and incident logs. No automatic retry, queued local write, silent merge or authority change.
- Explicit future authorization before creation of a production backend, migration of real contacts/registrations, merging the draft integration PR or replacing live `main/index.html`.

**Release status:** Local/connected read-only operational candidate and mocked independent-browser follow testing, NOT a production launch.
