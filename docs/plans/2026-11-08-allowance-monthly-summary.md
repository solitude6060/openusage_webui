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
- Live database (read-only): `codex_token_events` holds 36,981 events, 4,363,922,841 tokens, 2026-04-06 to
  2026-11-07, all under `codex:family`; `codex:codex` has 0 events. Session files on disk start in 2026-10;
  `~/.codex/archived_sessions` does not exist. Why older files are gone is not determined.
- On a map key change, `replaceCodexTokenEvents` (`packages/storage/src/codex-token-events.ts`) deletes every
  event of both Codex providers and inserts only events from files on disk. A map key change on the live
  database today would remove the 2026-04 to 2026-09 events.
- Cursor (`cursor:total-usage`) and Copilot (`premium`) have monthly windows. `buildBilling` runs only for
  `weekly` windows, so their `billing` is null. Their `current` cycle carries `tokens` and `apiCost` (Cursor
  2026-10-16 to 11-16: 157,457,560 tokens, $113.90).
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
- A rescan replaces only events at or after the earliest event found in the rescanned files. Older stored
  events stay unchanged. Without this, the rescan deletes the 2026-04 to 2026-09 events (Evidence).
- Back up the live database before the restart.
- Known limits: events before the earliest file on disk stay under `codex:family`, because their files are
  gone. Attribution is per session; a session resumed under the other login stays with its creator.

Tests first: two homes with the same plan and shape and different account ids split events by creator; a
session without a matching id falls back to the old rule; a changed map key triggers a rescan; a rescan keeps
stored events older than the earliest rescanned event.

### S2 Monthly summary at the top of the Allowance page

Files: `apps/web/src/pages/allowance-page.tsx`, page styles and tests. Data: the existing `billing.months` in
`GET /api/usage/allowance?span=cycles`; no new endpoint.

- One row per provider with a weekly window: billing month dates and their source (billing date, detected
  upgrade, or calendar month), tokens, API-equivalent dollars, projected month-end dollars when reliable,
  and the current weekly meter percent.
- Providers with a monthly window (Cursor, Copilot) have no `billing`; their current cycle is the billing
  month, so the row uses `current.tokens`, `current.apiCost` and the same projection rule.
- Providers without local token history show "No local token history" instead of 0.
- The range tabs and cycle tables move under a collapsed native `<details>` section named "Details".

### S3 No percent above 100 in the page

- Billing month table: remove the "Weekly Used" column. It was added for the 2026-10-19 request; the owner's
  2026-11-08 answer names tokens and API dollars as the monthly figures.
- Check whether redeemed Codex reset credits ("Rate Limit Resets", "Reset Credit") explain the 1 to 4 day
  Codex cycles; record the result.
  - Result (database copy, script `s2/codex-reset-credit-check.ts` in the artifacts folder): of the cycle
    boundaries that end a cycle shorter than 6.9 days, a drop in "Rate Limit Resets: N available" within
    2 hours appears at 2 of 15 for `codex:codex` and 3 of 14 for `codex:family`. None of the October
    boundaries (10-04 to 10-28) has one. Cause of the other short cycles not determined. Limit: snapshots
    are about 20 minutes apart, so a grant and a redemption inside one interval are not visible.
- Cycle table: a cycle with segments lists each segment's climb ("96% + 89%, meter reset mid-week") instead
  of the sum.

### S4 Plain reason text

- Each exclusion reason renders as one sentence, for example `meter-fell`: "The meter reset before its stated
  reset time, so this span is not used for estimates."
- A card headline shows a reason only when the span has no estimate.

### S5 Codex API value per account (added 2026-11-08 after S1 and S2)

- Evidence (database copy): Codex event rows enter Allowance as model "All Models" with `costUsd` null
  (`listAllowanceRows`, `packages/storage/src/allowance-tokens.ts`), and they replace the ccusage rows of the
  same day for every account in the session group. The priced ccusage daily rows of the shared log exist only
  under `codex:codex` (2026-11: 17 rows, 123,733,078 tokens, $140.99). The summary therefore shows API value
  "—" for both Codex accounts.
- Change: for each session group and local day, take the priced ccusage cost of the shared log and split it
  over the group's event hours in proportion to event tokens. Each account's day cost is that cost times its
  share of the day's event tokens. If any ccusage row of that day lacks a price, the day stays unpriced.
- Check: on the database copy, the per-day sum of both accounts' allocated cost equals the ccusage cost of
  that day.

### S2 follow-ups (added 2026-11-08 after the S2 report)

- "Projected End" above 100% in Details reads "Runs Out Before Reset At This Pace" instead of the number.
- Range-tab cards whose estimate is marked rough do not show allowance or API value as the large headline.
- Remove the changelog sentence about the removed column from the user guide.

## Delivery

- Owner decision 2026-11-08: Claude Opus 5.5 implements every item; the reviewers are Grok Build `grok-4.7`
  xhigh, AGY `gemini-3.8-flash-high`, and Opus 5.5 high (AGY `claude-opus-5-5-high` first, then Claude Code).
  This replaces the Codex `gpt-6.1-sol` third lane for this change. The Opus reviewer shares the
  implementer's family by owner choice and runs in a separate read-only context.
- S1 (Coding High, storage logic that deletes rows): Opus 5.5 high, worktree `../openusage_webui-wt-codex-attribution`.
- S2–S4 (Coding Medium, page and display): Opus 5.5 medium, worktree `../openusage_webui-wt-allowance-summary`.
  The two write scopes do not overlap. The orchestrator merges both into this branch.
- Docs to update: `docs/ADR_2026-10-11_CODEX_SESSION_EVENTS.md` (S1), `docs/providers/codex.md` if it
  describes event mapping (S1), `docs/USER_GUIDE_WEBUI.zh-TW.md` §5.5 (S2–S4), `README.md` Allowance notes.
- Visual change: before and after screenshots stay in `../openusage_webui-artifacts/2026-11-08-allowance/`
  (personal usage figures, not attached to the public PR).

## Out of scope

- The Dashboard shows the same ccusage totals on both Codex cards (ADR `docs/ADR_2026-10-11_CODEX_SESSION_EVENTS.md`).
- Renaming the fork (separate change after the owner picks a name).
- A Codex billing date from the ID token `chatgpt_subscription_active_start`.

## Verification

- `bunx vitest run`, the Bun suites and `bun run build:webui`.
- Database copy, before and after the rescan:
  - for each day covered by files on disk, `codex:codex` plus `codex:family` tokens are equal (tokens move
    between the two accounts; the total does not change);
  - events and hourly rows before the earliest rescanned event are unchanged for every provider;
  - per-account Codex tokens for the last 14 days follow the session counts per creator.
- Browser screenshots of the summary at 1440 px and 390 px on the database copy.
- Triple-review per the canonical skill. Deploy restarts `openusage-webui.service` and needs owner approval.
