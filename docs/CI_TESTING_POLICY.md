# FFTT3 CI policy — fast UI development, full release confidence

**Approved direction, October 28, 2026:** do not rerun the 50-plus-step
browser suite and disposable Supabase job for every cosmetic change.

## Automatic checks on the draft PR

The existing `.github/workflows/browser-tests.yml` has one change-impact
classifier and three mutually exclusive execution paths:

| Route | When | What runs |
| --- | --- | --- |
| Fast visual (`ui-visual`) | Incremental PR push changing only the allowed CSS/visual browser-test files | Offline syntax/privacy smoke and short **fictional** Chrome phone/desktop Players UI acceptance |
| Focused interaction (`ui-interaction`) | Allowed organizer-view presentation changes with **no** protected action/auth/source logic edits | Fast visual checks **plus** synthetic registration/check-in and fake-Google browser workflows |
| Full regression (`full`) | Any core, session, scoring, brackets, auth, server, Cloudflare Function, contracts, PostgreSQL, migrations, CI tooling, unknown or mixed change | Unchanged broad browser, security, SQL and disposable PostgreSQL suites |
| Docs (`docs`) | Verified docs-only incremental PR push | Classifier; no redundant browser or SQL jobs |

GitHub's `pull_request.synchronize` **before/after SHAs** are used for
the *complete incremental push range*, not the entire historical PR and not
only the newest commit. The classifier fails **closed to full** if either SHA
is missing, the comparison is ambiguous, the file is not allowlisted, or an
organizer view edit touches protected action/permissions/registration-source
calls. PR opening/reopening, pushes to `main`, and explicit
`workflow_dispatch` always select full. Newer PR updates cancel obsolete
in-progress workflow runs.

All UI checks use real Chromium with fictional, intercepted, local PGlite
data; none connect to hosted Supabase, a real Google Sheet or Cloudflare.

## Release gate — do not substitute a green fast lane

**Before any controlled Staff/Spectator deployment, explicitly run and
confirm a green full regression on the exact release source commit.**
The faster checks are for feedback *during iteration*, not for skipping
release-quality verification. Never deploy just because the fast lane passed.
Keep PR #19 draft and unmerged unless separately approved.

The current targeted test is
`node --test tests/e2e/gameday_fast_ui_browser.test.mjs` (after
`cd tests/e2e && npm ci && npx playwright-core install chromium`).
To run the full workflow on demand, use GitHub Actions → Browser regression
tests → Run workflow on the intended branch, verify the exact tested SHA,
and require all three `foundation`, `test` and `Disposable synthetic PostgreSQL` jobs to pass.

## Maintenance rules

- Do not broaden the UI allowlist to `server/`, `functions/`,
  `contracts/`, `supabase/`, `app/session*` or unknown app files.
- UI code is not automatically safe: changing check-in or registration
  write calls, source configuration, access decisions or permission checks
  requires full regression.
- Maintain `tests/test_ci_impact.py` when editing the classifier.
- A live Organizer visual review is still required for authenticated
  layouts before deciding the UI release is accepted.
- This change affects CI only; it does not modify any app release,
  staff credentials, real registration records or tournament results.

## Verified implementation — October 28, 2026

- CSS-only incremental PR commit `eebabb99cf4d05c6976eca4fd5d14c83b3817ead` triggered [GitHub Actions run 40641184551](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/40641184551): classifier **passed**, focused fictional Chromium UI check **passed**, full application job **skipped**, disposable PostgreSQL job **skipped**. This verifies the fast visual lane in the actual GitHub Actions runner.
- An earlier exploratory fast-lane attempt failed because a legacy Python Playwright smoke script was invoked without its separate Python dependency; the redundant step was removed, and the corrected lane passed. The focused Node/Chromium fixture remains the browser acceptance gate.
- Docs-only commit run 40640909104 completed successfully with both heavy jobs skipped; protected routing logic is exercised by `tests/test_ci_impact.py` in every classifier run.
- The interaction-focused lane is covered by routing unit tests but has **not yet been separately exercised end-to-end** in GitHub Actions. It must still pass before relying on it for a JS UI iteration. A green targeted run does not satisfy the **mandatory full pre-deployment regression**.


## Full-regression runtime improvement — 2026-10-28 (proposed CI branch)

The broad application test job is partitioned into two independent jobs, `foundation` (Python browser/security and legacy checks) and `test` (game-day and launch-mode JavaScript/Chromium suites). Both retain their original test commands and execute concurrently with the disposable PostgreSQL job. Node npm downloads use lockfile-keyed setup-node caching. The full release gate now requires **all three** jobs green on the exact release SHA, not merely the previous two. No security or launch test is removed. The first CI run of this workflow change must itself use the full lane and must pass before adoption; runtime improvement remains unverified until then.

## Automatic staging deployment — October 28, 2026

`.github/workflows/deploy-staging.yml` now deploys the Staff and Spectator **staging** Pages projects automatically after the full regression (above) is green on the exact commit. It reuses the PR's full run or starts it once; it never deploys on a fast lane. See [FFTT3_STAGING_PIPELINE.md](launch/FFTT3_STAGING_PIPELINE.md).
