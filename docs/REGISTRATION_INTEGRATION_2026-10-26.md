# Registration integration — contract, adapter and connection requirements (October 26, 2026)

> **Superseded in part on October 27, 2026.** The deployment-wide single sheet (`REGISTRATION_SHEET_ID` / `REGISTRATION_SHEET_RANGE`, `REGISTRATION_SOURCE=google-sheets`) described in section 3 no longer exists: each event now has its own saved source, chosen in the app, and the Function settings changed. See [REGISTRATION_SETTINGS_2026-10-27.md](REGISTRATION_SETTINGS_2026-10-27.md). The privacy contract and the registration model described here still apply.

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
* **Suggested level (corrected October 26 against the approved form):** the model matches the approved FFTT3 Google Form's answer choices **exactly** and in order — frequency (Several times a week … Never), league/club/school-team experience (No / Yes, a little / Yes, quite a bit), rally consistency (six descriptive sentences from "Haven't played…" through "I can sustain strong rallies consistently, including under pressure"), spin (No … Yes, confidently), attacking easier balls (No … Yes, confidently) and the five playing profiles. The **explicit profile label** (Beginner / Recreational / Intermediate / Strong Intermediate / Advanced / Competitive) is read from the start of the answer and is never overridden by words inside the description (for example "control" in the Beginner text). Self-assessment is **one input, not a verdict** (see `knowledge/PLAYER_RATING_SYSTEM.md`; FFTT2 showed some self-described Beginners were materially stronger than others): every answered question points part-way up the Level 1–5 scale and the weighted average gives the level. The chosen profile carries the largest single weight but **does not cap or floor the result**: when rally consistency, spin, attacking, how often they play and organized experience agree with each other they can lift or lower the suggestion by more than one level. **Unanswered questions count for nothing.** Guard rails: an **automatic Level 5 needs competitive evidence** (quite a bit of league/club/school-team experience, or the Advanced profile with some) — otherwise the suggestion is Level 4 and the reason notes that the organizer can confirm Level 5 after seeing play; and when the answers contradict the profile by **two levels or more**, confidence drops (medium at two, low at three) and the registrant is flagged **"Organizer review"** (reason text, a warning on the row, and the "Needs a look" filter). Suggestions are always **provisional**; the roster shows "Suggested" until the organizer confirms or changes the level. Older Yes/Sometimes/No wording from other forms is still understood.
* **Header mapping** is pattern-based and now **verified against the approved form's 12 columns** (`Timestamp`, `Full Name`, `Email Address`, `Phone Number`, `Age Group`, previous-event participation, frequency, experience, rally consistency, spin, attack, playing profile): nine map to fields; Age Group and previous participation are deliberately not rating inputs. The test fixture uses exactly this layout with fictional answers (no real row was read). Re-check the mapping only if the form is edited.

## 3. Privacy and safety properties (each has a test)

Organizer only (scorekeeper, outsider, revoked organizer, anonymous, signed-out session, other event: refused) · read-only (the only upstream calls are Google's token endpoint and one `values.get`) · fail closed (anything unconfigured answers one generic 503) · **the Google source refuses to run unless the event is explicitly allowlisted** (`REGISTRATION_EVENT_IDS`), so a fictional event can never pull a real sheet · same-origin only, no wildcard CORS, the spectator origin never answers · no contact column in the database, none in the audit log, the public view or the backups · no credential or Google endpoint in any browser file (scanned by tests and by the export builder) · rate-limited, short in-memory cache, no raw rows retained.

## 4. Private CSV fallback

Organizer chooses a CSV export of the sheet; it is parsed **in the browser's memory** by the same model code, produces the same masked list, is never uploaded or stored, and gives stable references per event (re-importing never double-checks someone in).

## 5. What remains to connect a REAL sheet (owner/authorization gates)

1. Separate authorization to use **real FFTT3 registrations**, and a production-grade plan: the current database is CHECK-constrained to synthetic events. Do **not** point staging at the real sheet.
2. A Google Cloud project with the Sheets API enabled and a **service account**; share the sheet with its address as **Viewer** only.
3. On the **staff** Pages project (secrets): `REGISTRATION_ENABLED=true`, `REGISTRATION_SOURCE=google-sheets`, `STAFF_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `REGISTRATION_EVENT_IDS` (the one real event), `REGISTRATION_REF_SECRET` (random, ≥32 characters), `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `REGISTRATION_SHEET_ID`, `REGISTRATION_SHEET_RANGE` (e.g. `Form Responses 1!A:Z`).
4. If the form's questions or choices are ever edited, re-run `node --test tests/registration_model.test.mjs` (it encodes the approved wording) and adjust the model first.
5. Never set these on the spectator project.
For a demo on staging use `REGISTRATION_SOURCE=synthetic-fixture` (fictional people, no Google involved).
