# Claude Resets, Credits And Allowance Segments — Review Round 1

Reviewed revision: `45d0741c` on `feat/claude-resets-allowance-segments`. The base is `e807b8e3`.
The reviewed diff covers plan Tracks A, B and C (`docs/plans/2026-10-19-claude-resets-and-allowance-segments.md`).
Prompt: `../openusage_webui-wt-review/cards/review.md`. The diff was `cards/diff.patch` in the same review worktree.
Raw verdicts: `../openusage_webui-artifacts/2026-10-19-claude-allowance/review-r1/{grok,agy,codex}-verdict.md`.
Run records: `../openusage_webui-wt-review/ext-worker/20261019-1618*-{grok,agy}/`, `review-r1/codex.jsonl`.

| Lane | Client And Model | Effort | Verdict |
| --- | --- | --- | --- |
| 1 | Grok Build `grok-4.7` | high | REQUEST_CHANGES (5 findings) |
| 2 | AGY `gemini-3.8-flash-high` | high | REQUEST_CHANGES (2 findings) |
| 3 | Codex `gpt-6.1-sol` | high | REQUEST_CHANGES (4 findings) |

The orchestrator is Claude Opus 5.5, so the three reviewer families (xAI, Google, OpenAI) are distinct from it.
No lane overlaps with the orchestrator's family.

| Finding | Source | Severity | Verified Evidence | This PR? | Why |
| --- | --- | --- | --- | --- | --- |
| R1-1: a reading exactly at a month end counts in the earlier month | Codex 3, Gemini 1 | MEDIUM | `allowance-billing.ts:172,176` used `span.to < from` and `span.to <= to`; red test: September 80 instead of 40 | Yes | Half-open month interval. Repaired in `d27a299`. |
| R1-2: month regime split comes from the four-cycle baseline sample | Codex 2 | MEDIUM | `allowance-cycles.ts:323-337`: `regimeAt` came from `sample`; red test: one October part after four newer cycles | Yes | Repaired in `d27a299` (all included cycles). R1-5 widens this to excluded cycles. |
| R1-3: settings PUT stores an unparseable `billingAnchor` | Codex 4, Gemini 2, Grok 5 | MEDIUM | `apps/server/src/index.ts:598-605` stored any string; red test: 200 for `not-a-date` | Yes | Repaired in `d27a299`. Grok 5 adds that a local-time string such as `October 19, 2026` parses in the server's time zone; the repair requires an ISO instant with `Z` or an offset. |
| R1-4: a peak before the month start is counted again in the next month | Grok 1 | MEDIUM | `allowance-billing.ts:176`: a segment that starts before the month and ends in it uses `span.endPercent`, the whole-segment maximum | Yes | Use readings inside the month unless the whole segment lies inside it. |
| R1-5: an excluded cycle hides the regime change | Grok 3 | MEDIUM | `allowance-cycles.ts:323-324` searches only `included` cycles; `meter-fell` excludes a cycle with any further fall under 5 points | Yes | Find the boundary across completed cycles; the baseline still pools only included cycles. |
| R1-6: token hours between two segments are dropped | Grok 2 | MEDIUM | `segmentSpans` (`allowance-cycles.ts:293-301`) ends a segment at its last reading; `bucketPlace` returns `out` for an hour inside the gap | Yes | Make the segments tile the cycle: a segment ends where the next one starts. |
| R1-7: desktop HTTP log keeps grant ids, organization uuids and `event_props` | Codex 1, Grok 4 | MEDIUM (reported HIGH by Codex) | `src-tauri/src/plugin_engine/host_api.rs:398-436` has no `uuid`, `id`, `full_name`, `display_name` or `event_props`; `host_api.rs:921-934` logs a 500-byte preview | No | Desktop (Tauri) path only. The WebUI host does not log response bodies (Grok 4 confirms). `cargo test` cannot build here: `openssl-sys` needs `libssl-dev`, which requires sudo. The same requests exist upstream in `a7953bf`. Recorded as a follow-up; no unverified Rust change ships. |

Repair order: R1-1 to R1-3 first (red tests `698db4f6`, repair `d27a299`), then R1-4, R1-6 and R1-5.
R1-1 to R1-3 were repaired before this record landed, which deviates from the review-doc-first rule.

Fix evidence: [fix log](../fix-logs/2026-10-19-claude-resets-allowance-fix-log.md).

## Round 2

Reviewed revision: `b549aa74`. Repair diff `git diff 45d0741..b549aa7 -- packages apps`.
Prompt: `../openusage_webui-wt-review/cards/review-r2.md`.
Raw verdicts: `../openusage_webui-artifacts/2026-10-19-claude-allowance/review-r2/{grok,agy,codex}-verdict.md`.

| Lane | Client And Model | Effort | Verdict |
| --- | --- | --- | --- |
| 1 | Grok Build `grok-4.7` | high | APPROVE, no findings |
| 2 | AGY `gemini-3.8-flash-high` | high | APPROVE, no findings |
| 3 | Codex `gpt-6.1-sol` | high | APPROVE, no findings |

All three lanes confirm R1-1 to R1-6 and the R1-7 deferral. The code gate passes at `b549aa74`.

## Rounds 3 To 5 (R1-7 Desktop Redaction)

R1-7 was taken back into this PR. `src-tauri` does not build on Linux (`tauri-nspanel` is macOS-only), so the redaction functions and tests run in a standalone crate (`../openusage_webui-artifacts/redaction-harness/extract.sh`).
Raw verdicts: `../openusage_webui-artifacts/2026-10-19-claude-allowance/review-r{3,4,5}/`.

| Round | Revision | Grok | AGY | Codex | Repair |
| --- | --- | --- | --- | --- | --- |
| 3 | `fd2ded2` | APPROVE | APPROVE | REQUEST_CHANGES: escaped quote leaks a name tail; braces in a string stop the `event_props` match (MEDIUM) | `f4aa501` test, `2bdf3bf` fix |
| 4 | `2bdf3bf` | APPROVE (LOW note on nested objects) | stopped at owner request | REQUEST_CHANGES: earlier rules can unbalance quotes before the `event_props` match (MEDIUM) | `4b5f968f` test, `044534a` fix |

| 5 | `044534a` | APPROVE | APPROVE | APPROVE | none |

The round-4 repair (`044534a`: `event_props` removed first, one nested level) passes 25 harness tests.
Round 5 reviewed `git diff 2bdf3bf 044534a -- src-tauri` once; the owner limited desktop-only work to this final round. The code gate passes at `044534a`.
