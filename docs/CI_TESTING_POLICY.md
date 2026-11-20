# FFTT CI v2 — fast by default, comprehensive by approval

## Operating contract

- Only pull requests trigger automatic focused checks. A merge to `main` does **not** repeat the same test suites.
- Cumulative PR changes are classified from a **trusted base-branch selector**, not code supplied by the PR. Superseded checks are cancelled.
- Each selected test file runs only once. npm and Chromium are installed only when a relevant test needs them.
- Unknown, scoring-authoritative, security, authentication, server, SQL, dependency, and CI-infrastructure changes **do not automatically start comprehensive regression**. They require a successful, separately authorized comprehensive run for the **exact PR head SHA** before the high-risk PR gate can pass.
- The original comprehensive suites and commands are preserved in `.github/workflows/browser-tests.yml`, but that workflow is **manual-only**, requiring the `approval=APPROVED` input.
- The staging gate can no longer launch that workflow. If the required evidence is unavailable, it blocks deployment. Production authorization and data-safety gates remain independent.

## Automatic checks

| Changed area | Selected checks | Manual comprehensive proof |
| --- | --- | --- |
| Markdown documentation only | Selection/reporting | No |
| TV layout, TV logic, TV presentation test | TV presentation plus public isolation/privacy | No |
| Spectator or public-site presentation | Public UI, selection and privacy | No |
| Verified passive public images in `app/assets/` (PNG/WebP, at most 1 MiB and 2048px per dimension) | Public UI, selection and privacy | No |
| Missing, oversized, animated, misleading, symlinked or unknown image/media files (including SVG/GIF) | Applicable focused checks; release blocked until authorized full proof | **Yes** |
| Allowlisted Staff visual UI | Focused Staff browser/unit | No |
| Registration model/UI/test | Registration unit/browser | Depends on protected changes |
| Scoring and tournament authority | Scoring plus public presentation | **Yes** |
| Authentication, SQL, server, deployment, CI code, unknown files | Applicable focused checks (if known) | **Yes** |

Targets, pending measurement in actual GitHub runs: under 30 seconds for static selection, and 1–3 minutes for focused browser checks. These are design budgets, not promises.

## Verified public image rules

The **trusted base-branch selector**, not the PR's proposed policy code, validates each image before treating it as presentation-only. Only a single-level `app/assets/<safe-filename>.png` or `.webp` qualifies. Validation requires the actual checked-out regular file (not a symlink), the expected PNG/WebP file signature and structure, safe reported dimensions (1–2048 pixels each), and a size of at most 1 MiB. WebP animation is disallowed. Invalid/missing bytes and executable formats fail closed to manual proof. Git and the sanitized Cloudflare export independently preserve file hashes; focused browser tests must verify the referenced public image actually loads, is accessible and doesn't alter security/privacy behavior.

The CI policy implementation and policy tests themselves remain **protected changes**. A change to `tools/ci_v2.py`, `tests/test_ci_v2.py`, or CI workflows still triggers the manual-proof gate under the existing trusted policy. Do not reinterpret a clean visual asset as authorization to merge a protected CI policy change without its mandatory review/approval.

## Manual full verification

An owner-authorized operator must explicitly dispatch **Browser regression tests** on the exact feature-branch head with input `approval=APPROVED`. Only a completed **successful** manually dispatched run with all three comprehensive jobs green counts as proof. Afterward, re-run the failed `CI v2 — release-risk gate` check to re-evaluate the immutable SHA evidence, without restarting full regression.

The CI selector itself never dispatches tests; there is no fallback that silently turns uncertainty into an automatic full run. Required checks and branch protections must not be removed merely to get a merge through.

## Staging and production

`tools/ops/staging_release.py` still requires its established exact-commit proof, including the historically narrow visual-release exception. It now fails fast when full proof is missing rather than starting another workflow. Missing safety evidence blocks staging, not authorizes it. Nothing in CI v2 approves a hosted migration, release, or production rollout.

## Safe activation boundary

The old comprehensive workflow currently exists on `main` with PR/push triggers. **Do not open a PR for the CI v2 branch until the old workflow is disabled or the owner explicitly approves a safe cutover.** Otherwise GitHub may start exactly the unwanted old full regression. Working on the isolated branch does not trigger that workflow.

For the **one-time initial PR**, before `ci_v2.py` exists on `main`, the new workflow independently verifies that the cumulative diff contains exactly the nine CI/policy adoption files, then runs only offline CI-v2 and staging-gate unit tests. It does not dispatch comprehensive regression. This narrow bootstrap exception does **not** apply to later PRs; normal trusted-base classification and explicit manual proof take over after adoption. Human PR review and existing branch protections remain necessary.

Retain existing branch-protection requirements. Validate the new routing with cheap local tests (`python3 -m unittest discover -s tests -p 'test_ci_v2.py' -v`), and staging safety tests (`python3 -m unittest discover -s tests -p 'test_staging_release.py' -v`). Any protected workflow change itself needs review/authorization before activation.

For the historical pre-v2 policy see prior Git history; do not restore it without explicit approval.
