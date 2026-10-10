# Dashboard Review Fixes — Plan

> Date: 2026-10-10
> Branch: `fix/dashboard-review-2026-10-10`
> Routing: Coding table, Medium tier, planned implementation. Plan and acceptance by the
> Claude Code root (Opus 5.5); implementation by Grok Build `grok-4.7` / high (user
> instruction 2026-10-10 "都給grok 實作"; same-tier Coding Medium option). Merge gate is
> `triple-review` (Grok Build, AGY Gemini, Codex Sol lanes); the Grok review lane runs in a
> fresh read-only context and shares the implementer's family, recorded as overlap.

## User Requests

1. Dashboard Claude Code card shows no reset info and no Fable info.
2. Cursor compact card: show Auto usage and API usage next to Total usage.
3. Review every page, confirm problems, decide fixes.
4. Antigravity multi-account behavior looks wrong.
5. Allowance does not back-calculate the subscription allowance as intended.

## Findings (Verified)

| ID | Finding | Evidence | This PR? |
|----|---------|----------|----------|
| F1 | Claude Session shows no reset text when the 5-hour window is idle. The API returns `resets_at: null` until the next message starts a window; the UI renders nothing. | 183 of the latest 500 `claude-code` snapshots have `Session` with `resetsAt` missing, always at `used: 0` (DB query 2026-10-10). `usage-line.tsx:121-125` only renders when `resetsAt` is a string. | Yes |
| F2 | Fable weekly limit is missing. The Claude usage API now reports it only in `limits[]` as `{kind:"weekly_scoped", scope:{model:{display_name:"Fable"}}, percent:44, resets_at}`; legacy keys such as `seven_day_fable` are absent. | Live `GET /api/oauth/usage` response 2026-10-10; parser `plugins/claude/plugin.js:993-1002`. | Yes |
| F3 | Cursor summary only includes `Total usage`; `Auto usage` and `API usage` fall into details. | `dashboard-page.tsx:25-34` summary label set; live cursor snapshot lines. | Yes |
| F4 | Sessions filters overwrite the Dashboard's records. | `App.tsx:217` passes `onRecords={setRecords}`; the same state feeds `DashboardPage` (`App.tsx:181-186`). | Yes |
| F5 | Dashboard cards are built from the latest 100 records only, so an enabled provider whose newest snapshot is older disappears. | `App.tsx:53` `limit: 100`; `dashboard-page.tsx:166-177`. | Yes |
| F6 | After Refresh All, Sessions shows unfiltered rows under stale filter controls. | `App.tsx:47-58` resets `records`; Sessions `filters` state untouched. | Yes (same fix as F4) |
| F7 | Dashboard keeps cards for disabled providers if a snapshot is loaded. | `dashboard-page.tsx:183` checks only `providerMap.has`. | Yes |
| F8 | Reset text says `Resets now` after the reset time passed while showing the old percentage. | `usage-line.tsx:121-125`, `format.ts:53`. | Yes |
| F9 | Sessions shows unknown cost/tokens as zero; empty Limit sends `limit=0`; empty-filter message says "No Usage Records Yet". | `sessions-page.tsx:41,122,132-136`; `api.ts:95`. | Yes |
| F10 | `formatDate` throws on invalid timestamps and there is no error boundary, so one bad value blanks the app. | `format.ts:24-30`; `provider-ui.ts:109-111`. | Yes (guard only) |
| F11 | Antigravity: enabling any account hides the bare default provider. The account actually in use (`$HOME`, token updated 2026-10-01, has `id_token`) is not tracked; tracked `acct1` is an idle spare account (all meters 0%, window never started). | `provider_accounts` rows: `antigravity:acct1` enabled, `antigravity:acct2` disabled, no `$HOME` row; last bare `antigravity` snapshot 2026-08-08 (1790 rows). `registry.ts:104-135`. | Yes |
| F12 | Antigravity badge repeats the label (`acct1`) because spare-account token files lack `id_token`; plan falls back to generic `allowedTiers[0]` ("Gemini Code Assist"). | `plugins/antigravity/plugin.js:619-624,758-780`. | Yes |
| F13 | Settings Provider Accounts always opens on Codex; Antigravity placeholder suggests `~/.agy-homes/acct1`. Detect treats IDE homes as signed in when `state.vscdb` merely exists. | `settings-page.tsx:31,56`; `account-detect.ts:202-205`. | Yes |
| F14 | Allowance never aligns for Claude/Codex/Cursor: endpoints are mid-day readings, and ccusage rows are local-time days stored as UTC days. | See C7. | Yes |

Deferred (recorded, not in this PR): Tokens "Today" uses UTC day bounds (deliberate for
ccusage; needs a labeling decision), percent display ignoring `limit != 100`, count-format
trailing space, Tokens page date filters treat ccusage local-day rows as UTC days (same root cause as C7, page logic only), Antigravity `allowedTiers[0]` plan label, Codex card labels the weekly window as `Session` (`Resets in 3d 21h`; window key `session` with weekly inferred from `resets_at`), accessibility of progress bars/keyboard drag/toggles, lowercase copy in
`usage-line.tsx:44` and `allowance-page.tsx:142`.

## Changes

### C1 — Claude plugin: parse `limits[]` (F2)
- In `plugins/claude/plugin.js`, after the existing lines, read `data.limits` when it is an
  array. For each entry with `kind === "weekly_scoped"` and a non-empty
  `scope.model.display_name`, push a percent progress line labeled
  `"<display_name> Weekly"` with `used = percent`, `resetsAt = resets_at`,
  `periodDurationMs = SEVEN_DAY_MS`.
- Skip a label already emitted by the legacy parser (no duplicate `Fable Weekly`).
- Keep legacy key parsing for older API responses.
- Tests in `plugins/claude/plugin.test.js`: `limits[]` Fable entry → `Fable Weekly` 44%
  with reset; legacy `seven_day_fable` plus `limits[]` → exactly one `Fable Weekly`.
- Audit new response fields against `src-tauri/src/plugin_engine/host_api.rs` redaction
  lists (AGENTS.md rule for plugin changes); no secrets are added.

### C2 — Progress reset states (F1, F8)
- `usage-line.tsx`: when `resetsAt` is missing but `periodDurationMs` is present and
  `used === 0`, render `Window Starts On Next Use`. When `resetsAt` is in the past, render
  `Reset Due · Refresh For New Value` instead of `Resets now`.
- Test the label selection as a pure helper in `apps/web/src`.

### C3 — Cursor summary (F3)
- Add `Auto usage` and `API usage` to `SUMMARY_PROGRESS_LABELS`. Update
  `dashboard-page.test.ts`.

### C4 — Dashboard data source (F4, F5, F6, F7)
- Dashboard gets its own data: the latest snapshot per enabled provider. Add a server
  query `GET /api/usage/latest-snapshots` (one newest `OpenUsage Plugin Snapshot` or
  quota-bearing record per provider) and use it in `App.tsx` instead of slicing
  `records`.
- `SessionsPage` owns its own records state; it no longer calls `setRecords` in `App`.
  Refresh All re-runs Sessions' current filters.
- `providerDataMap` skips providers with `enabled === false`.
- Tests: server query returns one row per provider even when another provider has 100+
  newer rows; dashboard skips a disabled provider.

### C5 — Sessions and date robustness (F9, F10)
- Unknown cost/tokens render `-`. Limit clamps to 1..1000, default 100. Empty result with
  filters shows `No Records Match These Filters`.
- `formatDate` returns `Invalid Date` text for unparseable input instead of throwing.

### C6 — Antigravity accounts (F11, F12, F13)
Constraint from PR 31 (`docs/reviews/2026-08-08-cursor-antigravity-accounts-pr31-triple-review.md`):
Google email stays out of provider/account labels and detect labels, and the
`allowedTiers[0]` plan fallback is a deliberate QA fix. Both stay unchanged.
- Settings: when a multi-account provider has at least one enabled account and none of
  them points at that provider's default home (Antigravity: `~`), show a notice
  `Default Account Not Tracked` with a button that adds the default home through the
  existing add-account API (label `Antigravity · Local CLI`).
- Settings: default the provider selector to the first provider that has accounts;
  Antigravity placeholder becomes `Antigravity · Local CLI` / `~`.
- Plugin badge: when there is no `id_token` email, omit the `Account` badge instead of
  repeating the home basename that is already in the card title. Existing email badge
  behavior is unchanged.
- Detect: IDE homes count as signed in only when `state.vscdb` contains the OAuth key
  (reuse the plugin's existing query), not when the file merely exists.
- Live data: no automatic account change. After deployment the user adds the default
  home with the new button (or explicitly asks the orchestrator to do it).
- Tests: notice shown/hidden logic as a pure helper; badge omitted without email; detect
  rejects an IDE fixture without the OAuth key.

Follow-up, same branch: the notice uses every account loaded when Settings opens, and
it stays at the top of Provider Accounts when another provider is selected. The text is
`Default Antigravity Account Not Tracked`. The button adds `Antigravity · Local CLI` /
`~` and selects Antigravity. Antigravity's capability includes `defaultHomePath` from
`normalizeHomePath("~")`. The page does not derive that home from the database path.

### C7 — Allowance boundary alignment (F14)
Verified causes (2026-10-10):
- `estimateCycle` (`packages/providers/src/allowance-estimate.ts:300-313`) measures from
  the first to the last meter reading of the cycle. Both fall mid-day, so a daily token
  row always straddles an endpoint and the cycle is rejected as `unaligned`. Live 7-day
  result: Claude, Codex and Cursor unaligned; Grok aligned only because it had no token
  rows on its endpoint days.
- ccusage groups days by the system time zone (`--timezone` default; server runs in
  Asia/Taipei, no `TZ` override). Stored ccusage rows use `YYYY-MM-DDT00:00:00.000Z`, but
  the real bucket is the local day: Claude 2026-10-09 local = 382,279,638 tokens vs
  231,894,683 with `--timezone UTC` (`../openusage_webui-artifacts/2026-10-10-review/ccusage-utc.json`).
  `sqlite-storage.ts:779-781` treats the bucket as the UTC day, an 8-hour shift.
  Cursor and Grok rows are true UTC days.

Changes:
1. `packages/storage/src/sqlite-storage.ts` token-row mapping for allowance: for tool
   `ccusage`, `startedAt` = local midnight of the row's date in the server process time
   zone and `bucketEnd` = next local midnight. Cursor/Grok keep UTC days. No stored data
   is rewritten.
2. `estimateCycle`: choose aligned measurement boundaries instead of raw first/last
   readings. Candidates are the first and last readings plus every bucket start/end of
   this provider's positive token rows inside that span. A candidate `t` is usable when
   no positive row of the provider straddles `t` (`start < t < end`) and the meter value
   at `t` is known: a reading exactly at `t`, or the nearest readings before and after
   `t` are equal (the meter is monotonic within a cycle; falls are already reported as
   `meter-fell`). Use the earliest usable candidate as `tokenFrom` with its value as
   `percentStart`, and the latest as `tokenTo` / `percentEnd`. If fewer than two usable
   candidates exist, keep the current `unaligned` result.
3. The returned `from`/`to`/percent fields describe the aligned span so the page shows
   what was actually measured. The page text stays as is except where it describes the
   rule; update `docs/` allowance text.
4. Accepted limit: an equal reading across a boundary only proves movement under one
   percentage point, so each end can be off by up to one point. Claude weekly includes
   usage from other surfaces/machines; this is already described on the page.

Tests (`packages/providers/test`, `packages/storage/test`):
- Cycle with mid-day first/last readings and daily rows, flat readings across two
  boundaries → `ok`, tokens summed only over buckets inside the aligned span.
- Boundary where readings differ on each side → not usable; fall back to `unaligned` when
  no pair remains.
- ccusage row date maps to local-midnight bounds when `TZ=Asia/Taipei` (run that test
  file with `TZ=Asia/Taipei`), Cursor row stays UTC.

Scope limits: C7 is read-side only. Do not change the ccusage invocation
(`openusage-plugin-runtime.ts:310`) or any import path, and do not change `COARSE_DELTA`.
`meter-fell` stays computed over the whole cycle (conservative). Meter points come from
`quota_observations`, which store a row on every change plus a 6-hour heartbeat, so two
adjacent equal observations prove no movement between them at any gap; no time-gap
threshold is used.

Acceptance: run the server on port 6738 against a copy of the live database (never the
live file) and confirm `GET /api/usage/allowance?days=7` returns `ok` for Claude Code and
Codex; Cursor returns `ok` (possibly flagged coarse) or a recorded reason; Grok Build's
7-day estimate stays 878.63M tokens (regression anchor: UTC rows, unchanged endpoints).
Record the numbers in the fix log. Routing for C7: Grok Build `grok-4.7` / xhigh (Coding
High engineering cell; load-bearing estimate logic).

## Docs To Update
- `docs/providers/` Claude and Antigravity pages (Fable from `limits[]`; account badge).
- `README_WEBUI.md` / `README_WEBUI.zh-TW.md` if dashboard behavior text mentions them.
- `status.md`, `tracker.md`, `handover.md` at delivery.

## Acceptance
- Plugin tests: `bun run test -- --run plugins/claude plugins/antigravity` (vitest).
- WebUI tests: `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`
  (bun:test; some `packages/providers/test` cases are known env-sensitive on `main`, compare
  against `main` before attributing a failure).
- Builds: `bun run build:webui`.
- Headless screenshot of `/dashboard`: Claude shows `Fable Weekly` with reset; Cursor
  compact card shows three meters; idle Session shows `Window Starts On Next Use`.
- Before/after screenshots stored in
  `../openusage_webui-artifacts/2026-10-10-review/` for the PR (visual change rule).
