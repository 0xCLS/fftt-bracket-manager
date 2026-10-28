# FFTT3 automatic staging deployment

**Scope:** the two existing Cloudflare Pages **staging** projects, `fftt3-staff-stg` (Organizer and scorekeepers, with the private `/api/registrations` Function) and `fftt3-games-stg` (spectator and TV). **Authoritative source:** branch `integration/milestone1-secure-foundation` (PR #19 stays a draft; `main` and GitHub Pages are not involved). Both projects are Cloudflare *Direct Upload* projects, which cannot be converted to Cloudflare's own Git integration, so deployment is done by GitHub Actions using `wrangler pages deploy`, the same recipe as `FFTT3_CUTOVER_RUNBOOK.md` Step 4.

## What happens on every push to the branch
Workflow `.github/workflows/deploy-staging.yml`, logic in `tools/ops/staging_release.py` (unit-tested by `tests/test_staging_release.py`):

1. **Plan** (no secrets). Builds both sanitized bundles from the exact commit with `tools/staging/build_export.py` (staging environment, both origins pinned) and compares them with what is live (`/MANIFEST.json`). A bundle is released only if its files differ from the live ones; for Staff also if `functions/` or `server/` changed since the live commit. Docs-only and unrelated pushes therefore deploy nothing and run no tests.
2. **Gate.** Requires the **full regression** on that exact commit: `Full regression — browser and security foundation`, `Full regression — game-day and launch workflows` and `Disposable synthetic PostgreSQL` must all be green. It reuses the run the pull request already produced; if only a fast UI lane ran (or nothing), it starts the existing full run once (`workflow_dispatch`) and waits. A failure stops the release. If a newer commit has been pushed, the older release is dropped as superseded. This enforces `CI_TESTING_POLICY.md`: a green fast lane never deploys.
3. **Release** (GitHub Environment `staging`, the only place the Cloudflare token exists), per app, Staff first:
   - the uploaded artifact is re-checked: manifest commit equals the tested commit, target and environment (`staging`) are right, every file hash matches, no extra files;
   - upload to the throw-away preview branch `ci-verify`, then `verify_deployment.py --static-only` on that unique URL (hashes, CSP, headers, private paths not served). A failure here means **nothing is promoted**;
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

## Recovery
- **A release failed its checks:** nothing to do for a preview or gate failure (the live site is unchanged); a post-promotion failure restores the previous deployment automatically. Read the workflow log, fix on the branch, push.
- **A bad build is live anyway:** Cloudflare dashboard → Workers & Pages → the project → Deployments → the last good one → **Rollback to this deployment** (Staff then Spectator). Or revert the commit on the branch; the pipeline redeploys the reverted content after the full regression. For an urgent redeploy of known-good content use *Run workflow* with **force**.
- **Incident switches:** unchanged — set `REGISTRATION_GOOGLE_MODE` back to `diagnostic` in Cloudflare and redeploy once (force run).
- **Pipeline itself is broken or the token expired:** the local manual recipe in `FFTT3_CUTOVER_RUNBOOK.md` Step 4 still works (`npx wrangler@4 login`).
- **Rollback references** before this pipeline existed are in `FFTT3_CUTOVER_RECORD_2026-10-27.md`.

## Release-day rule
Because Staff is the live game-day application, keep using this pipeline for tested changes only. For an event freeze, disable the workflow (Actions → Deploy FFTT3 staging → ⋯ → Disable workflow) and re-enable it afterwards; no other setting needs to change.
