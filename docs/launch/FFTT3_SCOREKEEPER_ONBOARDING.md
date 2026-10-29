# FFTT3 — scorekeeper onboarding and permission verification

**Status: ready-to-use procedure, not proof that a volunteer has accepted or has an account.** This document contains no staff e-mail addresses, credentials, player contacts or private event identifiers. Use the Owner's private volunteer tracker for identities.

## Intended event and roles
- **Live tournament:** Sunday, November 22, 2026, 1:00 PM, Ypsilanti SDA Church. Venue secured, two physical tables permanently accessible to the Organizer.
- **Onsite rehearsal:** Sunday, November 8, 2026, 10:00 AM. Two tables are available, but the church room/building entry arrangements remain to be confirmed.
- **Minimum people:** Organizer (laptop), Scorekeeper A (phone), Scorekeeper B (another phone), and an observer of the Spectator/TV display.
- **Current volunteer status:** Maydis Skeete was asked to score, but acceptance, identity verification and volunteer account authorization remain **unconfirmed** in the private event record. Do not present her as confirmed. A second scorekeeper also needs confirmation.

## Stage A — approval and individual identity (Owner + Organizer)
1. Ask each volunteer privately whether they accept, whether they can attend the rehearsal and November 22 event, and which personal e-mail identity to use. Keep any addresses in the private outreach tracker, **not this public repository**.
2. Confirm an existing Supabase Auth user is the *intended individual*. If none exists, the trusted administrator uses an **approved, owner-controlled invite/create procedure** and verifies the e-mail is confirmed. **Do not enable public self-signup**; the Organizer previously confirmed that toggle is disabled.
3. Never share an Organizer account, reuse a single volunteer account on two phones, publish a password, or create a staff grant merely because someone was mentioned in a planning conversation.
4. For an actual FFTT3 grant, require the Organizer's explicit confirmation of **the named volunteer and the target event**. Do not use the completed October 25 fictional tournament as an access test. Use a **new, separate fictional rehearsal event** to test permissions before real-event authorization.

## Stage B — event-specific grant
1. Organizer signs in at `https://fftt3-staff-stg.pages.dev/app/staff`, chooses the **intended event by name**, then opens the **Staff** tab.
2. Choose **Grant access** for the verified, confirmed individual Auth e-mail. Select **Scorekeeper** (not Organizer). Grant only for that event.
3. Verify the event's Staff list reflects precisely the intended identities and roles. If it does not, **stop** and investigate; do not guess or grant broadly.
4. Repeat independently for the second confirmed volunteer.

## Stage C — each volunteer's own phone
- [ ] Volunteer signs in with their **own** individual account on their phone and explicitly selects the correct event.
- [ ] The account sees **Match Desk only** — no Organizer Players/Registration, Staff, event-setting, or publication controls.
- [ ] On a **fictional rehearsal event** with two configured tables, each Scorekeeper can use one free table; the same table cannot be assigned concurrently to another active match.
- [ ] Both try to submit the **same fictional match** at the same time: exactly one result accepted, the other rejected as stale/outdated.
- [ ] On airplane-mode or lost connection, writes pause; reconnection does **not** silently re-submit. Confirm paper/server receipts before any intentional retry.
- [ ] Organizer revokes one **rehearsal** Scorekeeper grant; that account's next attempted action is denied. Regrant only after the correct volunteer/event is reverified.
- [ ] Scorekeeper and Organizer can find help and paper scorecards without needing new e-mailed recovery codes on event day.

## No-go
Do not use volunteer live scoring until: two independent authorized accounts are known, separate phone sign-ins pass, real event is not accidentally public, the paper fallback is available, and the Organizer validates actual scorekeeper roster/permissions. Failures must have an owner and a successful retest.

## Scope and history
This guide prepares the steps only. It **does not** authorize creating accounts, granting live FFTT3 roles, reading registration answers, checking players in, changing event visibility, or merging PR #19. Refer to `FFTT3_ACCEPTANCE_CHECKLIST.md`, `FFTT3_REHEARSAL_CHECKLIST_NOV8.md` and `FFTT3_EVENT_DAY_GUIDE_NOV22.md`.
