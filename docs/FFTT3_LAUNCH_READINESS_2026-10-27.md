# FFTT3 — direct launch-readiness plan
**Decision: October 27, 2026.** Christopher prioritizes **simplicity and moving straight to safe real-event launch readiness**. Do not make further synthetic milestones or new infrastructure the default. The previous suggestion for a second Supabase project and two additional Pages sites is superseded by this direction (preserve it as historical analysis).

## Preferred architecture — reuse what exists
- **One Supabase project:** `fftt-bracket-manager-dev` (`copmkalfkkrkzheohwuc`), **upgraded in place**, subject to a verified, non-destructive migration and explicit hosted-cutover authorization. Project naming alone is not a reason to duplicate it.
- **Two existing Cloudflare Pages projects:** Staff `fftt3-staff-stg.pages.dev` including server-only Google registration Function; Spectator/TV `fftt3-games-stg.pages.dev` with no staff code. Promote accepted builds on these projects, keeping their private/public isolation. Optional friendly production URLs should not block functionality.
- **One codebase:** existing `0xCLS/fftt-bracket-manager` repository and draft PR #19; preserve historical rehearsals and existing event-scoped grants. No new application/repository or subscription.
- **Google:** keep the already verified service account and real FFTT3 sheet. The October 27 diagnostic passed (12 columns, 21 response rows) but **read no participant answers**. It does not authorize actual importing, and response count is not proof of unique registrants.

## Critical path to launch
1. **Implement a safe, in-place event-mode release, not a fresh-database replacement.** Current live schema enforces `synthetic_only=true` and multiple staff/score RPCs filter on that field. Create a reviewed change that preserves all existing synthetic events and historical results, allows clearly identified new real events, authorizes each operation by active event-scoped Auth grant and lifecycle, audits changes, and prevents a fictional fixture from being used for a real event. The existing *real-only fresh-database* SQL generator is a reference candidate, **not safe to run unchanged on the populated Supabase project**.
2. **Preflight with a populated disposable clone**: preserve synthetic fixtures, score decisions, event revisions, staff roles, export and rollback. Test every relevant V3–V5 operation, real-event creation, cross-event denial, staff revoke, check-in, 1-match/Bo3 formats, bracket generation, table reservation, consolation and doubles.
3. **Independent signed authentication and concurrency acceptance**: actual GoTrue Auth sessions (not just in-process JWT stubs), organizer and two scorekeepers plus outsider, simultaneous score attempts, stale/retry handling, reconnection and no public access to sensitive details.
4. **Private snapshot and recovery before hosted schema changes**: verify backups, restore on disposable instance, record before/after fingerprint; never delete or overwrite completed fictional tournament data. Establish paper-score and manual export fallback.
5. **Reuse existing Staff and Spectator deployments**: verify signed login, server-only Google credentials, origin allowlist, private registration data handling, read-only spectator projection, device/TV performance, fail-closed errors and publication defaults. Explicitly authorize the hosted migration and any real registration loads; do not expose contacts or private ratings.
6. **Onsite rehearsal:** **November 8, 2026 at 10:00 AM** (confirmed). **Event:** **November 22, 2026 at 1:00 PM** (confirmed). Reverify access, sync, backup and device recovery before game day.

## Readiness acceptance
| Area | Must-pass evidence | Status as of decision |
| --- | --- | --- |
| In-place schema | Tested migration on **populated** disposable DB, no synthetic-data loss, verified backup/restore | **Pending** — fresh-DB real-mode SQL CI passed only |
| Access | Independent signed Auth, event-scoped organizer/scorers, outsider denial and instant revocation | **Pending in real-event mode** |
| Scoring | Two-scorer concurrency, formats, brackets, table conflict, consolation, doubles, audit and recovery | Synthetic tests passed; **real-mode acceptance pending** |
| Registration | Private verified Google source, reviewed heading mapping, per-player reconciliation, no contact leakage | Metadata diagnostic passed; **no real answers imported** |
| Spectators | Separate bundle and allowlisted, organizer-controlled publication; no staff APIs, ratings or contact data | Synthetic checks exist; **release acceptance pending** |
| Operations | Current Pages sites, health, offline score fallback, private backups, onsite real-device rehearsal | **Pending** |

**Priority:** launch-critical correctness and recovery before cosmetic polish or optional features. Batch engineering + tests; avoid serial approval requests for code-only changes. No paid services. The preferred one-project route should change only if a verified technical/security blocker makes it unsafe.

**Boundaries:** This direction authorizes preparation and disposable tests, **not** changing the populated hosted database, sharing/importing real participant answers, publishing real player information, altering protected keys, merging PR #19, or deploying an unverified production release. Seek one focused approval for the ready-to-run hosted cutover after evidence is complete.

**Source conflict / resolution:** Prior October 27 separate-production-project plan was a recommendation under the earlier synthetic-prototype scope. Christopher's later simplicity/direct-launch instruction overrides that recommendation while maintaining strong authentication, privacy and data-integrity requirements.
