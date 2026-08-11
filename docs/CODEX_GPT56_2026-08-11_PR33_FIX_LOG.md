# Codex GPT-5.6 Pull Request 33 Fix Log

Date: 2026-08-11

Related review: [Codex GPT-5.6 Pull Request 33 Review](CODEX_GPT56_2026-08-11_PR33_REVIEW.md)

## Changes

| Finding | Reproduction | Correction | Files |
| --- | --- | --- | --- |
| F001 | Set an ambient sentinel, construct a provider with `env: {}`, and capture the GitHub CLI runner environment. The sentinel was present before correction. | Build the CLI environment from the provider environment and canonical `HOME`. | `packages/providers/src/providers/openusage-plugin.ts`, `packages/providers/test/openusage-plugin-isolation.test.ts` |
| F002 | Refresh generic Claude usage while the Claude plugin throws. The local Claude total was missing before correction. | Keep recognized generic rows; successful structured refresh continues to clear overlapping token fields in storage. | `packages/providers/src/providers/ccusage.ts`, `packages/providers/test/ccusage-provider.test.ts`, `apps/server/test/api.test.ts` |

The fallback behavior is recorded in
[ADR: Preserve Local ccusage When Provider Refresh Fails](ADR_2026-08-11_CCUSAGE_FALLBACK.md).

## Verification

- Focused provider and API tests: 46 passed, 0 failed.
- Complete WebUI suite: 237 passed, 0 failed.
- Claude, Codex, and Cursor plugin tests: 72 passed, 0 failed.
- Production WebUI build: passed.
- Independent Codex GPT-5.6 re-review: approved.

One timeout cleanup test failed only when the complete suite ran concurrently with the plugin tests
and production build. The same test passed alone, and the complete suite passed when rerun by itself.
