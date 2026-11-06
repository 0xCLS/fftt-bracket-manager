# FFTT3 — Bracket Manager registration lookup and check-in (November 6, 2026)

Status: **IMPLEMENTED AND TESTED LOCALLY; NOT RELEASED.** Source: [PR #52](https://github.com/0xCLS/fftt-bracket-manager/pull/52) (draft). Nothing here has been applied to hosted Supabase, deployed to Staff production, or used on real registrations, rosters or staff grants. Hosted SQL, Cloudflare secrets and the Staff deploy each need their own explicit authorization (see [Release requirements](#release-requirements)).

## What changes for the people running the day

* **Event access without a Cloudflare edit.** The Staff registration Function no longer needs `REGISTRATION_EVENT_IDS`. A new real event reads its Google Sheet as soon as its Organizer saves **and enables** a source for that event in *Registration settings*. The November 8 rehearsal and November 22 events can share one sheet; each keeps its own roster, check-ins and opaque references.
* **A Bracket Manager can find a registered player and check them in.** On **Check-in** (Bracket Manager only) a **Registered players** card loads the event's sign-ups, searches by name, shows each person's suggested level, and shows who is already on the roster. One tap checks a plain registration in (adding the player to the roster at the suggested level). **Review & check in** opens a small dialog when a decision is needed: a missing level, other sign-ups that look like the same person (merge), or a roster player who already has this name (match them, never add twice). Registrations without a usable full name cannot be checked in from here; the card says to ask the Organizer to fix the sheet or add a walk-in. The roster table and **Add & check in** (walk-ins) below are unchanged, and the whole screen locks once the Championship bracket exists, exactly as before.
* The Bracket Manager sees **names, suggested levels and sign-up times only**: no e-mail or phone (not even masked), no sheet link, no mapping, no raw answers.

## Security model

| Question | Answer |
| --- | --- |
| Who may look up / check in? | Only a **current** `bracket_manager` of **that event**. Scorekeepers, unassigned or revoked staff, Organizers (who use their own workflow), and other events are refused by the Function **and** by the database. The role is read live on every call. |
| Does the Bracket Manager get the source RPC? | **No.** `fftt_registration_source_v5` and `fftt_set_registration_source_v5` stay Organizer-only (asserted in SQL and browser tests). The sheet id, tab and mapping never reach the desk. |
| Can the browser invent a registration, change a name or level, or reuse another person's request? | **No.** The browser sends only an opaque reference (plus an optional level 1–5, duplicate references and a roster link). The Function re-reads the event's own enabled sheet, finds that reference, and sends the database the **name and level it read**, with an HMAC proof. The database checks the proof, so a forged or altered request is refused. |
| What does a proof bind? | Purpose, event, the **signed-in user's id**, a 45-second expiry (the database accepts at most 120 s) and, for a check-in, the source fingerprint plus every reference, name and level. Another user, event, source, name, level or extra item changes the proof. The browser never receives a proof. |
| What if the Organizer changes the source in between? | The check-in names the source fingerprint (a hash of kind, spreadsheet id and tab). The database compares it with the **current** saved source: `source-changed` is refused. A disabled source (`source-not-enabled`) and a fictional source on a real event (or a live sheet on a synthetic event) are refused too. |
| Duplicates and identity substitution | Merging is allowed only for sign-ups the registration model itself grouped with the chosen one; the database links them to the same player (never a second one). A roster link is allowed only to a roster player of the **same name**; that player's own level, name and source are not rewritten. |
| Idempotency and races | The event row is locked for the whole call. Repeating a check-in changes nothing (`unchanged`, no new revision, no new audit row). A name already on the roster is refused (`duplicate-name`) until the person explicitly matches it. Roster full (64) and the bracket lock are enforced in the database. A lost reply is reported as **outcome unknown**: the screen refreshes from the database before anything is retried. |
| Event revision checks | The operation does not take an expected revision: it is idempotent per reference and every conflict (name, roster size, lock, source) is checked inside the locked transaction, so a stale screen cannot produce a wrong roster. The returned revision updates the snapshot. |
| Audit | One `registration_checkin` audit row per change with `via: bracket_manager`, the outcome (`created` / `linked` / `existing`), the player id and the number of merged sign-ups. No name, contact, answer or sheet id is stored in the audit row. |
| Walk-ins | Unchanged and separate: `fftt_event_day_walkin_v1`, full name and level chosen at the desk. Registration check-in does not weaken or replace it. |
| SQL hygiene | Private functions are `SECURITY DEFINER` with `search_path = ''`; helpers and the secret installer are executable by **no** API role; only the two public wrappers are granted to `authenticated` (not `anon`, not `public`); the secret table has RLS on and no API grant. HMAC-SHA256 uses the core `sha256()` (no extension) and is verified against RFC 4231 vectors on PGlite and native PostgreSQL 17. |
| What is **not** changed | Role-specific snapshots and publication permissions, Staff account administration (Organizer-only), source configuration (Organizer-only), the Organizer registration workflow, `fftt_checkin_registrants_v4`, `fftt_set_checkin_v3`, scoring and bracket permissions. |

### Retained deployment controls (still required)

`REGISTRATION_ENABLED` (global switch), `STAFF_ORIGIN` and `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (origin and project pinning), `REGISTRATION_GOOGLE_MODE` (`off` · `diagnostic` · `enabled`, the incident switch), `GOOGLE_SA_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` (read-only scope), `REGISTRATION_REF_SECRET` (opaque references), the synthetic-event rule (a live sheet is never served for a synthetic event; the fictional source never for a real one), per-event saved source + enable switch, authentication and event-scoped role checks.

### Retired

`REGISTRATION_EVENT_IDS`. The Function ignores it (set or not, valid or not). Once the release below is verified, delete it from the Staff Cloudflare project so nobody edits it again.

### Review of other rollout-era restrictions (bounded, November 6)

| Restriction | Finding | Action |
| --- | --- | --- |
| `REGISTRATION_EVENT_IDS` (Cloudflare event list) | Duplicated the database's event-scoped role check and the event's own saved, enabled source, and needed a manual Cloudflare edit and redeploy for every new event. | **Removed** (tests: new eligible event, obsolete setting ignored, Nov 8/Nov 22-style events on one sheet). |
| `event-not-enabled` Function answer | Only the allowlist produced it. | Removed with it. |
| `REGISTRATION_SHEET_ID`, `REGISTRATION_SHEET_RANGE` in the setup list | Not read by any code since V5's per-event source. | Removed from the active setup list (docs only). |
| `REGISTRATION_ENABLED`, `REGISTRATION_GOOGLE_MODE`, credentials, `REGISTRATION_REF_SECRET`, `STAFF_ORIGIN`, Supabase pinning | Global incident switches and secrets, not per-event steps. | **Kept.** |
| Per-event saved source + enable switch, Organizer-only source RPC | Meaningful: it is how an Organizer authorizes one event to read one sheet. | **Kept.** |
| Synthetic-event rule (live sheet never for a synthetic event; fictional source never for a real one) | Meaningful isolation boundary, enforced in the Function and the database. | **Kept**, and extended to the new check-in. |
| 20-second sheet cache, 30 requests/minute per user, 64-player roster, bracket lock | Operational limits and safety rules, not rollout gates. | **Kept.** |

## Release requirements

Authorization is needed for **each** of 1–4. Do them in this order; every step is additive and reversible.

0. **Before anything:** green full CI on the exact release commit; a fresh private backup with disposable restore evidence ([backup and recovery](FFTT3_BACKUP_RECOVERY.md)); read-only reconfirmation that the hosted database carries the Bracket Manager role layer (`FFTT3_BRACKET_MANAGER_ROLE_20261030`) and the event-day delegation layer (`FFTT3_EVENT_DAY_DELEGATION_20261105`; the project changelog records it applied on November 5, 2026). This candidate depends on the role layer; the roster check-in and walk-in the desk also uses need the delegation layer.
1. **Hosted SQL** (the owner, SQL editor or `psql`): run `supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql` once (it is one transaction).
2. **Install the proof secret** (once; never commit it, never paste it into chat). Generate a random value of 32–200 characters into a private file, for example `openssl rand -base64 48 | tr -d '\n' > ~/Documents/FFTT-private/secrets/REGISTRATION_GATE_SECRET.txt && chmod 600 ~/Documents/FFTT-private/secrets/REGISTRATION_GATE_SECRET.txt`. Install it in the database with `psql`, so the value is not in a saved SQL-editor history:
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v gate_secret="$(cat ~/Documents/FFTT-private/secrets/REGISTRATION_GATE_SECRET.txt)" <<< "select fftt_private.install_registration_gate_v1(:'gate_secret');"`
   Re-running with a new value rotates it (do the Cloudflare secret in step 3 at the same time; between the two, desk calls are refused, nothing else is affected).
3. **Cloudflare, Staff project only** (Production): add the secret `REGISTRATION_GATE_SECRET` with the same value (`npx wrangler@4 pages secret put REGISTRATION_GATE_SECRET --project-name fftt3-staff-stg < that file`). Never set it on the Spectator project. Redeploy the Staff bundle once from the final commit (Pages applies variable changes to new deployments only). After the verification below, **delete `REGISTRATION_EVENT_IDS`**.
4. **Staff production deploy** of the exact final commit of PR #52 (merge order per the repository's release process; PR #52's base branch must be merged or retargeted first).

Order safety: the SQL is additive, so the current Staff bundle is unaffected by step 1. A new bundle without the SQL or secrets shows "Registration lookup is not set up for this event" and leaves the roster and walk-in screens working.

### Verification after release (signed in as each person; use the private rehearsal event, never create or alter the live Nov 22 event for a test)

* Bracket Manager of event A: **Check-in → Registered players** loads; one registered player checks in; the roster shows them at the suggested level; repeating changes nothing; the roster table's **Undo** still works.
* The same Bracket Manager cannot reach event B (not assigned): refused. A Scorekeeper and an unassigned account: refused. A revoked Bracket Manager: refused with the same still-valid page.
* The Organizer's **Players** tab, Registration settings, CSV and check-in behave as before.
* After the Championship is built, the card reports that check-in is closed and its buttons are disabled.
* The page shows no e-mail, phone, sheet link or credential; `select * from fftt_private.registration_links` and the audit log show opaque references, names and levels only.
* Switching `REGISTRATION_GOOGLE_MODE` to `diagnostic` makes the lookup answer "not available" immediately; switching back resumes it.

### Rollback (reversible, deletes no event data)

1. Redeploy the previous good Staff bundle (the new card disappears; the old roster/walk-in screen returns).
2. Run `supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_ROLLBACK_DO_NOT_APPLY.sql` (removes only the new functions and the stored secret; players, links and audit rows already written stay; safe to run twice; the candidate can be applied again afterwards).
3. Remove `REGISTRATION_GATE_SECRET` from Cloudflare. Without the SQL or the secret the Function answers "not set up"; nothing else depends on them.

## Evidence (all fictional, all local)

* `tests/e2e/bm_registration_lookup.test.mjs` — real SQL in PGlite behind the real Function with a fake Google, two real-mode events sharing one sheet: independent rosters and check-ins; a new event with no deployment setting; Organizer, Bracket Manager, Scorekeeper, unassigned, revoked, demoted and cross-event matrix; forged, altered, retargeted, replayed, expired and wrongly keyed proofs; duplicates, ambiguous and incomplete registrations; levels; existing roster players; late arrival and bracket lock; disabled, missing, changed and unreadable sources; synthetic isolation; no sensitive data; privileges and `SECURITY DEFINER` hygiene; rollback and re-apply. Mutation-checked: removing the proof check, widening the role or dropping the bracket lock each fails the suite.
* `tests/fftt3_bm_registration.sql` (in `tests/gameday_single_project_postgres.sh`) — the same on native PostgreSQL, including the RFC 4231 vectors and the rollback.
* `tests/registration_gate.test.mjs` — the proof byte layout, the strict desk payload, the client and the Function's role boundaries without a database.
* `tests/e2e/gameday_desk_registration_browser.test.mjs` — real Chromium, desktop and phone: search, one-tap check-in, review, duplicate merge, missing level, incomplete name, privacy, lost reply, switched-off source, outage, missing secret, locked bracket, revocation.
