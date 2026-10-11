# Codex Session Events Fix Log — 2026-10-11

> Branch: `feat/codex-session-events` (base `998d7d8`, plan commit)
> Decision: `docs/ADR_2026-10-11_CODEX_SESSION_EVENTS.md`
> Plan: `docs/plans/2026-10-11-codex-session-events.md`
> Evidence: `../openusage_webui-artifacts/2026-10-11-allowance/gap-analysis.md` section 4.2

| Role | Client / model / effort |
|------|-------------------------|
| Implementer | Grok Build `grok-4.7` |
| Review lanes | Not run in this session |

The plan names a triple-review before merge. This session stops at the fix log and does not push.

## What landed

Allowance reads `token_count` events from each Codex account's real `sessions` directory. A linked directory is scanned once. An event is kept when the cumulative total changed. It is assigned by the weekly meter shape (7-day session, or 5-hour session plus a weekly meter) or by one recorded plan name. `creator_account_id` is not read. Prompt text and account ids are not stored.

`codex_token_events` is read only by Allowance. A local day with events replaces that account's ccusage day with hourly `All Models` buckets. Tokens, Sessions, and Dashboard stay on the daily rows. An account with event rows in the Allowance window is no longer marked `shared-log`. A linked account with no events stays excluded.

The Codex refresh, in the plugin worker, returns the new rows. The server and the CLI status refresh store the rows, the file cursors, and the recorded plan. The next refresh resumes from the cursor.

Quota observations are not written from these events. The acceptance check does not require them, and one row per event would add a large series beside the probe history. The ADR leaves that write for later.

Child-session replay was measured and not adopted. Skipping replayed lines before the child's own turn removed about 19,000 lines and left the all-history medians at 5.84 (prolite) and 1.24 (plus). The September–October medians already match the gap analysis without that skip.

## Real-data check

Read-only scan of the local Codex session files, aggregates only. The comparison window is September–October 2026, the months in the gap-analysis event table. Cycles are the same plan with weekly reset times within 20 hours, and the end percent is at least 20. The ratio is in-cycle tokens divided by that end percent.

| Plan | This scan | Gap analysis |
|------|-----------|--------------|
| prolite (codex:codex) | 21,842 events, 13 cycles, median 2.77 M per 1% (mean 2.62, min–max 0.15–6.59) | 11 cycles, median 2.75 (mean 2.81, min–max 0.52–6.59) |
| plus (codex:family) | 4,142 events, 7 cycles, median 0.78 M per 1% (mean 0.89, min–max 0.56–1.60) | 6 cycles, median 0.75 (mean 0.78, min–max 0.56–0.99) |

The scan covered 4,174 session files and 205,460 kept events in total, of which 6,320 had no account. An earlier pass over the whole history, including cycles before September 2026, had medians 5.85 (prolite, 42 cycles) and 1.29 (plus, 26 cycles). Those older cycles are outside the gap-analysis table.

## Checks

- `bun run test -- --run`: 69 files, 1,301 passed, 0 failed. The first attempt exited 127 because dependencies were not installed. After `bun install`, the rerun passed.
- `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`: 64 files, 496 passed, 0 failed.
- `bun run build:webui`: passed (`tsc`, Vite, server bundle).
- The known `CcusageProvider` timeout flake and the Antigravity Cloud Code language-server test did not fail in this run.

## Commits

`a439fb6` docs: decide Codex session events for Allowance
`7abe796` test: Allowance must read Codex events instead of the shared daily row
`a359a0a` feat(storage): store Codex token events for Allowance only
`a867539` test: Codex session events must split plans and skip unchanged totals
`0b9ae9e` feat(providers): scan Codex session events by meter shape
`09fde71` test: Allowance must split Codex accounts that have session events
`6fe9e02` fix(allowance): use Codex event rows instead of the shared-log flag
`8a1bf10` test: Codex refresh must return session events for the live meter
`26276b2` test: Codex refresh must store session events for Allowance
`de18baf` feat(providers): return Codex session events from refresh
`81dd6b8` feat(server): store Codex session events on refresh

The documentation update is the commit that adds this file.
