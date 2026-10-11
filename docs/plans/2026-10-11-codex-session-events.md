# Codex Session Events For Allowance — 2026-10-11

## Problem

All Codex token rows are stored on `codex:codex` because `~/.codex-family/sessions` is a symlink to
`~/.codex/sessions`, and `ccusage codex` gives daily rows only. Allowance therefore marks
`codex:family` `shared-log` and mixes about 14% of the other account's tokens into `codex:codex`;
Codex cycles restart at arbitrary times, so daily buckets straddle most cycle edges.

Every `token_count` event in a Codex session file carries `info.last_token_usage`,
`info.total_token_usage` and `rate_limits` with `plan_type`, `primary` and `secondary`
(`used_percent`, `window_minutes`, `resets_at`). Evidence:
`openusage_webui-artifacts/2026-10-11-allowance/gap-analysis.md` section 4.2 and
`scripts/codex-plan-cycles.ts` in the same directory.

## User Decision (2026-10-11)

Import Codex session events as a second PR after the cycle summary (`2026-10-11-allowance-cycle-summary.md`).

## Changes

E1. ADR `docs/ADR_2026-10-11_CODEX_SESSION_EVENTS.md`: new table read only by Allowance, account
mapping rule, deduplication rule, privacy (no prompt text, no account id stored).

E2. Storage: table `codex_token_events` (`provider_id`, `observed_at`, `tokens`, `input`,
`cached_input`, `output`, `plan_type`, `weekly_used_percent`, `weekly_resets_at`, unique key on
`provider_id, observed_at, total_tokens`). Migration in `packages/storage`.

E3. Scanner in `packages/providers/src`: read `*.jsonl` under the real (non-symlink) sessions
directory of each Codex account home, keep only `token_count` events, skip events whose
`total_token_usage` did not change, map to an account by the weekly window shape that account's
own quota observations report (a weekly-primary-only meter vs. 5-hour primary + weekly secondary)
or by `plan_type` recorded per account; never by `session_meta.creator_account_id`. Incremental by
file mtime/offset. Runs with the Codex refresh in the existing worker path.

E4. Allowance reads: `listAllowanceTokenRows` returns hourly-bucketed Codex event tokens per account
in place of the ccusage daily Codex rows when events exist for that account and hour; remove the
`shared-log` exclusion for an account that has event rows. Cycle summary (from the first PR) then
works for both Codex accounts unchanged. Event meter readings may also be written as quota
observations only if that needs no schema change; otherwise leave for later.

E5. Docs: `docs/providers/codex.md`, README Allowance notes, fix log.

## Acceptance

- Fixture session files (synthetic, no real ids) with two plan types produce rows on the right
  accounts; duplicate unchanged totals are skipped; re-scan is idempotent.
- Symlinked sessions directory scanned once.
- Allowance for a fixture: codex:family no longer `shared-log` when it has event rows;
  codex:codex excludes the other plan's tokens.
- Real-data check (read-only, aggregates only): per-cycle medians close to gap analysis
  (codex 2.75 M per 1%, family 0.75 M per 1%).
- Full test runners and `bun run build:webui` pass.

## Routing

Coding High engineering (new import path and schema): Grok Build `grok-4.7` / `xhigh`. Triple-review.
