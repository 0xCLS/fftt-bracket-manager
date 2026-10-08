# Phase 1 — Shared Event State and Access Architecture

_Status: architecture proposal, October 8, 2026. **Update:** Christopher has now approved Supabase **for a synthetic-only prototype**, individual organizer-authorized accounts, public restricted-field spectator results and pause-on-disconnect single-device fallback. No provider has been provisioned and no shared backend is implemented. See [Phase 1A contract](PHASE1A_SHARED_EVENT_CONTRACT.md). Earlier unapproved-state descriptions below are historical._

## Why this milestone comes first

Christopher approved the Bracket Manager's existing design and directed work to move on. The current application is hosted by GitHub Pages but saves all event state in a browser's `localStorage` under `fftt_bracket_manager_v01`. GitHub Pages does not synchronize event data. The current engine builds championship and reviewed consolation brackets, validates singles scores and advances results within one browser.

The desired next capabilities — simultaneous volunteer scoring and live spectator/TV brackets — require **one authoritative shared state**, secure write access, a deliberately restricted public projection, and tested handling for conflicting score submissions.

## Implementation boundary

1. **Keep the approved seven-screen visual design, emblem and exact `Developed by Chris Smith` attribution.** Do not redesign the app as part of this phase.
2. Keep the existing tournament rules and deterministic bracket-advancement behavior. Do not replace them with a different tournament format.
3. **Do not migrate actual FFTT3 participant details into a new service during architecture evaluation.** Development and security testing use synthetic event data only.
4. Preserve current single-browser behavior and JSON backups until a cloud version passes rehearsal and an explicit cutover is approved.
5. Do not embed private admin/service keys or real participant contacts in the public GitHub Pages repository.
6. **Updated October 8, 2026:** Supabase is approved for synthetic prototyping, individual organizer-authorized accounts and public field-restricted results are approved, and cloud writes must pause offline with a controlled single-device fallback. No production provider, hosted project, paid plan, actual participant migration or cutover has been approved.

## Provider comparison (official documentation)

| Criteria | Supabase (recommended candidate) | Firebase Cloud Firestore (valid alternative) |
| --- | --- | --- |
| Shared database | Hosted PostgreSQL relational tables, constraints, transactions | Document database with collections/documents |
| Browser sync | Realtime Broadcast (recommended for scale/security) or Postgres Changes | Real-time document/query listeners |
| Staff access | Supabase Auth + Postgres Row Level Security (RLS) and explicit grants | Firebase Authentication + Firestore Security Rules |
| Conflict control | Transactional server-side result submission and per-match version checks are a natural fit | Transactions and security rules; careful document structure and consistency boundaries required |
| Offline considerations | Explicit application-level offline/degraded mode design required | Client cache/offline support exists, but default reconciliation behavior alone is not acceptable for conflicting tournament scores |
| Fit to FFTT | Relational players, matches, event roles and auditable result submissions | Also workable, especially if deliberately choosing a Firebase-centric implementation |

**Updated decision:** Christopher approved evaluating **Supabase in an isolated synthetic-data prototype**, not using it for real participants or production. This remains a provider-neutral contract until a sandbox is separately authorized. No project, secrets or hosted database have been provisioned.

Primary references:
- Supabase RLS and access grants: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Realtime approach: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- Supabase private Realtime authorization: https://supabase.com/docs/guides/realtime/authorization
- Cloud Firestore overview: https://firebase.google.com/docs/firestore
- Firestore Security Rules: https://firebase.google.com/docs/firestore/security/overview
- Firestore offline limitations/behavior: https://firebase.google.com/docs/firestore/manage-data/enable-offline

## Roles and exposure

| Role | Required access | Forbidden exposure / operations |
| --- | --- | --- |
| Organizer/admin | Own the event, check in players, adjust ratings, approve bracket creation, manage volunteer authorization, correct scores with audit history, export secure backups | Cannot bypass validation silently |
| Volunteer scorekeeper | Authenticate or be specifically authorized; see eligible match assignments; submit game scores and winner; receive confirmation | No editing player private profiles, assigning other roles, unauthorized bracket rebuilds or changing completed scores |
| Spectator | Read-only published bracket, matchup, scores and progress | No player phone/email, internal FFTT ratings or provisional status, operational backups or write capabilities |
| TV/projector | Read-only large-format public view, automatically updated | Same privacy constraints as spectator; no admin menus or hidden private fields |

Treat a public spectator projection as a **separate allowlisted data shape**. Never send the entire organizer state or hide private fields only with CSS.

## Recommended conceptual data entities

The exact physical schema will be designed after backend selection, but preserve these boundaries:

- `events`: event identifier, date, format/configuration, state version and lifecycle status.
- `event_staff`: event-scoped user IDs and roles.
- `players_private`: internal player IDs, display names, check-in, rating and provisional/established flags; avoid importing contact fields if not operationally needed.
- `bracket_matches`: event/bracket/round/match IDs, participant references, winner, game score, table, status and row version.
- `result_submissions`: unique submission ID, submitting user, expected match version, received time, normalized game scores and acceptance/rejection status.
- `audit_events`: server-side record of corrections, bracket rebuilds and other privileged operations.
- `published_event_results` (or explicit projection): only the public match/bracket fields with internal identifiers and private ratings excluded.

**Security first:** exposed database tables require tightly scoped grants and RLS policies. Public subscription/listening must access only intended published fields. Backend secrets and privileged routines stay server-side.

## Accepting a score safely

A single validated transaction or equivalent server-authoritative operation should:

1. Authenticate the volunteer and verify their event/scorekeeper permission.
2. Confirm the match exists, is eligible/assigned to them under the selected assignment policy, and remains unresolved.
3. Confirm the supplied client match version matches the server version; reject stale/repeated submissions safely.
4. Validate winner, completed games, configured best-of rules and 11-point win-by-two scoring on the authoritative side (reuse/reproduce the existing app's semantics).
5. Atomically record the result, advance eligible brackets and update the match version; append an audit record.
6. Return success with the accepted authoritative state **or** a clear non-destructive conflict requiring organizer review.
7. Notify subscribed organizer/spectator clients. Realtime notifications prompt a refresh; the stored database state stays authoritative.

Use stable submission IDs for retries/idempotency. Do not allow two phones to silently overwrite the same score, or allow a stale browser's local snapshot to overwrite a newer full event state.

## Phased engineering delivery

**1A. Architecture approval / sandbox** (next checkpoint)
- Confirm Supabase vs Firebase; staff login/invitation approach; whether spectator views are public without login; event-day offline/degraded policy.
- Define permitted fields and operations per role, threat model, and explicit backup/cutover procedure.
- Create an isolated synthetic event; never test access rules with actual signup contacts.

**1B. Server-side state and permission tests**
- Prototype database schema, security grants/policies, authenticated admin/scorekeeper paths and read-only spectator projection.
- Test forged/unprivileged writes, role revocation, private-field read attempts, stale/conflicting score submission, retries, server-side validation and auditability.

**1C. Adapter integration without breaking v0.1**
- Introduce a storage/sync boundary so existing local mode remains usable. Move **authoritative match submission/advancement** to server-side operations when cloud mode is enabled.
- Label offline/online/sync/error states accurately; never display 'saved' for an unacknowledged cloud write.
- Keep browser-only mode and existing manual JSON export/restore as a recovery path until a live cutover is approved.

**1D. Volunteer and public interfaces (Phase 2)**
- After reliable shared state, add mobile volunteer scoring; then spectator read-only links and a large TV/projector view.
- Verify results on two volunteer devices plus a separate spectator/TV device under realistic delayed connection conditions.

## Acceptance criteria before event-day usage

- Concurrent submissions for the same match cannot both be accepted; retries are idempotent and conflicts are explicit.
- Unauthorized users cannot read private player ratings/contact data or modify the event.
- Public projection exposes only approved names, matches, scores and event status.
- Organizer can export a reliable private backup and recover from device/service loss.
- Single-browser fallback remains usable without silently diverging cloud results.
- At least one fully rehearsed, synthetic end-to-end tournament (including consolation and score corrections) passes on multiple devices.
- Christopher reviews and authorizes cutover to a shared system.

## Decisions requiring Christopher's approval

1. **Backend:** Is Supabase acceptable for a prototype, or would he prefer Firebase/another option?
2. **Staff access:** Email sign-in/invitations, organizer-provisioned accounts, or another workflow?
3. **Spectator visibility:** Public shareable read-only link vs restricted link/login?
4. **Offline rule:** On connectivity loss, pause cloud writes and use a documented single-device fallback (safer initial recommendation), or engineer a more complex queued-merge workflow?
5. **Rollout:** Target for an event-day rehearsal and production cutover; no date assumed.

Do not interpret approval of the **visual design** as approval of these technical service, access, or deployment decisions.

## October 8, 2026 Phase 1A checkpoint

Approved directions and executable reference tests are now specified in [PHASE1A_SHARED_EVENT_CONTRACT.md](PHASE1A_SHARED_EVENT_CONTRACT.md), [contracts/phase1a_v1.json](../contracts/phase1a_v1.json), and [tests/test_phase1a_contract.py](../tests/test_phase1a_contract.py). These are design/synthetic artifacts; **no cloud/database/RLS/realtime implementation or event-data migration is complete**. The earlier approval questions in this proposal have been answered for the prototype only; production approval is still pending.
