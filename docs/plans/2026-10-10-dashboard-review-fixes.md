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
| F14 | Allowance: see section below. | — | See below |

Deferred (recorded, not in this PR): Tokens "Today" uses UTC day bounds (deliberate for
ccusage; needs a labeling decision), percent display ignoring `limit != 100`, count-format
trailing space, accessibility of progress bars/keyboard drag/toggles, lowercase copy in
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
- Detect labels CLI homes with the `id_token` email when present; IDE homes require the
  OAuth key in `state.vscdb` (reuse the plugin's query), not file existence.
- Plugin badge: use `id_token` email; otherwise omit the badge (no basename echo). Plan:
  drop the `allowedTiers[0]` fallback unless the tier is marked default; return no plan
  rather than a generic tier.
- Settings: default the provider selector to the first provider that has accounts;
  Antigravity placeholder becomes `~` labelled `Local CLI`. When enabling the first
  account for a provider, show a notice that it replaces the default card and offer the
  default home in detect results.
- Live data step after merge (reversible, via the existing API): add and enable
  `Antigravity · Local CLI` (`$HOME`); leave `acct1`/`acct2` as the user configured them.
- Tests: detect fixture with and without `id_token`; plugin badge/plan fallbacks.

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
