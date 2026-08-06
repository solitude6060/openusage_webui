# Tokens Page (Provider × Model) Plan

**Goal:** New WebUI page that aggregates token totals from `usage_records` by provider and model for selectable time ranges.

**Approved design (2026-07-30):**
- Page: Tokens (`/tokens`)
- Ranges: Today / Last 7 Days / Last 30 Days / This Month / All / Custom
- UI: expandable provider rows → per-model tokens
- Metric: token counts only (no USD / CP)
- API: `GET /api/usage/tokens?from=&to=` with SQL aggregation
- Scope: only rows already in `usage_records` with `total_tokens`

## Files

| File | Role |
|---|---|
| `packages/storage/src/sqlite-storage.ts` | `getTokenUsageBreakdown({ from?, to? })` |
| `packages/storage/src/storage.ts` | Interface |
| `packages/core/src/types.ts` | Response types |
| `apps/server/src/index.ts` | Route |
| `apps/web/src/pages/tokens-page.tsx` | UI |
| `apps/web/src/App.tsx` | Nav + route |
| `apps/web/src/lib/api.ts` | Client |
| tests | storage + API + light UI if needed |
| `docs/USER_GUIDE_WEBUI.zh-TW.md` | Mention Tokens page |

## Tasks

1. Types + storage aggregation (TDD)
2. API route + tests
3. Tokens page UI + wire App nav
4. Docs + verify
