# FFTT3 — scorekeeper onboarding and permission verification

**Current November 6 checkpoint:** The existing `FFTT 3 (Rehearsal)` event has **two active Scorekeeper grants**, **one Bracket Manager grant**, and no roster/check-ins after testing data was removed (read-only verification). These counts do **not** verify the individual grantees' identities, successful sign-ins, devices or Nov 8 attendance. Use the live Staff UI: **Staff → People → Event assignment** checkboxes, select **Role**, click **Save**, confirm, and refresh to check the server's grants. The Organizer verified the event checkbox UI; real Save/revoke was tested on fictional data. Do not create another rehearsal event. Older November 2 volunteer status paragraphs below are historical checkpoints.

**Status: ready-to-use onboarding procedure.** As of November 2, **Maydis Skeete, J'Mae Ferguson and Laura Nhiwatiwa** have each accepted their November 22 scorer roles; that does **not** establish an individual Auth account, verified login identity, rehearsal attendance, event grant, or authorization to issue one. This document contains no staff e-mail addresses, credentials, player contacts or private event identifiers. Use the Owner's private volunteer tracker for contact and identity checks.

## Intended event and roles
- **Live tournament:** Sunday, November 22, 2026, 1:00 PM, Ypsilanti SDA Church. Venue secured, two physical tables permanently accessible to the Organizer.
- **Onsite rehearsal:** Sunday, November 8, 2026, **1:00 PM EST** (corrected/confirmed November 2). Both physical tables and church room/building access are confirmed; individual volunteers' attendance, device readiness, and any additional setup coordination remain to be confirmed.
- **Minimum people:** Organizer (laptop), Scorekeeper A (phone), Scorekeeper B (another phone), and an observer of the Spectator/TV display.
- **Current volunteer status (November 2, organizer-confirmed):** **Maydis Skeete, J'Mae Ferguson and Laura Nhiwatiwa are the three confirmed FFTT3 scorers.** There are still two physical tables: arrange a primary scorer per table and rotate/backup as needed, once assignments are approved. Their Nov 8 availability, preferred authentication emails (Laura's contact still needs collection), individual verified Auth identities, account creation/sign-in, and event-scoped Scorekeeper permissions remain pending. Their volunteer confirmations are not player registrations or approval to grant access.

## Stage A — approval and individual identity (Owner + Organizer)
1. Confirm each volunteer's **preferred authentication e-mail** and availability for the November 8 rehearsal (all three have already accepted the November 22 scorer roles). Keep contact information and identity verification in the owner-private outreach tracker, **not this public repository**.
2. Confirm an existing Supabase Auth user is the *intended individual*. If none exists, the trusted administrator uses an **approved, owner-controlled invite/create procedure** and verifies the e-mail is confirmed. **Do not enable public self-signup**; the Organizer previously confirmed that toggle is disabled.
3. Never share an Organizer account, reuse a single volunteer account on two phones, publish a password, or create a staff grant merely because someone was mentioned in a planning conversation.
4. For an actual FFTT3 grant, require the Organizer's explicit confirmation of **the named volunteer and the target event**. Do not use the completed October 25 fictional tournament as an access test. Use the **existing, separate `FFTT 3 (Rehearsal)` event**, with actual registered names and **practice-only results**, to test permissions. Its event grant is separate from the November 22 event grant; do not confuse them.

## Stage B — event-specific grant
1. After separate permission to grant access, Organizer signs in on the **correct Staff host** for the intended event: production `https://fftt-staff.clslifestyle.com/app/staff`, or `https://fftt3-staff-stg.pages.dev/app/staff` only if the authorized rehearsal event is actually on staging. Verify the host **and intended event by name** before opening the **Staff** tab. Staging authorization is not production authorization.
2. Under **Staff → People**, locate the verified volunteer. Check the authorized event under **Event assignment**, choose **Scorekeeper** under **Role**, then click **Save** and confirm the exact event. Checking a box alone never grants access.
3. Refresh the Staff directory and verify the saved event and role against the intended individual. If the server-confirmed assignment differs, **stop** and investigate; do not grant broadly.
4. Repeat independently for the second confirmed volunteer.

## Stage C — each volunteer's own phone
- [ ] Volunteer signs in with their **own** individual account on their phone and explicitly selects the correct event.
- [ ] The account sees **Match Desk only** — no Organizer Players/Registration, Staff, event-setting, or publication controls.
- [ ] On the **separate FFTT3 Rehearsal** event with two configured tables, each Scorekeeper can use one free table; the same table cannot be assigned concurrently to another active match.
- [ ] Both try to submit the **same rehearsal match** at the same time: exactly one result accepted, the other rejected as stale/outdated.
- [ ] On airplane-mode or lost connection, writes pause; reconnection does **not** silently re-submit. Confirm paper/server receipts before any intentional retry.
- [ ] Organizer revokes one **rehearsal** Scorekeeper grant; that account's next attempted action is denied. Regrant only after the correct volunteer/event is reverified.
- [ ] Scorekeeper and Organizer can find help and paper scorecards without needing new e-mailed recovery codes on event day.

## No-go
Do not use volunteer live scoring until: two independent authorized accounts are known, separate phone sign-ins pass, real event is not accidentally public, the paper fallback is available, and the Organizer validates actual scorekeeper roster/permissions. Failures must have an owner and a successful retest.

## Scope and history
This guide prepares the steps only. The Organizer's November 3 plan is to check real registrants into a **separate rehearsal event**, but this document alone **does not** authorize creating accounts/grants, writing or checking players into the real Nov 22 FFTT3 event, changing its source settings, or publishing real names. PR #19 is already merged into `main`; that source integration is not volunteer authorization. Refer to `FFTT3_ACCEPTANCE_CHECKLIST.md`, `FFTT3_REHEARSAL_CHECKLIST_NOV8.md` and `FFTT3_EVENT_DAY_GUIDE_NOV22.md`.
