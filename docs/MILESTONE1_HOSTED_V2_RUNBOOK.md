# Milestone 1 — Approved hosted V2 synthetic integration (October 13, 2026)

## Explicit authorization and what was changed

Christopher approved a **one-time, synthetic-only hosted integration exercise** in the preexisting `fftt-bracket-manager-dev` Supabase project (`copmkalfkkrkzheohwuc`). No FFTT3 player data, real results, public publication or production GitHub Pages changes are authorized.

**Migration actually applied:** `20261013101523_milestone1_durable_scoring_v2_synthetic`. SQL exactly matches GitHub-reviewed source blob `af46f1d2cf7de1387086a6e2416f358a00e59b1a` in `supabase/proposals/MILESTONE1_DURABLE_SCORING_V2_DO_NOT_APPLY.sql`. The historical filename retains its original review-candidate provenance; this approval superseded the prior "do not apply" status **for this isolated dev project only**, NOT for production.

Read-only post-migration verification confirmed:
- Original synthetic event, match, accepted receipt (1), audit records (4) and old three staff-grant rows were unchanged.
- Private `score_decisions_v2` table exists, has RLS enabled, zero decisions initially and no direct `authenticated` table reads.
- `authenticated` can execute v2 score and own-decision snapshot RPCs, `anon` cannot.
- Legacy v1 score RPC execution is revoked from browser roles, atomically with the migration.
- Both public publication tables remain empty.

**Fresh hosted 2099 fixture CREATED:** `FFTT Milestone 1 V2 Hosted Synthetic Race — 2099`, date 2099-11-22. Exactly one new synthetic event, two fictional players, one active championship bracket and one pending C-0-0 final with match version 0, event revision 0, and no scores/decisions. Exactly three **new-event-only** organizer/scorekeeper staff rows were copied from the previously active synthetic test-staff identities; the three historical B2i staff-grant rows were never updated. No Auth user accounts or passwords were created or changed. The old B2i event and consumed match MUST NEVER be replayed, reset or edited.

**Fixture identification:** private UUIDs are intentionally omitted from public code, documentation, chat, screenshots and logs. The new event and match are hard-pinned **only by SHA-256 digests** inside `tests/milestone1_v2_hosted_once.py`; their unguessable raw identifiers must remain on the trusted Mac.

## Next authorized operation — exactly two irreversible signed V2 score POSTs

`tests/milestone1_v2_hosted_once.py` is the **new** one-time, Mac-local operator. **DO NOT RUN** the historical B2i launcher or old operator source. The new runner:
1. Defaults to dry-run, with no network or Auth session, unless the exact new execution flag is passed.
2. Requires the exact new event/match UUIDs, validated against pinned SHA-256 digests. This rejects the old B2i IDs.
3. Uses an organizer-entered hidden `sb_secret_` key **only in local process memory** to retrieve four previously established Auth users and issue individually verified short-lived JWT sessions. No users, passwords, roles or grants are created or modified.
4. Preflights organizer + two authorized scorekeeper roles, an outsider denial, one pending synthetic match, revision 0, and zero public results. Reads the newly deployed v2 snapshot before any score write.
5. After preflight, creates a mode-0600 **non-secret one-time attempt marker** in the Mac home directory before any scoring, preventing accidental rerun even after timeout.
6. Issues **exactly two simultaneous POSTs** to `fftt_submit_match_result_v2` using the existing two scorekeeper identities and incompatible valid fictional final scores. **No retry**, reset, correction or extra write.
7. Performs **read-only** `fftt_score_decision_snapshot_v2` requests to verify own accepted/rejected committed results, foreign-actor isolation, outsider denial and zero publication. The script prints only safe status counts/labels, never credentials, request bodies or private IDs.

### Operator instructions (trusted Mac; do not paste private data into this chat)

1. Open the existing Supabase project **SQL Editor** on the trusted Mac. Run this **read-only** query. Copy the two results locally; do not send them in ChatGPT or commit them to GitHub:

```sql
select e.id as new_event_uuid, m.id as new_pending_match_uuid
from fftt_private.events e
join fftt_private.matches m on m.event_id=e.id
where e.synthetic_only=true and e.event_date='2099-11-22'
  and e.event_name='FFTT Milestone 1 V2 Hosted Synthetic Race — 2099'
  and m.match_code='C-0-0' and m.status='pending'
  and m.match_version=0;
```

Exactly **one row** must appear. If none or multiple appear, STOP.

2. In a new folder (do not modify the previous B2i runner), get the exact current integration branch source:

```bash
cd ~/Downloads
git clone --branch integration/milestone1-secure-foundation --single-branch \
  https://github.com/0xCLS/fftt-bracket-manager.git FFTT_Milestone1_V2
cd FFTT_Milestone1_V2
python3 tests/milestone1_v2_hosted_once.py
```

The default command prints `DRY RUN` and sends no requests. If the folder already exists, do not blindly overwrite it.

3. When ready to consume the **new** fictional fixture exactly once:

```bash
python3 tests/milestone1_v2_hosted_once.py --execute-approved-v2-fixture
```

Enter only the requested private new event ID, private new match ID, existing synthetic organizer email, exact displayed approval phrase and **hidden local** Supabase development `sb_secret_` key. The test generates the signed sessions and runs the preflight before issuing the two score POSTs. Check that **no private input appears in any shared screenshot**.

4. Expected safe status: two HTTP 200 decisions (one `accepted`, one `rejected`), own-decision snapshots valid, no cross-actor reads, zero public results, and `HOSTED MILESTONE 1 V2 RACE AND OWN-DECISION RECOVERY READS: PASS`.

**On any unexpected denial, HTTP 429, timeout, disconnection, wrong count or missing response: STOP. Do not rerun even if only one result appears.** Report only the non-secret status lines to ChatGPT. Independently inspect the DB audit/decision counts before any further operation. The one-time marker must be kept.

## Post-race independent audit (read-only)

After the operator completes, the maintainer should use the connected Supabase project's **read-only SQL** to verify: one complete new match with version 1 and a matching winner, event revision 1, exactly one accepted v1 legacy submission receipt, one accepted audit, one first-loss consolation eligibility row, and **two v2 decisions (accepted and stale-rejected)**. Verify no old B2i data changes, no staff grants altered, zero public publications, and no unrelated event records.

Do not mark the hosted race complete before seeing the operator output AND this independent database audit. Even a hosted signed-HTTP race does not establish complete event-day browser scoring, production Auth UX, multi-device recovery/fallback, or approval to migrate FFTT3 data.

The application `main:index.html` and production GitHub Pages deployment remain unchanged. This is **only** Milestone 1 Secure Shared Foundation's approved synthetic hosted backend checkpoint.
