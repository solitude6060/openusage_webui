# Hourly Allowance Token Buckets — Plan

> Date: 2026-10-11
> Branch: `feat/hourly-allowance-buckets` (proposed)
> Base: `main` at `49b3b38`
> Routing: TBD by orchestrator
> Origin: deferred item "hourly Allowance buckets" in
> `docs/plans/2026-10-10-dashboard-review-fixes.md` (C7) and
> `docs/reviews/2026-10-10-dashboard-page-review.md` ("Rejected Or Changed Suggestions");
> `tracker.md:44`.

## Problem

Allowance computes `tokens between two meter readings / meter movement`. Token rows are
daily, so C7 can only measure between day boundaries where the meter is provably flat
(`alignedMeasurement`, `packages/providers/src/allowance-estimate.ts:361-392`). Tokens
used between the first meter reading and the next usable midnight, and after the last
usable midnight, are dropped together with their meter movement.

Evidence (DB copy `openusage_webui-artifacts/2026-10-10-review/db.local/openusage.sqlite`,
opened read-only; `now = 2026-10-10T13:50Z`, `TZ=Asia/Taipei`; script
`hourly-allowance-evidence/allow.ts`):

| Provider | 7-day result today | Span | Note |
|----------|-------------------|------|------|
| claude-code | ok, 9→59%, 1,142,757,543 tokens, est 2,285,515,086 | 10-05T16:00Z → 10-09T16:00Z (local midnights) | 4 of ~6.5 cycle days used |
| codex:codex (current cycle) | unaligned, 1→59% | 10-07T05:07Z → 10-10T03:18Z | no flat midnight on either side |
| codex:codex (previous cycle) | ok, 11→57%, 39,749,600 tokens, est 86,412,174 | 10-05T16:00Z → 10-06T16:00Z | one day of the cycle |
| cursor | ok, coarse, 7.33→8.81%, 105,666,771 tokens, est 7,107,116,296 | 10-04T00:00Z → 10-10T00:00Z | 1.49-point movement |
| grok | ok, 0→13%, 114,221,590 tokens, est 878,627,615 | 10-04T17:39Z → 10-10T00:00Z | ends at UTC midnight |
| codex:family | shared-log | — | symlinked sessions, excluded |

Raw source granularity:

| Source | Stored as | Raw timestamp | Hourly path |
|--------|-----------|---------------|-------------|
| Claude (ccusage) | `tool = ccusage`, local-day buckets stored as `YYYY-MM-DDT00:00:00.000Z` (`structured-usage.ts:258-267`) | per message, ms (`~/.claude/projects/**/*.jsonl`) | **Yes, via ccusage**: `ccusage claude blocks --json --session-length 1` returns clock-hour blocks with absolute UTC `startTime`, `totalTokens`, `costUSD`, `models` (names only, no per-model tokens; `entries` is a count). Verified with ccusage 20.0.28: 113 blocks over 10 days all start on `:00:00.000Z`, and per local day the block sum equals `ccusage claude daily` exactly (0 mismatched days; 2026-10-10: 541,207,931 both). Runtime 0.35 s vs 0.26 s for daily (31-day window with 10 active days, both measured with `--offline`; production runs without it). |
| Codex (ccusage) | `tool = ccusage`, local-day buckets | per event, ms (`~/.codex/sessions/**/rollout-*.jsonl`, `event_msg:token_count` and a newer `token_usage_record` type seen 2026-10-10) | **No ccusage path**: `ccusage codex --help` lists only `daily`, `monthly`, `session`. Root `ccusage blocks` is Claude-only (2026-10-10: root and `claude blocks` both 561,693,585 tokens; `codex daily` 81,212,112 not included). Hourly needs a custom rollout parser. |
| Cursor | `tool = Cursor Usage Event`, UTC day (`structured-usage.ts:84-86` truncates `event.timestamp`) | per event, ms | **Yes, in code**: key by hour instead of day. |
| Grok | `tool = Grok Session`, UTC day (`grok-session-usage.ts:174-199` truncates `agentTimestampMs`) | per turn, ms | **Yes, in code**: key by hour instead of day. |

Simulation (`hourly-allowance-evidence/sim.ts`; needs
`bunx ccusage claude blocks --json --since 20260901 --session-length 1 --offline > b40.json`
in the working directory): Claude hourly blocks from the live logs,
merged into the copy's daily rows per local day, give 7-day `ok`, 0→59%,
1,364,658,423 tokens, est 2,312,980,378 (+1.2% vs today), span starting at the cycle's first
reading 10-03T19:18:50Z instead of local midnight. The span end stayed at 10-09T16:00Z only
because the copy's local 10-10 daily row was captured at 13:45:52Z while the simulation
used blocks before 13:00Z read hours later (a simulation artifact; a real refresh writes
both together). Nine local days (10-01 … 10-09) matched the stored daily rows exactly; Aug/Sep days had no blocks because Claude Code had
already pruned those logs, so their daily rows must stay authoritative.

Honest scope statement: hourly buckets widen Claude, Cursor and Grok spans to the real
meter readings, but they do not fix the one provider that is currently `unaligned`
(Codex), because ccusage has no sub-day Codex output.

Storage today (`usage_records`, 55,154 rows in the copy): token rows are claude-code
ccusage 131 rows / 59 days, codex:codex ccusage 238 / 76, cursor 252 / 82, grok 30 / 27,
all with `ended_at` NULL. Token rows feed six readers that would double count if hourly
rows were added to the same table: `listUsageRecords` (Sessions), `getUsageSummary`
(Dashboard Today/Month tokens and record counts), `getTokenUsageBreakdown` (Tokens page),
`listPositiveTokenRows` (Allowance and Dashboard quota windows via
`quota-view.ts:118-141`), the `replaceScopes` delete/legacy-clear logic
(`sqlite-storage.ts:252-288`), and `deleteLocalLogUsageRecords`.

## Decision

Record as `docs/ADR_2026-10-11_HOURLY_ALLOWANCE_TOKENS.md` before implementation (data
contract change):

1. `usage_records` daily token rows stay the record of token totals for every page. This
   change never rewrites or deletes them (project rule; the 2026-10-01 delivery review also
   rejected daily reimport, `docs/plans/2026-10-01-allowance-delivery.md:27`).
2. Add a separate derived table `token_hourly`, used only by Allowance. Hourly rows are
   never shown in Tokens, Sessions, Dashboard totals or quota windows. No migration of
   existing data; the table fills from the next refresh (Claude: as far back as local logs
   still exist; Grok: all transcripts; Cursor: the fetched event window).
3. Allowance token selection: for each provider, tool and daily bucket (ccusage: local day;
   Cursor/Grok: UTC day, as in `allowanceTokenTimes`), if any hourly row exists inside the
   bucket, use the hourly rows (1-hour `bucketEnd`) and drop that bucket's daily rows;
   otherwise keep the daily rows. The estimator (`allowance-estimate.ts`) is unchanged; its
   straddle and alignment logic already works for any bucket size (shown by the simulation).
4. Claude hourly source is `ccusage claude blocks --json --session-length 1 --since <same
   YYYYMMDD as daily>`, run by the host only when the daily query succeeded and the account
   records tokens. This lifts C7's "do not change the ccusage invocation" limit, which was
   scoped to C7; the daily invocation itself stays unchanged.
5. Write-time guard (Claude only): for every completed local day returned by daily, the
   block sum must equal the day's `totalTokens`; otherwise log an error and write no hourly
   rows for that day. Hourly rows already stored for that day stay (they were checked when
   written, and `token_hourly` is upsert-only); a day with no stored hourly rows uses its
   daily rows. The current day is written without the check (daily and blocks are two
   processes a fraction of a second apart). Cursor and Grok hourly rows come from the same
   events as the daily rows, so they match by construction.
6. Codex stays daily in this change (see Open Question 1).
7. Hourly block times are absolute UTC, so the `ponytail:` time-zone assumption at
   `sqlite-storage.ts:943` remains only for legacy daily rows.

## Changes

### C1 — Table and write routing (`packages/storage/src/sqlite-storage.ts`)
- `CREATE TABLE IF NOT EXISTS token_hourly (provider_id TEXT NOT NULL, tool TEXT NOT NULL,
  hour_start TEXT NOT NULL, model TEXT NOT NULL, total_tokens INTEGER NOT NULL, cost_usd REAL,
  PRIMARY KEY (provider_id, tool, hour_start, model))`.
- An hourly token record is a `UsageRecord` with a token tool (`DAILY_TOKEN_TOOLS`) and
  `endedAt` set to `startedAt + 1h`. `upsertUsageRecords` splits these out before the
  `replaceScopes` loop and upserts them into `token_hourly` (`ON CONFLICT DO UPDATE`, so the
  still-running hour is overwritten on the next refresh). Nothing else reads them.
- `deleteUsageRecordsForProvider` also deletes that provider's `token_hourly` rows (same
  semantics as today's provider removal).
- Add `listAllowanceTokenRows(from)`: existing `listPositiveTokenRows` rows, with each daily
  bucket replaced by its hourly rows when any exist (Decision 3). Keep
  `listPositiveTokenRows` unchanged for the quota dashboard.

### C2 — Allowance read (`apps/server/src/quota-history.ts:135`)
- `loadAllowanceEstimates` calls `listAllowanceTokenRows` instead of `listPositiveTokenRows`.

### C3 — Claude hourly import
- `packages/providers/src/providers/openusage-plugin-runtime.ts`: add
  `runPluginCcusageBlocks(opts, …)` next to `runPluginCcusageQuery`, reusing
  `ccusageEnvForProvider` (per-account `CLAUDE_CONFIG_DIR`) and the bunx/npx runner loop;
  args `["claude", "blocks", "--json", "--session-length", "1", "--since", since]`, cost mode
  left at the default (`auto`) to match daily.
- `packages/providers/src/providers/structured-usage.ts`: `normalizeCcusageHourlyBlocks(
  providerId, blocks, daily)` skips `isGap` blocks, emits one record per block
  (`startedAt = startTime`, `endedAt = +1h`, `totalTokens`, `costUsd = costUSD`,
  model `All Models`), and applies the write-time guard (Decision 5). The record id hash
  includes `hour` so it never equals a daily row id (the in-memory map at
  `openusage-plugin.ts:155-157` is keyed by id; a Cursor/Grok 00:00Z hour would otherwise
  collide with its daily row).
- `packages/providers/src/providers/openusage-plugin.ts:320-326`: after a successful daily
  query with `recordCcusageTokens` and provider `claude`, run blocks and capture the hourly
  records. A blocks failure logs `console.error` (like the Grok scan at lines 168-178) and
  leaves the daily rows and the plugin result untouched. The production worker
  (`openusage-plugin-worker.ts:6-9`) calls `refreshInThread`, so both refresh paths reach
  this hook.

### C4 — Cursor and Grok hourly rows
- `CursorUsageCollector.records`: also aggregate by `(hour, model)` and return hourly records
  next to the daily ones (same events, same cost rule).
- `grok-session-usage.ts`: keep the turn time in ms; `aggregateGrokSessionRecords` returns
  daily records as today plus hourly records from the same deduplicated entries.

### C5 — Docs
- New ADR (Decision above).
- `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md` §5.5: Allowance
  measures between hour boundaries where hourly data exists (Claude, Cursor, Grok) and day
  boundaries otherwise (Codex, older history); the Claude card lists `All Models` instead of
  per-model rows for hourly spans.
- `docs/providers/claude.md`, `docs/providers/cursor.md` (line 35 says "daily token rows"),
  `docs/providers/grok.md`; `docs/providers/codex.md` states Codex stays daily.
- `status.md`, `tracker.md:44`, `handover.md` at delivery.

## Out Of Scope
- Codex hourly (Open Question 1).
- Changing Tokens, Sessions, Dashboard Today/Month or quota-window token math; they keep
  daily rows.
- Reimporting, rewriting or deleting any `usage_records` row; changing the daily ccusage
  invocation or `--timezone`.
- Estimator rules (`COARSE_DELTA`, `meter-fell`, cycle selection).
- Per-model Claude hourly split (ccusage blocks do not provide it; a custom Claude log parser
  would duplicate ccusage's deduplication).
- Pre-existing Codex attribution: `~/.codex-family/sessions` is a symlink to
  `~/.codex/sessions`, so `codex:codex` token rows include family-account usage measured
  against the codex account's meter. Not changed here.

## Acceptance

Tests (TDD order, red first; `bun test packages/storage/test packages/providers/test
apps/server/test`):
1. Storage isolation: upserting a batch with daily and hourly records leaves
   `usage_records` identical to a daily-only batch, and `getUsageSummary`,
   `getTokenUsageBreakdown`, `listUsageRecords` and `listPositiveTokenRows` return the same
   results; `token_hourly` holds the hourly rows.
2. `listAllowanceTokenRows`: a bucket with hourly rows returns those rows with 1-hour
   `bucketEnd` and none of its daily rows; a bucket without hourly rows returns its daily
   rows; a ccusage local day under `TZ=Asia/Taipei` pairs with UTC hours 16:00Z … 15:00Z
   (run that file with `TZ=Asia/Taipei`).
3. `deleteUsageRecordsForProvider` removes the provider's hourly rows.
4. Blocks normalizer: gap blocks skipped; fields mapped; id differs from a daily record at
   the same `startedAt`; a completed day whose block sum differs from daily emits no hourly
   rows and logs an error; the current day is emitted.
5. Plugin glue: a Claude refresh runs blocks with the daily `since` and account env; Codex
   does not; a blocks failure keeps daily records.
6. Cursor and Grok: per day and model, hourly totals sum to the daily record.
7. Estimator with hourly rows: mid-hour first/last readings with flat readings across an
   hour boundary align to that boundary (no estimator code change).

QA on a database copy (never the live file; persistent copy under
`openusage_webui-artifacts/`, server on port 6738):
1. Smoke: with the new build and an empty `token_hourly`, `GET /api/usage/allowance?days=7`
   returns HTTP 200 with the same reasons as `main` (API output moves with the clock, so it is
   not compared byte for byte).
2. Refresh `claude-code`, `cursor` and `grok` on the copy, then check:
   - `SELECT count(*) FROM usage_records WHERE ended_at IS NOT NULL AND tool IN
     ('ccusage','Cursor Usage Event','Grok Session')` = 0.
   - For each completed local day in the blocks window, `SUM(token_hourly.total_tokens)`
     equals the claude-code daily `usage_records` sum (expect 0 mismatches, as in the 10-day
     check).
   - Tokens page total and Dashboard Today tokens/records equal the values computed from
     daily rows only.
3. Fixed-clock comparison on the refreshed copy (extend `hourly-allowance-evidence/sim.ts`):
   one `now`, the same observations, run twice — once with `listPositiveTokenRows` rows, once
   with `listAllowanceTokenRows` rows. Expect: codex rows identical; claude-code `ok` with
   `from` no longer on a `16:00:00.000Z` local midnight and a span containing the daily span;
   grok and cursor `ok` with spans containing their daily spans. Record both outputs.
4. Record the numbers in the fix log.

Builds: `bun run build:webui`.

## Risks
- ccusage is run unpinned through `bunx`; a change to `blocks` semantics would surface as
  guard errors (Decision 5). Days first imported after such a change use daily rows; days
  imported earlier keep their checked hourly rows.
- The current day's Claude hourly rows are written without the guard; a log line written
  between the two ccusage processes lands in the next refresh (the still-running hour is
  overwritten).
- Cursor's event window starts at `min(now - 7d, billingCycleStart)`
  (`plugins/cursor/plugin.js:656-662`), so the hour containing the window start is written
  partially and overwritten each refresh. One hour at the edge of history; accepted.
- Equal meter readings across a boundary prove movement under one percentage point, as in C7.
- Allowance cards for Claude lose the per-model list when hourly rows are used.

## Open Questions (User Decision)
1. Codex hourly. Default: keep Codex daily now. A follow-up would parse
   `~/.codex/sessions/**/rollout-*.jsonl` token events directly (per-event ms timestamps
   exist), with the same write-time guard against `ccusage codex daily`. Cost: a custom
   parser against a log format that changed recently (`token_usage_record`), and Codex
   estimates stay contaminated by the shared session directory regardless.
2. Claude model list. Default: show a single `All Models` line on hourly Claude Allowance
   cards. Long spans (30 days, This Period) that reach back before hourly data will list
   `All Models` next to per-model rows from older daily buckets. Alternative: hide the list
   whenever hourly rows are used.

## Estimated Size
About 150–200 production lines (storage ~60, blocks runner and normalizer ~60, Cursor/Grok
~30, glue ~15) plus ~200 test lines and docs. Coding Medium.
