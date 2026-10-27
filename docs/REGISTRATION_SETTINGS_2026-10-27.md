# Event-specific registration sources and the UI/UX polish pass (October 27, 2026)

_Status as of October 27: implemented and deployed on synthetic staging; PR #19 remains open/draft/unmerged. Christopher's authenticated **read-only actual Google Sheets diagnostic passed**. Live Google registration **loading/import remains disabled** and requires an isolated real-event environment. See section 7._

## 1. Why registrations did not load (root cause)

The deployed staff Function reported "The registration sheet could not be read right now" even though staging was set to the fictional fixture. Reproduced locally in the same runtime Cloudflare uses (`workerd`):

* The Function's first call is to Supabase (`/auth/v1/user`) to check the caller. That call passed `redirect: 'error'` and `cache: 'no-store'`. **Cloudflare Workers reject both options** ("`redirect: error` won't be implemented…", "the `cache` field is not implemented"), so the `fetch` threw before leaving the Function.
* The Function treats any thrown upstream call as "service unavailable" (fail closed), so *every* request ended as `503`, whatever the configuration, and the UI said "temporarily unavailable". Mocked unit tests could not see this because Node's `fetch` accepts both options.

Fix and prevention:

* `server/registration/edge_fetch.mjs` is now the only way server code makes an outbound request. It passes only options workerd accepts, never follows redirects (`manual`), and enforces **controlled egress**: https only, no credentials or port in the URL, and a fixed host list (the pinned Supabase project, Google's token endpoint, the Sheets API).
* Every test double for the adapter now **throws exactly as workerd does** on those two options (`tests/registration_handler.test.mjs`, `tests/e2e/browser_world.mjs`, `tests/e2e/fake_google.mjs`), so the same defect can never pass tests again.
* Probing the deployed Function with an invalid token now returns the honest `401 access-rejected` instead of `503`.

## 2. Architecture: one registration source per event

| Layer | What it does |
| --- | --- |
| Database (`supabase/proposals/GAMEDAY_TOURNAMENT_V5_STAGING.sql`, additive) | `fftt_private.registration_sources`: one row per event — `kind` (`fixture` \| `google-sheets`), spreadsheet **id**, title, worksheet (tab), `column_map` (field → header text), `enabled`, last test status / outcome code / counts. **No credential, no row, no contact detail can be stored** (a test asserts the column list). RLS on, no API access. Four organizer-only functions: read, set, clear, record-test-outcome. Event-scoped through the same role check as every other organizer function. |
| Server (`server/registration/*`, `functions/api/registrations.js`) | One endpoint, four actions: `capabilities`, `inspect` (title + tab names), `test` (the read-only diagnostic) and `load`. `load` **never takes a spreadsheet from the caller**: it reads the sheet the event's organizer saved, using the caller's own token. Google credentials exist only as Pages Function secrets. |
| Browser (`app/view_registration.mjs`, `contracts/registration_client.mjs`) | The **Registration settings** card on the Players tab (below). The client validates every answer through a strict contract. |

### Access control (event-scoped, organizer-only)

1. The caller's own Supabase token is checked on every request: the session must be valid **and** the database must report the caller's *current* role for **that** event as `organizer`.
2. The saved source is read through `fftt_registration_source_v5`, which independently refuses anyone who is not that event's organizer.
3. A signed-in organizer who substitutes another event's id is refused (403) by the database check; Google is never contacted. Tested at three levels: handler unit tests, the real SQL (`tests/e2e/gameday_v5_server.test.mjs`), and handler + real SQL (`tests/e2e/registration_integration.test.mjs`).
4. Cache keys are `event | spreadsheet | tab | mapping`; opaque registration references are an HMAC over `event + spreadsheet + row identity`, so the same person in two events or two sheets never collides and a cached result is never served to another event.

### Google access

* Read-only scope only: `https://www.googleapis.com/auth/spreadsheets.readonly`. The only Google calls in the code base are the token POST and `GET` of spreadsheet metadata / one range.
* A new spreadsheet works only after its owner explicitly **shares it with the connection account as Viewer**; the settings screen shows that account's e-mail with a copy button.
* Only a Google Sheets link or id is accepted (`docs.google.com/spreadsheets/d/<id>`); any other host, scheme, port or credential-in-URL is refused in the browser and again on the server, before anything is contacted.
* The diagnostic returns readiness only: step results, column **heading text** with how each was recognized, and a response **count**. Never a cell value, never an answer. Failures are sanitized to short fixed messages.

### What the Organizer can do (Registration settings)

Source selection (fictional demo data / Google Sheet) · spreadsheet link or id · worksheet picker · column mapping preview (automatic recognition of the FFTT3 form's headings, an override per field, and "Not in my form") · read-only connection test (Google sign-in, spreadsheet, worksheet, headers, model compatibility, response count) · enable/disable · status, last checked, last successful read · an explicit read-only statement. Private CSV import and manual walk-ins are unchanged.

When playing-assessment questions are missing or unrecognized, **no level and no confidence are invented**: the registrant carries `suggestedRating: null`, confidence `none` and a review flag, check-in is disabled for that person until the Organizer chooses a level, and the list says so.

## 3. Deployment settings

| Setting (Pages Function variable/secret) | Purpose |
| --- | --- |
| `REGISTRATION_ENABLED`, `STAFF_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | as before |
| `REGISTRATION_FIXTURE=true` (or legacy `REGISTRATION_SOURCE=synthetic-fixture`) | allows the fictional demo data (synthetic events only) |
| `REGISTRATION_GOOGLE_MODE` = `off` (default) \| `diagnostic` \| `enabled` | `diagnostic`: the connection test works, nothing is read for event operations. `enabled`: real reads (needs the next three) |
| `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (secrets) | the read-only connection account |
| `REGISTRATION_REF_SECRET` (≥ 32 random chars), `REGISTRATION_EVENT_IDS` (explicit allowlist) | required for `enabled` |

Fail-closed rules: a live Google source is **never** served for a synthetic event (the database refuses to enable it too), in `off`/`diagnostic` mode, when switched off, or outside the allowlist. The old single-sheet variables (`REGISTRATION_SHEET_ID`, `REGISTRATION_SHEET_RANGE`) are gone.

## 4. UI/UX polish

* **One spacing system** (`--gap-label 6 · --gap-inline 12 · --gap-field 16 · --gap-actions 20 · --gap-section 24`). A shared stacking rule applies to every card, form, dialog, sign-in and recovery section; a label belongs to the field below it; actions sit 20px below their fields; button groups use the inline gap; phones stack. Grid forms (Overview setup, walk-ins) opt out so cells stay aligned. A Playwright audit (`SPACING`) fails if any two related controls are closer than 10px (vertical) / 6px (side by side) on Overview, Players, Registration settings, Doubles, Staff, Match Desk, Results, Championship, Consolation, spectator, sign-in (recovery open) and the score/correction dialogs at desktop, tablet and phone widths. It fails on the previous stylesheet (verified).
* **Password**: the eye icon is inside the field at the right (46×44 target), a real button with `aria-pressed` and a label that says what it will do; autocomplete (`current-password`) unchanged; focus stays on the button.
* **Score tiles** (`app/game_tiles.mjs`): equal rounded squares, tabular numerals, pastel green winner / red loser per game, first-named player first (the recorded order), a solid border for winners and a dashed one for losers, and a sentence per game for screen readers. Used in Match Desk Recent Results, Doubles Finale, bracket cards and the spectator Results/finale. Best of 1/3, historical Best of 5, 11 or 21 points and deuce scores all render; the text is only parsed for display, never rewritten. (The TV board keeps its large text.)
* **Overview**: "How each match is scored" is the last section and spans the full width, as a balanced grid of format tiles; locks, the historical-format note and all options are preserved.
* **Notifications** (`toast`): compact, top-right under the status bar (a top strip on phones), at most three, identical messages merged, dismissible, `status` / `alert` roles. Anything that needs action is explained once, **inline** and persistently (e.g. the registration state notice); the same text is never also shown as a toast.
* **Registration wording** (one vocabulary): Fictional demo data · Connected Google Sheet · Not configured · Unauthorized · Temporarily unavailable (plus Connection off and Not available on this site).

## 5. Tests added

* `tests/registration_handler.test.mjs` (rewritten): workerd regression, controlled egress, fail-closed settings, request hygiene, organizer-only and **cross-event denial**, fixture default, event-specific sources, cache/reference scoping, live-Google refusal matrix, Google failure mapping, wrong/unshared sheet, changed columns, missing rating inputs, the diagnostic (read-only, no rows), inspect (only Sheets addresses), no leaks (nothing logged), rate limit, reader strictness.
* `tests/registration_model.test.mjs`: mapping overrides, renamed columns, `(none)`, no fabricated level, contract rules.
* `tests/e2e/gameday_v5_server.test.mjs` (real SQL): privileges, organizer/event scope, validation, synthetic rule, status handling, audit (no sheet id), lifecycle, cascade. `tests/gameday_v5_disposable.sql` (CI, real PostgreSQL).
* `tests/e2e/gameday_polish_browser.test.mjs` (real Chrome, desktop/tablet/phone, fake Google): spacing audit, password toggle, tile geometry/colours/order/Bo1·Bo3·Bo5·deuce/doubles/spectator, Overview layout, notifications, the whole Registration settings flow, state wording.
* `tests/hosted_v4_acceptance_rollback.sql` is unchanged; the V5 hosted check is recorded in section 8.

## 6. Visual acceptance

Full-page screenshots at 1440, 820 and 390 px were produced by the polish suite (`FFTT_SHOTS=<dir>`) and inspected by eye, not only by assertions. That review found and fixed: labels that lost their top margin (sign-in/recovery fields touching), the Overview date field pushed below the name field by the shared rule, format dropdowns clipped to "Games to 1" on a phone, a notification covering the status pills, and a pill overflowing the mapping row at tablet width.

## 7. Real FFTT3 sheet: what is and is not verified, and the owner steps

### October 27 authenticated real-sheet diagnostic — PASS (supersedes the earlier setup instructions below)

Christopher tested the deployed V5 Staff site as Organizer with the real FFTT3 response sheet (`Form Responses 1`) and provided an on-screen recording. Status **Ready to read**; service-account authentication, sheet access, worksheet, and registration-model compatibility all passed. The diagnostic detected **12 columns**, **21 response rows** (not a verified unique-player count), and **six of seven optional assessment headings**. **Playing profile / description** mapped successfully; the separate optional **Self-described level** heading was not found. It read no participant answer rows and imported nothing. Synthetic staging stays `REGISTRATION_GOOGLE_MODE=diagnostic`; its completed fictional event was not changed. The steps below describe the *earlier, pre-test state* and should not be repeated.

**Important production-readiness correction:** Existing V3/V4/V5 STAGING SQL deliberately enforces `synthetic_only=true` in both the schema and multiple server routines. The earlier proposal below to create a real project, apply V5 and flip configuration is **not executable as written**. A separately reviewed, real-event-capable SQL/RPC release, matching security tests and isolated auth/deployment acceptance are required before enabling actual Google loads. Do not weaken protections on the existing synthetic project.

**Not verified against the real sheet.** No Google service account exists yet and none was created (this session cannot, and must not, create credentials). The connection diagnostic is complete and tested against a faithful fake. To validate the real sheet, the owner needs to:

1. In Google Cloud (free tier, no billing), create a project and **enable the Google Sheets API**; create a **service account** (no roles needed) and a JSON key. The key goes only into Cloudflare as a secret — never into chat, the repository or the browser.
2. On the **staff** Pages project add secrets `GOOGLE_SA_EMAIL` (the account's e-mail), `GOOGLE_SA_PRIVATE_KEY` (the key's `private_key`), and set `REGISTRATION_GOOGLE_MODE=diagnostic`. Redeploy the staff project (or just save the variables; they apply to new requests).
3. In Google Sheets, open the real FFTT3 form **response** sheet, **Share → add the service account's e-mail as Viewer**. (The private Outreach Tracker is a different file and must not be shared.)
4. In the staff app, Players → Registration settings → Google Sheet → paste the sheet's link → Check sheet → Test connection. The result lists the steps, the recognized columns and the response count; no rows are shown or stored.

Keep `REGISTRATION_GOOGLE_MODE` at `diagnostic` on staging: the database refuses to enable a live source on a synthetic event.

### Activating a real-event environment later (no rewrite)

A separate Supabase project and Cloudflare pair for the real event, with V5 applied and events that are not `synthetic_only`; set `REGISTRATION_GOOGLE_MODE=enabled`, `REGISTRATION_REF_SECRET`, `REGISTRATION_EVENT_IDS` (the one real event) and the Google secrets; share the real response sheet with the service account; the Organizer then selects it in Registration settings and switches the connection on. Nothing in the application code changes. Requirements before doing so: privacy review of what is stored (nothing but the source description), a decision on who may be organizer, and a rehearsal on the isolated environment.

## 8. Hosted staging record (October 27, 2026)

| Item | Value |
| --- | --- |
| Application commit deployed | `e938f76539b07b5c07285c0b748d2b1af2ec4f7a` (branch `integration/milestone1-secure-foundation`, PR #19 open draft). App/server files are identical to `e978ca4`/`413e830`; the last commit changed only a test. |
| Migration | `supabase/proposals/GAMEDAY_TOURNAMENT_V5_STAGING.sql`, SHA-256 `f537da164412a9daf53631c266aec6877f14047483fe135a9341dc2e10912e98` (16,774 bytes; the file fetched from the commit was compared byte-for-byte before it ran), applied once, additively, to the **synthetic** project `fftt-bracket-manager-dev`. Backward compatible: the previous V4 bundle keeps working against a V5 database, so the migration ran first and both bundles followed within minutes. |
| Staff deployment | `9e6d0794-3b6f-4e00-b324-7df14e0f4c65` (https://fftt3-staff-stg.pages.dev, with the registration Function) |
| Spectator deployment | `d4bb5de4-298b-4710-81b5-6efbfaa31246` (https://fftt3-games-stg.pages.dev) |
| Rollback references (unchanged, listed) | staff `ead402a1-7995-4acd-8ccc-c323d2a28428` (`c1e589c`), spectator `116de70c-28fa-4ae5-8cca-31c7708107ce` (`c1e589c`); the V4 bundles also run on the V5 database. |
| Function settings | unchanged: the fixture is allowed (`REGISTRATION_SOURCE=synthetic-fixture`); `REGISTRATION_GOOGLE_MODE` is unset (= off); no Google credential exists. |

**Verified after deployment:** live `MANIFEST.json` equals the local build for both sites (34 and 15 served files, 0 hash mismatches); an invalid-shaped token now returns the honest `401 access-rejected` (the pre-fix deployment returned `503`); no token 401, foreign origin 403, GET 405, spectator origin 405; `server/`, `functions/`, the SQL and test scripts return 404.

**Database after V5:** 4 public V5 functions, none executable by `anon`, all by `authenticated`; `registration_sources` exists with row-level security on and no API access; 0 sources saved. Preserved exactly: 4 events (3 active, 1 complete at revision 45), 18 players, 25 matches, 52 audit rows, 20 score decisions, 13 staff grants (same fingerprint), 0 published events, 0 tombstones/links, completed-event match fingerprint `fa83a90f35d2a0cb6be46bc382054fb3` (unchanged).

**Hosted acceptance:** [`tests/hosted_v5_acceptance_rollback.sql`](../tests/hosted_v5_acceptance_rollback.sql) ran on the hosted database in one always-rolled-back transaction as the existing organizer and a scorekeeper: **PASSED=23 FAILED=0** (privileges, organizer/event scope, a scorekeeper/outsider/anonymous refused, two events with two different sheets, the synthetic rule, validation, no credential smuggling, status handling, audit without the sheet id, cascade); zero disposable events remained.

**Not run:** the signed-in browser flows on the live staff site (needs an organizer password the release session does not have, and may not enter). The same code passed the full local browser suites (desktop/tablet/phone) and the files served are hash-identical to it.
