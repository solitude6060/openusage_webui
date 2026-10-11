# Cursor Meter Semantics — 2026-10-11

## Problem

The Cursor `Total usage` meter reports `usedPercent` from `planUsage.totalPercentUsed`
(`plugins/cursor/plugin.js:1002-1004`) and `usedValue` / `limitValue` from `totalSpend` / `limit`
(`:1050-1052`). Live snapshot 2026-10-10: 8.81% with $273.20 of $400 (68.3%). Allowance divides
Cursor tokens by 8.81% and reports $4,617 per full meter, 11.5x the stated cap.
Evidence: `openusage_webui-artifacts/2026-10-11-allowance/gap-analysis.md` sections 3 and 4.4.

## Changes

C1. Investigate what `totalPercentUsed`, `totalSpend`, `limit`, Auto and API percentages measure,
using the plugin code, upstream `robinebers/openusage` history and docs, Cursor's public docs, and
stored snapshots (read-only API `GET http://127.0.0.1:6736/api/usage/quotas`; no credentials, no
direct database access). Record findings in `docs/providers/cursor.md`.

C2. Based on C1, make the meter the Allowance uses consistent: if spend/limit is the billing
meter, derive `usedPercent` for `Total usage` from `totalSpend / limit` (or expose a separate
`Spend` window chosen by Allowance); otherwise document why the percent is correct and label it.
Test first in the plugin test (`plugins/cursor/*.test.*`).

C3. Fix log `docs/fix-logs/2026-10-11-cursor-meter-semantics-fix-log.md`.

## Out Of Scope

Cursor event page cap (tracker item), cycle summary.

## Acceptance

- Plugin test with a fixture response where percent and spend disagree asserts the chosen meter.
- Full test runners and `bun run build:webui` pass.

## Routing

Coding Medium: Grok Build `grok-4.7` / `xhigh`. Triple-review.
