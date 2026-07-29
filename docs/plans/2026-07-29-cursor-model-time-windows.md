# Cursor Model / Time-Window Usage Implementation Plan

> **For agentic workers:** Implement task-by-task. Docs: `docs/providers/cursor.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md` if user-facing.

**Goal:** Show Cursor usage broken down by model and time window (Last 7 Days + current billing cycle) using the unofficial dashboard events API.

**Architecture:** Reuse existing `WorkosCursorSessionToken` cookie auth. Non-fatally `POST https://cursor.com/api/dashboard/get-filtered-usage-events` with `startDate`/`endDate`, paginate with a hard cap, aggregate by model locally, emit detail `text` lines on the Cursor card. Primary Credits/Total usage path unchanged.

**Tech Stack:** `plugins/cursor/plugin.js` + `plugin.test.js`, WebUI summary label whitelist, Bun tests.

## Global Constraints

- Fail loudly into plugin logs; never fail the whole Cursor probe if events fetch fails.
- Title Case for hardcoded UI labels.
- Keep probe bounded: max pages × pageSize (e.g. 5 × 100).
- Redact auth cookies in host logs (already covered by Cookie header redaction patterns if present; verify).
- Docs stay English; chat stays Traditional Chinese.

## Files

| File | Role |
|---|---|
| `docs/plans/2026-07-29-cursor-model-time-windows.md` | This plan |
| `plugins/cursor/plugin.js` | Fetch + aggregate + emit lines |
| `plugins/cursor/plugin.json` | Declare new detail line labels |
| `plugins/cursor/plugin.test.js` | Regression tests |
| `apps/web/src/pages/dashboard-page.tsx` | Promote Credits / Total usage / Requests to summary |
| `docs/providers/cursor.md` | Document events API + metrics |

## Tasks

### 1. Aggregation helpers (TDD)

- [ ] Add pure helpers: `windowBoundsMs`, `aggregateEventsByModel`, `formatModelBreakdownLines`
- [ ] Tests with fixture events spanning two days / three models

### 2. Events fetch

- [ ] `fetchFilteredUsageEvents(ctx, accessToken, { startMs, endMs })` with Cookie + `Origin: https://cursor.com`
- [ ] Paginate until empty or page cap
- [ ] Soft-fail on 401/4xx/network

### 3. Wire into probe

- [ ] After main usage lines, fetch Last 7 Days + billing-cycle windows
- [ ] Emit: window total text + top 5 models by cost (detail scope)
- [ ] Update `plugin.json` line skeletons

### 4. WebUI summary

- [ ] Add `Credits`, `Total usage`, `Requests` to `SUMMARY_PROGRESS_LABELS`

### 5. Docs + verify

- [ ] Update `docs/providers/cursor.md`
- [ ] Run `plugins/cursor/plugin.test.js` + web dashboard split tests
