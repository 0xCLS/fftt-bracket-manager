# Registration integration — contract, adapter and connection requirements (October 26, 2026)

_Scope: the organizer's existing **private** Google Sheet of sign-up responses → an organizer-only, read-only list inside the staff app, with one-click check-in. **Live synchronization is not claimed**: the adapter is implemented and tested against a mocked Google; connecting a real sheet is an owner step below. No real FFTT3 participant record was retrieved, copied or imported._

## 1. Design in one paragraph

The browser never talks to Google and never holds a credential. The staff page calls its **own origin** (`POST /api/registrations`) with the signed-in person's access token and the event id. A server function checks, against the Supabase project and with the caller's **own** token, that the session is still valid **and** that the database reports the caller's *current* role for that event as `organizer`; then it reads one range of the sheet with a **read-only service account** and returns an allowlisted, masked list. Check-in then goes through audited database RPCs that accept names and opaque references only.

```
staff page ──token+event──▶ /api/registrations (Pages Function)
                              ├─▶ Supabase /auth/v1/user         (session still valid, not anonymous)
                              ├─▶ Supabase fftt_staff_role_v1    (organizer of THIS event, now)
                              └─▶ Google Sheets values.get       (spreadsheets.readonly, one range)
staff page ◀── {registrants[], duplicates[], summary} (no contact data) ──┘
staff page ──names + opaque refs──▶ fftt_checkin_registrants_v4 (organizer-only RPC, audited)
```

## 2. Integration contract (`contracts/registration_model.mjs`)

Response: `{source: 'google-sheets'|'synthetic-fixture'|'csv-import', fetchedAt, registrants[], duplicates[], summary, warnings[]}`. Each registrant is rebuilt from an **allowlist** — `ref` (opaque HMAC), `name`, `shortName`, `registeredAt` (a plain date/time shape only), `suggestedRating` (1–5), `ratingConfidence`, `ratingBasis[]` (plain-language reasons), `nameIssue`, `hint` (masked, e.g. `a•••@e•••.org`, `•••• 42`), `duplicate` (group, reasons, strength). The browser validates the same contract and discards the whole answer if anything else appears. Free-text answers, full e-mail addresses and phone numbers are never forwarded; a phone number or e-mail typed into a *name* box is stripped and flagged.

* **Duplicates:** same e-mail, same phone, same name, similar name (edit distance 1, or same first name + initial). Computed server-side from the hidden values, reported only as reasons. The organizer merges ("same person", all references link to one player) or dismisses.
* **Suggested level:** transparent heuristic over the inputs named in the private rating guide (how often they play; club/league/school/tournament experience; sustaining rallies; intentional spin; attacking easy balls; a short description; the old self-label as one weak input). It never exceeds Level 4 without demonstrated organized play, and it is always **provisional**: the roster shows "Suggested" until the organizer confirms or changes it.
* **Header mapping** is pattern-based and tolerant (`Timestamp`, `Full name` or `First/Last name`, `Email`, `Phone`, and the question columns). **The real form's headings were not read**; confirm the mapping against the real sheet before relying on it.

## 3. Privacy and safety properties (each has a test)

Organizer only (scorekeeper, outsider, revoked organizer, anonymous, signed-out session, other event: refused) · read-only (the only upstream calls are Google's token endpoint and one `values.get`) · fail closed (anything unconfigured answers one generic 503) · **the Google source refuses to run unless the event is explicitly allowlisted** (`REGISTRATION_EVENT_IDS`), so a fictional event can never pull a real sheet · same-origin only, no wildcard CORS, the spectator origin never answers · no contact column in the database, none in the audit log, the public view or the backups · no credential or Google endpoint in any browser file (scanned by tests and by the export builder) · rate-limited, short in-memory cache, no raw rows retained.

## 4. Private CSV fallback

Organizer chooses a CSV export of the sheet; it is parsed **in the browser's memory** by the same model code, produces the same masked list, is never uploaded or stored, and gives stable references per event (re-importing never double-checks someone in).

## 5. What remains to connect a REAL sheet (owner/authorization gates)

1. Separate authorization to use **real FFTT3 registrations**, and a production-grade plan: the current database is CHECK-constrained to synthetic events. Do **not** point staging at the real sheet.
2. A Google Cloud project with the Sheets API enabled and a **service account**; share the sheet with its address as **Viewer** only.
3. On the **staff** Pages project (secrets): `REGISTRATION_ENABLED=true`, `REGISTRATION_SOURCE=google-sheets`, `STAFF_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `REGISTRATION_EVENT_IDS` (the one real event), `REGISTRATION_REF_SECRET` (random, ≥32 characters), `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `REGISTRATION_SHEET_ID`, `REGISTRATION_SHEET_RANGE` (e.g. `Form Responses 1!A:Z`).
4. Confirm the header mapping and the level heuristic with the organizer on a few **fictional** rows laid out like the real form.
5. Never set these on the spectator project.
For a demo on staging use `REGISTRATION_SOURCE=synthetic-fixture` (fictional people, no Google involved).
