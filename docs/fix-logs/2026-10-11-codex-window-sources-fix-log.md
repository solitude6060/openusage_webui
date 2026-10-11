# Codex Window Sources Fix Log — 2026-10-11

> Branch: `fix/codex-window-sources` (base `8ec208f`, the plan commit on `origin/main`)
> Plan: `docs/plans/2026-10-11-codex-window-sources.md`
> Provider notes: `docs/providers/codex.md`
> Upstream reference: `robinebers/openusage` commits `a4cba27` (#708), `e1ddf23`, `d5166d6` (#1194), `aeceecc` (#1332), read from the local clone. Behavior was ported by hand.

| Role | Client / model / effort |
|------|-------------------------|
| Implementer | Grok Build, `grok-4.7`, `xhigh` (plan routing) |

Triple-review was not run. This change is local and has not been pushed.

## What changed

| Commit | Change |
|--------|--------|
| `01d8e95` test | A fresh window percent must beat a stale `x-codex-*-used-percent` header. |
| `3e2ba68` fix | Session and Weekly percents come from the usage body. Headers fill a window that has no percent. |
| `93f48fb` test | A 7-day primary window must be Weekly, with no Session line. An unrecognized duration keeps the slot. |
| `a41ad79` fix | Classify Session at exactly 5 hours (18,000,000 ms) and Weekly at exactly 7 days (604,800,000 ms), including `additional_rate_limits`. Other durations keep primary as Session and secondary as Weekly. |
| `f6177d0` test | Old Codex Session rows with a 7-day period plus new Weekly rows must be one Allowance window. |
| `93b630e` fix | Read-time alias of those rows to Weekly for Allowance, the quota view, refresh, and snapshot backfill. Stored rows stay Session. |
| `dba0c1e` test | Plan names Pro 100, Pro 200, Pro 500, and Business Premium. |
| `588962d` fix | `prolite`, `pro`, `promax`, and `self_serve_business_prolite` use those names. Other identifiers keep a readable name. |

Upstream `exactKind` compares the duration to those two values and has no extra tolerance band. This port does the same.

## Checks

Recorded on this branch after `588962d`. The provider notes land with this log and do not change runtime behavior.

| Command | Result |
|---------|--------|
| `bun run test -- --run` | 69 files, 1314 passed |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | 59 files, 490 passed, 0 failed |
| `bun run build:webui` | passed (web `tsc` + Vite, server bundle) |

The known `CcusageProvider` timeout flake and the Antigravity Cloud Code test did not fail in this run.

## Limits

- A Codex Session whose stored period is 5 hours stays Session, including when its reset time is about a week away. The existing Allowance rule still treats that series as a long window when it is the only long window for the account.
- The quota view's previous-window lookup reads the latest stored Session row before the cutoff and uses it when that row's period is 7 days. Allowance reads every row, so an older 7-day Session still joins the Weekly series there.
- `code_review_rate_limit` stays the Reviews line. The plan does not change it.
