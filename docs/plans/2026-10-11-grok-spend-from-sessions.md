# Grok Spend Tiles From Session Transcripts — 2026-10-11

Backlog item: `tracker.md:72` "move dashboard spend tiles from `unified.jsonl` to the same session
transcripts". Base: `main` at `49b3b38`.

Docs to update: `docs/providers/grok.md`, `README.md`, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`,
`docs/USER_GUIDE_WEBUI.zh-TW.md`, plus `tracker.md` / `status.md` / `handover.md`.

## Problem

The Grok card's Today / Yesterday / Last 30 Days tiles come from `plugins/grok/plugin.js`
`appendLocalSpend` (`:434-466`). It parses `~/.grok/logs/unified.jsonl` (`$GROK_HOME/logs/...`,
`:311-315`), maps each `shell.turn.inference_done` row to the process's model, and prices it with
the in-plugin `MODEL_RATES` table (`:8-15`, `:350-371`). Tokens-page rows come from a different
source: `scanGrokSessionUsage` (`packages/providers/src/providers/grok-session-usage.ts:49-67`),
which runs in the host after the probe (`openusage-plugin.ts:167-179`) and reads
`sessions/**/updates.jsonl` `turn_completed` rows.

Measured on this machine at 2026-10-10 23:54-23:57 Asia/Taipei. Script:
`grok-spend-compare.py` in this directory. It prints only aggregates.

| Observation | Value |
| --- | --- |
| `unified.jsonl` size / lines | 3,986,285 bytes / 7,059 lines (log is capped) |
| `unified.jsonl` time range | 2026-10-07T20:32Z to 2026-10-10T15:46Z, about 3 days of a 30-day window |
| `inference_done` rows in range | 616, all on 2026-10-10 local, all attributed to `grok-4.7` |
| Rows priced by `MODEL_RATES` | 0. `grok-4.7` has no entry, so `parseSpendLog` skips all 616 (`:416-417`) |
| Tiles shown on the card now | None. All three periods are omitted (`pushSpendLine` `:427`) |
| Session files | 447 `updates.jsonl`, 863 MB total |
| Session entries, last 30 days | 810 model entries, 2,116,313,306 tokens, recorded cost $654.28 |
| Entries with recorded `costUsdTicks` | 797 of 810 (98.4%), 92.8% of tokens |
| 2026-10-10 local, sessions | 62,912,075 tokens, $14.12 recorded (18 entries, all costed) |
| 2026-10-09 local, sessions | no entries |

Observations about the two token definitions, from the same day (2026-10-10):

- `unified.jsonl`: prompt 63,293,906, completion 796,265, reasoning 651,342.
- Sessions: input 62,128,816, output 783,259, reasoning 642,222.

Unified `completion_tokens` is within 2% of session `outputTokens`. Grok reports reasoning as a
subset of output (upstream `GrokLogUsageScanner.swift:118`). `plugin.js:415` adds
`reasoning_tokens` to `completion_tokens`, so it counts reasoning twice. The 1-2% gap in input
and output between the two logs has not been explained.

The plugin rate table also disagrees with Grok's recorded cost. For all costed `grok-4.6-build`
entries (529), recorded cost is $386.47 and the `MODEL_RATES` estimate is $1,444.25 (3.7x). One
contributing factor: `turn_completed` usage sums several model calls per turn, so the 200K
long-context threshold (`plugin.js:365`) applies to the turn total instead of each call. There is
no rate for `grok-4.7-build` (300 costed entries, $271.83 recorded).

Upstream OpenUsage (Swift `main`, copied in `.sisyphus/upstream-grok/`) computes these tiles from
session transcripts. `GrokLogUsageScanner.swift:3-5` says `unified.jsonl` is a capped debug log and
cannot back historical spend. `grok.md` "The spend tiles" says it uses the recorded cost and
buckets days by local time. The 2026-09-20 plan deferred this item only to keep that change
small (`docs/plans/2026-09-20-grok-build-session-tokens.md:29`).

## Decision

Build the tiles in the host from the same session entries that the Tokens rows use, during the
same scan. Remove the `unified.jsonl` spend path from `plugin.js`.

- Keep the work in the host, not the plugin VM. The 2026-09-20 plan made that choice on purpose.
  `host.fs.listDir` lists only one level (`openusage-plugin.ts:272-276`), and a second parser in
  the VM would read the 863 MB again on every refresh.
- Tokens per entry = `inputTokens + outputTokens`, the same `totalTokens` used by the Tokens rows
  (`grok-session-usage.ts:156`). Reasoning is not added.
- Cost per entry = recorded `costUsdTicks / 1e10` (already parsed into `costUsd`,
  `grok-session-usage.ts:154-168`). An entry with no recorded cost adds its tokens and $0. Do not
  port a rate table. The local table has no 4.7 rate and is 3.7x off for 4.6-build. If uncosted
  tokens were skipped, Last 30 Days tokens would disagree with the Tokens page again.
- A period whose entries are all uncosted shows tokens only. This follows the Codex
  `costAndTokensLabel` pattern (`plugins/codex/plugin.js:539-547`). A period with zero tokens is
  omitted, as today.
- Days use the server's local time zone: `Today`, `Yesterday`, and a rolling 30 × 24 h window
  ending at `this.now()`. This matches the current `plugin.js` (`:317-323`, `:387`), the
  Codex/Claude cards, and upstream.
- Value format is unchanged: `$14.12 · 63M tokens`, using the existing `fmtTokens` rule.
- Line order is unchanged. The dashboard orders lines by array position
  (`apps/web/src/pages/dashboard-page.tsx:94-122`, not the manifest). The plugin appends spend
  lines after "Pay as you go" today, and the host will append them there too.

## Changes

1. `packages/providers/src/providers/grok-session-usage.ts`
   - Keep the timestamp in milliseconds on each entry (`timestampMs`) alongside the UTC-day
     `startedAt`. Today `startedAtFromObject` reduces it to a UTC day at once (`:174-199`).
   - Split dedup out of `aggregateGrokSessionRecords` (`:73-93`) so both outputs share one
     deduplicated entry list. Add `scanGrokSessionEntries(options)`.
     `scanGrokSessionUsage` stays a thin wrapper, so existing callers and tests are unchanged.
   - Add `grokSpendLines(entries, nowMs)`. It returns `{ type: "text", label, value }` lines for
     Today / Yesterday / Last 30 Days. Move `fmtTokens` here from `plugin.js:325-344` (a move, not a
     copy).
2. `packages/providers/src/providers/openusage-plugin.ts:167-179`. In the existing
   `pluginId === "grok"` block, scan entries once, capture the records, and append
   `grokSpendLines(entries, Date.parse(this.now()))` to `snapshot.lines`. Do this before `raw` is
   built at `:181`. `normalizePluginResult` has already run (`:166`), so build lines in the
   normalized shape. The block covers both the worker path (`openusage-plugin-worker.ts:9` calls
   `refreshInThread`) and the direct test path. A scan error keeps the existing `console.error`;
   the card then has no tiles, and the weekly billing lines still show.
3. `plugins/grok/plugin.js`. Delete the spend path: `DEFAULT_LOG_PATH`, `SPEND_DAYS_BACK`,
   `LONG_CONTEXT_PROMPT_TOKENS`, `MODEL_RATES`, `readEnv` (its only caller is `spendLogPath`),
   `spendLogPath`, `dayKeyFromMs`, `fmtTokens`, `spendValue`, `resolveRates`, `estimateCost`,
   `modelID`, `parseSpendLog`, `pushSpendLine`, `appendLocalSpend`, and the call at `:517`. This
   removes about 150 lines. `plugin.json` is unchanged because labels and scopes stay the same.
4. Docs (required by AGENTS.md):
   - `docs/providers/grok.md:14` and the "Local Spend" section `:79-85`: the tiles come from the
     session transcripts, use recorded cost, and count uncosted turns as tokens only. Days are
     local, while Tokens-page Grok days stay UTC.
   - `README.md:9`, `README_WEBUI.md:160`, `README_WEBUI.zh-TW.md:197`,
     `docs/USER_GUIDE_WEBUI.zh-TW.md:16`: remove "spend tiles still use `unified.jsonl`".
   - `tracker.md:72`: tick the item. Update `status.md` and `handover.md`.

## Out Of Scope

- Changing Tokens-page Grok rows from UTC days to local days. Current behavior is documented in
  `docs/USER_GUIDE_WEBUI.zh-TW.md:203`.
- An incremental JSONL scan cache. The full scan already runs on every refresh for Tokens, and the
  tiles only add arithmetic.
- A Grok model price table or an estimate for uncosted turns.
- Per-account attribution. There is one `grok` provider (`packages/providers/src/registry.ts:23`)
  and `~/.grok/auth.json` has 1 entry. Neither log records an account. Behavior is unchanged.
- Usage trend chart and "Extra Usage" copy from upstream (deferred in the 2026-09-20 plan).
- The Tauri desktop host. See Risks.

## Acceptance

Tests first (red, then green):

- `packages/providers/test/grok-session-usage.test.ts`
  - One costed turn today gives `Today` and `Last 30 Days` equal to `$X.XX · N tokens`, with
    N = input + output. Reasoning is not added.
  - Turns at local 23:30 yesterday and 00:30 today split into `Yesterday` and `Today`. Build the
    timestamps with the local `Date` constructor, as the existing fixture does.
  - An uncosted turn adds tokens and $0. A period whose entries are all uncosted shows tokens only.
  - A turn older than 30 days is excluded. A period with no tokens is omitted.
  - Duplicate `eventId` + model across two files counts once in the tiles, as it does in the
    records.
- `packages/providers/test/openusage-plugin-local-fixtures.test.ts:215`: replace the
  `unified.jsonl` test with a session fixture under `$GROK_HOME/sessions/a/b/updates.jsonl` and an
  injected `now`. Also write a `unified.jsonl` whose numbers differ and assert that it is ignored.
  Assert that the labels are `Weekly`, `Pay as you go`, `Today`, `Last 30 Days`, and check the
  value. Keep the existing case that has no sessions and expects only `Weekly`, `Pay as you go`
  (`:190-211`).
- `plugins/grok/plugin.test.js:528-657`: delete the six `unified.jsonl` tests together with the
  code they cover.
- Commands: `bun test packages/providers/test/grok-session-usage.test.ts
  packages/providers/test/openusage-plugin-local-fixtures.test.ts`, the Grok plugin suite with
  `vitest`, the full WebUI suite, and `bun run build:webui`.
- Live check (read-only, after merge and the approved deploy): Refresh Grok. The card's
  `Last 30 Days` tokens equal the sum of the Tokens page's Grok rows over the same window, to
  within the UTC/local edge days. `Today` matches the script output for that day.

Before: the card has no Grok spend tiles (all 616 log rows are unpriced). Expected after, using the
2026-10-10 data: `Today` $14.12 · 63M tokens, `Last 30 Days` about $654 · 2.1B tokens. Exact
values move with the clock.

## Risks

- About 152M tokens (151,456,931 grok-4.6-build + 867,884 grok-4.7-build) from 13 uncosted September entries (latest 2026-09-25 local) are counted
  without dollars. Dollars on those days are understated by the cost of those turns. The cause of
  the missing cost is not determined: 4 of the 13 are cancelled turns and 9 are not. These entries
  leave the 30-day window by 2026-10-26.
- The card uses local days and the Tokens page uses UTC days for Grok. With Asia/Taipei (+08:00),
  the two can differ at day edges (local 00:00-08:00). This convention already exists.
- The Tauri desktop app runs the same `plugin.js` with its own host
  (`src-tauri/src/plugin_engine/host_api.rs`) and has no session scan. After this change it shows
  no Grok spend tiles. Today it also shows none for 4.7 users, because those rows are unpriced.
  `src-tauri` was last changed 2026-08-08, and upstream `tauri-legacy` is frozen.
- Refresh time is unchanged: one fewer 4 MB read, and no new file reads.

Routing: Codex `gpt-6.1-sol` / `xhigh` implements (user choice: GPT-6.1 and Sonnet); triple-review fixed lanes.
