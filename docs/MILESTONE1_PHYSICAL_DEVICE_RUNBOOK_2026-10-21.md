# Milestone 1 — Physical-device rehearsal runbook (PREPARED, NOT AUTHORIZED TO RUN)

_October 21, 2026 · synthetic development project only · nothing here has been executed. Running any step that sends an email or changes a hosted setting needs Christopher's explicit approval of the exact item (see **Approvals**)._ Companion record: [implementation and design findings](MILESTONE1_MULTI_DEVICE_OPERATIONS_2026-10-21.md).

## 1. What can be tested now vs. later

**Tier 1 — possible with the existing, already-consumed, read-only hosted fixtures** (no new fixture, no scoring, no publication, no grant change):

| Test | Needs email? | Shows |
| --- | --- | --- |
| Device readiness on every device | no | HTTPS/secure context, Web Crypto, tab storage, origin approved |
| Public TV board outage behavior | no | anonymous read, LIVE → STALE → removed → automatic recovery (no published rows exist, so it shows the empty state) |
| Organizer, Scorekeeper A, Scorekeeper B each sign in on their own device | 3 | independent PKCE sign-in, verified identity, event-scoped role, read-only desk at one authoritative revision |
| Outsider device | 1 | authenticated but no event role: nothing shown |
| Background, mail-app switch, offline | no (reuses sessions) | suspend/resume with fresh identity + role proof, sign-out on offline/overrun |
| Organizer fallback tabletop with real people and real devices | no | physical stand-down evidence, protected-backup check, manual reconciliation (fictional data, no scoring) |

**Tier 2 — NOT possible without new approvals** (do not attempt on Tier 1 fixtures): contested scoring on two phones, lost-response recovery on a real network, live revision change across devices, **revocation of a hosted grant**, spectator/TV showing real published results (needs publication), a server-side event freeze, an emailed-code sign-in alternative. These need a new disposable fixture with pending matches (fixture #4), a reviewed grant/publication procedure, and a new written approval. The three existing scoring fixtures stay consumed.

## 2. Devices and browsers

* **Host:** the organizer's Mac (this checkout, expected HEAD, CI green on that exact commit).
* **Organizer device:** the Mac's browser.
* **Scorekeeper A:** a phone (iOS Safari or Android Chrome, current version). **Scorekeeper B:** a different device (tablet or second phone, ideally the other OS).
* **Outsider:** a third device or a separate browser profile.
* **TV/projector:** a browser on the host Mac (or its own computer) pointed at the board page.
* Normal (non-private) tabs; no content blockers that stub `sessionStorage`; mail in a **browser tab** or a mail app whose link-copy menu works. A mail app's built-in browser **cannot** finish sign-in.

## 3. Hosting the pages for phones

Phones cannot use `http://localhost:3000` and a plain-`http://` LAN address fails the secure-context check. Required: a **private** HTTPS origin on the **default port (443)**. Options (no public hosting, no tunnels):

| Option | Notes |
| --- | --- |
| A. Tailscale `serve` on the Mac (private tailnet name, trusted certificate, no CA to install on phones) | Free personal plan appears sufficient but is a **new vendor account and app on every phone — needs your approval**; verify HTTPS support and current `tailscale serve` syntax on the day. **Never use `funnel`** (public). |
| B. Local HTTPS with a locally trusted CA (e.g. mkcert) on a private Wi-Fi you control | Needs the CA installed *and trusted* on every phone, a name or IP the certificate covers, and Wi-Fi without client isolation. Most manual setup. |
| Not allowed | GitHub Pages or other public static hosts, trycloudflare/ngrok-style tunnels (the policy refuses them), plain-http LAN addresses. |

**Serve from a clean export, never the working checkout.** The local server serves its entire current directory, which would expose any untracked private files (backups, markers, notes) to every device on the network.

```
mkdir -p ~/fftt-device-rehearsal && git -C <checkout> archive HEAD rehearsals contracts | tar -x -C ~/fftt-device-rehearsal
# private, git-ignored in the checkout; create it only in the export:
echo '{"approvedHttpsOrigins":["https://<approved-origin>"]}' > ~/fftt-device-rehearsal/rehearsals/m1/device-origins.local.json
cd ~/fftt-device-rehearsal && python3 <checkout>/tools/c8/local_readonly_server.py   # binds 127.0.0.1:3000 only
```

The script may open the C8 page in your browser; close it and do not press its request button. The proxy (option A or B) forwards HTTPS 443 to `http://127.0.0.1:3000`. The hostname/origin is private: do not paste it into Claude Code, ChatGPT, screenshots or the repository.

## 4. Hosted prerequisites (hosted changes — approval required, none made)

1. **Redirect allowlist:** add exactly `https://<approved-origin>/rehearsals/m1/device-staff.html?state=*` in Authentication → URL Configuration. **Keep** Site URL `http://localhost:3000`, the C8 entry and the M1 localhost entry; do **not** change the Magic Link template or SMTP. (`requiredRedirectAllowlistEntry()` in the device policy module computes the exact string.) Christopher saves it and confirms the saved list by screenshot **before** any email: if the entry is missing, Supabase silently redirects to the Site URL, the link is consumed on a page the phone cannot reach, and that attempt is lost.
2. **After the rehearsal** Christopher removes that entry unless a follow-up rehearsal is approved.

## 5. Existing synthetic identities and roles

Per the audited record: four synthetic Auth users (Organizer, Scorekeeper A, Scorekeeper B, Outsider) and nine event-scoped grants over the three consumed fictional events (organizer + two scorekeepers each; the outsider has none). Only Scorekeeper A's mailbox is documented as reachable (Yahoo, delivered to Spam). **Confirm before the session that the operator can open the mailbox for every account used.** The event UUID is typed locally on each device; never share it.

## 6. Approvals checklist (Christopher)

- [ ] Hosting option (A, B, or neither) and, for A, creation of a Tailscale account and app installs.
- [ ] The exact redirect allowlist addition above (and its later removal).
- [ ] Number of real emails (Tier 1 maximum **4**: one per account, each ≥ 60 s apart per account, **no retries**).
- [ ] Which mailboxes/devices represent each account, and who is allowed to hold the outsider account.
- [ ] Background grace: keep **120 s**, shorten, or **0** (design finding 5).
- [ ] Phone link hand-off: accept the copy-link-and-paste-into-original-tab procedure, or authorize a later 6-digit-code design (finding 4).
- [ ] Organizer-window handling for fallback (finding 6) and server-side freeze (finding 7) — informational for Tier 1, decisions for Tier 2.

## 7. Exact order

**R0 Preflight (host).** HEAD is the commit CI passed on; clean export built; local server and HTTPS proxy running; `https://<origin>/rehearsals/m1/device-check.html` loads from a phone. Redirect entry saved and screenshot-confirmed. Stop if any item fails.

**R1 Device checks (no email).** On every device open `device-check.html`, type the approved origin, press *Check*. All automatic checks must be ✔. Do the two manual checks it lists (the mail link can be pasted into the original tab; the tab survives switching to mail). A ✘ means *do not* attempt sign-in on that device.

**R2 TV board (no email).** On the TV browser open `tv-display.html`, press *Start*. Expect LIVE with "No approved results are published yet". Turn that device's Wi-Fi off for ~30 s: expect STALE; keep it off past 2 minutes: expect "NO CURRENT DATA". Restore Wi-Fi: it recovers on its own. Press *Stop and clear*.

**R3 Organizer sign-in (email 1).** On the Mac open `device-staff.html` → READY. Type the account address, tick the single-email box, press *Request* **once**. Open the mailbox (check Spam). **Copy the link address without opening it** and paste it into the *same tab's* address bar. Expect: address cleared, "Return received". Type the event UUID, *Finish sign-in* → "SIGNED IN · verified organizer". Press *Follow*: revision, generation and pending count appear and refresh every 6 s.

**R4 Scorekeeper A (email 2)** on the phone, **R5 Scorekeeper B (email 3)** on the second device: same procedure. All three devices now follow concurrently; revision and generation must be identical on all.

**R6 Outsider (email 4):** same procedure. Expect sign-in to fail at authorization ("Sign-in failed") with nothing displayed.

**R7 Lifecycle on the phone:** switch to the mail app for < 2 minutes and return → "re-verified", following resumes. Leave for > 2 minutes → "SIGNED OUT". Re-sign-in by email is **not** part of Tier 1; stop here for that device. On another signed-in device switch on airplane mode → "SIGNED OUT · connection lost"; restoring the connection must **not** resume.

**R8 Sign out and clean tabs** on every device (*Sign out*, then close the tab).

**R9 Fallback tabletop (host, no network, no email).** Open `fallback-ops.html`, choose **live** evidence mode. Verify organizer, declare outage, request stand-down. For each real device (A, B, TV) physically take it out of use (app closed, screen off) and, *only when you have seen it*, acknowledge it as **organizer-physically-observed**. Seal a fictional backup, re-verify, begin fallback, record a paper-backed fictional result, reconnect, disposition it by hand, sign off, run the fresh read, release each device, verify the incident log. This demonstrates the human procedure; it does not stop any device by itself and uses no cloud data.

**R10 Post-audit.** Christopher's read-only aggregate audit must match the baseline: 3 events, 3 private matches, 9 grants, 4 Auth users, 4 durable decisions, 3 accepted submissions, 0 public events, 0 public matches.

## 8. Stop conditions (stop the whole session; do not retry)

HTTP 429 or any request failure; a missing email; any redirect to a page other than the approved device origin (especially a `localhost` page on the phone); callback without both `code` and `state`, an `#access_token` fragment, a state mismatch or lost verifier; a link opened in a mail app's browser or another tab; identity mismatch; missing/revoked event role on an account that should have one, **or any role on the outsider**; revisions that differ between devices at rest; any score submission, mutation, publication or grant change; any sign of private data (UUIDs, contacts) on a public screen; any change in the post-audit counts. Record only sanitized phrases; never copy links, codes, tokens, UUIDs or addresses into chats, screenshots or files.

## 9. Recovery and cleanup

Sign out and close every tab; stop the HTTPS proxy and the Python server; delete the export directory (it contains the private origin file); remove any trusted CA profile or Tailscale node installed on phones; Christopher removes the redirect allowlist entry; confirm via the aggregate audit that nothing changed. A consumed or uncertain link is never reused; a new email needs a new approval.
