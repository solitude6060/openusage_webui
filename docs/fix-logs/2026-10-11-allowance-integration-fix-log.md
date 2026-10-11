# Allowance Integration Fix Log — 2026-10-11

> Branch: `chore/allowance-integration`
> Base: `origin/main` at `fb72d6d`
> The four source branches had each passed triple-review on their own. This log covers behavior that was missing only after they were combined.

No branch commit was rewritten. Each source head is an ancestor of this branch. Nothing was pushed.

## Merges

No-ff merges onto `fb72d6d`, in this order:

| Order | Source | Head | Merge | Conflicts |
|-------|--------|------|-------|-----------|
| 1 | `fix/cursor-meter-semantics` | `ad5b182` | `fd61b73` | none |
| 2 | `fix/codex-window-sources` | `39a0320` | `6a2a6bd` | none |
| 3 | `feat/allowance-cycle-summary` | `82213b7` | `ab7fd0f` | two test files, below |
| 4 | `feat/codex-session-events` | `5965b7c` | `0a36005` | none |

`ab7fd0f` conflicted in `apps/server/test/quota-history.test.ts` and `apps/web/src/pages/allowance-page.vitest.tsx`. Both sides were kept. The server file still contains the 7-day Session quota tests and the `span=cycles` tests. The page file still contains the Cursor dollar-limit tests and the Subscription Period test.

## I1. One Weekly series in the cycle summary

`buildAllowanceEstimates` runs `aliasCodexSevenDaySessions` before it chooses a window (`allowance-estimate.ts`). `buildAllowanceCycleSummaries` passed the stored rows straight to `chooseWindows`. After the window fix, new Codex readings are stored as Weekly and older 7-day readings stay Session. The cycle summary then kept the newer Weekly cycle and left the older cycle out, so one account did not have a continuous series.

`buildAllowanceCycleSummaries` now aliases those rows first, then chooses the window and reads the meter points from the aliased rows. A 5-hour Session is left as Session.

The new test failed before the fix because the summary had only the Weekly cycle ending `2026-10-15`. After the fix, one Weekly summary contains that cycle and the older cycle ending `2026-10-08`, and the older cycle ends when the newer one starts.

| Commit | Change |
|--------|--------|
| `55a8dcf` | test: legacy 7-day Session plus newer Weekly readings must be one continuous series |
| `221bca1` | fix: alias inside `buildAllowanceCycleSummaries` |

`README_WEBUI.md`, `README_WEBUI.zh-TW.md`, and the Allowance section of `docs/USER_GUIDE_WEBUI.zh-TW.md` now say those older readings sit in the same Weekly series. `84e1ff9` adds that a Session whose period is not exactly 7 days is still estimated only when that account has no Weekly window.

## I2. Event rows exempt the cycle summary too

`loadAllowanceEstimates` removes an account from the shared-log set when `listCodexEventProviderIds` returns it. `loadAllowanceCycleSummaries` built that set from `codexSessionTokenDuplicateIds` alone, so a linked Codex account with event rows was still treated as a shared log on `span=cycles`.

Both loaders now call `allowanceSharedProviderIds` in `apps/server/src/quota-history.ts`. The helper loads the duplicate ids and drops any id that has event rows in that loader's history window.

The new route test failed before the fix because `span=cycles` omitted the linked account. After the fix, that account's cycle is included and its exclusion is empty. The older test still omits a linked account that has no event rows.

| Commit | Change |
|--------|--------|
| `a0bf209` | test: a linked Codex account with event rows is included on `span=cycles` |
| `e2c0857` | fix: one shared helper for both loaders |

The Subscription Period paragraphs in both README files, and the user-guide shared-log lines, now say the exclusion applies when that account has no session-event rows of its own.

## I3. Other combinations

Checked against the merged tree. Code was changed only for the two gaps above. The user-guide sentence below was the remaining documentation mismatch.

| Check | Result |
|-------|--------|
| `meterShapeFromObservations` in `packages/providers/src/codex-session-events.ts` | Already treats a window of at least one day, whether the stored label is Session or Weekly, as weekly-primary when no shorter Session is present. A 5-hour Session plus Weekly stays the other shape. Covered by `packages/providers/test/codex-session-events.test.ts`. The refresh scan classifies the current plugin lines, which the window fix labels Weekly at exactly 7 days. No change. |
| Quotas (`loadQuotaDashboard`) | Still uses `codexSharedSessionAccountIds` and daily token rows. Session events are read only by Allowance. No change. |
| Provider rebuild | Still removes duplicate ccusage rows for the Tokens page. No change. |
| Token rows for cycles | Both loaders already call `listAllowanceTokenRows`, so the cycle summary already receives event hourly buckets. The missing piece was the shared-log set in I2. |
| Previous Weekly lookup | `previousQuotaObservation` already aliases a 7-day Session row. Cycle summaries read the whole series, which I1 now aliases. No further change. |
| Cursor meter | Cycle summaries use the stored percent. They do not recompute it from spend. The Included Dollar Limit label is on the range cards and was already updated on the Cursor branch. No change. |
| `docs/providers/codex.md` | Already says older 7-day Session readings are shown as Weekly in Allowance, and that a linked account with event rows is converted. No change. |
| `docs/ADR_2026-10-11_CODEX_SESSION_EVENTS.md` | The decision already exempts an account that has event rows. The context paragraph describes the earlier daily-row behavior. No change. |
| Plans under `docs/plans/` | Left as the records of each branch. |

The user guide still said a weekly quota appears only on a Session line. `README_WEBUI.zh-TW.md` and `docs/providers/codex.md` already describe a Session or Weekly line of at least one day, with no shorter Session. `f225c9d` aligns the user guide with that wording. The same guide said a linked account is never converted; that sentence was corrected in `e2c0857`.

## Checks

Recorded on this branch after `f225c9d`. The following doc-only commit `84e1ff9` does not change runtime behavior, so these commands were not run again.

| Command | Result |
|---------|--------|
| `bun run test -- --run` | 69 files, 1322 passed, 0 failed |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | 73 files, 541 tests, 540 passed, 1 failed |
| `bun run build:webui` | passed (web `tsc` + Vite, server bundle) |

The bun failure is `CcusageProvider > default command runner cleans up child processes on timeout`: after the 200 ms wait the marker file was still present. A second run of that file passed 12 tests and failed the same one. It was not changed here. The Antigravity Cloud Code test that reaches a running language server did not fail in this run.

## Review round 1

Reviewed at `34667a5`. Grok and Codex requested changes. One finding was verified.

| Finding | Source | Severity | Verified | Disposition |
|---|---|---|---|---|
| N1-1 shapeFor (apps/server/src/codex-event-refresh.ts:69-78) classifies raw latest observations; with period-aware latest rows an account can carry a 7-day Session and a 5-hour Session (same timestamp, unordered) or a stale Session after a Weekly tombstone, giving a wrong or null shape and unassigned/misassigned events | Grok, Codex (both reproduced) | MEDIUM | yes: listLatestQuotaObservations per (provider, window, period) since #55 | fix: classify `collapseQuotaWindows(aliasCodexSevenDaySessions(rows))` in shapeFor; tests: same-timestamp 7-day + 5-hour Session → five-hour-primary; 7-day Session alone → weekly-primary; legacy Session superseded by a Weekly tombstone → null |

`shapeFor` sent each account's latest quota rows to the classifier with no alias and no newest-row collapse. `listLatestQuotaObservations` keeps one row per provider, window, and period, so one Codex account can hold a 7-day Session and a 5-hour Session from the same time. The classifier keeps a single Session row. The new test received `weekly-primary` for that pair. A 7-day Session with no shorter Session was already `weekly-primary`.

A refresh that drops every quota window writes a newer Weekly absence and leaves the old 7-day Session present. The stored rows in the new test were that pair. The scan still returned `weekly-primary`.

`shapeFor` now classifies `collapseQuotaWindows(aliasCodexSevenDaySessions(rows))`. The 7-day Session is read as Weekly and the 5-hour Session stays Session, so the pair is `five-hour-primary`. The newer Weekly absence replaces the older Session, so the shape is null and that account is no longer matched by shape; a recorded plan name that matches only that account still assigns events to it.

The I3 note above says the refresh scan needed no change because it classifies the plugin lines of the account being refreshed. That path is unchanged. This round covers the stored rows used for the other accounts.

| Commit | Change |
|--------|--------|
| `c7fe3e7` | test: a same-time 7-day Session and 5-hour Session must be five-hour-primary; a 7-day Session alone stays weekly-primary |
| `349312b` | fix: alias a stored 7-day Session before classification |
| `e9874ed` | test: a Weekly absence after that Session must clear the shape |
| `c3a00d9` | fix: keep the newest row of each window after the alias |

`README_WEBUI.md`, `README_WEBUI.zh-TW.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md`, and `docs/providers/codex.md` now say a saved 7-day Session counts as Weekly for this choice, and a later reading with no Weekly window clears that shape.

### Checks

Recorded on this branch after `c3a00d9`.

| Command | Result |
|---------|--------|
| `bun run test -- --run` | 69 files, 1322 passed, 0 failed |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | 74 files, 544 tests, 544 passed, 0 failed |
| `bun run build:webui` | passed (web `tsc` + Vite, server bundle) |

`CcusageProvider > default command runner cleans up child processes on timeout` passed in this run. The Antigravity Cloud Code test that reaches a running language server did not fail. Neither was changed. Nothing was pushed.

## Review round 2

Target `0451be5`. Grok Build `grok-4.7` high (REQUEST_CHANGES, documentation only), AGY `gemini-3.8-flash-high` (APPROVE), Codex `gpt-6.1-sol` high via the second Codex home (APPROVE). N1-1 confirmed resolved in code. Grok (MEDIUM) and Codex (LOW) found that the two zh-TW documents and this log said a cleared shape stops event assignment; `assignAccount` still assigns by a uniquely matching recorded plan name (`packages/providers/src/codex-session-events.ts:235-237`). The zh-TW README, the zh-TW user guide and the round-1 paragraph above now say the shape is cleared and plan-name matching can still assign events. Documentation-only change by the orchestrator (Claude Opus 5.5); no code changed after the reviewed head.
