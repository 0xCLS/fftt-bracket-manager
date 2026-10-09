# Phase 1B B2f — Real anonymous HTTP API boundary (synthetic only)

**Scope:** An isolated, read-only **anonymous/public API** smoke test against the existing Supabase Free development project `fftt-bracket-manager-dev`, pinned to `https://copmkalfkkrkzheohwuc.supabase.co`. This does **not** require anyone's password and does **not** test signed organizer or scorekeeper access.

**Status:** Script and twelve no-network guard tests prepared in an unmerged draft feature branch. Live hosted HTTP outcomes must be recorded separately after the probe is actually executed; a passing unit test is **not** proof that hosted HTTP was exercised.

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

## Acceptance and next gates

- [ ] No-network guard suite and Python syntax pass in GitHub Actions.
- [ ] Run the exact live hosted HTTP probe once and record actual statuses, without echoing response bodies containing user data.
- [ ] Verify anonymous public view is accessible and empty, private query/schema blocked, and event remains unmodified.
- [ ] Verify Supabase Security Advisor and record outcomes in private project changelog.
- [ ] **Still pending:** genuine signed-in role/matchdesk verification for four controlled accounts, organizer RPC grant/revoke tests, remote multi-client scoring and fixture-based recovery, byes, corrections and publication.

**No frontend cutover:** `index.html`, `localStorage`, JSON backups, browser UI, actual FFTT3 registration and real participant records must remain unchanged.
