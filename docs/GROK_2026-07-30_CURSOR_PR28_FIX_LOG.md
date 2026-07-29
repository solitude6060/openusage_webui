# Cursor PR #28 Fix Log (Grok 4.5)

Date: 2026-07-30
PR: https://github.com/solitude6060/openusage_webui/pull/28
Review: `docs/GROK_2026-07-30_CURSOR_PR28_REVIEW.md`

| Finding | Fix | Tests |
|---|---|---|
| `providerLabel` 2-arg call breaks build | Revert dashboard to `providerLabel(providerId)` | `bun run --cwd apps/web build` |
| 800-event under-report | `pageSize=200`, `maxPages=10`; append `· partial` on window totals | incomplete + page-cap tests |
| Missing page-cap Events Note test | Added page-cap regression test | vitest |
| Short page vs higher total skips note | Set `truncated` when `all.length < total` on short page | covered by page-cap / incomplete paths |
| `chargedCents: 0` blocks totalCents | Prefer positive charged, else positive totalCents | new unit case |
| `role="img"` + buttons | Drop `role="img"` | build |
