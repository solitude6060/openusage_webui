# Grok Session Review

Date: 2026-10-01
Status: Confirmed defects repaired locally; final independent review approved.

## Target And Contract

Grok session `01a0ede0-2615-7d43-a147-0bd50108164e`, stored under `~/.grok/sessions/`, developed allowance estimates, time ranges, and Codex model cost allocation on top of uncommitted quota-history changes. Base: `7a0ad63885432dde85f1757dd114d9f9177bce27`.

The original requests require comparing subscription allowance across reset cycles using tokens and API value divided by the percent movement over the same measured interval. Keep the separate Allowance page, local calendar month, real Codex session owner, exclusion of shared sibling logs and true five-hour meters. Preserve explicit model costs including zero. Use the authorized standard short-context mapping when model costs are absent.

The prior session explicitly prohibited commits, pushes, and pull requests. This review retains the dirty checkout and makes no commits; this overrides the usual committed-plan branch flow. Preserve unrelated changes. Do not mutate the live database or restart services during diagnosis.

The initial file hashes, original source bytes, and tracked diff are archived in the ignored persistent directory `docs/reviews/2026-10-01-grok-session.local/`. Raw user transcripts and credentials are excluded.

## Review Plan

1. Independently review allowance time boundaries and fee allocation while the root checks server/UI wiring and official pricing.
2. Verify findings against source and failing fixtures before repair.
3. Repair only confirmed defects, with regression tests first.
4. Run the WebUI suite, affected plugin tests, production build, and independent exact-content triple review.
5. Update affected behavior documentation and root management records.

Documents: `docs/USER_GUIDE_WEBUI.zh-TW.md`, `docs/providers/codex.md`, `docs/plans/2026-09-30-allowance-ranges.md`, `docs/plans/2026-09-30-codex-model-rates.md`, this review, matching fix log, `status.md`, `tracker.md`, and `handover.md`.

## Validation Before Repair

`bun test packages/providers/test/allowance-estimate.test.ts packages/providers/test/openai-token-rates.test.ts apps/server/test/quota-history.test.ts`: 23 passed. These passing fixtures do not establish correctness of interval alignment.

## Findings

| Finding | Severity | Risk | In This Repair | Evidence / Decision |
| --- | --- | --- | --- | --- |
| Tokens start after the percent baseline | High | Wrong allowance | Yes | `estimateCycle` uses `segmentFrom` for tokens and earlier baseline for percent. Use observations inside the selected span as common endpoints. |
| Daily aggregates extend past observation/reset | High | Wrong allowance | Yes | `listPositiveTokenRows` drops the tool/coverage; midpoint snapshots consume entire historical days. Preserve daily coverage and withhold conversion when it crosses a measured boundary. |
| Meter falls then recovers | Medium | Wrong allowance | Yes | Endpoint-only delta hides an intermediate fall. Check the full measured sequence. |
| Historical long session contaminates a true short session | Medium | Wrong eligibility | Yes | `effectivePeriod` scans all reset horizons. Derive each reset cycle separately. |
| Positive movement under one percentage point labeled flat | Medium | Misleading status | Yes | Document promises a rough estimate below five points. Distinguish any positive delta from zero. |
| Listed rates applied before identifiable day cost | High | Source costs replaced / unsupported residual | Yes | A single model with day cost 20 becomes 10; two unpriced models assign an unsupported residual. Allocate identifiable source costs before estimates. |
| New ccusage fees duplicate retained CLI fees | High | Double-counted summary | Yes | Legacy token clearing preserves fee while summary adds both sources. Preserve source bytes and apply aggregation precedence. |
| Cursor nonnumeric money becomes zero | Medium | Unknown price becomes known | Yes | `Number("")` after stripping nonnumeric text yields zero. Accept numeric money only. |
| Copilot fixture reads ambient credentials | Medium | Nonisolated test / credential output | Yes | Full suite: 318 passed, 1 failed because actual CLI credentials replaced `state-token`. Existing fixture is the failing regression. Supply isolated home/environment and a fake failed token runner. Failure log is redacted. |
| Observation sampling drops fractional movement/falls | High | New estimator guard lacks evidence | Yes | Independent Sol review traced `recordQuotaFromRefresh` and backfill to a one-point sampling threshold. Preserve every percent change and replay existing snapshots under a new backfill version. |
| Zero recorded API value omitted | Medium | Known zero shown as unavailable | Yes | New regression failed because `estimatedApiCost` required cost greater than zero. Accept known zero; unknown remains null. |

## Final Local Validation

- WebUI suite: 326 passed, zero failed; 748 assertions across 34 files (`webui-tests-final.log`).
- Affected Codex/Cursor/Claude plugin tests: 259 passed (`plugins.log`).
- WebUI TypeScript/Vite build and server Bun build passed (`build-final.log`).
- Boundary regression: six failures before repair, 28 focused tests passed after repair (`allowance-red.log`, `allowance-green.log`).
- Fractional recording/replay regression: three failures before repair; ten focused tests passed after repair (`sampling-red.log`, `sampling-green.log`).
- Cost regression phases and provenance checks: `cost-validation.txt` records failing assertions and final 42 passing focused tests.
- `git diff --check` passed.

All logs above are in `docs/reviews/2026-10-01-grok-session.local/`. Test commands set `TMPDIR` to its verified persistent `test-tmp` directory. Exact review snapshots give test filenames a `.snapshot` suffix to avoid accidental Bun discovery; contents and hashes are retained.

## Operational Limits

A separate GET-only preview opened SQLite with `readonly: true`, used the corrected estimator, and returned all eight range choices. Browser inspection confirmed `Daily Usage Cannot Align`, shared-log exclusion, and fully covered model totals. Most recorded daily aggregates cannot support a same-interval estimate because meter endpoints lie inside those days. Recovering finer timestamps would require a separate ingestion change; this repair does not invent them.

The existing server at port 6736 still runs its earlier backend. No service restart, provider refresh, or live database rewrite was performed. The built frontend includes the new explanation; corrected backend behavior was verified in the isolated read-only preview. Legacy multiple-account costs whose original owner is unrecorded remain ambiguous. Prior one-shot price rewrites cannot recover reported prices from the new provenance tags; the previous backup remains available.

## Independent Review

Final content identity: `089936dc7e7a2ac80a9fb99a0541bdb17f892db16a92c37bfeccf20a32f6a960`; base `7a0ad63885432dde85f1757dd114d9f9177bce27`. The manifest covers 19 relevant files and is stored with raw outputs in the persistent review directory.

- Initial Sol source review found the fractional sampling integration issue. Re-review confirmed it repaired, with no remaining source findings. The code-reviewer role withheld formal approval because its required LSP tool is absent. A fresh GPT-6.1 Sol high verifier context returned APPROVE after checking source plus archived compiler/test evidence (`round2-sol-verifier.md`). Its actual model metadata was not separately exposed by the runtime.
- Initial Grok process exited 143 and Gemini was interrupted without verdicts; neither counted as approval. One bounded retry retained the pinned models/efforts.
- Gemini retry returned APPROVE for the final identity; conversation `856f1f83-6aca-456b-98f6-8c23d5b1dee6`.
- Grok retry returned APPROVE; conversation `01a0f34c-6c31-77f3-9047-d6d5b9f16263`, actual stream model `grok-4.7-build`, requested effort high. Process session 70458 exited zero; final response is archived in `round2-grok.md`. Grok reviewed source and did not independently rerun tests.
- All three approvals bind to the final content identity. The root recomputed all 19 file hashes after the external processes ended and confirmed no changes (`final-verification.txt`). No unresolved findings remain. The review used the recorded Claude-unavailable Sol fallback; Sol shares the originating model family.
- The GET-only preview process exited zero after SIGINT and its agent-created browser tab was closed. The existing service remains unchanged.

## Repair Decisions

- Daily rows retain a UTC day end in the allowance input. Do not apportion a day by elapsed time. If a positive daily row overlaps a measurement endpoint, withhold the allowance/API-value estimate with an explicit alignment reason; retain fully covered token totals. Event rows keep timestamp behavior. This supersedes the previous midnight-assignment rule, whose arithmetic violates the same-interval contract.
- Use the first and last observations within the selected cycle/span. No synthetic boundary percentages, widened month, or inferred reset zero.
- No live database changes are authorized by this diagnosis. Prior price rewrites remain a documented operational limitation; source-based future ingestion is corrected by this repair.
- Version the historical replay marker so databases already marked `quota_backfill_v1=done` recover previously omitted fractional changes on their next normal startup. Existing quota rows are retained; deterministic insertion IDs deduplicate the replay.
