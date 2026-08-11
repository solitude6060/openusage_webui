# Codex Plugin Fixture Isolation Fix Log

Date: 2026-08-11

Related review: [Codex Plugin Fixture Isolation Review](CODEX_2026-08-11_PLUGIN_FIXTURE_ISOLATION_REVIEW.md)

## Changes

| Finding | Reproduction | Correction | Files |
| --- | --- | --- | --- |
| F001 | Set `OPENUSAGE_ANTIGRAVITY_CLI_HOME` to an external sentinel and run the Antigravity API fixture. The fixture followed the ambient account pin and failed. | Pass an explicit empty environment to the isolated Antigravity fixture. | `packages/providers/test/openusage-plugin-api-fixtures.test.ts` |

The preceding implementation also aligned the configured provider home with plugin-visible `HOME`
and moved GitHub Copilot and bundled authentication fixtures into isolated homes.

## Verification

- Focused provider isolation and fixture tests: 28 passed, 0 failed with the external Antigravity sentinel set.
- Provider tests: 141 passed, 0 failed.
- Complete WebUI suite: 236 passed, 0 failed.
- Production WebUI build: passed.
- Independent Codex GPT-5.6 review: approved after F001 was corrected.
