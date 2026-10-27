# FFTT3 isolated real-event SQL candidate — October 27, 2026

**STATUS: candidate generation and local fictional-data testing only. NOT production-ready or deployment-authorized.** The existing synthetic project, staging bundles, and GitHub PR #19 stay unchanged/unmerged.

## What this delivers

The executable offline generator at `tools/release/build_real_event_candidate.py` takes the exact nine reviewed source SQL files (B1–B2d, V2, V3–V5), checks each Git blob ID, and produces a clean real-only SQL variant in a local empty directory. It changes only known synthetic event schema/default, event authorization lookups, event listing, scoring/revocation checks, and export's event-mode flag. Every substitution has an expected occurrence count; any source drift or leftover permissive synthetic-only lookup aborts. The checked-in synthetic SQL is never modified.

The release candidate **still disallows synthetic fixtures**; the V5 registration-source rule permits an enabled Google source only for a non-synthetic event. Existing server-side Google credentials, event-id allowlisting, role checks and diagnostic-only staging rules are untouched.

The isolated PGlite test `tests/e2e/gameday_real_event_candidate.test.mjs` generates SQL in a temporary directory, instantiates a fresh simulated Auth/PostgREST database, and checks: real-only event creation, rejection of synthetic inserts, outsider denial, organizer-only Google source setting, fixture rejection, staff scoring, and public-projection privacy. **No real participant names, responses or identifiers appear in the test.**

## Local non-deploying commands

Run the validation guard:
`python3 tools/release/build_real_event_candidate.py --check`

Run the isolated integration test after `npm ci` under `tests/e2e`:
`node --test tests/e2e/gameday_real_event_candidate.test.mjs`

Optionally generate review artifacts into a NEW EMPTY local folder:
`python3 tools/release/build_real_event_candidate.py --candidate --out /tmp/fftt-real-candidate-review`

These are *not* Supabase CLI migrations. Do not use `supabase db push`, apply them in a dashboard, or deploy them to either project. A separate infrastructure/release authorization remains mandatory.

## Remaining review gates

- Independent PostgreSQL/Supabase Auth test, with actual JWT identities, role revocation and concurrent score submissions. PGlite test alone cannot certify all hosted behavior.
- Validate that all V3–V5 server functions, format controls and event-life-cycle transitions behave under real-only mode; audit `SECURITY DEFINER`, RLS and published fields. Production sources must never accept raw contact details. Live Google loads must remain off until explicit organizer approval.
- Design secure real account provisioning and assess Free plan pausing, quotas, private backup/restore and paper fallback. Confirm no paid resources before infrastructure creation.
- Separately approve creation of a second Supabase project plus two Pages sites, then separately approve actual response loading, controlled publication and final November 8 onsite / November 22 game-day acceptance.

**Never weaken or repurpose the existing synthetic-only schema in `fftt-bracket-manager-dev`.**
