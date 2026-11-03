# FFTT3 — onsite rehearsal checklist · Sunday, November 8, 2026, 1:00 PM EST

**Purpose:** prove the real venue, real devices, real Wi-Fi and the real people work end to end **using fictional players only**. The rehearsal is **not** a dress rehearsal with real registrants. **The Organizer has permanent access to both physical tables; use two tables for the new fictional rehearsal event.** The November 22 venue is secured. **November 8 rehearsal room access was confirmed by the Organizer on November 2, along with the corrected 1:00 PM start**; coordinate any additional opening/setup details as necessary. This supersedes the prior 10:00 AM start and room-access uncertainty.

## November 3 production-release and authorization boundary

- **Production Staff:** https://fftt-staff.clslifestyle.com/ · **Spectator:** https://fftt-games.clslifestyle.com/ · **Homepage:** https://fftt.clslifestyle.com/
- PR #43 is **merged into PR #22's feature branch**, deployed to Staff production at `3a37976e3b31320ab79b7943aec92ba833dfd50e`; full CI, 34/34 asset hashes and security checks passed. Organizer verified all three mobile issues fixed on a real iPhone. **PR #22 remains draft/unmerged into application main.** Do not repeat the completed mobile work without new evidence.
- Three November 22 scorers are confirmed (Maydis Skeete, J'Mae Ferguson, Laura Nhiwatiwa); **their November 8 attendance and individual authenticated grants are not confirmed.** Debbie Young's November 22 Bracket Manager role is confirmed, but her identity/grant needs separate authorization. **Do not provision anyone or create the fictional event merely because this checklist exists.**
- Keep the public FFTT3 event and actual registrations unchanged. At the rehearsal, first verify the explicitly authorized host, fixture, accounts, public-view policy and test operator. All physical device/network/TV/fallback gates are still **NOT TESTED** as of November 3.

## Ground rules
* Use a **separate rehearsal event** created in the Staff app (name it `REHEARSAL — fictional — Nov 8`). Add only fictional names (e.g., Ada Quill, Ben Marlow) as walk-ins. **Do not** enable the Google source on it and **do not** put fictional people into the real FFTT3 event.
* The real FFTT3 event may be **opened** (read-only: Players → Load registrations to eyeball names and suggested levels) but **nobody is checked in** and nothing is published.
* Public visibility on the rehearsal event may be turned on only with the Organizer's explicit fictional-fixture approval; turn it off afterwards. **Archive only after Organizer review/authorization**. Archive keeps the audit trail (nothing is deleted).
* If anything fails, write down the exact message and time; do not improvise fixes on the real event.

## Bring
Organizer laptop + charger; two scorekeeper phones (different people, different devices); one spare phone/tablet; the TV/projector and its HDMI/Chromecast path; a printed bracket sheet and 12+ paper score sheets (blank), pens; a hotspot-capable phone as a Wi-Fi backup; the private backup USB; list of staff e-mails and the password-reset path; QR code/short link for the spectator page.

## Before leaving home (the evening before)
- [ ] The release build is deployed and `MANIFEST.json` hashes match (cutover runbook, Step 4); CI green on the release commit.
- [ ] Take a private backup (`tools/ops/hosted_export.sql`) and run `restore_verify.mjs --rehearse` on it.
- [ ] Organizer and both scorekeepers have signed in successfully at least once from their own phones (passwords known; password reset works for each).

- [ ] **Supabase Free limits:** the project must not be paused (Free projects pause after about a week with no activity; any Staff sign-in or SQL query counts as activity — keep using it weekly until Nov 22). Do not rely on e-mailed password-reset codes on the day: Free-plan Auth e-mail is heavily rate-limited, so every volunteer must **already know a working password** and have signed in once.

## 1:00 PM — network and devices (20 min)
- [ ] Venue Wi-Fi: open the Staff page on 3 devices at once; sign in as Organizer, Scorekeeper A, Scorekeeper B. Note the time each takes. Repeat on the hotspot.
- [ ] Spectator page on 3 attendee-style phones (cellular and Wi-Fi), TV page on the real screen: legible from the farthest seat? Sleep/screen-lock disabled on the TV device.
- [ ] Walk the Wi-Fi dead spots: with a score half-typed, step out of coverage and back. The phone must pause writes; reconnecting alone must not resend an unconfirmed score. Check the server record and paper score before any deliberate submission.

## 1:20 PM — run a full fictional tournament (60–90 min)
- [ ] Organizer: create a **separate fictional rehearsal event configured for 2 tables**, add 10–16 fictional walk-ins with full first and last names, confirm test levels, build the championship (byes appear correctly). Never reuse the actual FFTT3 event or the completed October 25 fictional fixture.
- [ ] Scorekeepers A and B: claim tables for different matches, record results from two phones **simultaneously**; deliberately both submit the same match; confirm one is rejected cleanly.
- [ ] Table conflict: try to give the same table to two matches. Wrong-score correction by the Organizer with a reason.
- [ ] Complete round 1 → consolation review → consolation bracket → mixed-skill doubles finale → complete.
- [ ] Spectator and TV show full names, now playing / up next / results, no levels or contacts; TV stays correct for 10 minutes unattended.
- [ ] Revoke Scorekeeper B on the Staff tab: B's next action is refused; re-grant and confirm B works again.

## 2:45 PM — failure drills (15 min; proposed timing)
- [ ] Turn the venue Wi-Fi off on the Organizer laptop mid-match: banner shows paused; scorekeeper phones on cellular keep scoring; laptop catches up.
- [ ] Verify that the **fictional rehearsal event has no Google registration source configured**, and that fictional walk-in entry works without any Google Sheet access. **Do not toggle the shared Cloudflare `REGISTRATION_GOOGLE_MODE` variable** during this rehearsal: it could interrupt registration availability for the real FFTT3 event. Any separate incident drill of that production-level switch requires an explicitly scheduled, owner-approved window.
- [ ] **Paper fallback drill:** declare "system down". Fill 3 paper score sheets, then enter them into the system afterwards by the Organizer and confirm results match (see the event-day guide, §6).
- [ ] Download the **private backup** from Results & Export and the results text/CSV; open both.

## 3:00 PM — close out (proposed timing, not a confirmed end time)
- [ ] Hide the rehearsal event from the public; **archive only if the Organizer has reviewed and approved closing that fictional fixture**. Take a private backup. Write down: Wi-Fi sign-in times, any message that confused a volunteer, what to print/bring differently.
- [ ] Decide go/no-go items for Nov 22: staff list and devices ready, the confirmed **2-table configuration** visible on the real event Overview, match formats agreed, and publication policy for real names (spectator notice) decided by the Organizer.

## Evidence to keep (no participant data)
Times, device models, screenshots of any error text, the backup file's SHA-256 (not the file), the rehearsal event's name. Do not attach screenshots that show real registrants.
