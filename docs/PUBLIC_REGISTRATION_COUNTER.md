# FFTT3 public registration counter

## Verified starting point

The public counter starts at **31 distinct active names** as read from `FFTT3 Registration`, tab `Form Responses 1`, on November 16, 2026. The reported withdrawals Errol Liverpool and Letrisha Stallard are not in this current active sheet. The separately named `FFTT3 Registration Withdrawals` workbook is a historical version, not a list of names to subtract.

The source must remain a curated active-registration list: authorized organizers need to remove or exclude new withdrawals there. The count is not a check-in or guaranteed attendance figure.

## Approach

- The public website is static. A local fallback shows the verified starting snapshot.
- GitHub Actions runs hourly, reads only columns A:B (timestamp and full name) of the private Sheet using a **read-only service account**, deduplicates in memory, and writes only `{eventDate,count,verifiedDate}` to `public-site/data/registration-count.json`. It never logs or publishes names or registration answers.
- The homepage fetches that count-only file from public GitHub raw/main (with a local fallback), so hourly Cloudflare Pages redeployment is **not** required.
- Commits occur only when the count changes or the calendar date advances. GitHub cron may have occasional delays. The website labels the last **verified date**, not second-by-second availability.
- Fail closed if Google authentication or sheet access fails. Never publish zero on failure. Stop refresh after November 23, 2026; future events require reconfiguration.

## Required configuration (not yet verified)

Configure these GitHub Actions repository secrets in `0xCLS/fftt-bracket-manager`:

- `FFTT_COUNT_SERVICE_ACCOUNT_JSON` — read-only Google Sheets service account credential JSON; do not commit or print it.
- `FFTT_COUNT_SPREADSHEET_ID` — private ID for the **active** `FFTT3 Registration` spreadsheet, not the withdrawals archive.

Ensure the spreadsheet is shared with the service account as **Viewer**. The workflow deliberately skips updates when secrets are unavailable, and the website retains 31 until a verified update. Hourly refresh must not be claimed active until a successful workflow run is observed.

## Verification, deployment, privacy

Run `node --test tests/public_registration_count.test.mjs`. After merging the feature and configuring the secrets, run the workflow manually for a first check and inspect the count-only public JSON. Never expose staff credentials, the sheet ID, player names, or form answers. The public site must keep its **isolated static `public-site/` Cloudflare Pages deployment**, with no Functions bundle or changes to Staff, Spectator, DNS, or database. Check responsive desktop/tablet/mobile layouts and warmed-browser CSS pairing before production release.
