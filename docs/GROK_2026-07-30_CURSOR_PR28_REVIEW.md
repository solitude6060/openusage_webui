# Cursor PR #28 Review (Grok 4.5)

Date: 2026-07-30
Reviewers: Grok 4.5 code-reviewer + Bugbot
Branch: `feat/cursor-model-usage-windows`
PR: https://github.com/solitude6060/openusage_webui/pull/28

## Verdict (initial)

**REQUEST CHANGES**

## Findings triage

| Finding | Severity | This PR? | Why |
|---|---|---|---|
| `providerLabel` 2-arg call vs 1-arg definition breaks WebUI build | Critical | Yes | Accidental bleed; revert call |
| Hard 800-event budget under-reports heavy accounts | High | Yes (partial) | Raise pageSize; mark window totals partial |
| No page-cap Events Note regression test | Medium | Yes | Add test |
| Short final page vs higher `totalUsageEventsCount` skips note | Medium | Yes | Mark truncated when `all.length < total` |
| `chargedCents: 0` blocks `totalCents` fallback | Medium | Yes | Fall through when charged is 0 and totalCents > 0 |
| `role="img"` wrapping interactive bars | Low | Yes | Drop role=img |

## Verdict (after fix)

**APPROVE** (pending re-review confirmation)

All triage rows marked This PR? Yes were addressed in the follow-up fix commit. See `docs/GROK_2026-07-30_CURSOR_PR28_FIX_LOG.md`.

