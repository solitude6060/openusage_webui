# Cursor Meter Semantics Fix Log — 2026-10-11

> Branch: `fix/cursor-meter-semantics` (base `origin/main` = `fb72d6d`)
> Plan: `docs/plans/2026-10-11-cursor-meter-semantics.md`
> Evidence read: `openusage_webui-artifacts/2026-10-11-allowance/gap-analysis.md` sections 3 and 4.4 (outside the repo; no account identifiers copied)

| Role | Client / model / effort |
|------|-------------------------|
| Implementer | Grok Build, `grok-4.7`, `xhigh` |
| Review | Not run. The plan's merge gate is triple-review. This branch was not pushed. |

## C1 — what the fields measure

Cursor's current period payload carries two readings with different denominators.

| Field | What it measures | Source |
|---|---|---|
| `autoPercentUsed` | Auto / Cursor Models pool percent (Cursor's own models, including Grok and Composer) | Cursor docs, [Usage and limits](https://cursor.com/help/models-and-usage/usage-limits); upstream [cursor.md](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md) labels this pool Cursor Models |
| `apiPercentUsed` | API / Other Models pool percent (third-party models at API price) | Same docs |
| `totalPercentUsed` | Combined pool percent. Cursor staff (Dean Rie, 2026-08-13, forum thread 168210) wrote that this field, `autoPercentUsed`, and `apiPercentUsed` follow an internal metric of their own. Upstream OpenUsage uses this structured percentage for Total Usage when Cursor supplies it. | Staff reply; upstream cursor.md |
| `totalSpend`, `includedSpend`, `limit` | Included dollar amount, in cents. The usage sentence "You've used N% of your included usage" uses `includedSpend / limit`. Spend in the plugin prefers `totalSpend`, otherwise `limit - remaining`. | Same staff reply; plugin comments already described `totalSpend` as included spend plus bonus spend |

`totalPercentUsed` is the Total usage percent Allowance already stores. `limit` is the Stated Cap. They are different denominators, so spend divided by `limit` was not substituted for the percent.

A read-only `GET /api/usage/quotas` on 2026-10-11 returned four different figures for the Cursor account: Total usage `usedPercent` 8.8245 with `usedValue` 273.56 and `limitValue` 400 (included spend is 68.39% of that limit), Auto usage 5.7797, API usage 100. The quotas payload has no per-pool dollar size, so the weights inside `totalPercentUsed` stay uncalculated for this account.

## Decision

Keep individual Total usage on `totalPercentUsed`. Show Included Spend as `$spend of $limit` on the card summary. Allowance still scales tokens and API dollars by the Total usage percent. Stated Cap remains `planUsage.limit`.

The pool-weight formula is undetermined here. Behavior of the percent was kept, and the dollar reading is now labeled.

## Commits

| Commit | Change |
|--------|--------|
| `4512a11` | test: failing plugin and dashboard checks for the pool percent and the Included Spend label |
| `17e5b81` | fix: emit Included Spend, keep it on the card summary, document the two denominators |
| `88a68f6` | test: host-adapter fixture requires the Included Spend line |

## Checks

| Runner | Result |
|--------|--------|
| `bun run test -- --run` | 69 files, 1302 passed, exit 0 |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | First run: 486 passed, 2 failed. One failure was the Cursor host fixture, fixed in `88a68f6`. The other was `CcusageProvider > default command runner cleans up child processes on timeout` (marker file still present after 200ms). Second run after the fixture commit: 488 passed, 0 failed, exit 0. |
| `bun run build:webui` | exit 0 |

The Antigravity Cloud Code fixture that can reach a running language server passed in both bun runs. It was not changed.

The card label was not clicked through in a browser. Playwright was unavailable, and the always-on service on port 6736 runs another checkout. The quotas request was read-only.
