# Allowance Cycle Summary — 2026-10-11

## Problem

The user asked for subscription-period back-calculation: for each completed subscription cycle,
`allowance = tokens used in the cycle / (end-of-cycle % / 100)`, averaged over recent cycles, and
compared with the current cycle. The Allowance page computes only range estimates between two
aligned meter readings (`packages/providers/src/allowance-estimate.ts`); it has no per-cycle
history, no baseline and no remaining-allowance figure.

Evidence and real-data evaluation: `openusage_webui-artifacts/2026-10-11-allowance/gap-analysis.md`
(sibling artifact directory, sections 4–6).

## User Decisions (2026-10-11, "照預設做")

1. Baseline: last 4 included completed cycles, median, with min–max and n shown.
2. Daily buckets at cycle edges are not apportioned (directive from `193348c`). Show a range:
   low = buckets fully inside the cycle, high = low plus buckets straddling either edge.
3. Per full meter (per cycle), not per calendar week; show cycle length.
4. Tokens headline, recorded API dollars beside it.
5. Codex session-event import follows in a separate PR (`2026-10-11-codex-session-events.md`).
6. Five-hour windows are out of scope.

## Changes

S1. Pure function `buildAllowanceCycleSummaries(observations, tokenRows, sharedProviderIds, now)` in
`packages/providers/src/allowance-cycles.ts`. Reuse `chooseWindows`, `meterPoints` and
`boundedCycles` from `allowance-estimate.ts` (export them; do not copy). Per provider and chosen
window:

- Cycles: start = stated reset − period; an early restart ends the cycle at the next cycle's start
  (existing `boundedCycles` rule).
- Per completed cycle: start, end, length, end % (max reading in the cycle), tokens and API cost
  of buckets fully inside (`low`), straddling tokens/cost (`high` = low + straddle),
  allowance per full meter `low / (end% / 100)` and the high counterpart, API dollars per full
  meter likewise (null when any in-cycle row has null cost), and `included` with `exclusion`
  reason. Reasons: `meter-fell` (a reading drops inside the cycle), `shared-log` (provider in
  `sharedProviderIds`), `no-tokens`, `below-min-percent` (end % < 20, reuse the existing
  `IMPLIED_MIN_PERCENT` value), `observation-gap` (no reading in the last 24 h before the cycle end).
- Baseline over the last 4 included cycles: median, min, max, n for tokens per full meter and API
  dollars per full meter.
- Current (open) cycle: used % (latest reading), tokens and API cost since cycle start, elapsed
  fraction, remaining = (100 − used%) / 100 × baseline median, projected end % = used% /
  elapsed fraction, `projectionReliable` false when elapsed < 1 day or the provider restarted early
  in any of the last 4 cycles.

S2. Route: `GET /api/usage/allowance?span=cycles` returns `{ span: "cycles", summaries }`, loaded in
`apps/server/src/quota-history.ts` with `storage.listAllowanceTokenRows` (same rows and
shared-provider set as `loadAllowanceEstimates`), history 120 days.

S3. Page: `apps/web/src/pages/allowance-page.tsx` gains a "Subscription Period" range option that
renders one card per provider: baseline line (median, min–max, n, tokens and $), current cycle
(used %, so far, remaining, projection with an unreliable marker) and a completed-cycles table with
the exclusion reason. Narrow layout uses the existing card pattern. Styles go in
`apps/web/src/styles/usage.css`.

S4. Docs: `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md` Allowance
section; fix log `docs/fix-logs/2026-10-11-allowance-cycle-summary-fix-log.md`.

## Out Of Scope

Codex event import, Cursor meter semantics (separate plans), five-hour windows, prorating, retiring
`quota-view.ts` `impliedAllowance` (follow-up after this lands).

## Acceptance

- Unit tests on fixtures: early restart ends the cycle at the restart; meter fall excludes the
  cycle; a straddling daily bucket yields low < high; end % below 20 excluded; the open cycle is
  not in the baseline; median of 4 with one excluded uses the remaining included cycles; shared
  provider excluded with `shared-log`.
- Fixture mirroring the gap analysis Grok cycles (7.52 / 13.05 / 16.88 M per 1%) gives median
  13.05 M per 1%, n = 3.
- API test for `span=cycles`; page test renders a card with baseline, current cycle and a reason.
- `bun run test -- --run`, `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`,
  `bun run build:webui` pass.

## Routing

Coding Medium feature; user instruction: Grok Build `grok-4.7` / `xhigh` implements. Triple-review
with the fixed lanes.
