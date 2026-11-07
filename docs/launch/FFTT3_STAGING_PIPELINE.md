# FFTT3 automatic staging deployment

**Scope:** the two existing Cloudflare Pages **staging** projects, `fftt3-staff-stg` (Organizer and scorekeepers, with the private `/api/registrations` Function) and `fftt3-games-stg` (spectator and TV). **Authoritative source:** branch `integration/milestone1-secure-foundation` (PR #19 merged on October 29; this **staging deployment workflow** still uses the integration branch and does not deploy from `main`). Both projects are Cloudflare *Direct Upload* projects, which cannot be converted to Cloudflare's own Git integration, so deployment is done by GitHub Actions using `wrangler pages deploy`, the same recipe as `FFTT3_CUTOVER_RUNBOOK.md` Step 4.

**October 31, 2026 status clarification:** PR #22 (Bracket Manager role and domain source) remains a separate **draft** feature PR. A normal merge to application `main` does **not** trigger this staging workflow: the checked-in `.github/workflows/deploy-staging.yml` listens only for pushes or authorized manual dispatch on `integration/milestone1-secure-foundation`, and release targets are the two `fftt3-*-stg` Pages projects only. Existing production Staff/Spectator releases are separate and are never promoted by that merge. The old PR #19 status above was outdated, but the workflow branch and safety boundary were not changed.

## What happens on every push to the branch
Workflow `.github/workflows/deploy-staging.yml`, logic in `tools/ops/staging_release.py` (unit-tested by `tests/test_staging_release.py`):

1. **Plan** (no secrets). Builds both sanitized bundles from the exact commit with `tools/staging/build_export.py` (staging environment, both origins pinned) and compares them with what is live (`/MANIFEST.json`). A bundle is released only if its files differ from the live ones; for Staff also if `functions/` or `server/` changed since the live commit. Docs-only and unrelated pushes therefore deploy nothing and run no tests.
2. **Gate.** For a **verified visual-only delta** (only CSS/visual test paths since matching live Staff+Spectator manifests whose commit has the full regression green), accepts both successful exact-commit PR classifier and focused fictional Chrome jobs; it **does not dispatch full CI again**. If anything about the baseline, file history or fast checks is missing, ambiguous or changed outside the visual allowlist, require the **full regression** on the exact commit: browser/security foundation, game-day/launch workflows and disposable PostgreSQL all green. Nonvisual changes reuse a full run or start it once and wait. A failure blocks release; a superseded commit is dropped. See `docs/CI_TESTING_POLICY.md`.
3. **Release** (GitHub Environment `staging`, the only place the Cloudflare token exists), per app, Staff first:
   - the uploaded artifact is re-checked: manifest commit equals the tested commit, target and environment (`staging`) are right, every file hash matches, no extra files;
   - upload to the throw-away preview branch `ci-verify`, then `verify_deployment.py --static-only` on that unique URL (hashes, CSP, headers, private paths not served). Preview Functions have no production-only variables/secrets, so GET `/api/registrations` may return **either** 405 (method rejected) **or only** the exact 503 JSON `{"error":"registration-not-configured"}` (fail-closed without configuration), with `Cache-Control: no-store`; any other response is a failure. A failure here means **nothing is promoted**;
   - upload the same bytes to production branch `main` of the staging project, then the full `verify_deployment.py` on the stable URL (files hash-identical to the manifest, live `MANIFEST.json` equals the tested bundle, security headers, private paths 404, Staff Function 405 on GET and 401 without a token, Spectator serves no Function or staff page), retried for edge propagation;
   - if the live check fails, the previous successful deployment is restored through the Cloudflare rollback API and the job fails.

`workflow_dispatch` runs the same pipeline; tick **force** to redeploy even when the live content is identical.

## What the pipeline cannot touch
- Project names, origins and the branch are constants in `staging_release.py`; there is no input for a different project or environment, and the workflow refuses other refs.
- No Cloudflare variable or secret, Supabase setting, Auth rule, SQL, event data or Google configuration is read or changed. A Direct Upload deployment replaces only the static files and Function code; Staff secrets (`GOOGLE_SA_*`, `REGISTRATION_*`, `STAFF_ORIGIN`, `SUPABASE_*`) stay as configured.
- The workflow has no `pull_request` trigger, so a fork or PR cannot reach the token. The token is an environment secret restricted to the integration branch and scoped to **Account → Cloudflare Pages → Edit** for the one account, with a one-year expiry.
- Production (GitHub Pages from `main`, and any future non-staging Cloudflare project) is not referenced.

## One-time configuration (owner of the Cloudflare account)
| Where | Item |
| --- | --- |
| Cloudflare → My Profile → API Tokens | Custom token, name `fftt3-staging-deploy`, permission *Account · Cloudflare Pages · Edit*, only this account, expiry one year |
| GitHub → Settings → Environments → `staging` | Deployment branches: only `integration/milestone1-secure-foundation`; secret `CLOUDFLARE_API_TOKEN`; variable `CLOUDFLARE_ACCOUNT_ID` |

Rotate the token before it expires: create a new one, `gh secret set CLOUDFLARE_API_TOKEN --env staging`, delete the old one.

## October 28 preview-function false failure and correction

Release run [40734534618](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/40734534618) for `fd0a71a` passed all three full CI suites and the Staff preview's 34/34 file hashes, manifest and static/security checks, but the preview Function returned 503 on GET because the non-production preview lacks the configured production-only registration variables. The old verifier insisted on 405 even for an unconfigured preview; no deployment was promoted. The updated verifier accepts only an explicit `registration-not-configured` 503 in previews, not a generic 503; all stable Staff origin checks remain mandatory. The fix requires a new full regression and independently verified release before reporting the Staff update live.

## Recovery
- **A release failed its checks:** nothing to do for a preview or gate failure (the live site is unchanged); a post-promotion failure restores the previous deployment automatically. Read the workflow log, fix on the branch, push.
- **A bad build is live anyway:** Cloudflare dashboard → Workers & Pages → the project → Deployments → the last good one → **Rollback to this deployment** (Staff then Spectator). Or revert the commit on the branch; the pipeline redeploys the reverted content after the full regression. For an urgent redeploy of known-good content use *Run workflow* with **force**.
- **Incident switches:** unchanged — set `REGISTRATION_GOOGLE_MODE` back to `diagnostic` in Cloudflare and redeploy once (force run).
- **Pipeline itself is broken or the token expired:** the local manual recipe in `FFTT3_CUTOVER_RUNBOOK.md` Step 4 still works (`npx wrangler@4 login`).
- **Rollback references** before this pipeline existed are in `FFTT3_CUTOVER_RECORD_2026-10-27.md`.

## Release-day rule
Because Staff is the live game-day application, keep using this pipeline for tested changes only. Full regression remains mandatory for organizer JS/interaction, Auth, scoring, server, schema or unknown changes; the focused exception is strictly visual-only with verified full-tested live baseline. For an event freeze, disable the workflow (Actions → Deploy FFTT3 staging → ⋯ → Disable workflow) and re-enable it afterwards; no other setting needs to change.
