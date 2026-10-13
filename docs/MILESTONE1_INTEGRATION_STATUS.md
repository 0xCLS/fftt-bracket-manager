# Milestone 1 — Integrated Secure Shared Foundation

_Integration checkpoint, October 13, 2026 · Synthetic development only_

## Branch reconciliation and preserved evidence

The authoritative October 12 consolidated roadmap in `main:ROADMAP.md` defines just three delivery milestones. The subsequent C1–C11 labels describe **historical technical evidence**, not new delivery phases. This branch starts from the approved `main` commit `a82930a636a603f8f8ca3993aa0f3ede0d70c894` and imports 84 compatible files from the C11 stack `bf4e054c5d656a4679c4d14cefd3e5374f9baafe`. It retains the current, approved `main:index.html`, `ROADMAP.md`, README, design system, architecture notes and current UI smoke tests; the older branch copies are not used. Historical PRs #2–#18, test reports and branch tips remain available unchanged.

Historic per-step workflow files are deliberately **not imported** to avoid multiplying CI runs. Evidence recorded in the historical PRs remains provenance, not a fresh verified run. Retained operator scripts are for historical review, **not authorization to execute them**. The B2i synthetic fixture was permanently consumed and must not be reset or replayed.

## Milestone 1 evidence and remaining gaps

| Area | Evidence | Still required |
| --- | --- | --- |
| Local app baseline | Approved `main` UI, offline single-device data and backup paths retained unchanged | Comprehensive regression on the integrated candidate |
| B1/B2 security and scoring | Isolated synthetic hosted backend; B2i genuine two-scorekeeper race passed for one fictional match | Full event lifecycle, signed adapter and multiple active-device rehearsal |
| C8 organizer authentication | Organizer Magic Link, `/auth/v1/user`, staff-role and private Match Desk lookup observed passing; zero eligible matches after B2i is expected | Production-safe account flow, volunteer and outsider independent verification |
| Individual read-only access / C9 history | Organizer and Scorekeeper A authorized empty desk reads observed; outsider signed in and UI displayed no private data with denied/expired/unavailable fail-closed status | Root-cause confirmation of outsider denial and adversarial authenticated access tests remain in the consolidated security suite; no live scoring readiness |
| C10/C11 recovery and durability | Pure synthetic decision models and fail-closed tests passed | Genuinely durable accepted **and rejected** decisions and trusted, actor-scoped reconnect snapshot |
| C5 snapshot proposal | SQL proposal and disposable/static checks only | **Unapplied; requires approval and transactional/security review before deployment** |
| Read-only projection | C3 public projection transport + C8 isolated UI now show event/bracket/match summaries, with a strict data allowlist and manual refresh | Device/browser verification and permission review; no public real-player names |
| Connected cloud scoring | **Not implemented/authorized for live UI** | Authenticated write adapter, server-proven revision/decision and safe recovery before any rollout |
| Integrated backend/client candidate (Oct 13) | Unapplied v2 SQL passed disposable PostgreSQL, original 81 pgTAP, and real local signed GoTrue/PostgREST two-scorekeeper race, own-receipt and revocation checks | Separate approval before hosted v2 SQL/permission cutover; controlled browser scoring + trusted recovery and independent device rehearsals still pending |

The C5 proposal returns accepted receipts but does not durably record rejection. An absent receipt is **unknown**, never proof of rejection; C11 simulates a future durable decision but does not make it a trusted server. Reconnection may never silently retry, replay or merge scores. This is the principal server/client integration blocker, alongside normal organizer-authorized volunteer authentication.

**October 13 completed browser-observation sequence:** Organizer and Scorekeeper A signed in and received event-authorized empty Match Desk results. A subsequent screenshot of the previously ungranted outsider rehearsal showed a signed-in state and `Denied, expired or unavailable. No private result shown.` after the staff read, with zero published events. No private Match Desk data was displayed. The generic message is fail-closed, but does not conclusively identify the underlying HTTP/authorization cause or prove profile isolation. No further manual login is requested; validate negative-role security through the remaining consolidated synthetic security/integration suite. No account, private event UUID or credential is preserved here.

**Substantive implementation added:** [Milestone 1 backend/client candidate](MILESTONE1_BACKEND_CLIENT_CANDIDATE.md) reuses B2b scoring, adds a private append-only terminal decision ledger proposal and a consistent own-decision snapshot, plus a signed read-only transport and synthetic multi-client scoring coordinator. No v2 SQL was applied. The proposed v1→v2 endpoint cutover, RLS, race and receipt behavior must pass disposable PostgreSQL and real signed-Auth tests before a hosted authorization request.

**Verified integration gate (October 13):** [Consolidated GitHub Actions #38380704428](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/38380704428) **PASS on attempt 1** at `a74d6504d3fe5bfd10a7dbabf74e1fb81e5561b7`. The existing UI/backup/bracket suite, 156/156 Node tests, eight static SQL checks, 81/81 baseline pgTAP, disposable v2 transaction tests and genuine local independently signed two-scorekeeper HTTP race all passed. Accepted/stale-rejected decisions, owner-specific snapshot privacy and revocation were verified locally. No hosted Supabase changes, participant data, publication, or B2i replay occurred.

**Expanded validation:** The same PR workflow includes a new local-only disposable PostgreSQL job that runs the original B1–B2d security assertions, then applies v2 in that container and checks actual accepted/rejected decisions, access control, idempotency, revision and audit. This local job now additionally starts a throwaway GoTrue/Auth API and runs a genuine signed multi-connection v2 HTTP score race with actor-scoped decisions and revocation checks. This local verification is **not** a hosted migration; the signed multi-connection scoring race is now locally verified, while server-proven client reconnect and browser/device rehearsal remain gated.

## Coherent remaining Milestone 1 development batches

**Backend and signed client batch (approval-gated for hosted changes):** Build the durable per-actor score decision ledger, consistent event revision/own-decision snapshot, denied/revoked access handling, and signed score/read/recovery adapter as one integrated piece. Verify with disposable Postgres, authenticated synthetic concurrency, idempotency, lost acknowledgments, stale generations, revocation, wrong-user reads, and outage tests. Migration, Auth/account, staff grant and backend setting changes require separate explicit authorization.

**Connected rehearsal and release-evidence batch:** Wire the resulting adapter into a *separate* controlled synthetic demo (not `index.html`), keep all score writes blocked until authority is verified, and rehearse organizer + two individually authorized scorekeepers + outsider + spectator/TV using separate devices. Test disconnected/ambiguous submissions, controlled organizer-only single-device fallback, protected backups, manual reconciliation, public privacy, bracket advancement and audit. Only a fresh, separately approved production cutover may change the live app.

Milestones 2 and 3 retain their approved scope; no more invented C-number milestones or routine piecemeal approval requests.

## Current branch validation and safeguards

- New strict public-result view model has **six local Node zero-network tests PASS**; it strips raw private identifiers from display, rejects added/private fields, inconsistent event/bracket/winner, oversized rows and malformed projection shapes.
- The C8 read-only page displays only audited public projection fields using DOM `textContent`, never `innerHTML`. Manual refresh does not subscribe to Realtime or submit results. Staff views remain protected by individual signed Auth and event-scoped role lookup.
- C8 implicit-flow callback is localhost-only; it is a controlled synthetic rehearsal, **not production PKCE/CSRF security**. Never move this callback to public GitHub Pages.
- No hosted test, Supabase migration, staff/account change, real FFTT3 data access/migration, score write, publication, fixture reset or GitHub Actions workflow rerun is part of this integration.
- The isolated Supabase development project remains synthetic-only, and current `main`/GitHub Pages stays browser-local with unchanged tournament design and local backups.
