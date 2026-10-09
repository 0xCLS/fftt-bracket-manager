# Phase 1C C1 — Offline authority, pause and organizer reconciliation (reference only)

**Status (October 9, 2026):** A provider-neutral **pure JavaScript reference state machine** and 19 no-network tests are staged on an **unmerged draft branch**. No application integration, Supabase migration, Auth change, event record/score write, published result, or production cutover is included. The completed B2i synthetic hosted match and its immutable audit stay untouched.

## Source and applicable decision

Use [Phase 1A shared event contract](PHASE1A_SHARED_EVENT_CONTRACT.md), [Phase 1 shared architecture](PHASE1_SHARED_EVENT_ARCHITECTURE.md) and Christopher's approved offline policy:

> On disconnection, pause cloud writes and retain a **controlled single-device fallback**. Returning online does **not** automatically upload or merge local scores.

This C1 implementation is the safety/state-transition **reference**, not the deployable adapter. The existing browser-local `index.html`, `fftt_bracket_manager_v01` localStorage, seven-screen accepted UI, Undo/JSON backups and GitHub Pages deployment are unchanged. Nothing can contact Supabase from the reference.

## Executable reference

Files: `contracts/phase1c_disconnect_reference.mjs` and `tests/phase1c_disconnect_reference.test.mjs`.

| State | Which authority? | Cloud score commands | Allowed exit |
| --- | --- | --- | --- |
| `cloud-ready` | Cloud server | May submit **one** versioned intent pending genuine acknowledgement | Network loss, server conflict/refetch |
| `cloud-paused` | Cloud (stale) | **Forbidden**; no offline queue | Network restored → verified server reload; or explicit organizer fallback |
| `cloud-reloading` | Cloud (stale) | **Forbidden**; no optimistic `saved` | Server event ID, revision, generation verified; ambiguous in-flight submission resolved |
| `single-device-fallback` | One isolated organizer device | **Forbidden**; no implicit local-to-cloud sync | Connectivity restored → organizer reconciliation |
| `organizer-reconciliation` | Isolated fallback remains authority | **Forbidden** | Explicit organizer audit of private backup/manual log, all edits and unresolved submissions; then still requires fresh server reload |

### Defenses coded and tested

- Event identity, authoritative version and bracket generation checks; no cross-event or regressed-version reads.
- A single cloud request is pending at a time, and the UI may claim successful persistence **only after a real accepted server response with a higher revision**. A rejected request requires an authoritative reload. Client-generated requests are not server-trusted state.
- Network loss with an outstanding submission retains that submission's identity as **unresolved**; cloud reload cannot clear it without a server-confirmed outcome. No background retries, duplicate score queue, silent optimistic save or replay.
- Realtime revision notification alone never mutates authoritative state: mark cached data stale and refetch.
- Isolated fallback may begin **only while cloud is paused**, with organizer approval, acknowledgement that other devices have stopped scoring, correct event and backup metadata, private backup protection, and manual/paper result-log readiness. An unresolved previous write must be documented rather than guessed.
- Fallback changes increment only an **isolated manual-log count** in this reference. It does not hold player names, ratings, contact info, raw scores or cloud writes. The actual manual evidence remains private and offline.
- On restoration the model enters reconciliation; no upload, import or merge API exists. To return to cloud mode the organizer must affirm review of private backup, entire manual log, every fallback edit and uncertain prior cloud receipt against a non-regressed server state. A separate verified server snapshot is then still required before cloud writes can resume.
- `canSendCloudIntent` remains false in every paused, stale, pending, unresolved, fallback and reconciliation state.

**Human safeguards cannot be automated by this reference:** the organizer must actually direct other devices to stop; prevent a second organizer from entering fallback; protect the manual record and JSON backup; obtain a reliable server-side receipt audit; and resolve conflicts. Booleans acknowledging these actions **do not prove** they happened. Real cloud/fallback orchestration, trusted session freshness and storage isolation need integration/instrumentation testing later.

## How to run the isolated tests

```sh
node --check contracts/phase1c_disconnect_reference.mjs
node --test tests/phase1c_disconnect_reference.test.mjs
```

The tests are deterministic; they use only built-in Node test/assert/fs to inspect source and run pure transitions. They never open a socket, invoke Supabase, access filesystem backups, mutate actual match records or alter `index.html`. The GitHub Actions workflow `.github/workflows/phase1c-offline-authority.yml` runs these on Node 22 without project credentials. CI success is **not** proof of actual offline mode in the deployed app.

## Next integration and approval gates

1. Introduce a selectable shared-state adapter **on an isolated draft branch**, without replacing the browser-local adapter, current UI/storage key or moving any real registration/FFTT3 player data. Establish test-only browser sessions, stale/paused indicators and versioned read commands. A proposed shared adapter must never send the event's old local JSON wholesale to Supabase.
2. Exercise at least two synthetic volunteer clients plus an organizer and spectator, including one device network loss during score submission, revocation during an in-flight command, reconnect/read-your-write and controlled fallback.
3. Build a **separately audited reconciliation workflow** with real receipt checks before restoring cloud authority; never auto-import the local backup.
4. Retain the exact completed B2i rehearsal and its immutable score history. Any hosted new synthetic fixture, correction, extra retry/revocation operation or production deployment requires separate express organizer approval.
5. Volunteer-owned login/invitations, private backup/security/restore, fully bracketed consolation/byes, public result publication policy, production provider/cutover and event-day device handoff are still pending.

**Do not overclaim:** C1 establishes an independently testable contract for a future client integration. No actual app/cloud connection, offline browser fallback or physical multi-device behavior is delivered by C1.
