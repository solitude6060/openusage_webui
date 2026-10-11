# ADR 2026-10-11: Codex Session Events For Allowance

Status: Accepted (2026-10-11). Decided with the user: import Codex session events as a
second change after the cycle summary. Plan: `docs/plans/2026-10-11-codex-session-events.md`.

## Context

Allowance divides tokens used between two meter readings by the meter movement. Codex rows
today come from `ccusage codex`, which is daily only, and every Codex home that shares one
`sessions` directory stores those rows on the account whose directory is the real folder.
The other account is marked `shared-log` and is not converted. The real account's daily
rows include both accounts' tokens. Codex cycles also restart at arbitrary times, so a
local-day bucket usually crosses a cycle edge.

Codex session files are `sessions/**/*.jsonl`. A line with `type: "event_msg"` and
`payload.type: "token_count"` carries `payload.info.last_token_usage`,
`payload.info.total_token_usage`, and `payload.rate_limits` (`plan_type`, `primary`,
`secondary` with `used_percent`, `window_minutes`, `resets_at`). One plan reports a weekly
primary window only (7 days, 10080 minutes). The other reports a 5-hour primary window
(300 minutes) plus a weekly secondary window. That window shape matches the account's own
quota lines: a 7-day Session line, or a 5-hour Session line plus a Weekly line.
`session_meta.creator_account_id` does not identify who consumed the tokens.

Evidence: `docs/plans/2026-10-11-codex-session-events.md` and the 2026-10-11 allowance gap
analysis, section 4.2. Per completed cycle there, the medians are 2.75M tokens per 1% and
0.75M tokens per 1%.

## Decision

1. Add a table `codex_token_events`, read only by Allowance. `usage_records` daily rows stay
   the source of token totals for every other reader. They are not rewritten or deleted.
   Columns: `provider_id`, `observed_at`, `tokens` (the turn's `last_token_usage` total),
   `input`, `cached_input`, `output`, `plan_type`, `weekly_used_percent`,
   `weekly_resets_at`, and `total_tokens` (the cumulative `total_token_usage` total).
   The unique key is `provider_id, observed_at, total_tokens`.
2. A refresh cursor table `codex_event_cursors` stores the session file path, modified time,
   byte offset, and the last cumulative total. It exists so the next refresh can resume.
   The recorded plan name for each account is stored in `app_meta` under
   `codex_event_plan_types`. Neither store holds prompt text or an account id.
3. The scanner reads `*.jsonl` under the real `sessions` directory of each configured Codex
   home. A directory reached through a symlink is read once. Only `token_count` events are
   kept. An event whose cumulative `total_token_usage` did not change since the previous
   kept event in that file is skipped. The scan runs inside the existing Codex refresh
   worker, after a successful probe, and the server writes the rows.
4. An event is assigned to the one account whose quota observations report the same weekly
   window shape (weekly primary only, or 5-hour primary plus weekly secondary). If the
   shape does not pick one account, the plan name recorded for an account is used. The
   scanner never reads `creator_account_id`. Events that match no account are counted in
   the error log and not stored. Quota observations are not written from these events.
5. When an account has event rows on a local day, Allowance uses the hourly sums of those
   events for that day instead of that account's ccusage daily row. Other days keep the
   daily row. An account that has event rows in the Allowance range is not marked
   `shared-log`. Deleting a provider's usage also deletes its event rows.

## Consequences

- Allowance can convert both Codex accounts from their own tokens. Days with no event rows
  still use the mixed daily row.
- Tokens, Sessions, and Dashboard totals are unchanged. Codex event rows have no model and
  no price, so Allowance shows them as one `All Models` line and does not add an API dollar
  figure from them.
- The first successful refresh reads the session history. Later refreshes read only the
  bytes appended since the cursor. A change in account shape or recorded plan rereads the
  files; the unique key keeps that reread from inserting duplicates.
