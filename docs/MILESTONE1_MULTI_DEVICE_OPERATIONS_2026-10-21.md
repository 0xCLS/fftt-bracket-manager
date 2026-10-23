# Milestone 1 — Multi-device operations & recovery (local implementation)

_October 21, 2026 · synthetic only · **local development, disposable simulation and intercepted-provider browser tests**. No hosted Supabase setting, user, grant, fixture, email, score or publication was touched by this batch. Production `main` and draft PR #19's merge state are unchanged._

## Starting point

The [October 21 hosted PKCE acceptance](MILESTONE1_HOSTED_PKCE_PROVIDER_PREFLIGHT_2026-10-21.md) (operator-observed: real email, PKCE code exchange, independently verified identity, event-scoped scorekeeper role, read-only Match Desk, session cleared, aggregate-only post-audit unchanged) **supersedes** older wording elsewhere that says real-provider PKCE was untested. It is a single-account, localhost-only result; it does not establish physical-device, multi-user, revocation, spectator/TV, scoring or fallback behavior.

## What was added, by workstream

| Workstream | Capability | Where | Evidence |
| --- | --- | --- | --- |
| 1 Multi-device access | Device origin + capability policy (exact `http://localhost:3000`, or an operator-approved **HTTPS default-port** origin; public static hosts and tunnels always denied; offline model of the hosted redirect allowlist; phone capability checklist) | `contracts/milestone1_device_origin_policy.mjs` | `tests/milestone1_device_origin_policy.test.mjs` |
| 1 | Zero-network phone readiness page | `rehearsals/m1/device-check.*` | `tests/milestone1_device_check_browser.py` |
| 1 | Physical-device staff page: origin-gated, consent-gated single email, same-tab PKCE, read-only Match Desk following, background suspend/resume, offline sign-out | `rehearsals/m1/device-staff.*` | `tests/milestone1_device_staff_browser.py` (fake origins, intercepted provider), `tests/milestone1_display_pages_static.test.mjs` |
| 2 Revocation | `suspend()` / `resume()` on the staff session (opt-in grace ≤ 10 min, default **0 = off**); identity pinned across re-verification; role change in either direction forces a new sign-in | `contracts/milestone1_pkce_staff_session.mjs`, `contracts/milestone1_staff_access_gate.mjs` | `tests/milestone1_staff_revocation.test.mjs` (20 scenarios) |
| 3 Synchronized views | Public/TV follower with bounded freshness (`current` → `stale` → removed), automatic recovery, immediate blanking of invalid/private data, reads only | `contracts/milestone1_public_display.mjs` | `tests/milestone1_public_display.test.mjs` |
| 3 | TV/projector board | `rehearsals/m1/tv-display.*` | `tests/milestone1_tv_display_browser.py` (controlled clock) |
| 4 Offline continuity | Fallback operations ledger over the reviewed C1/drill model: sealed + re-verified backup digest, per-device stand-down roster (**simulated / self-reported / organizer-physically-observed**), tracked unknown scores, per-result manual disposition, hash-chained incident log, return-to-cloud readiness gate | `contracts/milestone1_fallback_ops.mjs` | `tests/milestone1_fallback_ops.test.mjs`, `tests/milestone1_fallback_ops_browser.py` |
| 4 | Organizer rehearsal page for the ledger (no network at all) | `rehearsals/m1/fallback-ops.*` | `tests/milestone1_fallback_ops_browser.py` |
| 5 Operational rehearsal | Six isolated clients (organizer, Scorekeeper A, Scorekeeper B, outsider, spectator, TV) running the **real** guard, transports, gate, supervisor, score session, display follower and ledger against an in-process GoTrue/PostgREST-shaped cloud | `tests/milestone1_sim_cloud.mjs`, `tests/milestone1_sim_clients.mjs`, `tests/milestone1_operational_acceptance.test.mjs` | included in the Node run below |

The simulated cloud enforces server behavior the clients must survive: single-use PKCE codes, verifier hash check, 60-second email limit, unknown email refusal (no account creation), expiry and global session revocation, per-event grants, stale-version rejection with durable decisions, actor-owned receipts, and mid-read event changes.

## Design findings and decisions needed (please review)

1. **Phones cannot use the current flow.** All earlier PKCE pages are pinned to `http://localhost:3000`, which on a phone is the phone itself. A LAN `http://` address is not a secure context, so Web Crypto (`crypto.subtle`, needed for the S256 challenge) is unavailable. Phones need a trusted **HTTPS** origin. The policy module, `device-check` and `device-staff` encode this; they have **not** run on a real phone.
   _What the origin list is and is not:_ the approved-origin file is served by the same origin it describes, so it is an **operator-safety check** (it stops accidental use of an insecure, wrong or public address) and not a defense against a malicious host. The real controls are the hosted redirect allowlist, email delivery only to existing accounts, S256/state binding, and event-scoped authorization.
2. **Hosted redirect allowlist (hosted change, not made).** Per the offline GoTrue review, a redirect on the Site URL's scheme and host (`http://localhost…`) is accepted without an allowlist; an HTTPS device origin is a different scheme and host and would be silently replaced by the Site URL unless an exact entry is added: `https://<approved-origin>/rehearsals/m1/device-staff.html?state=*`. `requiredRedirectAllowlistEntry()` produces the string. This needs your approval before any device email.
3. **HTTPS origins must use the default port (443).** The reviewed PKCE guard refuses explicit ports except on `http://localhost` / `127.0.0.1`. The first draft of the policy allowed `:8443`; the device browser test caught the mismatch (page said READY but could not initialize). The policy now matches the guard and a regression test keeps them aligned. The guard itself was not loosened.
4. **Email link hand-off on phones is the main practical risk.** The pending verifier is in tab-scoped `sessionStorage`. A link opened from a mail app's built-in browser, a different browser, or a discarded background tab cannot finish and fails closed (a new email, with the 60-second per-user limit, is then needed). The page therefore instructs: copy the link address from the mail and paste it into **the original tab's address bar** (the same procedure that passed on October 21). **Decision for you:** accept this procedure for the rehearsal, or authorize a later design change to an emailed **6-digit code** (`{{ .Token }}`) entered on the device, which removes the redirect/tab dependence but needs an email-template change (hosted) and new client code. Not implemented.
5. **Background grace (proposed default 120 s in `device-staff`, module default 0).** With 0, every backgrounding signs the volunteer out and needs a new email. With 120 s the memory-only token is kept but unusable until `resume()` re-proves identity **and** role; revocation, identity change, role change, expiry or overrun all end the session. **Decision for you:** keep 120 s, shorten, or set 0 (`BACKGROUND_GRACE_MS` in `rehearsals/m1/device-staff.mjs`).
6. **Organizer verification window vs. a long outage.** The reviewed drill cannot re-verify an organizer role while PAUSED/FALLBACK (that check needs the cloud) and an approval lasts at most 15 minutes. The ledger therefore requires a *fresh* proof only for the authority transfer and cloud-facing steps, and a *prior verified organizer session* for paper-backed local steps (stand-down, backup seal/verify, offline results). Consequence: **a fallback must begin within 15 minutes of the organizer's last verified check**, otherwise it cannot start until connectivity returns. Options if that is too tight: re-verify the organizer on a schedule during the event, or design a local organizer PIN. Not implemented.
7. **No server-side stand-down.** Scoring and Match Desk reads already require `lifecycle = 'active'` on the server, so a freeze is *possible*, but no organizer-callable control exists to set it; changing the lifecycle today needs privileged SQL. Until a reviewed migration is approved, stopping other scoring devices relies entirely on the physical stand-down. The ledger records who attested what and never claims physical isolation (`physicalIsolationVerified` stays false).
8. **Public displays keep aged data briefly; private views never do.** The TV board shows its last good public view labelled STALE after 20 s and removes it after 120 s so a network blip does not blank an unattended projector. Staff Match Desk views still clear immediately on any refresh failure. Private/invalid fields in a public response blank the TV at once.

## Verification (this checkout)

Run on macOS with Node v26.3.0 and Playwright/Chromium 156 in an isolated virtualenv; all network is simulated or intercepted.

* Node: `node --test tests/phase1c*.test.mjs tests/milestone1_*.test.mjs` — **308/308** (baseline before this batch: 233/233; 75 new tests).
* New Chromium suites: fallback operations, TV board, device staff page, device check — all PASS. Existing suites re-run unchanged and PASS: connected browser, score lab, hosted-browser mock, live read, continuity, PKCE staff mock, `ui_smoke`, `safety`, `rehearsal`.
* Python guards: Phase 1A contract (10), v2 proposal (8), hosted-once source guards, hosted browser operator source guards — OK.
* Mutation checks: the key safety gates (live-mode physical stand-down, backup withdrawal on mismatch, per-result disposition, server-verified unknown resolution, resume role/identity pins, grace bound, per-read fresh role, expiry/clock regression, private-data blanking, state check, mid-read revision change, supervisor stop-on-failure, non-loopback http refusal) were disabled one at a time; each makes at least one test fail. Two apparent survivors were redundant defense-in-depth layers; one dead condition was removed.

### Defects found by the batch's own tests and review (all fixed, each with a regression test)

* **Policy/guard mismatch:** an HTTPS device origin with an explicit port passed the new policy but made the reviewed PKCE guard throw during page setup, so the device page reported READY and then could not sign in. Caught by the device browser test; fixed by requiring the default port, with a test that keeps policy and guard aligned. The device page now also shows BLOCKED if initialization ever fails.
* **TV board classified a privacy violation as an outage:** the transport's allowlist error was treated as a network blip, so old data lingered as STALE instead of blanking. Caught by the TV browser test; fixed with an explicit invalid-data classifier (a broken classifier fails closed).
* **Suspend/resume race:** backgrounding the tab while a poll (or resume) was in flight made that interrupted operation destroy the suspended session, so a phone that was backgrounded at the wrong instant came back signed out. Found in review; fixed so only the still-current operation may tear a session down; two race tests fail without the fix.
* **Ledger consistency:** over-long organizer notes could throw after state had already changed, and stand-down acknowledgements were accepted after authority had transferred. Both now validate first and are rejected outside the paused phase.
* **Harness honesty:** the hygiene scan used to prove "no private identifiers" initially searched nothing because of unquoted shell expansion; it was re-run with a sanity canary. The acceptance suite now proves its process-wide fetch trap was armed.

### Coverage gaps (not claimed)

* **Disposable PostgreSQL / local GoTrue were not run on this machine** (no Docker, Supabase CLI or `psql`). The 81 pgTAP assertions, v2 SQL assertions and the signed local HTTP race are unchanged by this batch and last passed in CI on the previous commit; they must be confirmed by the next CI run.
* No real phone, tablet, mail app, Wi-Fi network, TLS certificate, projector, hosted Supabase CORS behavior from a non-localhost origin, or mobile `sessionStorage` discard behavior has been exercised.
* The simulated cloud is a model of reviewed behavior, not the hosted service.

## Explicitly not done / not approved

Real emails, hosted users or grants, new fixtures, hosted scores, publication, template or redirect changes, deployment, production `main` changes, merging PR #19, any tunnel or public hosting, any real FFTT3 data. The three hosted scoring fixtures remain consumed.

## Game-day staff authentication release requirement (decision October 23, 2026)

The organizer approved a **$0-budget release requirement**: game-day sign-in must be low-friction and resilient to email delay or link hand-off failure. The existing synthetic PKCE Magic-Link flow remains valid **development evidence only**, not the required game-day experience.

- **Anonymous spectator view:** no registration/login, no routine Auth email; show only organizer-approved public fields.
- **Staff:** individual, pre-provisioned authorized organizer/scorekeeper identities. Evaluate email/password entry (preferred for routine live use without an inbox dependency), and optional six-digit emailed OTP as recovery/alternative. Subject any implementation to appropriate brute-force, credential recovery, privacy, session and security review. No hosted Auth configuration change is authorized by this decision.
- **Session lifecycle:** implement secure renewal/refresh for a tournament-length session, explicit expiry/sign-out, identity and current event-role verification, revocation, and mobile background/resume behavior without unsafe token persistence. Preserve fail-closed private views.
- **Pre-event operational test:** verify real phone/tablet/browser behavior, email deliverability and rate limits, recovery, role denials, stale views, and a full fictional event before production. Target **zero routine login emails during active play**; this is an operational target, not a guarantee.
- **Economics and boundaries:** use free services only unless a separate future decision changes that. Staging hosting, exposed-origin allowlists, Auth emails, accounts/grants, new fixtures, scoring/publication, migration of real players and production release all require their own approvals. Three existing hosted score fixtures stay consumed; draft PR #19 remains unmerged.
- **Implementation status:** **not implemented, not tested, not released**. The existing Tailscale-first private-hosting runbook is historical/provisional; evaluating public HTTPS staging is a separate deployment decision, not yet an authorized change.
- **Update October 23, 2026:** a **synthetic-only local candidate** now implements the password sign-in, session lifecycle, optional six-digit code, narrow staging/production origin profiles and a sanitized staging export, tested against simulated infrastructure and intercepted Chromium only. It is **not enabled on the hosted project, not deployed, not released**, and every hosted step remains unapproved. See the [authentication design](MILESTONE1_STAFF_PASSWORD_AUTH_2026-10-23.md) and the [hosting assessment and staging plan](MILESTONE1_STAGING_HOSTING_2026-10-23.md).

## Next steps

See the [physical-device runbook](MILESTONE1_PHYSICAL_DEVICE_RUNBOOK_2026-10-21.md) for the approvals, exact order, stop conditions and cleanup.
