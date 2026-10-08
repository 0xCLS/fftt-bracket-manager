# Phase 1A — Shared Event Contract (v1)

_Status: architecture and executable synthetic reference tests, October 8, 2026. This is **not** a running backend, database schema, deployed authentication system, or approved production rollout._

## Decisions approved by Christopher

- **Provider direction:** Supabase approved **for a synthetic-data prototype only**. Provider-neutral contract first; no project, infrastructure, credentials, production database, or billing is provisioned by this milestone.
- **Staff identity:** Individual authenticated, organizer-authorized accounts. No shared volunteer password or browser-supplied role claims.
- **Spectators and projector:** Public read-only results with a **field-allowlisted projection**, not hidden organizer data or unrestricted database tables. Use synthetic names until publication/consent policy is confirmed for real participants.
- **Disconnections:** Pause all cloud writes. An isolated, controlled single-device and paper/JSON fallback remains available; never silently merge local changes back into cloud state.
- **Existing application:** Retain GitHub Pages, the seven screens, cool-neutral/pastel styling, circular FFTT emblem, exact "Developed by Chris Smith" attribution, Overview headline, localStorage format and browser-local functionality pending a separate cutover approval.

Machine-readable normative companion: [contracts/phase1a_v1.json](../contracts/phase1a_v1.json). Testable reference behavior: [tests/test_phase1a_contract.py](../tests/test_phase1a_contract.py).

## Shared-state boundary

- **Existing local mode (unchanged):** \`index.html\` reads/writes \`fftt_bracket_manager_v01\`; Undo, export/import and offline browser use continue to work. Its \`version: "0.1"\` backup remains a **local backup format**, not a cloud update command.
- **Future shared mode (not implemented):** The server is authoritative for event and bracket versions, staff access, bracket generation, result acceptance, advancement, corrections and audit. Cloud clients display verified snapshots and send **intent commands**, never whole-state overwrites.
- **Integration later:** A selectable local/shared adapter is introduced only after the sandbox is security-tested. A shared-mode browser must not overwrite its cloud event from cached localStorage, and local Undo or JSON restore must not write into the cloud.
- **Supabase-specific mappings, later:** PostgreSQL tables, RLS/grants, trusted transactional operations, Auth and Realtime subscriptions will implement this contract. Client-visible keys are publishable/anon only with verified RLS; privileged service credentials remain server-only. Do not conflate a public anon key with authorization.

## Entities and identity

| Entity | Required identity/behavior | Visibility |
| --- | --- | --- |
| Event | Opaque \`event_id\`, event-scoped revision, name/date/config and lifecycle state | Name/date/status via public projection; private configuration to authorized staff |
| Staff grant | Authenticated principal, \`event_id\`, organizer or scorekeeper, active/revoked flag | Organizer only |
| Player | Stable private \`player_id\`, display name, internal FFTT Level 1–5, provisional status, check-in | Only approved display name published; raw player ID, rating and check-in never public |
| Bracket | Type championship/consolation, \`bracket_generation\` counter, ordered matches; preserve existing first-loss eligibility and byes | Published presentation only |
| Match | Event + generation + bracket + match identity, ordered players, round/slot, result, \`match_version\` | Public projection uses opaque presentation ID and display names, not private FK IDs |
| Result submission | Unique \`submission_id\`, authenticated actor, requested result, expected version, accepted/rejected response | Restricted staff/audit only |
| Audit event | Who/when/what, before/after references, reason for privileged correction, immutable history | Organizer only |

All IDs are scoped to the event. Existing UI-style match labels like \`C-0-0\` are **not globally unique**: a rebuilt bracket can reuse them. Server keys and commands must include event identity and bracket generation. All client versions are advisory preconditions, never an authority source. Table number records where play occurred; it does not imply an exclusive reservation (not currently implemented).

## Roles and permission enforcement

See machine-readable \`role_permissions\` for the allowlist.

- **Organizer:** Manage event/player setup, internal ratings, staff membership, bracket builds/rebuilds, result submissions, audited corrections and private backup export. Even organizer writes must pass server-side validation.
- **Scorekeeper:** Read only the minimum match-desk data needed to score and submit results for **any eligible active match** in their authorized event (no table/match assignment system in this milestone). No roster ratings, contact data, participant management, bracket rebuilds, score corrections or other staff grants.
- **Spectator and TV:** Anonymous read of published event name/date/status and explicit public bracket/match fields; **no writes**. A read-only link is not an authentication token granting private data.
- **Revocation:** Server verifies event-scoped grants on each privileged command/read; revocation must take effect on the next request. A previously authorized submission ID does not bypass subsequent role revocation.
- **Privacy:** Never return an entire organizer state object and rely on CSS, client filtering, or a public subscription to hide sensitive fields. Published names are explicitly allowed; phone/email, raw player IDs, FFTT ratings, rating status, check-in, staff, audits and backups are forbidden.

## Atomic submit-result command

Request (logical shape, not a deployed API):

\`\`\`json
{
  "event_id": "synthetic-event",
  "match_id": "C-0-0",
  "bracket_generation": 1,
  "expected_match_version": 0,
  "submission_id": "unique-client-generated-id",
  "winner_id": "synthetic-player-a",
  "game_scores": "11-8, 8-11, 11-7",
  "table_number": 1
}
\`\`\`

The server must:

1. Authenticate the caller and verify their current event-scoped role **before** returning a prior idempotency outcome.
2. In a single transaction (or equivalent serializable operation), lock/check the event/bracket/match and verify generation, match version, eligibility, ordered participants and result status.
3. Check the \`(event_id, authenticated actor, submission_id)\` idempotency key: an exact authenticated repeat returns its prior outcome; reuse with changed payload is rejected. Store canonical request fingerprint and response. Different submissions to the same match contend on version.
4. Validate winner belongs to the current match; preserve optional blank game scores; otherwise enforce best-of 3 for regular matches, best-of 5 for the championship final, first to 11 and win-by-two (including deuce), and no extra games after victory. Score order matches displayed \`p1,p2\`, not inferred winner/loser order.
5. Atomically save the result, update match/event versions, advance dependent bracket slots and permitted byes, mark first actual championship-match losers for later **reviewed** consolation placement, and append server audit facts. No automatic random consolation drop-down.
6. Return accepted authoritative state/version or structured \`conflict\` / \`validation_error\` / \`forbidden\` / \`offline\`, with no partial writes. Concurrent different submissions for one unresolved match must yield at most one accepted outcome.
7. Emit a minimal change notification after commit (e.g., event revision), prompting each authorized client to reload the correct snapshot. No private payload is broadcast publicly.

## Corrections, rebuilds and Undo

- Only an organizer can request a score correction. Require a reason, expected match version and matching bracket generation; retain immutable original result and correction audit trail.
- A correction that would invalidate **already resolved dependent matches** is blocked pending explicit organizer remediation; do not silently rewrite descendants. When no dependent result is resolved, downstream entrants and first-loss eligibility must be recalculated transactionally.
- Bracket rebuilds must explicitly increment generation, preserve prior audit/recovery history and require organizer confirmation. Previous-generation score commands become stale, even if their UI-style match IDs repeat.
- Browser-local snapshot Undo is not valid in cloud mode. Future cloud reversal is a separate, audited, permission-checked command.

## Disconnect and recovery rules

- Cloud mode on loss of connectivity: stop submitting/queueing edits, show clearly that the last visible event state may be stale, and resubscribe/refetch authoritative state on reconnect.
- For a serious outage, organizer chooses a **single isolated event-day fallback authority** using an exported private snapshot or printed scores. Other phones stop scoring. Keep a clear log of any paper/local results.
- Returning online **does not automatically upload or merge** a local backup. An organizer must explicitly review and reconcile changes against the authoritative server history using a future, separately tested workflow.
- Private exports must have safe storage, access control, dated revision metadata and a rehearsed restore; do not commit them to public GitHub or embed them in spectator HTML.

## Tournament invariants carried forward

- Championship bracket uses internal FFTT Levels 1–5 for rating-aware opening seeding; ratings remain private.
- Byes are not competitive games and **do not** create consolation entrants.
- A player's **first actual championship loss** creates reviewed consolation eligibility; all checked-in players must finish their first real championship match before the consolation bracket is built.
- Best of 3 regular singles, best of 5 championship final, 11 points with win-by-two; optional winner-only result remains permitted as current app behavior.
- The two championship finalists anchor **one** Mixed-Skill Doubles finale with suitable consolation partners. Current app selects teams but does not record a doubles result; this milestone does not invent that feature.
- No change to existing local tournament rules, browser UI, scoring engine, or approved branding.

## Synthetic validation and acceptance

Run: \`python -m unittest discover -s tests -p 'test_phase1a_contract.py' -v\`. This executes an **in-memory reference model**, not Supabase and not the live \`index.html\`. The tests assert the specification's intended security and transaction invariants, including role revocation, allowlisted public projection, version conflicts, exact retries, tampered IDs, scoring validation, advancement, downstream-correction safety and offline rejection. Existing Playwright tests continue to test the real local application.

**Not proven by 1A:** Actual RLS/grants, authentication integration, SQL isolation/locks, Postgres migrations, Realtime permissions, cloud multi-device behavior, production backups or event-day recovery. Those require Phase 1B onward, with separate end-to-end security/concurrency tests. Do not mark shared state functional based solely on reference tests.

## Approval gates still pending

- Provision an isolated Supabase project **only when separately authorized**; confirm free/paid plan, ownership, resource limits and recovery approach.
- Define signup/invitation delivery and account recovery without shared volunteer credentials.
- Approve publication/consent policy for real player display names and production URLs.
- Approve any real player-data migration or production cutover only after synthetic rehearsal.
