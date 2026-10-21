# Review: Antigravity Quota Summary, Argon Weekly, Account Scan, Grouped Cards (PR #61)

## Round 1

- Base `f60b8309`, head `ca511375`.
- Card: `../openusage_webui-artifacts/2026-10-21-antigravity-quota/review-card-r1.md`.

| Lane | Client and model | Verdict | Raw output |
|---|---|---|---|
| 1 | Grok Build `grok-4.7`, effort xhigh | REQUEST_CHANGES | `grok-r1-verdict.md` |
| 2 | AGY `gemini-3.8-flash-high`, effort high | REQUEST_CHANGES | `agy-r1-verdict.md` |
| 3 | Codex `gpt-6.1-sol`, effort high | REQUEST_CHANGES | `codex-r1-verdict.md`, `codex-r1.jsonl` |

The orchestrator is Claude Opus 5.5; the three reviewers are xAI, Google and OpenAI.

## Triage

| ID | Finding | Source | Severity | Verified | This PR | Why |
|---|---|---|---|---|---|---|
| R1-1 | Local `RetrieveUserQuotaSummary` is skipped when both per-model LS calls fail (`plugin.js` early `return null`). | All three | MEDIUM (AGY HIGH) | Yes, code path read | Fix | The summary is the primary source. |
| R1-2 | An empty local summary becomes null and the probe falls through. | All three | MEDIUM (AGY, Grok HIGH) | Yes | Fix | A parsed summary is authoritative; Cloud Code already keeps it. |
| R1-3 | `parseCloudCodeModels` and `parseAgyQuotaBuckets` drop the model id, so `MODEL_PLACEHOLDER_M421` pools into Claude. | All three | MEDIUM (AGY HIGH) | Yes, reproduced by test | Fix | The Argon skip did not apply on two paths. |
| R1-4 | Saved card order of per-account ids is lost when accounts become one group card. | All three | MEDIUM | Yes | Fix | Owner's card positions would move. |
| R1-5 | Same-quota note true when only one used window shares its reset time. | All three | LOW to MEDIUM | Yes | Fix, narrower rule | Every window with use must match its reset on every account. Unused windows are not compared, because their reset rolls forward and differs by seconds between accounts; Grok's "every line" rule would never fire on the observed data. |
| R1-6 | Summary 401/403 after a successful `loadCodeAssist` is treated as a dead token: refresh, legacy calls skipped. | Grok | HIGH | Yes | Fix | Token accepted by `loadCodeAssist`; auth failure must come from `loadCodeAssist` or the legacy calls. |
| R1-7 | Account columns follow snapshot recency, so they reorder after a refresh. | Grok | MEDIUM | Yes (`listLatestUsageSnapshots` orders by `started_at DESC`) | Fix | Stable order by account id. |
| R1-8 | Unpinned home: a parsed per-model body with no lines now falls through to the shared keychain. | Grok | LOW | Yes | Fix | Restores the earlier behavior (login error, no keychain). |

## Round 2

- Remediation diff `ca511375..80bb311a`. Card: `review-card-r2.md`.

| Lane | Client and model | Verdict | Raw output |
|---|---|---|---|
| 1 | Grok Build `grok-4.7`, effort xhigh | APPROVE | `grok-r2-verdict.md` |
| 2 | AGY `gemini-3.8-flash-high`, effort high | APPROVE | `agy-r2-verdict.md` |
| 3 | Codex `gpt-6.1-sol`, effort high | APPROVE | `codex-r2-verdict.md`, `codex-r2.jsonl` |

All lanes report R1-1 to R1-8 resolved and no new defects. Codex ran the new regression tests in memory against both revisions: 10 fail before the fixes and pass after; "appends new cards by name" checks existing behavior and passes on both. Grok and Codex both judged the narrower R1-5 rule correct.

This record is a review-record-only commit and keeps the approval bound to `80bb311a`.
