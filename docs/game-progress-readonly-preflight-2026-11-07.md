# Game-by-game scoring V6 — read-only preflight evidence
**Recorded:** November 7, 2026  
**Scope:** PR #59, `feat/game-by-game-scorekeeping`; no hosted DDL, deployment, score, player, permission, or event writes.

## Verified application and CI
- PR #59 head `8cddf0ad864d6125621b644dcc8e8bda1989af43` passed [all required CI jobs](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/42352293870), including disposable PostgreSQL, game-day workflows, browser foundation and security.
- `main` subsequently advanced to `b3f63e03b09b3d2829db955b27ea7193406ab8ca` with the fictional-showcase release (PR #62). The game-progress branch has been reconciled in this update to preserve demo identification, real-event selection, public-view behavior, and interim live scores. **The merged head requires its own fresh CI check**; the prior green run must not be misrepresented as applying to this tree.
- The independent draft Premium TV redesign PR #61 and CI routing PR #63 are **not** incorporated.

## Connected Supabase access and baseline (read-only)
- The only FFTT project visible in the connected Supabase accounts is **`fftt-bracket-manager-dev`**, project ref `copmkalfkkrkzheohwuc`. The repository's `supabase/hosted_migration_baseline.json` identifies it explicitly as **synthetic development**, records `hosted_push_approved: false`, and warns against unreviewed migration repair/push.
- Its migration-history listing contains six entries ending with `20261013101523` (`milestone1_durable_scoring_v2_synthetic`). However, read-only function introspection finds V3/V4 routines already in the live schema, including `v3_normalize_scores`, `v4_match_format`, `v4_normalize_scores`, `set_formats_v4` and `submit_match_result_v2`. **Migration-history entries alone do not establish the actual installed V3–V5 state.**
- Read-only schema checks find `fftt_private.matches` with `best_of` and `points_to_win`, the baseline `public.fftt_published_matches` without `game_progress`, and **no** `fftt_private.match_game_progress` table. The V6 candidate has **not** been installed on this connected development project.
- Existing `fftt_private.matches` and `audit_events` have RLS enabled and no direct `SELECT` privilege for `anon` or `authenticated`; the published match table is RLS enabled; the public tournament view is readable. This is **not** a substitute for checking the target database's privileges, view policies, and anonymous REST behavior after migration.
- Supabase security advisor reports 15 informational `rls_enabled_no_policy` findings on existing private tables (consistent with the deny-direct-access model; must remain reviewed) and one existing leaked-password-protection warning. These findings are not evidence of V6-specific exposure.

## Release status — blocked pending evidence
1. **Identify and connect the actual production database** used by the live FFTT application; the synthetic development project must not be assumed to be production.
2. From the actual target, obtain a read-only, non-sensitive snapshot of schema/migration history, function signatures, grants, RLS, triggers, public view and game-day V3/V4/V5 state; reconcile drift and pin an exact target revision.
3. Establish a tested, restorable, owner-approved **pre-change database backup** and a disposable restore rehearsal. Supabase's [current backup guidance](https://supabase.com/docs/guides/platform/backups) says free-tier projects should export/off-site back up; this check did **not** establish a usable backup or restore.
4. Obtain **explicit separate authorization** for the verified production migration and matched Staff/Spectator/TV deployment. PR review approval is not migration permission. Execute synthetic acceptance and non-destructive rollback checks on the authorized target before real use.

**Decision:** CI green on prior branch; code reconciliation committed here for fresh CI. Production readiness is **NOT VERIFIED**. PR stays draft/unmerged and V6 SQL remains a DO-NOT-APPLY proposal. No database changes were made by this preflight.
