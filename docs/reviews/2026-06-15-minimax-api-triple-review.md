# MiniMax API Provider Triple Review

## Context

- Branch: `codex/webui-minimax-api-provider`
- Base: `main`
- Reviewed commit: `bf0b42c3b37a2e9c9c16148d90d6472b5300f90e`
- Review prompt: `/tmp/openusage_minimax_api_review_prompt.txt`

## Reviewer Commands

- AGY: `agy --print-timeout 15m --dangerously-skip-permissions -p "$(cat /tmp/openusage_minimax_api_review_prompt.txt)"`
- Claude: `claude -p "$(cat /tmp/openusage_minimax_api_review_prompt.txt)"`
- Claude MiniMax: `env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL CLAUDE_CODE_SIMPLE=1 CLAUDE_CONFIG_DIR=$HOME/.claude-minimax claude -p "$(cat /tmp/openusage_minimax_api_review_prompt.txt)"`

## Verdicts

- AGY: REQUEST CHANGES
- Claude: REQUEST CHANGES
- Claude MiniMax: APPROVE with follow-ups

## Triage

| Finding | Source | Severity | Verified Evidence | Action |
|---|---|---:|---|---|
| MiniMax Settings UI still exposed manual quota fields that no longer drive API refresh. | AGY, Claude MiniMax | MEDIUM | `apps/web/src/App.tsx` had a `PUT /api/settings/minimax` form for `plan_type`, `monthly_budget_usd`, `remaining_quota`, and `notes`. | Fixed by replacing the form with read-only API tracking details. |
| `MiniMaxManualProvider` became dead code after registry switched to `MiniMaxProvider`. | AGY, Claude MiniMax | LOW/HIGH | `packages/providers/src/registry.ts` returned `MiniMaxProvider`, while `minimax-manual.ts` was still exported and tested. | Fixed by deleting the dead provider export and test assertion. |
| Snapshot IDs were not stable when MiniMax omitted `start_time`. | AGY, Claude | HIGH | `readTimes()` used exact `Date.now()` and `recordFromQuota()` hashed `startedAt`, defeating SQLite upsert dedupe. | Fixed with regression coverage and stable fallback from `end_time` or UTC day. |
| `current_interval_usage_count` is treated as remaining quota despite its name. | Claude | HIGH | Original plugin documents this field as remaining prompts; current test encoded the behavior without a comment. | Accepted. Added precedence test and code comment documenting the original MiniMax API behavior. |
| Global API key could be sent to the CN endpoint during fallback. | Claude | MEDIUM | `CN_API_KEY_ENV_VARS` included `MINIMAX_API_KEY` and `MINIMAX_API_TOKEN`; `endpointAttempts()` tried CN without a CN key. | Fixed by requiring `MINIMAX_CN_API_KEY` for CN endpoint use. |
| README and error text omitted `MINIMAX_API_TOKEN`. | Claude, Claude MiniMax | LOW/HIGH | Provider accepted `MINIMAX_API_TOKEN`; READMEs and missing-key error did not mention it. | Fixed in provider, server test, README, and zh-TW README. |
| `remains_time` fallback was missing versus the original plugin. | Claude MiniMax | MEDIUM | `readTimes()` used only `start_time` and `end_time`. | Fixed with regression coverage for `start_time + remains_time`. |
| Non-zero `base_resp` and 401/403 paths needed tests. | Claude, Claude MiniMax | LOW/MEDIUM | Error branches existed but lacked provider-level tests. | Added `base_resp` status regression. Existing global failure test covers 401/403 mapping and no CN credential fallback. |
| Shared server failure path marks `detected: false` on refresh failures. | Claude | LOW | Existing API handler behavior outside this MiniMax provider change. | Deferred. Not introduced by this branch. |
| Global endpoint contract should be verified against original plugin/live service. | Claude | MEDIUM | Original repo plugin uses the same remains endpoint and bearer header; live API was not called in tests. | Documented. No browser cookies, login, scraping, or API key storage added. |

## Outcome

All accepted CRITICAL/HIGH/MEDIUM findings from the first review pass were fixed or explicitly deferred with scope evidence. A follow-up review must run on the fixed branch before merge.
