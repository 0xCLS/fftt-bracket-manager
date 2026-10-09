# Phase 1C C3 — Supabase read-only protocol adapter (synthetic development, draft)

**Status (October 9, 2026):** This is a **draft, injectable HTTPS read transport** and **22 mock-HTTP protocol tests**. It is NOT loaded by the live `index.html`, is not merged to `main`, does not have or store organizer credentials, and does not submit tournament data. It can make real **read-only** Supabase requests only if a future separately constructed test harness passes `fetch`, the project's public publishable key, and a currently authenticated **individual** JWT callback. GitHub CI injects *only fake* HTTP responses; CI does not contact Supabase.

## Canonical backend evidence (read-only SQL inspection)

Queried the exact isolated Supabase development project `copmkalfkkrkzheohwuc` before implementing the adapter:

- `public.fftt_staff_role_v1(p_event_id uuid) returns text` — **POST**, read/authorization RPC. Exact roles accepted: `organizer`, `scorekeeper`; others denied by backend.
- `public.fftt_matchdesk_v1(p_event_id uuid) returns TABLE(...)` — **POST**, event-scoped *read* RPC. Exactly 14 allowlisted fields: `event_id, bracket_generation, match_id, match_code, match_version, bracket, round_number, slot, player_1_id, player_2_id, player_1_name, player_2_name, is_championship_final, table_number`. No staff contact, ratings or attendee sign-up data.
- `public.fftt_public_results_v1` — anonymous **GET**, fields `event_id,event_name,event_date,status,brackets,updated_at`. SQL view builds `brackets: [{name, matches}]` from **only** `fftt_published_matches`. These projection sources currently contain no published event rows.
- `public.fftt_published_events` — anonymous **GET**, fields `event_id,event_name,event_date,status,updated_at`.
- `public.fftt_published_matches` — anonymous **GET**, fields `event_id,match_id,bracket,round,slot,player_1_name,player_2_name,winner_name,game_scores,status`. Its **public `match_id` column is TEXT** representing a presentation label (e.g., `C-0-0`), **not** the private match UUID.

Actual hosted JWT/role security has already been validated separately in B2h and the one synthetic concurrent score submission has been verified in B2i. That B2i match is now **complete and must not be reset/replayed**.

## Code and guardrails

`contracts/phase1c_c3_readonly_supabase_transport.mjs` exports `createC3ReadOnlySupabaseTransport` and pins the HTTPS host to the *one isolated development project*. It accepts **only** a modern public `sb_publishable_` key, an injected function to retrieve a signed user-session token for staff reads, and an injected fetch function. There are **no built-in Auth admin APIs, password handlers, service-role keys, JWT persistence, browser global fetch, hidden redirects, retries, or dynamic arbitrary paths**.

| Adapter method | HTTP request | Authorization and output |
| --- | --- | --- |
| `readStaffRole({eventId})` | POST `/rest/v1/rpc/fftt_staff_role_v1` | Requires individual signed JWT; only returns exact organizer/scorekeeper role |
| `readMatchdesk({eventId})` | POST `/rest/v1/rpc/fftt_matchdesk_v1` | Requires individual signed JWT; strict 14-field private matchdesk allowlist |
| `readPublicResults()` | GET `/rest/v1/fftt_public_results_v1` | Public publishable key; strict nested bracket/public match field allowlist |
| `readPublicEvents()` | GET `/rest/v1/fftt_published_events` | Public publishable key; strict published event fields |
| `readPublicMatches()` | GET `/rest/v1/fftt_published_matches` | Public publishable key; strict presentation fields, including **TEXT match ID** |
| `submitScore()` | **No request; always throws** | A C3 transport cannot mutate a match, even if injected into C2 |
| `fetchAuthoritativeSnapshot()` | **No request; always throws** | Current backend exposes no dedicated trusted event-revision/receipt snapshot needed for C1 reconnect clearance |

Staff RPCs use POST **only because that's how PostgREST invokes these particular read-only RPCs**; this is not permission to send a score or staff-mutation POST. Every route/column/header/method is fixed. The network-facing response validator refuses unknown private fields, malformed data, cross-event matchdesk results, invalid versions, overlarge arrays, unexpected nested keys and non-200 responses. It returns no raw backend error bodies and never logs or persists the signed token.

**Authorization is enforced by hosted Auth, PostgreSQL/RLS and the RPC**, not by the front-end field validator. The transport's JWT shape check cannot cryptographically validate a token. Only the real Supabase Auth service can verify it. This adapter is an additional least-privilege presentation boundary, not a replacement for backend permission checks.

## Verification and limits

`tests/phase1c_c3_readonly_transport.test.mjs` has **22** Node mock-HTTP cases covering host/key pinning, per-event signed reads, forbidden fields, anonymous public projections, public TEXT match labels, HTTP 403/429/500, network loss and missing JSON, no access without a JWT, no score/retry endpoint and denied authoritative snapshot. One test injects C3 into the earlier C2 controller and proves that C2's attempt to submit a score can only pause as **uncertain**—the transport never issues a score HTTP request. CI uses only mocked responses, no privileged keys or live Supabase traffic. Run locally:

```sh
node --check contracts/phase1c_c3_readonly_supabase_transport.mjs
node --test tests/phase1c_c3_readonly_transport.test.mjs
```

**Not yet complete:** real authenticated hosted C3 `fetch` calls, a trusted read-only event snapshot/receipt status service, C2 cloud-resume after disconnect, production-grade login/recovery, actual browser UI and multi-device synchronization, byes/corrections, public publication/consent, or rollout.

## Next safe implementation action

On a new draft branch, build an **isolated synthetic browser harness** that uses mock HTTP transport, not the live `index.html`, to show organizer/scorekeeper/spectator read-only screens and clear offline/stale/reconciliation status. Before enabling a genuine signed hosted browser read, verify its Auth session handling without putting any admin/secret key in browser code. Before enabling a hosted score, staff change, real data import or production publication, obtain separate explicit organizer approval. The C3 adapter itself cannot authorize such changes.
