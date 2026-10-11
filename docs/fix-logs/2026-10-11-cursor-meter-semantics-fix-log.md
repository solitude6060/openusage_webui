# Cursor Meter Semantics Fix Log — 2026-10-11

> Branch: `fix/cursor-meter-semantics` (base `origin/main` = `fb72d6d`)
> Plan: `docs/plans/2026-10-11-cursor-meter-semantics.md`
> Evidence read: `openusage_webui-artifacts/2026-10-11-allowance/gap-analysis.md` sections 3 and 4.4 (outside the repo; no account identifiers copied)

| Role | Client / model / effort |
|------|-------------------------|
| Implementer | Grok Build, `grok-4.7`, `xhigh` |
| Review | Round 1 reviewed `1b40aef` (Codex, Grok, AGY). R1-1 through R1-4 are fixed in this log. R1-5 and R1-6 were rejected. Round 2 reviewed `693015f` (Codex and Grok requested changes; AGY approved). R2-1 through R2-4 are fixed in this log. This branch was not pushed. |

## C1 — what the fields measure

Cursor's current period payload carries two readings with different denominators.

| Field | What it measures | Source |
|---|---|---|
| `autoPercentUsed` | Auto / Cursor Models pool percent (Cursor's own models, including Grok and Composer) | Cursor docs, [Usage and limits](https://cursor.com/help/models-and-usage/usage-limits); upstream [cursor.md](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md) labels this pool Cursor Models |
| `apiPercentUsed` | API / Other Models pool percent (third-party models at API price) | Same docs |
| `totalPercentUsed` | Combined pool percent. Cursor staff (Dean Rie, 2026-08-13, forum thread 168210) wrote that this field, `autoPercentUsed`, and `apiPercentUsed` follow an internal metric of their own. Upstream OpenUsage uses this structured percentage for Total Usage when Cursor supplies it. | Staff reply; upstream cursor.md |
| `totalSpend`, `includedSpend`, `limit` | Included dollar amount, in cents. The usage sentence "You've used N% of your included usage" uses `includedSpend / limit`. Spend in the plugin prefers `totalSpend`, otherwise `limit - remaining`. | Same staff reply; plugin comments already described `totalSpend` as included spend plus bonus spend |

`totalPercentUsed` is the Total usage percent Allowance already stores. `limit` is the Stated Cap. They are different denominators, so spend divided by `limit` was not substituted for the percent.

A read-only `GET /api/usage/quotas` on 2026-10-11 returned four different figures for the Cursor account: Total usage `usedPercent` 8.8245 with `usedValue` 273.56 and `limitValue` 400 (included spend is 68.39% of that limit), Auto usage 5.7797, API usage 100. The quotas payload has no per-pool dollar size, so the weights inside `totalPercentUsed` stay uncalculated for this account.

## Decision

Keep individual Total usage on `totalPercentUsed`. Show Included Spend as `$spend of $limit` on the card summary. Allowance still scales tokens and API dollars by the Total usage percent. Stated Cap remains `planUsage.limit`.

The pool-weight formula is undetermined here. Behavior of the percent was kept, and the dollar reading is now labeled.

## Commits

| Commit | Change |
|--------|--------|
| `4512a11` | test: failing plugin and dashboard checks for the pool percent and the Included Spend label |
| `17e5b81` | fix: emit Included Spend, keep it on the card summary, document the two denominators |
| `88a68f6` | test: host-adapter fixture requires the Included Spend line |

## Checks

| Runner | Result |
|--------|--------|
| `bun run test -- --run` | 69 files, 1302 passed, exit 0 |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | First run: 486 passed, 2 failed. One failure was the Cursor host fixture, fixed in `88a68f6`. The other was `CcusageProvider > default command runner cleans up child processes on timeout` (marker file still present after 200ms). Second run after the fixture commit: 488 passed, 0 failed, exit 0. |
| `bun run build:webui` | exit 0 |

The Antigravity Cloud Code fixture that can reach a running language server passed in both bun runs. It was not changed.

The card label was not clicked through in a browser. Playwright was unavailable, and the always-on service on port 6736 runs another checkout. The quotas request was read-only.

## Review round 1

Reviewed commit `1b40aef`. The triage below is the round 1 disposition. R1-5 and R1-6 were not changed.

| Finding | Source | Severity | Verified | Disposition |
|---|---|---|---|---|
| R1-1 Included Spend uses totalSpend (includes bonus); should use includedSpend, else limit - remaining | Grok, Codex | MEDIUM | yes: docs/providers/cursor.md:80-83, plugin.js:995-998 | fix |
| R1-2 Allowance page shows pool-percent extrapolation next to "Stated Cap" without saying denominators differ | AGY, Codex | MEDIUM | yes: allowance-page.tsx:161-168 | fix: label Cursor stated cap as included dollar limit + one-line note; page test |
| R1-3 Forum thread 172012 reconstruction claim not supported by cited post | Codex | LOW | not re-verified; claim unnecessary | fix: delete the sentence (docs + fix log) |
| R1-4 User guide describes a fourth percent not on screen | Grok, AGY | LOW | yes | fix wording |
| R1-5 127.0.0.1:6736 in plan | AGY | LOW | loopback address, not personal | reject |
| R1-6 sibling artifact paths in plan/fix log | AGY | LOW | established convention (25 existing references in docs/) | reject |

Included Spend now uses finite `includedSpend`, otherwise `limit - remaining`. Total usage `usedValue` still prefers `totalSpend`. The C1 row above described the plugin before this round. On the Allowance page, a Cursor stated cap is labeled Included Dollar Limit. The note says the estimate scales the combined pool percent, whose denominator differs from that dollar limit. Other providers still show Stated Cap. The unsupported forum reconstruction sentence was removed from `docs/providers/cursor.md` and from the C1 section above. The user guide describes Included Spend as the on-screen dollar line, and says the included-usage percent is Cursor's website wording.

| Commit | Change |
|--------|--------|
| `b91e10d` | test: Included Spend excludes bonus, and still uses includedSpend when totalSpend is missing |
| `45b442a` | fix: Included Spend numerator; host fixture sends includedSpend; provider doc |
| `db66218` | test: Allowance page names the Cursor cap and keeps Stated Cap for another provider |
| `aac4ff9` | fix: Included Dollar Limit label and the denominator note |
| `e6ae272` | docs: delete the unsupported forum reconstruction sentence |
| `f891bbf` | docs: user guide no longer describes a fourth on-screen percent |

| Runner | Result |
|--------|--------|
| `bun run test -- --run` | 69 files, 1305 passed, exit 0 |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | 487 passed, 1 failed, exit 1. The failure was `CcusageProvider > default command runner cleans up child processes on timeout` (marker file still present after 200ms). A separate run of that test file passed (1 passed, 12 filtered). Not changed. |
| `bun run build:webui` | exit 0 |

The Antigravity Cloud Code test was not the failure in this bun run. It was not changed. The Allowance label was checked by the page test. It was not clicked through in a browser. Playwright was unavailable, and the always-on service runs another checkout.

## Review round 2

Reviewed commit `693015f`. The triage below is the round 2 disposition. All four findings were fixed.

| Finding | Source | Severity | Verified | Disposition |
|---|---|---|---|---|
| R2-1 Allowance label/note check `providerId === "cursor"` misses named accounts `cursor:<slug>` | Grok, AGY(LOW), Codex | MEDIUM | yes: registry.ts:130 uses account.id; quota-observations.ts:42 uses base id | fix: base-id check (`cursor` or `cursor:` prefix) in both places; page test with `cursor:work` |
| R2-2 Note claims a different denominator also for Team (dollar meter) and the spend/limit fallback | Codex | MEDIUM | yes: plugin.js:1003,1027 | fix: scope the note wording to individual accounts that report Cursor's pool percent (e.g. "On individual plans the percent is Cursor's combined pool percent; its denominator differs from this dollar limit."), or show it only when the data identifies that path; test |
| R2-3 Included Spend falls back to `limit - 0` when both includedSpend and remaining are missing | Grok | LOW | yes: plugin.js:1057-1059 | fix: use `limit - remaining` only when remaining is finite; otherwise omit the line; test |
| R2-4 docs/providers/cursor.md:20 still says "Spend divided by limit is Included Spend" | Grok | LOW | yes | fix wording |

A named Cursor account such as `cursor:work` now gets the Included Dollar Limit label and the note. The note says: "On individual plans the percent is Cursor's combined pool percent; its denominator differs from this dollar limit." Team dollar meters and the spend-divided-by-limit fallback are not described as a different denominator. Included Spend uses finite `includedSpend`. When that field is missing and `remaining` is finite, the numerator is `limit - remaining`. When both are missing, the line is omitted. Total usage `usedValue` still prefers `totalSpend`. The Total usage row in the provider doc calls Included Spend the included dollar amount, a separate reading from the pool percent. The user guide states the same individual-plan scope for the note.

R2-4 is a documentation sentence. It has no runtime check, so it landed as a docs commit, as the round 1 doc fixes did.

| Commit | Change |
|--------|--------|
| `93800e8` | test: named Cursor account expects Included Dollar Limit and the note |
| `ff161ad` | fix: label and note use the Cursor base id |
| `51d672f` | test: note must name individual plans |
| `909a8d2` | fix: scope the note; provider doc and user guide match |
| `504f994` | test: omit Included Spend when includedSpend and remaining are both missing |
| `b676d36` | fix: omit that line; provider doc states the finite-remaining rule |
| `9641660` | docs: Total usage row no longer calls spend divided by the limit Included Spend |

| Runner | Result |
|--------|--------|
| `bun run test -- --run` | 69 files, 1308 passed, exit 0 |
| `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src` | 488 passed, 0 failed, 59 files, exit 0 |
| `bun run build:webui` | exit 0 |

`CcusageProvider` child-process timeout and the Antigravity Cloud Code test both passed in this bun run. They were not changed. The Allowance label and note were checked by the page test. They were not clicked through in a browser. Playwright was unavailable, and the always-on service runs another checkout.

## Review round 3

Target `933d265`. Lanes: Grok Build `grok-4.7` high (REQUEST_CHANGES), AGY `gemini-3.8-flash-high` (APPROVE), Codex `gpt-6.1-sol` high via the second Codex home (REQUEST_CHANGES). R2-1, R2-3 and R2-4 confirmed resolved by all lanes.

| Finding | Source | Severity | Disposition |
|---|---|---|---|
| R3-1 The note still said individual plans use the combined pool percent; an individual payload without `totalPercentUsed` falls back to spend divided by the limit (`plugins/cursor/plugin.js:1003`), and Team uses dollars | Grok, Codex | MEDIUM | Fixed in `f1d8f09` (test) and `47c4dda` (fix): the note now says the combined pool percent has a different denominator, and Team plans and plans without that percent use spend divided by the limit. `docs/providers/cursor.md` matches. Applied by the orchestrator (Claude Opus 5.5) as a wording-only change. |

## Review round 4

Target `426acc6`. Grok Build `grok-4.7` high, AGY `gemini-3.8-flash-high`, Codex `gpt-6.1-sol` high (second Codex home): all APPROVE. R3-1 resolved. Grok LOW: `docs/USER_GUIDE_WEBUI.zh-TW.md:225` still carried the round-2 note wording; updated to match the page (documentation only, no code change).
