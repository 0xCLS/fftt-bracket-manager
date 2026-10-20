# Milestone 1 — Approved Hosted Browser Score & Recovery Rehearsal

_Date: October 19, 2026 · strictly synthetic hosted development test only._

## Authorization and isolated database fixture

Christopher explicitly approved a **new limited hosted browser-scoring and recovery rehearsal** after Milestone 1 local synthetic browser + server test gates passed. Scope: the existing `fftt-bracket-manager-dev` Supabase project only; **never** production FFTT3 data, publication, staff identity creation, old B2i/V2 fixtures, or production `main/index.html`.

Preflight verified two existing consumed fictional events (each one match), two durable V2 decisions, two accepted historic receipts, four Auth accounts, six existing event-scoped staff grants, zero public projection rows. The authorized operation created exactly **one new** 2099-11-23 fictional active event:

- Event: `FFTT Milestone 1 Hosted Browser Score & Recovery — 2099`.
- Two new synthetic players (`Synthetic Browser Alpha`, `Synthetic Browser Beta`), one pending `C-0-0` championship final, match version 0, bracket generation 1, event revision 0.
- Exactly three new-event-only grants copied from the previously established fictional organizer and two scorekeepers; no original grant was updated, and no Auth accounts were created.
- Both public projection tables still empty. Prior two test fixtures' results/receipts/audits were preserved.
- The event UUID and match UUID remain **private**; their SHA-256 fingerprints only are pinned in `contracts/milestone1_hosted_fixture_transport.mjs`. The host scoring adapter rejects other event and match IDs, including consumed fixtures.

## Connected browser implementation

- `rehearsals/c8/index.html` retains its established **existing individual Magic Link** login at `http://localhost:3000/rehearsals/c8/index.html`. A new isolated **Approved Hosted Browser Scoring · Synthetic Fixture #3** section is shown only after signed account verification.
- `rehearsals/c8/hosted-score.mjs` binds that signed session to the **specifically pinned new event and match**, checks the authenticated **scorekeeper** role, requires exactly one pending match at version 0, then checks both event revision reads. Organizer can inspect but **cannot** submit through this rehearsal UI.
- The scorekeeper selects one of the two *fictional* players, prepares the score, and **records a unique private submission ID and score outside the browser BEFORE the one-time send**. The score button requires the explicit checked human confirmation.
- `contracts/milestone1_hosted_fixture_transport.mjs` enforces the fixed Supabase development URL, public `sb_publishable_` key, signed user JWT, strict single event/match SHA-256 pins, expected version/generation 0/1, and only these two server RPC endpoints: `fftt_submit_match_result_v2` and caller-owned `fftt_score_decision_snapshot_v2`. No role or publication endpoint exists on this score transport. It makes **at most one hosted score attempt per browser profile**; a non-secret `localStorage` marker is saved **before** the irreversible score POST, persists after a reload, and never contains account tokens, emails, scores, or event IDs. This is an operator safety mechanism; the authoritative server still enforces score authorization and match concurrency.
- An HTTP 200 ACK is only provisional. The operator uses a **separate signed own-decision read** to verify committed accepted or stale-rejected results. A lost response, expired session, missing decision, mismatch or browser crash is **UNKNOWN** until inspected; it must never trigger automatic retry. A scorekeeper can sign in again and manually enter their saved submission ID to recover **their own** decision even after tab loss. An absent decision is not evidence of rejection.
- The existing C8 staff reader and public results projection remain read-only; the production application `main/index.html` is untouched. No real FFTT3 names or registration records are used.

## Private operator steps — NOT yet executed

1. On the trusted Mac, open the development Supabase SQL Editor. Run this **read-only** query. Copy the two UUIDs privately to a secure note; do **not** paste them in ChatGPT or GitHub:
   ```sql
   SELECT e.id AS new_private_event_uuid, m.id AS new_pending_match_uuid
   FROM fftt_private.events e
   JOIN fftt_private.matches m ON m.event_id=e.id
   WHERE e.synthetic_only IS TRUE
     AND e.event_date='2099-11-23'
     AND e.event_name='FFTT Milestone 1 Hosted Browser Score & Recovery — 2099'
     AND m.match_code='C-0-0' AND m.status='pending'
     AND m.match_version=0;
   ```
   Exactly one row must appear; otherwise **STOP**.
2. Update the existing trusted checkout:
   ```bash
   cd ~/Downloads/FFTT_Milestone1_V2
   git pull --ff-only
   python3 tools/c8/local_readonly_server.py
   ```
   Open `http://localhost:3000/rehearsals/c8/index.html` in a trusted browser. **Do not open the historical B2i launcher.** Do not share Magic Links, tokens, UUIDs, API keys, or screenshots showing private data.
3. In a browser profile signed in as **SCOREKEEPER A's existing synthetic account**, enter the private **new event ID**, then choose **Verify fresh hosted scorekeeper desk**. It must show exactly one pending fictional `C-0-0` at revision 0. Prepare the score, copy the private generated submission ID and score to your secure note, and check the confirmation box. **Do not press the irreversible Send button until ready for the approved race.**
4. Sign in separately as **SCOREKEEPER B** in an **independent browser profile/device** following the same existing-user Magic Link flow. Repeat the fresh-read, prepare and private-ID recording steps, also **without sending yet**. The two browsers should each show the same original match/revision. Do not reuse one actor's session or receipt for the other.
5. Once both are ready, submit the competing fictional scores **once from each browser**. They need not be perfectly simultaneous for the stale-version test; the second must remain a prepared version-0 intent. **Never retry** any sent score. After either HTTP error/timeout, treat the result as unknown. Read the caller's own receipt using the saved private submission ID; the successful race should produce one accepted and one durable stale rejection.
6. If you lose a browser/tab after sending, return to the same C8 URL, authenticate with the **same** synthetic account and use **Own-decision recovery** by pasting that scorekeeper's saved private submission UUID (while the new event ID is present). Never resend. If a Magic Link request rate-limits, wait rather than retry.
7. Stop after exactly **two** attempted score submissions. Preserve the non-secret one-time markers in both browser profiles. Report **only safe status text**, never private UUIDs, login email addresses, tokens or full screenshots containing identifiers. The maintainer will separately verify the database, revision, decisions, audit, original fixtures and zero publication.

**Do not claim this hosted browser race completed until both actual browser submissions and an independent read-only Supabase audit pass.** Browser profiles simulate separate user sessions but do not establish real physical-device readiness, live automatic sync, organizer fallback operation, or production Auth UX. These remain Milestone 1 release gates.

## Testing and change limits

The new automated `tests/milestone1_hosted_fixture_transport.test.mjs` validates hard PIN denial without network, publishable-only key, exactly one signed V2 score POST, persistent one-attempt marker and same-user own-receipt lookup using **test-only simulated SHA-256 outputs**. The C8 browser regression asserts nonexistent/consumed test fixtures cannot prepare a hosted score. These tests never issue hosted requests. All normal tests and disposable local PostgreSQL/GoTrue checks run in existing consolidated CI.

The SQL fixture creation, existing v2 deployment and signed-role lookup are the **only** approved hosted modifications/reads preceding the user's intentional actual browser score submissions. Never reset/replay the earlier consumed B2i and V2 fixtures. No changes to Supabase Auth redirect, permissions, production infrastructure or real participants are authorized by this rehearsal.
