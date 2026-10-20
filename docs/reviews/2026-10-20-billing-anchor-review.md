# Review: Derive The Billing Anchor From A Plan Upgrade

PR #60, base `74a681e6`.

## Round 1

Target `2f970753`. Card and raw verdicts: `../openusage_webui-artifacts/2026-10-20-billing-anchor/`.

| Lane | Client and model | Verdict |
| --- | --- | --- |
| 1 | Grok Build `grok-4.7`, xhigh | REQUEST_CHANGES |
| 2 | AGY `gemini-3.8-flash-high`, high | APPROVE |
| 3 | Codex `gpt-6.1-sol`, high | REQUEST_CHANGES |

The orchestrator is Claude Code (Anthropic); no reviewer shares its family.

## Triage

| ID | Finding | Source | Severity | Verified | Disposition |
| --- | --- | --- | --- | --- | --- |
| R1-1 | A cycle that starts before the history window holds only part of the earlier side's dollars, so a reset grant reads as an upgrade and is saved | Codex, Grok | HIGH | Yes: test with the earlier side's first token hour outside the window returned an upgrade anchor | Fixed in `9bd657b3` (test) and `72fb1fa7` (fix) |
| R1-2 | An upgrade in the open cycle waits until the cycle ends | Codex | MEDIUM | Yes: an upgrade two days into the open cycle returned calendar months | Fixed in `9bd657b3` and `72fb1fa7` |
| R1-3 | A manual billing date stops the detected upgrade from being saved | Grok | LOW | Yes: the server saves only when the source is `upgrade` | Deferred; see the fix log |
| R1-4 | The guide says an unreadable manual date forces calendar months; an upgrade still applies | Grok | LOW | Yes: `buildBilling` treats it as no setting | Fixed in the guide |
