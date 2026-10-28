# Development testing and release efficiency standard

Approved: 2026-10-28. Applies to development, CI, code review and deployments. This is a default engineering policy, not permission to bypass existing repository release gates.

## Principles

- Verify proportionately to risk. Keep developer feedback fast; do not launch a full end-to-end regression for every cosmetic change.
- Use change-impact classification that fails closed to stronger checks if scope, dependencies or safety are uncertain.
- Run the smallest tests that establish the intended behavior, then escalate for material risk.
- Never sacrifice authorization, security, privacy, data integrity or production safeguards for speed.
- Reuse passing results on unchanged code, but never claim that a run validates a different commit.
- Batch related fixes into one validated release; avoid duplicate deployments and repeated approval cycles.

## Default test tiers

| Tier | Examples | Minimum checks |
| --- | --- | --- |
| Visual | CSS, spacing, text, decorative icons | Syntax/static checks and targeted UI visual or browser smoke |
| Interaction | Focus, scrolling, accessible controls, client-side presentation | Visual checks plus affected browser interactions at relevant viewport sizes |
| Workflow | Registration, import/export, content or reporting data flow, non-sensitive persistence | Affected integration tests, regression cases and representative end-to-end flows |
| Critical | Auth, permissions, privacy, scoring or financial accuracy, DB schema/migrations, server/API/cloud functions, deployment/security config, unknown/mixed changes | Full relevant regression, security/privacy and persistence checks, release gate review |

These are minimums; project-specific hazards may require stronger checks.

## Releases

- For **development preview or isolated staging**, prefer targeted tier-appropriate checks and manual acceptance when safely allowed by that repository's approved release policy.
- For **production, live user-data environments, critical changes or major releases**, retain the repository-specific higher-assurance release gate.
- If a repository currently requires full regression for staging, that requirement **remains binding** until its policy, impact classifier, tests and deployment controls are deliberately updated and validated. This document alone does not relax it.
- Verify the tested SHA, affected files, workflow jobs and actual deployment target. Preserve rollback and never change live data as a side effect of UI validation.
- Never silently merge or deploy; honor repository-specific authorization and protected branches.

## CI engineering standards

- Split independent test families into parallel jobs where safe; do not parallelize tests sharing mutable state.
- Cache immutable dependency downloads (with lockfile keys) and browser binaries when safe.
- Prefer targeted, deterministic fictional/mock data in fast lanes; no real credentials or production services.
- Cancel obsolete CI on superseded commits, not the latest relevant release checks.
- Configure risk-based path/logic classification, with explicit tests that prove critical changes cannot take the fast path.
- Report median and slowest CI durations; prioritize removing duplicated setup and needless repetition.
- Make manual release verification one deliberate operation per release candidate, not one per small commit.

## Implementation and verification checklist

1. Inspect existing CI, branch protection and deployment policy before changing enforcement.
2. Add or verify tested classification rules; protected paths must remain critical.
3. Add targeted smoke and interaction tests; keep a documented fallback to full.
4. Parallelize independent full jobs and adopt safe caching.
5. Validate one cosmetic change takes the fast lane and one critical change takes the full lane.
6. Prove deployment gates still block unverified critical or production releases.
7. Report what is implemented versus what is only policy, the commit SHA and remaining blockers.

## Time budget

Aim for quick UI feedback, ideally 1–5 minutes; these are performance goals, not blanket CI timeouts. If a mandatory longer test exceeds the user's available attention budget, let it continue unattended or report the status; do not claim release readiness or bypass a gate. Never start duplicate regression runs simply because the first exceeds the attention budget.
