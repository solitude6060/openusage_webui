# ADR 2026-10-11: Hourly Token Buckets For Allowance

Status: Accepted (2026-10-11). Decided by the orchestrator under the user's instruction to complete
the deferred hourly Allowance item. Plan: `docs/plans/2026-10-11-hourly-allowance-tokens.md`.

## Context

Allowance estimates divide tokens used between two meter readings by the meter movement. Token
rows in `usage_records` are daily buckets, so C7 (2026-10-10) aligned cycle edges to day
boundaries. Finer buckets let the measured span reach the actual meter readings.

Evidence (database copy captured 2026-10-10 13:46Z; plan has details):
- `ccusage claude blocks --json --session-length 1` returns hour-aligned blocks whose per-day sums
  equal `ccusage claude daily` (10 days checked, 0 mismatches).
- Cursor usage events and Grok session transcripts carry millisecond timestamps.
- `ccusage codex` offers only `daily`, `monthly`, `session`; no hourly path.

## Decision

1. Add a table `token_hourly`, read only by the Allowance estimate. `usage_records` daily rows stay
   the source of token totals for every other reader; they are not rewritten, migrated or deleted.
2. Allowance row selection: per provider and local day (ccusage) or UTC day (Cursor, Grok), use
   hourly rows when any exist for that day, otherwise the daily rows. The estimator is unchanged.
3. Sources: Claude via `ccusage claude blocks --session-length 1` with the same `--since` as the
   daily query, written only for days whose hourly sum equals the daily total (mismatch: no hourly
   rows for that day, logged). Cursor and Grok: the same events grouped by hour. Codex: daily only.
4. Hourly record identities differ from daily ones. Deleting a provider account deletes its hourly
   rows.
5. Where hourly rows are used, the Claude model list shows one `All Models` line (blocks have no
   per-model split).
6. This lifts, for this change only, C7's restriction on changing the ccusage invocation.

## Consequences

- Allowance spans can start and end at hour boundaries near the meter readings; days without
  hourly data (for example Claude logs already deleted by Claude Code) fall back to daily rows.
- Codex estimates are unchanged. The shared `~/.codex-family/sessions` link remains a separate,
  unresolved attribution issue.
- One extra ccusage call per Claude refresh (measured 0.35 s with `--offline`).
