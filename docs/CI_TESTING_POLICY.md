# CI routing and release policy

The browser regression workflow selects the least expensive **verified** lane. Unknown paths, invalid history and ambiguous UI edits fail closed to the full suite. The router and workflow changes themselves are full-risk and require comprehensive CI before adoption.

| Lane | Scope | Checks |
| --- | --- | --- |
| `ui-visual` | Allowlisted, non-sensitive shared CSS | Fictional Staff UI plus public TV/Spectator browser, selection and privacy checks |
| `public-ui` | Allowlisted public presentation and narrowly bounded event-selection changes | Fictional TV and Spectator browsers at desktop, phone and TV sizes; event selection, public projection, freshness and privacy tests |
| `organizer-ui` | Allowlisted Staff presentation changes that do not touch protected actions or permissions | Fictional Staff UI, registration and check-in workflows |
| `docs` | Documentation-only verified ranges | Classifier tests |
| `full` | Scoring, bracket logic, data writes, authorization, authentication, permissions, secrets, SQL, server/Functions, contracts, CI/test changes, unknown or ambiguous changes | All three existing full regression jobs, including disposable PostgreSQL |

Public/organizer JavaScript is not automatically trusted. The router rejects changed imports, network/storage/auth/write operations and other protected or ambiguous UI edits; public feed wiring must remain byte-identical for the limited event-selection exception. Display or test edits that cannot be proven safe go through full CI. CSS that may hide status or load external resources is full-risk. Test, dependency and CI changes always use full CI. Maintain the allowlists and tests together; never add server, contract, database, auth or scoring code to a focused lane.

For opened and reopened PRs, the classifier verifies the base, head, checkout and merge base, then classifies the **whole merge-base-to-head diff**. Synchronize events additionally verify the before/after SHAs and ancestry, but still classify the cumulative PR diff. Earlier sensitive work therefore cannot escape because a prior check failed, was cancelled, or never completed. Force pushes, missing commits, mismatched checkouts and empty or unprovable ranges require full CI. For main pushes, the entire verified before/after range is classified. A manual workflow dispatch always runs full regression. Automatic runs cancel superseded runs for the same PR or branch; manual full runs have independent concurrency groups.

A main push may avoid repeating a **completed full PR regression** only when the previous trusted router verifies the GitHub merged PR, the tested PR base matching the prior main commit and being an ancestor of the head, exact PR-head and merge-result tree equality, and success of all three full jobs in the same successful PR workflow run. CI, test, tool and dependency changes are ineligible. Missing, failed or incomplete proof falls back to normal classification and cannot waive full checks. The workflow reports `reused` explicitly; it does not manufacture an exact-commit full check.

The classifier for an event is loaded from the trusted base/before commit, not from the PR under test. Protect the workflow and branch through repository review and branch-protection rules; the classifier is not a substitute for those controls.

## Staging and production release safety

CI routing does **not** authorize deployment. The staging gate still requires successful full jobs on the exact release commit except for its existing narrowly pinned visual-only exception: matching full-tested live staging baselines, an allowed cumulative visual delta, successful exact-commit classifier and focused job, and all bundle, preview and live verification. Its allowlist is independent of the development router and cannot expand merely because a new CI lane is added. Public UI and organizer interaction lanes do not satisfy this exception. A reused PR run is not an exact-commit full release check; when the full gate applies it must run on the release SHA. Cloudflare production authorization, security checks and Supabase safeguards are unchanged.

Run `python3 -m unittest discover -s tests -p 'test_ci_impact.py' -v` for routing and proof tests, and `python3 -m unittest discover -s tests -p 'test_staging_release.py' -v` for staging safeguards. Focused browser fixtures use intercepted fictional data. Manual full CI is available through **Browser regression tests → Run workflow** on the intended commit/branch; verify its exact SHA and all three full jobs before relying on it for a release.
