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
quota lines: a 7-day Session line, a 7-day Weekly line with no shorter Session line, or a
5-hour Session line plus a Weekly line.
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
   `codex_event_plan_types`. A value that is not valid JSON, or that is JSON but
   not an object, is read as an empty map and logged. Neither store holds prompt
   text or an account id.
3. The scanner reads `*.jsonl` under the real `sessions` directory of each configured Codex
   home. A directory reached through a symlink is read once. Only `token_count` events are
   kept. An event whose cumulative `total_token_usage` did not change since the previous
   kept event in that file is skipped. The scan runs inside the existing Codex refresh
   worker, after a successful probe, and the server writes the rows.
4. An event is assigned to the one account whose quota observations report the same weekly
   window shape (a weekly window of at least one day and no shorter session, or 5-hour
   primary plus weekly secondary). If the shape does not pick one account, the plan name
   recorded for an account is used. A plan
   learned from a shaped event in that same scan is used to assign the scan's other events
   before the file cursor moves on. The scanner never reads `creator_account_id`. Events
   that match no account are counted in the error log and not stored. Quota observations
   are not written from these events.
5. Accounts that share one real sessions directory are one group. The local day of an
   event is that event's own timestamp in the server time zone. When any account in the
   group has event rows on a local day, Allowance uses each account's hourly event sums
   for that day and leaves out every account's ccusage row for that day. A day with no
   event in the group keeps the daily row. An account that has event rows in the
   Allowance range is not marked `shared-log`. Deleting a provider's usage also deletes
   its event rows.

## Consequences

- Allowance can convert both Codex accounts from their own tokens. Days with no event rows
  still use the mixed daily row.
- Tokens, Sessions, and Dashboard totals are unchanged. Codex event rows have no model and
  no price, so Allowance shows them as one `All Models` line and does not add an API dollar
  figure from them.
- The first successful refresh reads the session history. Later refreshes read only the
  bytes appended since the cursor. A change in account shape or recorded plan rereads the
  files and replaces the stored event rows for those accounts in one write. Superseded on
  2026-11-08 (see "Update 2026-11-08: Attribution By Session Creator" below): a reread now
  moves only the events it finds and can assign, by time and cumulative total; an empty
  sessions directory that can be read keeps the stored events; an event the new mapping
  cannot assign keeps its account; and a reread that cannot read every folder and file still
  stores what it read but marks the mapping key `rescan-pending`, so the next refresh rereads
  again.
  The unique key still ignores a duplicate insert of the same account, time, and
  cumulative total.

## Update 2026-11-08: Attribution By Session Creator

Plan: `docs/plans/2026-11-08-allowance-monthly-summary.md`, item S1.

Both Codex accounts became Plus with the same 5-hour plus weekly windows, so the shape and
plan rule in Decision 4 could no longer pick one account. Every event went to one account.
This section replaces two 2026-10-11 statements: "`session_meta.creator_account_id` does
not identify who consumed the tokens" and "The scanner never reads `creator_account_id`".

- Each configured Codex home carries a hash: SHA-256 of `tokens.account_id` in
  `<home>/auth.json`. Only that field is read.
- Each session file's first line is `session_meta`. Its `creator_account_id` is hashed.
  Every event in that file goes to the one account with the same hash. The first line is
  read separately, so events appended later keep their creator.
- When no account matches, or the field is missing, the old shape and plan rule applies.
  Only events assigned by that rule teach a recorded plan.
- The mapping key in `app_meta` now includes these hashes. The full hash is stored there;
  the raw id is never stored, logged, or returned. A changed hash rereads the files.
- A reread replaces a stored event only when a file it read holds the same event (same time
  and cumulative total) and the new mapping assigns it to an account. Every other stored
  event keeps its account: events whose files are gone, and events the new mapping cannot
  assign. (Revised after review R1-1; the first version replaced every event after the
  earliest file event.) When two or more stored rows share a rescanned event's time and
  cumulative total, the reread cannot tell which session it came from, so it keeps all of them
  and adds no row for that event (reviews F-1 and R6-1; adding one under a third account would
  count the tokens twice).
- A reread that is incomplete (a folder or file could not be read) still moves the events it
  did read and saves their file cursors. Instead of the new mapping key it stores the marker
  `rescan-pending`, which no real key equals, so every later refresh rereads again until one
  reread completes, even if the accounts' key returns to the old value. (Keeping the old key
  let those saved cursors skip the moved files; review R3-1.) This is safe because the replace
  touches only events it re-inserts. On such a reread, an event that only a plan learned in
  the same reread could assign is left unmapped, because the unread files might make that
  plan ambiguous; its stored row keeps its account (review G-R3-1). Before review R2-1 an incomplete reread saved nothing, so
  one deleted home or one unreadable file stopped Codex events for every account. Until the
  cause is fixed, every refresh rereads all session files. Cursors under a missing sessions
  directory are kept on purpose: they are what keeps a temporarily unmounted directory from
  being read as empty, so a deleted home costs a full reread on each refresh (review R3-2).
  While the reread stays pending, learned plans are not saved, and new events that only a
  newly learned plan could assign are not stored; the first complete reread, which reads every
  file from the start, adds those that its plan names can assign. Each pending reread logs the
  number of events it read but left unassigned, stored or new, as `codex_events_unmapped` (a
  count only). The marker is written before any event moves, so a
  stop between the writes also leaves the reread pending (review R4-1, R4-2).
- A reread that finds no event (for example an empty sessions directory that can be read)
  counts as incomplete, so the mapping key is marked pending and the next refresh rereads
  again; it logs `codex_event_rescan_no_events`. Saving the key would use the reread up, and files that come back with their
  old size and modified time would never be read again. (Review G-R1-1.)
- A missing sessions directory counts as a failed read when the stored file cursors show it
  held session files before. A home that never had one is skipped and does not block the
  other home. (Review G-R1-2.)
- A missing `auth.json`, as after a logout, removes that home's hash and rereads the files.
  That home's sessions then fall back to the shape and plan rule. When that rule cannot
  pick an account, as with two Plus accounts, the stored events keep their account. When it
  can pick one, the events move to it.
- If an `auth.json` exists but cannot be read or parsed, that refresh skips the event scan:
  no events, cursors, or mapping key change. A missing `auth.json` means no hash.
- If a session file's first line cannot be read, or is longer than 4 MiB, none of that file's
  new events are stored, its cursor stays, and the scan counts as incomplete, so the next
  refresh retries it.

Known limits:

- Events whose session files are gone keep their old account. On the
  owner's machine on 2026-11-08 that is 35,136 events from 2026-04-06 to 2026-10-28, all
  under `codex:family`; the earliest event in a file on disk is 2026-10-29T10:01Z.
- Attribution is per session. A session resumed under the other login stays with its
  creator. 11 events in sessions created by `~/.codex-family` carry the other account's
  weekly reset; they stay with the creator.

## Update 2026-11-08: API Value For Event Hours

Plan: `docs/plans/2026-11-08-allowance-monthly-summary.md`, item S5. This replaces the 2026-10-11
consequence that Allowance "does not add an API dollar figure" from event rows.

- Event hours still show as one `All Models` line with unchanged token counts.
- Each event hour now carries a price: the session group's ccusage cost for that local day times
  the hour's share of the group's event tokens that day. Each account's day cost is therefore the
  day cost times its share of the day's event tokens, and the accounts add up to the day cost.
- The day cost comes from the first group member, by account id, that holds ccusage rows that day,
  so a log stored on two members is not counted twice. Hourly ccusage rows are used when that
  member has them for the day, otherwise its daily rows.
- If the group has no ccusage row that day, or any of those rows has no price, the day's event
  hours stay unpriced.
- These prices are marked as allocated. Billing months and cycle dollars count them, but the
  regime change and upgrade checks treat a segment with allocated dollars as unpriced: a
  token share of a day's cost cannot show a change in dollars per percent. (Review R1-3.)

