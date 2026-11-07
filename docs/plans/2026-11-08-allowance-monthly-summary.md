# Allowance Monthly Summary And Codex Account Attribution

Date: 2026-11-08. Branch: `feat/allowance-monthly-summary` from `origin/main` `ec01a33f` (live :6736 revision).

## Owner request

- 2026-11-08: the Allowance page should first answer "this subscription month: how much was used, and what
  it costs at API prices".
- Reported as wrong on the live page: percentages above 100 that cannot be read; the Codex main account
  shows almost no tokens; "Meter Fell" has no stated meaning.
- Earlier requests: 2026-10-10 and 2026-10-19, reconstruct usage over the whole subscription period.

## Evidence (read-only, 2026-11-07 and 2026-11-08)

- Live screenshots of the 7 Days and Subscription Period tabs were taken from :6736. They contain personal
  usage figures and are not tracked.
- Latest snapshots (2026-11-07 16:03Z): `codex:codex` plan Plus, Session (5 h) and Weekly windows, Weekly
  23%, resets 2026-11-13T15:29:44Z. `codex:family` plan Plus, the same two windows, Weekly 16%, resets
  2026-11-13T20:35:23Z.
- `~/.codex-family/sessions` is a symlink to `~/.codex/sessions`. In the last 14 days the directory holds
  1,868 `token_count` events, all with primary 300 min, secondary 10080 min and `plan_type` `plus`.
- `assignAccount` (`packages/providers/src/codex-session-events.ts`) matches the meter shape first and the plan
  type second. Both accounts now have the same shape and plan, so neither rule identifies one account. On
  the live page `codex:codex` shows "No Tokens" for 14 of 16 weekly cycles while its meter moved (78%,
  100%, 63%); its tokens accrue to `codex:family`.
- Every session file on disk (161 files, 2026-10 and 2026-11) starts with `session_meta.payload.creator_account_id`.
  It equals `tokens.account_id` in exactly one home's `auth.json`: 120 sessions for `~/.codex`, 41 for
  `~/.codex-family` (last 14 days, compared as SHA-256 prefixes).
- The weekly `resets_at` inside events matches the creating account's snapshot reset for most events. 11
  events in sessions created by `~/.codex-family` carry the `~/.codex` reset; cause not determined.
- Stored Codex events go back to 2026-04. Their source files are no longer on disk.
- Billing month "Weekly Used" shows consumed of available percent: Claude 2026-10-14 to 11-14 "391% of
  349.3%"; Codex 2026-10 "582% of 442.9%". Available percent assumes 7-day cycles; recent Codex cycles are
  1 to 4 days long (cause not determined).
- Weekly cycles with a mid-cycle reset show the summed climb, for example "185% · 2 Segments".
- "Meter Fell" is the exclusion reason `meter-fell`: a reading fell inside a cycle while its stated reset
  stayed the same. The Antigravity card shows it as the headline next to "2% → 6%".
- Antigravity and Copilot have no local token history, so every span shows 0 tokens.

## Changes

### S1 Codex attribution by account id

Files: `packages/providers/src/codex-session-events.ts`, `apps/server/src/codex-event-refresh.ts`, tests.

- Each Codex account carries `accountIdHash`: SHA-256 of `tokens.account_id` from `<home>/auth.json`. The raw
  id and tokens are never stored, logged or returned.
- An event belongs to the account whose hash equals the hash of its session's `creator_account_id`. When no
  account matches, the existing shape and plan rule applies.
- The event map key includes the hashes, so the first refresh after deploy rescans the files on disk.
- Constraint: the rescan must not delete stored events or hourly token rows whose source files are gone.
  Verify on a database copy before deploy; back up the live database before the restart.
- Known limit: attribution is per session. A session resumed under the other login stays with its creator.

Tests first: two homes with the same plan and shape and different account ids split events by creator; a
session without a matching id falls back to the old rule; a changed map key triggers a rescan; rows whose
files are gone are kept.

### S2 Monthly summary at the top of the Allowance page

Files: `apps/web/src/pages/allowance-page.tsx`, page styles and tests. Data: the existing `billing.months` in
`GET /api/usage/allowance?span=cycles`; no new endpoint.

- One row per provider with a weekly window: billing month dates and their source (billing date, detected
  upgrade, or calendar month), tokens, API-equivalent dollars, projected month-end dollars when reliable,
  and the current weekly meter percent.
- Providers without local token history show "No local token history" instead of 0.
- The range tabs and cycle tables move under a collapsed native `<details>` section named "Details".

### S3 No percent above 100 in the page

- Billing month table: remove the "Weekly Used" column.
- Cycle table: a cycle with segments lists each segment's climb ("96% + 89%, meter reset mid-week") instead
  of the sum.

### S4 Plain reason text

- Each exclusion reason renders as one sentence, for example `meter-fell`: "The meter reset before its stated
  reset time, so this span is not used for estimates."
- A card headline shows a reason only when the span has no estimate.

## Out of scope

- The Dashboard shows the same ccusage totals on both Codex cards (ADR `docs/ADR_2026-10-11_CODEX_SESSION_EVENTS.md`).
- Renaming the fork (separate change after the owner picks a name).
- A Codex billing date from the ID token `chatgpt_subscription_active_start`.

## Verification

- `bunx vitest run`, the Bun suites and `bun run build:webui`.
- Database copy: per-account Codex tokens for 2026-10-25 to 2026-11-08 compared with session counts per
  creator; stored event and hourly row counts before 2026-10 unchanged for every provider.
- Browser screenshots of the summary at 1440 px and 390 px on the database copy.
- Triple-review per the canonical skill. Deploy restarts `openusage-webui.service` and needs owner approval.
