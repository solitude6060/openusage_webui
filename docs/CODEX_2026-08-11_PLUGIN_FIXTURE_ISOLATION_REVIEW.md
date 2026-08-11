# Codex Plugin Fixture Isolation Review

Date: 2026-08-11

## Scope

- Provider home and environment alignment in commit `8ee5449`.
- Credential-sensitive plugin fixture isolation.
- Multi-account environment compatibility and credential priority.

## Initial Verdict

Request changes.

| Finding | Severity | Evidence | Required change |
| --- | --- | --- | --- |
| F001 | High | The Antigravity API fixture inherited ambient `OPENUSAGE_ANTIGRAVITY_*` variables because it did not pass an explicit environment. | Pass `env: {}` in the isolated fixture. |

The finding was reproduced with an external sentinel path. The Antigravity fixture failed before
the correction because it followed the ambient account pin outside its isolated home.

## Final Verdict

Approve after commit `1203d00`.

The focused isolation and fixture tests passed with the external Antigravity sentinel still set.
See [the fix log](CODEX_2026-08-11_PLUGIN_FIXTURE_ISOLATION_FIX_LOG.md) for the correction and final
verification results.

