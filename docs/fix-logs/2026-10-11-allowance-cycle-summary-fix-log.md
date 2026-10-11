# Allowance Cycle Summary Fix Log — 2026-10-11

> Branch: `feat/allowance-cycle-summary` (base `main` = `fb72d6d`)
> Plan: `docs/plans/2026-10-11-allowance-cycle-summary.md`
> Evidence: `../openusage_webui-artifacts/2026-10-11-allowance/gap-analysis.md` (not copied into this repo)

| Role | Client / model |
|------|----------------|
| Implementer | Grok Build, `grok-4.7` |
| Review round 1 | Grok `REQUEST_CHANGES`, AGY `APPROVE`, Codex `REQUEST_CHANGES`, against `fbbfe86`. Raw reviews stay outside this repo |
| Review round 2 | Grok `APPROVE`, AGY `APPROVE`, Codex `REQUEST_CHANGES`, against `1078a57`. Raw reviews stay outside this repo |

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
| `fbbfe86` | This log, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, and the Allowance section of `docs/USER_GUIDE_WEBUI.zh-TW.md` |

The Grok-sized fixture keeps three included cycles. Two end at 100 percent: 752,000,000 tokens ($276) and 1,305,000,000 tokens ($463). The third ends at 17 percent, with 286,960,000 tokens fully inside the cycle; its per-full-meter figures are about 1,688,000,000 tokens and $411. The token median is 1,305,000,000 (13,050,000 per one percent) and the API-dollar median is 411. A meter-fall cycle and the open cycle stay out of that count.

## Checks

At `d4481f2`, before the docs commit:

- `bun run test -- --run`: 69 files, 1302 tests passed, exit 0.
- `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`: 60 files, 503 tests passed, 0 failed, 1220 expectations, exit 0.
- `bun run build:webui`: exit 0. The web typecheck and the server bundle both finished.

The ccusage child-process timeout test and the Antigravity Cloud Code fixture were part of that bun run and did not fail. The page assertion runs in vitest: it selects Subscription Period and finds Baseline, Current Cycle, and Meter Fell in both the table and the card list. No browser was opened.

That docs commit changes only those four markdown files.

## Review round 1

Reviewed revision: `fbbfe86`. Each behavior below has a failing test commit, then the change that makes it pass. `C1-5` is the exception: the new hour-bucket test already passed, because the classifier reads each bucket's end, so there is no following code commit.

Exclusion order after this round: `meter-fell`, `shared-log`, `history-truncated`, `no-tokens`, `below-min-percent` (10), `edge-uncertain`, `observation-gap`.

| Finding | Source | Severity | Disposition | Commits |
|---------|--------|----------|-------------|---------|
| C1-1. A cycle that starts before the loaded history (120 days of observations, tokens one day earlier) still entered the baseline | Grok, Codex | MEDIUM | Exclude it, reason `history-truncated` | `2445bc5` / `544e894` |
| C1-2. One-sided API dollars rendered as a single amount | Grok, Codex | MEDIUM | Show the known amount and `Unknown`. Both sides missing stay a dash. Equal known sides stay one amount | `9fd47b6` / `75f017c` |
| RD-1. Cycles with a large edge straddle entered the baseline | orchestrator real-data check | HIGH | Exclude when `tokensHigh` > 1.25 × `tokensLow`, reason `edge-uncertain`. A ratio of exactly 1.25 stays included | `046e2ed` / `028a2f9` |
| RD-2. The 20 percent minimum dropped a 17 percent cycle the plan kept | orchestrator | MEDIUM | Cycle summaries use `CYCLE_MIN_PERCENT` 10. `IMPLIED_MIN_PERCENT` stays 20 | `e585e7d` / `806fe8d` |
| RD-3. A reset a fraction of a second early marked the projection unreliable | orchestrator | MEDIUM | An early restart is only a cycle that ends more than one hour before its stated reset | `ee1f305` / `3e7c136` |
| RD-4. A summary with no usable data still rendered | orchestrator | LOW | Omit a summary with no open cycle and no included cycle, and omit one whose every reading is 0% | `a612a90` / `7011dc5` |
| C1-3. An open cycle could stay reliable after its meter fell | Grok | LOW | `projectionReliable` is false, and the current reading shows Meter Fell | `dfd990c` / `4dbab26` |
| C1-4. The page did not say the baseline uses the inside total | Grok | LOW | The explanation says that median uses only the usage fully inside each period | `cb694dc` / `9d06dd2` |
| C1-5. Tests used one-day buckets only | Grok | LOW | One-hour buckets fully inside a cycle, and one hour that crosses the reset, are covered. No production change | `4e7cbca` |

The same read-only database copy was loaded again at `2026-10-10T16:30:00Z`. The output stays outside this repo. Claude Weekly no longer has a token baseline. Grok Weekly has n = 3 and includes the 17 percent cycle. `codex:codex` Session has n = 1: the recent cycles with a large edge straddle are excluded, and one older cycle stays included. The stale Codex summary and the Copilot summary whose readings were all 0 percent are absent. Claude's open cycle is marked reliable.

At `9d06dd2`, before this docs commit:

- `bun run test -- --run`: 69 files, 1302 tests passed, exit 0.
- `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`: 62 files, 513 tests passed, 0 failed, 1241 expectations, exit 0.
- `bun run build:webui`: exit 0. The web typecheck and the server bundle both finished.

The ccusage child-process timeout test and the Antigravity Cloud Code test did not fail in that bun run. The page assertions run in vitest. No browser was opened.

This commit updates the plan's Changes section, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, the Allowance section of `docs/USER_GUIDE_WEBUI.zh-TW.md`, and this log.

## Review round 2

Reviewed revision: `1078a57`. Grok `APPROVE`, AGY `APPROVE`, Codex `REQUEST_CHANGES`. Raw reviews stay outside this repo. Round 1 stays resolved.

| Finding | Source | Severity | Verified | Disposition | Commits |
|---------|--------|----------|----------|-------------|---------|
| C2-1. All-0% omission hides a provider whose current cycle has positive tokens | Codex (reproduced) | MEDIUM | yes: `allowance-cycles.ts:178` | Keep a summary when `current.tokens` > 0. A provider whose every reading is 0% and whose current cycle has no tokens is still omitted. Plan and user docs state that exception | `d21b36b` / `21a1e3a` |

At `21a1e3a`, before this docs commit. The documentation edits were already in the working tree and are not inputs to these runners.

- `bun run test -- --run`: 69 files, 1302 tests passed, exit 0.
- `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`: 62 files, 514 tests, 513 passed, 1 failed, 1243 expectations, exit 1. The failure is `CcusageProvider > default command runner cleans up child processes on timeout` (known timing flake). The Antigravity Cloud Code test did not fail.
- `bun run build:webui`: exit 0. The web typecheck and the server bundle both finished.

The page assertions run in vitest. No browser was opened.

This commit updates the plan's omission rule, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, the Allowance section of `docs/USER_GUIDE_WEBUI.zh-TW.md`, and this log.
