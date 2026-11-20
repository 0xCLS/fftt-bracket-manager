# FFTT3 registration: event-driven publisher trigger

**Status (Nov 20, 2026):** Active and verified. The spreadsheet owner authorized the script; both automatic triggers ran successfully on a real registration and an hourly reconciliation. The legacy GitHub `:17` and `:47` cron schedules have been retired. Manual `workflow_dispatch` remains available as an emergency fallback.

## Behavior

- A Google Sheets **installable form-submit trigger** fires after a genuine form submission to the original FFTT3 Registration spreadsheet, tab **Form Responses 1**.
- It sends a GitHub Actions workflow dispatch to **0xCLS/fftt-bracket-manager**, workflow **public-registration-count.yml**, branch **main**, containing only the ref main. It never reads, forwards, stores or logs names, contact details or responses.
- The already-deployed, separately authenticated GitHub workflow reads the original source read-only, canonicalizes registration names, and publishes only a verified aggregate snapshot. No existing scorer, Staff, Spectator, Cloudflare or database behavior changes.
- An hourly **Apps Script** reconciliation trigger handles missed form events and manual sheet changes. The script stops dispatching after November 23, 2026 in Detroit local time. Both Google triggers may delay; their automatic executions were observed before the legacy GitHub cron was retired.

## Spreadsheet owner activation

1. Create a short-lived **GitHub fine-grained personal access token** limited to **only repository 0xCLS/fftt-bracket-manager** and repository permission **Actions: Read and write** (required for workflow dispatch). Keep the token private; do not share it with the assistant or put it in source control.
2. Open the **original FFTT3 Registration Google Sheet**, then **Extensions → Apps Script** (not the Google Form). Add the source from **Code.gs** to the sheet-bound Apps Script project without overwriting any unrelated code or triggers. Save.
3. Under **Project Settings → Script properties**, add **FFTT_GITHUB_ACTIONS_TOKEN** whose value is that fine-grained token. Keep project access restricted.
4. Select and run **ffttInstallTriggers**. Approve Google's installation/authorization request. The installer verifies the original tab and expected Timestamp/Full Name headers and creates only the FFTT form-submission and hourly reconciliation triggers, idempotently.
5. Select and run **ffttVerifyDispatch**. This sends a refresh request but **does not create a fictional player**. Verify a new **workflow_dispatch** run on https://github.com/0xCLS/fftt-bracket-manager/actions/workflows/public-registration-count.yml, that its update job completes, the public JSON remains valid, and the rendered homepage count remains accurate.
6. Confirm **ffttOnFormSubmit** and **ffttReconcile** exist under Apps Script **Triggers**, with no duplicates. Check **Executions** for errors. Use the next *genuine* registration to prove an event-driven count change. Check Google trigger failure notifications and GitHub Actions run history.
7. **Verified Nov 20, 2026:** A real registration fired `ffttOnFormSubmit` at 12:48:45 AM EST, triggering [GitHub run 44683506208](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/44683506208) and a 32 → 33 public count. `ffttReconcile` completed automatically at 12:11:19 AM EST, corresponding to [GitHub run 44679341913](https://github.com/0xCLS/fftt-bracket-manager/actions/runs/44679341913). After these acceptance checks, the two old GitHub cron entries were retired; **manual `workflow_dispatch` and both Apps Script triggers remain**.
8. After the event run **ffttRemoveTriggers**, revoke the GitHub token, and verify the triggers are gone.

## Security and caveats

The only outbound event payload is a workflow dispatch referencing main, never the form values. The Script Properties token grants dispatch access to one repository; the Google script does not need any GitHub Contents write permission. Installation reads only A1:B1 headers; the existing publisher retains its private read-only spreadsheet credential and fail-closed limits. HTTP failures throw only a status code, not the response body or secret. A successful dispatch is **not** proof the underlying publication succeeded.

The legacy GitHub cron was retired only after the two automatic trigger paths were verified. Manual workflow dispatch remains for emergency refresh. This integration is specific to FFTT3 and its hard-coded event date.
