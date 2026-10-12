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

## Review round 1

Reviewed target `8560153`. Grok, AGY, and Codex each returned REQUEST_CHANGES. E1-1 through E1-6 are fixed. The two LOW groups below stay as recorded.

| Finding | Source | Severity | Verified | Disposition |
|---|---|---|---|---|
| E1-1 Day where only the linked (symlink) account has events: its event hours are added AND the real-directory account's mixed ccusage daily row stays → double count | Grok, AGY (reproduced) | HIGH | yes: allowance-tokens.ts:148,174 covered keyed per account | fix: treat accounts sharing one real sessions directory as a group; on a day where any group member has events, drop the group's ccusage daily rows; test where only the linked account has events |
| E1-2 Remap (shape/plan change) rescans with INSERT OR IGNORE keyed by provider_id → same event stored under two accounts; unassignable events keep stale rows | Codex (reproduced) | HIGH | yes: codex-token-events.ts unique key includes provider_id | fix: on a mapping change, atomically replace the event rows for the rescanned scope (or key by account-independent event identity and update the owner); test swapping shapes |
| E1-3 Plan learned in a round is not used to assign that round's unassigned events, and the saved mapKey prevents a later rescan | Grok, Codex | MEDIUM | yes: codex-session-events.ts:110-164 | fix: re-assign unassigned events with learned plans in the same round (or save the input mapKey so the next round rescans); test |
| E1-4 eventDays uses the UTC-hour-truncated time for the local day; wrong in UTC+05:30 etc. | Codex (reproduced) | MEDIUM | yes: allowance-tokens.ts:143-148 | fix: local day from the event's own timestamp; test with TZ=Asia/Kolkata around midnight |
| E1-5 meterShapeFromObservations needs a >=1 day "session"; after the parallel Codex window fix the 7-day meter is "weekly" only → null shape | AGY, known integration | MEDIUM | yes: codex-session-events.ts:76-88 | fix now: weekly-primary when there is a >=1 day window (session or weekly) and no sub-day session; test both labelings |
| E1-6 readPlanTypes throws on invalid JSON in settings | AGY | LOW | yes | fix: treat as empty map and log |
| AGY LOW: recursive walk each refresh; plan change disables learning | AGY | LOW | partly | defer, record in fix log |
| Grok LOW: cursor/plan map kept after deleting account usage; replay in another file with new timestamp bypasses unique key | Grok | LOW | plausible | defer, record in fix log |

Accounts that share one real sessions directory are one group. On a local day where any member has events, Allowance leaves out every member's ccusage row for that day and keeps each account's own event hours. The local day is the event's own timestamp in the server time zone. The hour bucket remains the UTC hour that contains the event.

When the account shape or recorded plan changes, the scan deletes the stored event rows for those accounts and inserts the new assignment in one write. An event the new mapping cannot assign is removed. A later refresh with the same mapping still inserts only new bytes.

A plan learned from a shaped event in the same scan is applied to the other events in that scan before the file cursor moves on. A meter is weekly-primary when it has a window of at least one day, on the session line or the weekly line, and no shorter session. A five-hour session plus a weekly line stays the other shape. A stored plan map that is not valid JSON is logged and read as an empty map.

Each refresh still walks the session tree and stats every file. A history that contains more than one plan name for an account still does not record a learned plan. Deleting an account's usage still leaves the file cursor and the plan map. A replay written into another file with a new timestamp can still pass the unique key. Those items are unchanged.

| Commit | Change |
|--------|--------|
| `bccb3a2` test | A day with events only on the linked account must hide the real account's mixed ccusage row. |
| `6787f69` fix | Accounts that share one sessions directory are a group. Any member's events that day drop the group's ccusage rows. |
| `1c24870` test | Swapping shapes must leave the event on the new account only, and a later unassignable rescan must drop it. |
| `6ec05f4` fix | A mapping change replaces the scanned accounts' event rows in one write. |
| `cfde9ff` test | A plan learned in one scan must assign that scan's event that has only the plan name. |
| `ee1fd8b` fix | Unassigned events are assigned again after the same scan learns a plan. |
| `53fb889` test | In Asia/Kolkata, an event at 00:15 must replace that local day's ccusage row. |
| `c6a249a` fix | The local day comes from the event's own timestamp. |
| `cfe043e` test | A 7-day Weekly line and a 7-day Session line are both weekly-primary. A 5-hour Session plus Weekly stays the other shape. |
| `37a98d6` fix | weekly-primary is any window of at least one day when there is no shorter session. |
| `6f8d988` test | An invalid plan map must not stop the scan. |
| `7aa9c9d` fix | Invalid JSON is logged and read as an empty plan map. |

Checks after `7aa9c9d`, before this note:

| Command | Result |
|---------|--------|
| `bun run test -- --run` | 69 files, 1301 passed, exit 0 |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | 67 files, 502 passed, 0 failed, exit 0 |
| `bun run build:webui` | passed (`tsc`, Vite, server bundle), exit 0 |

The known `CcusageProvider` timeout flake and the Antigravity Cloud Code test that reaches a running language server did not fail in this run. This session does not push.

## Review round 2

Reviewed target `614d445`. Grok and Codex returned REQUEST_CHANGES. AGY returned APPROVE. E1-1 through E1-6 stayed fixed. E2-1 and E2-2 are fixed.

| Finding | Source | Severity | Verified | Disposition |
|---|---|---|---|---|
| E2-1 A remap rescan with a directory or file read failure still replaces all accounts' events and saves the new mapKey; old cursors stay, so lost history never returns | Grok, Codex (reproduced) | HIGH | yes: codex-session-events.ts:179,228,252,268; codex-event-refresh.ts:45,55 | fix: mark the scan complete only when every directory listing and file read succeeded; on an incomplete rescan do not replace events, cursors or mapKey (next round retries the full rescan); an empty but readable sessions dir still clears; regression test with a read failure then recovery |
| E2-2 readPlanTypes throws on valid non-object JSON ([], null, string) | Grok, AGY | LOW | yes | fix: log and treat as empty map |

A rescan replaces stored events only when every sessions directory listing and every session file read succeeded. If a listing or a file read fails, the refresh leaves the stored events, file cursors, recorded plans, and mapping key unchanged. The next refresh still has the previous mapping key and rereads the history. An empty sessions directory that can be read still clears the stored events.

A stored plan map that is an array, `null`, or a string is logged as `codex_event_plan_types_invalid` and read as an empty map. The Codex refresh still attaches the event scan.

| Commit | Change |
|--------|--------|
| `620e994` test | A file that cannot be read during a shape change must keep all 300 tokens on the original account, and a sessions directory that cannot be listed must keep them too. After the read succeeds, the 300 tokens move to the new account. An empty readable sessions directory still clears. |
| `2a3c2eb` fix | An incomplete rescan does not replace events, cursors, or the mapping key. |
| `b534aa2` test | An array, null, or string plan map must not stop the scan. |
| `37964cb` fix | Those values are logged and read as an empty plan map. |

Checks after `37964cb`, before this note:

| Command | Result |
|---------|--------|
| `bun run test -- --run` | 69 files, 1301 passed, exit 0 |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | 68 files, 505 passed, 1 failed, exit 1 |
| `bun run build:webui` | passed (`tsc`, Vite, server bundle), exit 0 |

The one failure is `CcusageProvider > default command runner cleans up child processes on timeout`. The same test passed when run alone (1 pass, exit 0). The Antigravity Cloud Code test that reaches a running language server did not fail in this run. This session does not push.

## Review round 3

Target `dbb890a`. Grok Build `grok-4.7` high, AGY `gemini-3.8-flash-high`, Codex `gpt-6.1-sol` high (second Codex home): all APPROVE. E2-1 and E2-2 confirmed resolved. Deferred LOW findings (Codex lane): a remap rescan where the sessions directory does not exist still clears events and saves the new mapping key (a missing directory is treated like an empty one); a new test does not restore an environment variable it sets.
