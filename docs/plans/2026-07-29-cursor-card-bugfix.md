# Cursor Card Bugfix Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. Docs: `docs/providers/cursor.md`.

**Goal:** Fix the seven Cursor-card defects from the 2026-07-29 bug review so dark-mode charts, detail grouping, partial event samples, and cost parsing behave correctly.

**Architecture:** Keep soft-fail event aggregation in `plugins/cursor/plugin.js`. Fix WebUI summary whitelist in `dashboard-page.tsx` so window totals stay with their model rows. Prefer theme CSS for chart bars instead of hardcoded black.

**Tech Stack:** Cursor plugin (`plugin.js` / `plugin.test.js` / `plugin.json`), WebUI dashboard split + `usage-line` CSS, Bun/Vitest.

## Global Constraints

- Fail loudly into plugin logs; never fail the whole Cursor probe if events fetch fails.
- Title Case for hardcoded UI labels.
- Docs stay English; chat stays Traditional Chinese.
- No drive-by refactors outside the listed findings.

## Files

| File | Role |
|---|---|
| `docs/plans/2026-07-29-cursor-card-bugfix.md` | This plan |
| `plugins/cursor/plugin.js` | Colors, truncated mid-fetch, Number cost parse, DST day buckets, Bonus spend format |
| `plugins/cursor/plugin.json` | Declare `Bonus spend`, `Events Note` |
| `plugins/cursor/plugin.test.js` | Regression tests |
| `apps/web/src/pages/dashboard-page.tsx` | Stop promoting `Last 7 Days` into summary |
| `apps/web/src/dashboard-page.test.ts` | Update Cursor split expectations |
| `apps/web/src/styles.css` | Ensure bar default uses theme ink (already does when color omitted) |
| `docs/providers/cursor.md` | Note partial-sample + chart theming |

## Tasks

### 1. Dark-mode chart colors

- [x] Test: cost/token `barChart` lines omit hardcoded `#000000` / `#555555` (or use no `color`)
- [x] Implementation: remove `color` from `pushDailyCharts` so WebUI uses `.usage-barchart-bar { background: var(--ink) }`

### 2. Keep Last 7 Days with model rows

- [x] Failing test: Cursor split keeps `Last 7 Days` + model rows together in detail
- [x] Remove `"Last 7 Days"` from `SUMMARY_TEXT_LABELS`
- [x] Update existing Cursor overview test

### 3. Mid-pagination incomplete sample

- [x] Failing test: page 1 full + page 2 non-2xx ⇒ totals from page 1 + `Events Note` / truncated
- [x] Set truncated (or incomplete flag) whenever fetch breaks early with partial events

### 4. Coerce string cost fields

- [x] Failing test: `chargedCents: "250"` and/or `tokenUsage.totalCents: "100"` count as money
- [x] Parse with `Number(...)` + `Number.isFinite` in `eventCostCents` / token helpers as needed

### 5. DST-safe day buckets + Bonus spend + manifest

- [x] Advance daily cursor with calendar-day `Date(y, m, d+1)` instead of `+86400000`
- [x] Format Bonus spend with two decimal places (same as event USD)
- [x] Add `Bonus spend` + `Events Note` to `plugin.json`
- [x] Update `docs/providers/cursor.md` briefly

### 6. Verify

- [x] `bunx vitest run plugins/cursor/plugin.test.js`
- [x] `bun test apps/web`
- [x] `bun run --cwd apps/web build`
