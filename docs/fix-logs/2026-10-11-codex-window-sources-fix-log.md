# Codex Window Sources Fix Log — 2026-10-11

> Branch: `fix/codex-window-sources` (base `8ec208f`, the plan commit on `origin/main`)
> Plan: `docs/plans/2026-10-11-codex-window-sources.md`
> Provider notes: `docs/providers/codex.md`
> Upstream reference: `robinebers/openusage` commits `a4cba27` (#708), `e1ddf23`, `d5166d6` (#1194), `aeceecc` (#1332), read from the local clone. Behavior was ported by hand.

| Role | Client / model / effort |
|------|-------------------------|
| Implementer | Grok Build, `grok-4.7`, `xhigh` (plan routing) |
| Review round 1 fixes | Grok Build, `grok-4.7`, `xhigh` |

Review round 1 is recorded below. A follow-up review has not been run. This change is local and has not been pushed.

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
- Quotas keeps the latest stored row for each period. A 7-day Codex Session is read as Weekly when the account also has a newer 5-hour Session. The previous Weekly reading is the latest 7-day Session before the cutoff. The previous 5-hour Session is the latest Session row with another period.
- `code_review_rate_limit` stays the Reviews line. The plan does not change it.

## Review round 1

Reviewed target `86149f5`. Grok APPROVE, AGY APPROVE, Codex REQUEST_CHANGES.

| Finding | Source | Severity | Verified | Disposition |
|---|---|---|---|---|
| W1-1 Same account with a legacy 7-day Session row then a genuine 5-hour Session: storage latest-per-raw-key hides the legacy row, an unchanged Weekly reading is deduplicated against it and not stored, Quotas shows only Session until the next change | Codex (reproduced in-memory) | MEDIUM | code path confirmed: quota-history.ts:54, latest is per raw window_key before aliasing | fix: choose latest per aliased window (period-aware), regression test on one account |
| W1-2 Previous-week lookup `latestQuotaObservationBeforeReset(..., "session")` takes the newest Session (5-hour) and drops it, missing an older 7-day Session | Codex, Grok (LOW) | MEDIUM | yes: quota-history.ts:133-138 | fix: legacy lookup restricted to period_ms = 7 days before ORDER/LIMIT; genuine Session previous lookup excludes 7-day rows; same-account mixed test |
| Grok LOW: same-class duplicate windows keep the first even without percent | Grok | LOW | matches upstream candidates.first | no change |
| Grok LOW: non-Spark additional limits kept | Grok | LOW | plan contract | no change |

W1-1 and W1-2 are fixed. The two LOW findings stay as recorded. Stored rows are not rewritten.

| Commit | Change |
|--------|--------|
| `e8ad234` test | Quotas must keep Weekly when a 5-hour Session arrives after a 7-day Session on the same account. |
| `71b514f` fix | The latest-window query keeps one row per period. The existing alias and collapse then keep that Weekly series. |
| `905d774` test | The previous Weekly percent must come from the older 7-day Session. In that fixture the 5-hour Session has no previous window. |
| `4efdd9f` fix | The legacy lookup requires a 7-day period before the row limit. The 5-hour Session lookup excludes those rows. |

Checks after `4efdd9f`, before this note:

| Command | Result |
|---------|--------|
| `bun run test -- --run` | 69 files, 1314 passed |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | 59 files, 492 passed, 0 failed |
| `bun run build:webui` | passed (web `tsc` + Vite, server bundle) |

The known `CcusageProvider` timeout flake and the Antigravity Cloud Code test that reaches a running language server did not fail in this run.

## Review round 2

Target `1d986db`. Grok Build `grok-4.7` high, AGY `gemini-3.8-flash-high`, Codex `gpt-6.1-sol` high (second Codex home, quota fallback from the first home; same family as no implementer here): all APPROVE. W1-1 and W1-2 confirmed resolved. Codex LOW, deferred: for non-Codex providers, two readings with the same `observed_at` in different periods can change which one the latest-per-period query returns; no current provider writes such pairs.
