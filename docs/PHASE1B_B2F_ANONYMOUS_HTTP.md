# Phase 1B B2f — Real anonymous HTTP API boundary (synthetic only)

**Scope:** An isolated, read-only **anonymous/public API** smoke test against the existing Supabase Free development project `fftt-bracket-manager-dev`, pinned to `https://copmkalfkkrkzheohwuc.supabase.co`. This does **not** require anyone's password and does **not** test signed organizer or scorekeeper access.

**Status (October 9, 2026):** Script and twelve no-network guard tests prepared in unmerged draft PR #8; **all 12 local/CI guards passed**. A separate read-only *browser-driven* hosted HTTPS GET spot-check returned the expected statuses for **six** public projection/field/anonymous RPC checks; the seventh request rejected access to a nonexistent **public** staff table, but did not send the required `Accept-Profile: fftt_private` header, so the *private schema* boundary is **not yet proven by this HTTP run**. The stricter scripted seven-case probe with proper headers remains **not executed against hosted Supabase**. The browser spot-check used a public publishable key as a URL query parameter; the scripted probe instead sends the API key in an HTTP header. No real JWT sign-ins were attempted.

## Why this milestone is separate

Previous B2e checks verified actual *hosted database* SQL authorization using **injected simulated claims**, not signed JWTs. B2f verifies the Supabase HTTP/PostgREST **anonymous gateway** without credentials. It cannot substitute for GoTrue authentication, JWT verification, controlled staff grant/revoke, multi-device score races, bracket rebuild/bye/correction, or production deployment.

No new database event, staff grant, player, match, or published result is needed; the same existing **synthetic-only rehearsal event dated 2099-01-01** is used. Event UUID is retrieved privately from `0xCLS/forging-fellowship-table-tennis/maintenance/CHANGELOG.md`, not copied into public scripts/docs.

## Implemented tests

| HTTP request | Required outcome |
| --- | --- |
| Anonymous `GET /rest/v1/fftt_public_results_v1` with six allowed columns | `200` and empty list; no publication authorized |
| Anonymous `GET /rest/v1/fftt_published_events` | `200`, empty list |
| Anonymous `GET /rest/v1/fftt_published_matches` | `200`, empty list |
| Anonymous public results query `?select=email` | `400`, column not exposed |
| Anonymous GET to STABLE `fftt_staff_role_v1` RPC | Rejected HTTP 4xx |
| Anonymous GET to STABLE `fftt_matchdesk_v1` RPC | Rejected HTTP 4xx |
| Anonymous GET private `event_staff` via `Accept-Profile: fftt_private` | Rejected HTTP 4xx |

The standard Python probe **only makes GET requests** to a seven-path allowlist. It never sends an `Authorization` header, signed JWT, user password, project service-role/secret key, or browser cookies. It **cannot** call score or staff-write RPCs. No redirects are followed. HTTP 5xx/non-JSON/unexpected successful private access fails closed.

The probe requires an explicit live read-only flag, an exact pinned project URL, the project's modern **public** `sb_publishable_` key, and the existing private synthetic event UUID. It refuses other domains, malformed event UUIDs, privileged keys, and arbitrary endpoints. The empty-publication assertion deliberately fails if an unapproved publication appears.

## Run commands (operator-controlled; no passwords)

```sh
# In repository root. Get the public key from Supabase API Keys;
# obtain the existing synthetic event UUID from the private project log.
export FFTT_B2F_APPROVE_READ_ONLY_HOSTED=YES_READ_ONLY_SYNTHETIC_HTTP
export FFTT_B2F_PUBLISHABLE_KEY='sb_publishable_REPLACE_FROM_SUPABASE'
export FFTT_B2F_EVENT_ID='SYNTHETIC_EVENT_UUID_FROM_PRIVATE_PROJECT_LOG'
python3 tests/b2f_anonymous_http_probe.py
```

No environment variables are stored in GitHub or CI; these are local operator instructions. The `sb_publishable_` key is specifically designed for public clients; **never** use `sb_secret_`, service-role or legacy JWT keys. The UUID is an existing synthetic event identifier, not a real FFTT3 record.

For no-network static/functional tests:

```sh
python3 -m py_compile tests/b2f_anonymous_http_probe.py tests/test_b2f_anonymous_http_probe.py
python3 -m unittest discover -s tests -p test_b2f_anonymous_http_probe.py -v
```

## Observed browser-side hosted GET spot-check — October 9, 2026

Independent browser-driven testing against the exact Free development project performed seven **GET-only** requests using the project's modern **public** API key (passed as URL query parameter by that browser agent). The browser operator did **not** run the Python probe itself or submit an Authorization/JWT header.

| Browser request | Observed status | Interpretation |
| --- | --- | --- |
| Anonymous public results projection | 200, empty JSON array | PASS |
| Anonymous published events table | 200, empty JSON array | PASS |
| Anonymous published matches table | 200, empty JSON array | PASS |
| Anonymous result projection `select=email` | 400 (`42703`, missing column) | PASS: private field absent |
| Anonymous staff-role RPC | 403 (`42501`, function permission denied) | PASS |
| Anonymous matchdesk RPC | 403 (`42501`, function permission denied) | PASS |
| Anonymous public-schema `event_staff` lookup | HTTP 4xx (`PGRST205`, no `public.event_staff`) | **INCONCLUSIVE for private schema**: no `Accept-Profile: fftt_private` header was actually used |

Browser evidence: https://agent.tinyfish.ai/runs/366a05f1-deb4-4514-b6bd-05ab8e004b6a

**Important limitations:** Unlike the new Python probe, the browser used an `apikey` URL parameter instead of an HTTP request header, and it did not supply the private-schema header for the final test. Its sixth meaningful success only establishes the six explicitly observed HTTP boundaries above, not the full strict-script B2f suite. Do not claim the private-schema HTTP test passed or that genuine user login/JWT rights have been exercised. The hosted database-side private table grants were separately checked in B2e.

## Acceptance and next gates

- [x] Twelve no-network unit guards and Python syntax passed in the B2f GitHub Actions workflow.
- [x] Browser-driven HTTP GET spot-check: six supported checks passed; seventh private-schema check **inconclusive** due to missing header.
- [ ] Run the **exact** strict live Python probe with header-based authentication and `Accept-Profile: fftt_private`, then record real statuses. Do not confuse browser results with probe execution.
- [ ] Verify anonymous public view is accessible and empty, private query/schema blocked, and event remains unmodified.
- [ ] Verify Supabase Security Advisor and record outcomes in private project changelog.
- [ ] **Still pending:** genuine signed-in role/matchdesk verification for four controlled accounts, organizer RPC grant/revoke tests, remote multi-client scoring and fixture-based recovery, byes, corrections and publication.

**No frontend cutover:** `index.html`, `localStorage`, JSON backups, browser UI, actual FFTT3 registration and real participant records must remain unchanged.
