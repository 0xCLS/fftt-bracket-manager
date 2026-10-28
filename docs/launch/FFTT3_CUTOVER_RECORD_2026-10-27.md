# FFTT3 hosted cutover record — October 27, 2026

**Approved by the organizer in chat; executed in the order of `FFTT3_CUTOVER_RUNBOOK.md`; every gate passed.** PR #19 remains a draft. No participant data, credential or backup is in this repository.

| Item | Result |
| --- | --- |
| Release code commit | `efcdc0003e24ac183be0ab4b010c79a0d6ba88c8` (CI run 40570687105 green); branch head at cutover `0978047` (tests/docs only, CI run 40573404676 green) |
| Pre-cutover backup | fresh private export (73,118 bytes, SHA-256 `6bf4a571…2f61`), identical to the earlier export in all 15 tables; `restore_verify.mjs --rehearse` → ALL CHECKS PASSED; **second copy**: AES-256 encrypted, decrypts to the identical hash, key in the macOS Keychain |
| Hosted schema before | all six fingerprints equal the repository-built "before" values |
| Migration | `build_single_project_upgrade.py` output, SHA-256 `9812087552ccd97aad3af135514e88fc037c3d7b8097db303b495f2cb35c35f6` (editor content hash-checked before running), applied once in the Supabase SQL editor: "Success" |
| Hosted schema after | constraint 87 `85f32e20…`, function 94 `ef010512…`, trigger 5 `bcc594f6…`, column/rls/view unchanged — **equal to the expected "after" values** |
| Data after | all 12 populated tables' row counts and md5 fingerprints **identical** to the backup (4 fictional events, 18 players, 25 matches, 20 score decisions, 13 staff grants, 52 audit events, …) |
| Event mode | changing `synthetic_only` fails (`fftt_event_mode_immutable`); verified in a rolled-back transaction |
| Real event | created through the real `fftt_create_event_v3` RPC as the existing platform Organizer: real mode, draft, **not public**, table count 2 (provisional; confirm on Overview), formats at the app defaults — regular and championship rounds Bo3 to 11, championship final Bo3 to 11, consolation one game to 21, doubles Bo3 to 11 (**Organizer to confirm on Overview**), only the Organizer granted; audit `event_created` only. Its id is recorded in the private knowledge repository, not here. **No scorekeeper granted** (no confirmed identity yet); **no players** |
| Cloudflare (staff project, Production) | new secrets `REGISTRATION_EVENT_IDS` (this one event only) and `REGISTRATION_REF_SECRET` (from the private local file); `REGISTRATION_GOOGLE_MODE` `diagnostic` → `enabled`; `GOOGLE_SA_EMAIL`/`GOOGLE_SA_PRIVATE_KEY` untouched |
| Deployments | Staff `3be2a824-70c0-4dd2-a894-b5c527a53a81`, Spectator `c41ef841-d5d3-4f75-9d23-cc1678b50cb8`, both from `efcdc00`; `verify_deployment.py` on the stable URLs: all files hash-identical to the local manifests, headers, private paths 404, Function 405 (GET) / 401 (no token); spectator serves no Function and no staff page |
| Hosted acceptance (rolled back) | `tests/hosted_launch_acceptance_rollback.sql`: **25/25 PASS** — real event not public and untouched, Organizer sees 5 events, fictional scorekeepers/outsider/anonymous refused on the real event, Google source may be saved and enabled only on the real event (demo source refused), disposable real-mode event: full names stored, scorekeeper A accepted / B rejected, revoked scorekeeper denied at once, audit free of sheet ids and contacts. Afterwards: 5 events, 1 real, 0 public, 18 players, 25 matches, 0 sources, no leftovers |
| Auth | public sign-ups, manual linking and anonymous sign-ins off; e-mail confirmation on |

## Rollback references
* **Cloudflare:** Staff `944c112b-25ad-4ef2-9d81-c47acf1eb477` (before it `6ffe2598-b0f7-47fa-b411-0a89034eb269`); Spectator `d877dd90-7e75-476c-8c27-204ac84e1352` (before it `a367d9f9-af87-4518-a42f-c152ea1a2823`). The older staff bundles still work against the upgraded database (function signatures unchanged).
* **Database:** the rollback SQL (SHA-256 `2bf97f3e…ab366`) restores the exact pre-upgrade schema but **refuses now that a real event exists**; from here recovery is roll-forward or restore from the private backups.
* **Incident switches:** set `REGISTRATION_GOOGLE_MODE` back to `diagnostic` and redeploy; "Hide from the public" is already the state.

## Not done (not authorized or not possible)
* No registration answer was read: reading needs the Organizer's own signed-in session (Players → Registration settings → paste the response-sheet link → Check sheet → Test connection → Enable/Save → Load registrations). No one was checked in; nothing is public.
* No scorekeeper was granted; no account was created.

---

# Addendum — Staff UI release, October 27, 2026 (rank shields, compact registration list, simplified column mapping)

**Approved by the organizer in chat. Staff project only; Supabase, Spectator, Cloudflare variables and event data untouched. PR #19 remains a draft and unmerged.**

| Item | Result |
| --- | --- |
| Release commit | `8e783921a0de56925ae5a2781db3a5e9e7a30303`; CI run 40624210113 on that exact commit: both jobs green (Disposable synthetic PostgreSQL, test) |
| Bundle | `build_export.py` from a clean detached worktree at that commit (staff target, staging environment, both origins pinned); 36 files, every file hash equal to `MANIFEST.json`, manifest `commit` = the release commit; the existing `functions/api/registrations.js` Pages Function included |
| Deployment | **Staff `390e958a-79f3-4a2c-90bf-9a3056279050`** to the existing `fftt3-staff-stg` project (Production, branch `main`), `https://fftt3-staff-stg.pages.dev` |
| Live verification | `verify_deployment.py --kind staff` on the stable URL: **ALL LIVE CHECKS PASSED** — 34/34 served files hash-identical (`_headers`/`_redirects` consumed by Cloudflare), live `MANIFEST.json` equals the local one, CSP self-only with only the pinned Supabase project, nosniff, no-referrer, no-store, noindex, HSTS, private paths 404, GET `/api/registrations` 405, token-less POST 401 |
| Origin protection | POST from a foreign `Origin` → 403; the project still lists all nine secrets by name (`GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `REGISTRATION_ENABLED`, `REGISTRATION_EVENT_IDS`, `REGISTRATION_REF_SECRET`, `REGISTRATION_SOURCE`, `STAFF_ORIGIN`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`); a deployment does not change project variables, and `REGISTRATION_GOOGLE_MODE` (a plain-text variable, not listed by name above) was not edited |
| Shields (live code, rendered in real Chrome) | five `40×40` SVG badges at phone, tablet and desktop widths; face colors grey `#6b7280`, green `#23945b`, blue `#2679ce`, orange `#e88320`, purple `#9544bc` for Levels 1–5; 1–4 chevrons, a five-point star at Level 5; no feather, laurel or extra star elements |
| Responsiveness / console | Staff page at 390×844 (touch, 2×), 768×1024 and 1440×900 in real Chrome: no horizontal overflow, **0 console warnings/errors, 0 failed requests** |
| Registration list, column mapping, check-in, duplicate handling, accessibility | covered by the CI browser suite on the same commit (compact full-width list, simplified mapping, existing check-in/duplicate/axe behavior); **not** re-exercised on the live site because that needs the Organizer's signed-in session |

**Not done (by instruction):** no Supabase change, no registration answer read or imported, nobody checked in, no change to event visibility, no Spectator deployment, no new infrastructure.

**Rollback reference:** Staff `3be2a824-70c0-4dd2-a894-b5c527a53a81` (from `efcdc00`; before it `944c112b-25ad-4ef2-9d81-c47acf1eb477`) — Cloudflare dashboard "Rollback to this deployment", or redeploy that bundle. Older Staff bundles still work against the upgraded database. Spectator is unchanged (`c41ef841-d5d3-4f75-9d23-cc1678b50cb8`).

**Organizer review tasks:** sign in, open Players → Registration settings and confirm the simplified mapping on the real response sheet; Load registrations and eyeball the shields, compact list and suggested levels on a laptop and a phone; confirm duplicate groups and one-tap check-in behave as before (do not check anyone in until the event); table count and formats on Overview.
