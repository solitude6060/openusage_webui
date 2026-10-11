# Allowance Cycle Summary Fix Log — 2026-10-11

> Branch: `feat/allowance-cycle-summary` (base `main` = `fb72d6d`)
> Plan: `docs/plans/2026-10-11-allowance-cycle-summary.md`
> Evidence: `../openusage_webui-artifacts/2026-10-11-allowance/gap-analysis.md` (not copied into this repo)

| Role | Client / model |
|------|----------------|
| Implementer | Grok Build, `grok-4.7` |
| Review | Not run in this session |

`packages/storage` is unchanged. `span=cycles` is a separate response and is not passed through the existing estimate builder. Codex session-event import, Cursor meter semantics, five-hour windows, prorating, and retiring the older implied-allowance helper stay out of scope.

## Commits

| Commit | Change |
|--------|--------|
| `341363e` | Plan |
| `325cb8d` / `0dfaff8` | An early restart ends the cycle at the next start |
| `4fb027b` | A falling meter excludes the cycle. The exclusion landed in `969547c` |
| `820cf08` / `969547c` | A bucket on either boundary widens the high side. `969547c` also marks a falling meter |
| `def051d` / `0019e6e` | End percent below 20, or no tokens fully inside, excludes the cycle |
| `1460771` | No reading in the last day excludes the cycle. The check landed in `5b2ed38` |
| `e8c11c4` / `5b2ed38` | The open cycle stays out of the baseline. `5b2ed38` also adds the last-day gap |
| `9c2a3c1` / `70cf0ac` | The baseline is the median of the last four included cycles |
| `2a1147d` / `b310633` | A shared session log is excluded. The feat follows the cycles API test commit |
| `0baad76` / `76be73b` | `span=cycles` returns 120 days of summaries and uses the same shared Codex account as the estimates |
| `1c2a8c5` / `d4481f2` | The Allowance page adds Subscription Period |
| this commit | This log, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, and the Allowance section of `docs/USER_GUIDE_WEBUI.zh-TW.md` |

The Grok-sized fixture stores three included cycles at 100 percent: 752,000,000, 1,305,000,000 and 1,688,000,000 tokens, with API dollars 276, 463 and 411. The token median is 1,305,000,000 (13,050,000 per one percent). A meter-fall cycle and the open cycle stay out of that count.

## Checks

At `d4481f2`, before the docs commit:

- `bun run test -- --run`: 69 files, 1302 tests passed, exit 0.
- `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`: 60 files, 503 tests passed, 0 failed, 1220 expectations, exit 0.
- `bun run build:webui`: exit 0. The web typecheck and the server bundle both finished.

The ccusage child-process timeout test and the Antigravity Cloud Code fixture were part of that bun run and did not fail. The page assertion runs in vitest: it selects Subscription Period and finds Baseline, Current Cycle, and Meter Fell in both the table and the card list. No browser was opened.

This docs commit changes only those four markdown files.
