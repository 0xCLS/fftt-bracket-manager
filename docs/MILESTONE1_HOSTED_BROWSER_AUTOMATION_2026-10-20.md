# Milestone 1 — One-command guarded hosted browser acceptance runner

**FINAL ACCEPTANCE STATUS — PASS / FIXTURE #3 PERMANENTLY CONSUMED (October 20, 2026). DO NOT RUN THIS EXECUTION COMMAND AGAIN.** The historical one-time operator recipe below is retained solely for test provenance. Never delete the private local incident marker, attempt a second score POST, generate a replacement hosted scoring fixture, or reset any of the three completed synthetic fixtures. This changes no production behavior.

## Verified operator result and independent read-only hosted postflight

The organizer completed the exact one-time guarded browser run and provided sanitized terminal output (no secrets or private UUIDs). It established **four distinct existing Supabase Auth identities**, independent signed Scorekeeper A/B browser profiles, both prepared score intents, a file permission **0600** incident log before the score attempts, and **exactly one browser-origin signed score POST per actor**. **Scorekeeper A: accepted; Scorekeeper B: rejected**. Both returned to fresh browser tabs to perform actor-owned decision recovery, with persistent one-attempt browser markers and no recovery score POSTs. Foreign-owner and outsider receipt reads were denied, and the runner independently confirmed no spectator publication.

A *separate* Supabase **read-only** audit after the user's run verified:
- One precise fictional 2099-11-23 event, **active / bracket generation 1 / event revision 1**.
- One `C-0-0` match: database status `complete`, match version **1**, winner recorded, no pending match.
- **Two** durable V2 decisions: **one accepted** and **one rejected** with exact reason `stale-match-version`; **one** accepted result submission/receipt.
- Three total synthetic test events and matches, with **four** total V2 decisions and **three** accepted result submission rows (older two fixtures unchanged).
- Four unchanged Auth identities and nine total staff grants; **zero** published event rows and **zero** published match rows.

**Scope conclusion:** Hosted synthetic browser scoring/concurrency and tab-loss own-receipt recovery acceptance is **PASSED** for the developer fixture. It does **not** establish ordinary volunteer inbox login, production-grade Auth PKCE, synchronization on two actual physical devices, public spectator/TV live updates, offline fallback or readiness for a real FFTT event. PR #19 remains **draft**; production `main/index.html` stays byte-identical. The incident file on the user's Mac is private, must not be uploaded, and must not be deleted to bypass the safety lock.

_Date: October 20, 2026 · replacement for the labor-intensive manual C8 two-inbox exercise._

## Scope and operator safety

The user approved **automating**, rather than repeating, the signed two-scorekeeper synthetic browser acceptance exercise. This does **not** authorize new fixtures, new scores beyond the original two one-time browser attempts, real FFTT3 data, broader database edits, public publication or production deployment.

This runner is **not a mock**: `tests/milestone1_hosted_browser_once.py` uses existing preverified synthetic Auth identities, the test-only Supabase development project, real Auth-issued JWTs and **two truly separate Chromium browser contexts** to load the actual C8 web app. Unlike the earlier manually accessed profiles, it automates submitting both conflicting fictional scores and independently reading each scorekeeper's own receipt, including after a tab is closed and reopened. It never generates a new Auth user, asks for Yahoo inbox access, creates a database event or changes any staff role.

The one-time test was pinned to precisely the *then-pending, now permanently consumed* **2099-11-23** fixture by SHA-256 event and match fingerprints. The two older completed hosted fixtures are excluded. Before scoring, the runner checks the expected four-account inventory, staff roles, outsider denial, exactly one match version 0, event revision 0, fictional participants and no public publication.

## Historical operator instructions on a trusted Mac — already executed, DO NOT repeat

Update the previously reviewed integration checkout:

```bash
cd ~/Downloads/FFTT_Milestone1_V2
git pull --ff-only
python3 tests/milestone1_hosted_browser_once.py
```

The default command is **DRY RUN**: it makes **no** Auth or Supabase calls, starts no scoring and writes no file.

The following one-time execution command **was already used** and is retained only as historical evidence. **Never invoke it again:**

```bash
python3 tests/milestone1_hosted_browser_once.py --execute-approved-browser-fixture
```

The operator supplies **privately in Terminal** the previously saved new fixture event and match UUIDs, the existing organizer synthetic email, the exact confirmation phrase shown on-screen, and the existing project **`sb_secret_`** test key (hidden input). No private value should be sent to ChatGPT, GitHub, CLI command arguments, screenshots, or CI. Playwright Chromium must be installed on the trusted Mac: `python3 -m pip install playwright` and `python3 -m playwright install chromium` if necessary, before the guarded execution.

The script starts its own random-port loopback server, so the old C8 `localhost:3000` server does not need to be opened or running. It never sends out Magic Link email: it generates/redeems existing-account one-time Auth sessions through the already tested local admin helper. That validates actual account Auth, **not** ordinary volunteer inbox login.

The runner stages both fictional scores **in the real C8 browser UI** before sending either. Immediately before the irreversible score POSTs it atomically creates:

`~/.fftt_m1_hosted_browser_once_52c86dee4d72893b.json`

File permissions are **0600** and it contains only the two private fictional *submission IDs* needed for manual crash recovery and a one-way fixture hash, never Auth tokens, user emails, secret keys, event or match UUIDs. Do not publish or delete this incident record. If the marker exists from an earlier attempt the runner **refuses to resend**. On HTTP errors, lost responses or partial results, **STOP**, never rerun, and investigate signed receipts and Supabase read-only. The backend remains the ultimate match-concurrency authority.

On completion the runner asserts exactly **one signed score POST per browser**, one accepted and one stale rejected result, browser tab-loss own-receipt reads using the original actor's JWT, cross-actor decision denial, outsider denial and no public spectator publication. Report only sanitized `PASS`/`RESULT`/`STOP` lines; do not copy private IDs or keys.

## Verified consolidated regression and hosted fixture state

[GitHub Actions run #39445817756](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/39445817756) **PASS on the first run after one test-assertion correction**, executable commit `d1dce18f874e3fe04d12bd398be3a1e25f391a35`: **190/190** JavaScript, **5/5** new operator-safety unittest checks, mock-backed real Chromium dual-scorekeeper/lost-ACK/stale-decision/tab-recovery/outsider checks, **81/81** baseline PostgreSQL assertions, local GoTrue signed score race, original UI/tournament suites. All external hosted requests in Chromium mocks were intercepted.

**Historical pre-execution checkpoint:** An independent read-only Supabase audit immediately after CI had confirmed event revision 0, one pending version-0 match and zero new fixture decisions/receipts. **This pre-execution state has been superseded by the completed/consumed acceptance result documented at the beginning of this file.** Production `main/index.html` remains byte-identical.

## Test harness, what it proves and what remains

- `tests/test_milestone1_hosted_browser_once.py`: no-network safety tests for default dry-run, hard fixture pin and *exclusive* permission-restricted incident marker.
- `tests/milestone1_hosted_browser_mock.py`: independent test-only Chromium rehearsal of the actual C8 webpage with all Supabase calls intercepted, two signed fictional browser contexts, committed-but-lost first ACK, durable stale second decision, read-only receipt recovery across tabs and outsider denial. **Zero hosted score POSTs**.
- Existing local disposable PostgreSQL/GoTrue concurrency suite and public UI/tournament tests remain in the same consolidated CI.

**Limits:** The automated browser rehearsal is not proof that two separate physical phones, production-ready email authentication, broadcast/TV synchronization or physically supervised offline fallback work. Automated existing-account Magic Link issuance should not be used for real volunteers. Do not merge draft PR #19 or cut over production on the strength of this isolated synthetic result alone. The required independent **read-only hosted database audit** was completed and confirmed Fixture #3 permanently consumed.
