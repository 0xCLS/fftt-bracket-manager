# FFTT3 — Organizer and scorekeeper acceptance checklist

Run on **real devices** after the cutover (and again, shorter, on Nov 8 and Nov 22 before doors). Tick each box; any ✗ is a no-go until understood. "Browser-simulated" test evidence in CI is not a substitute for this list.

**Sites:** Staff `https://fftt3-staff-stg.pages.dev/app/staff` · Spectator `https://fftt3-games-stg.pages.dev/` · TV `https://fftt3-games-stg.pages.dev/app/tv`
**People/devices:** Organizer (laptop), Scorekeeper A (phone), Scorekeeper B (a different phone), an outsider (any account that is not on the event), a TV/projector browser.

## 1. Organizer (laptop)
- [ ] Sign in with e-mail + password; the event picker shows **FFTT3 by name** and the fictional events only under "Archived/other"; no technical id is shown.
- [ ] Overview: name, date **Nov 22, 2026**, table count, match formats (regular Bo3 to 11; championship final Bo5; consolation single game to 21; doubles Bo3) are correct. Public visibility is **off** (the button reads "Publish to spectators").
- [ ] Staff tab lists exactly: the Organizer, Scorekeeper A, Scorekeeper B. Revoking and re-granting a scorekeeper takes effect on that phone on its next action.
- [ ] Players → Registration settings shows **Google Sheet** (no demo option) and "Connected"; **Test connection** is green; counts shown are counts only.
- [ ] **Load registrations**: names are **full first and last names**; duplicates are grouped; unrecognised/contradictory answers show "Organizer review" and no level is invented; contact details appear only as masked hints (`a•••@b•••`), never full.
- [ ] Check in one person with a suggested level, edit a level, merge a duplicate group ("Same person"), dismiss one ("Different people"), add a **walk-in with a full name**; a second walk-in with the same name is refused.
- [ ] Championship preview matches the checked-in count; building the bracket warns before replacing an existing one.
- [ ] Results & Export: Results (text), Matches (CSV), Private backup download and Print work; **Mark event complete** is available only while the event is active; the text/CSV contain names and results only (no levels, ids or e-mails).

## 2. Scorekeeper A and B (two different phones, at the same time)
- [ ] Each sees **Match Desk only** (no Players, Overview or Staff tabs, no registration screen).
- [ ] A and B both open the same ready match; A assigns Table 1; B sees it occupied within a few seconds and cannot choose Table 1 for another match.
- [ ] A and B both submit a result for the **same match at the same moment**: exactly one is accepted; the other gets a clear "already recorded / out of date" message and the desk refreshes. No duplicate result, no lost result.
- [ ] A puts the phone in airplane mode, enters a score, sees "paused"; reconnecting sends it once (no double entry). A stale tab (opened before the other scorekeeper's result) is told the match changed.
- [ ] A no-show / walkover and a correction (organizer only) work and appear in the audit trail with the reason.
- [ ] The score dialog and table pills show **full names**; two players with the same first name are distinguishable.

## 3. Unauthorized user
- [ ] An account that exists but is not on the event can sign in and is told it has no access; it sees no players, no results, no staff list.
- [ ] A signed-out visitor to the staff URL sees only the sign-in form. `/api/registrations` returns 405 (GET) / 401 (no token); the spectator origin has no `/api/*` or staff files (404).
- [ ] A scorekeeper account calling the registration/staff screens' data (try the Players URL) is refused.

## 4. Spectator and TV (public visibility **off**, then on)
- [ ] Off: spectator and TV show "not published" and nothing else.
- [ ] On (organizer decision, separate approval for real names): bracket, results, now-playing, up-next show full names and scores; **no** levels, ratings, e-mail, phone, registration answers, staff names or ids anywhere (view source too).
- [ ] TV at 1920×1080: readable from 5 m; no overflow with the longest registered name; it labels itself **stale** if the network drops and recovers by itself.
- [ ] Phone (390 px): bracket scrolls horizontally inside its own area; the page itself does not scroll sideways.

## 5. Flow to the end (rehearsal event, fictional names)
- [ ] Bracket with byes → progression → consolation review (first-match losers) → consolation bracket → doubles finale (mixed-skill partners) → complete → export. Table conflicts are refused; the completed event is read-only except organizer corrections.
- [ ] Private backup export after the final result restores in `restore_verify.mjs` (do on a laptop with the repo).

## 6. Privacy and Google (real event, after cutover)
- [ ] Cloudflare has `REGISTRATION_GOOGLE_MODE=enabled`, `REGISTRATION_EVENT_IDS` = the FFTT3 UUID only, `REGISTRATION_REF_SECRET` set; the response sheet is shared as **Viewer** with the service account only.
- [ ] After loading, the SQL editor shows `registration_sources` with **no** answer data, `players`/`registration_links` with names/levels/opaque refs only, and the audit log without sheet id, e-mail or phone.
- [ ] Switching to `diagnostic` stops loading immediately (incident drill), switching back resumes.
