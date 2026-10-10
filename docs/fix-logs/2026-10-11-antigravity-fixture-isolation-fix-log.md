# Antigravity Fixture Isolation Fix Log — 2026-10-11

> Branch: `fix/antigravity-fixture-isolation` (base `main` = `d8479dc`)
> Plan: `docs/plans/2026-10-11-antigravity-fixture-isolation.md`
> Artifacts: `../openusage_webui-artifacts/2026-10-11-followups/agfixture/`

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, verification | Claude Code, `claude-opus-5-5` |
| Implementer | Claude Code subagent, `claude-sonnet-5-5`, `xhigh` (user choice) |
| Review lanes | 1 Grok Build `grok-4.7` `high`; 2 AGY `gemini-3.8-flash-high` `high`; 3 Codex `gpt-6.1-sol` `high` |

Problem: `adapts the original Antigravity plugin through Cloud Code quota` failed whenever a real
Antigravity language server ran locally (observed with the developer's Antigravity and with an
`agy` review process), because `ctx.host.ls.discover` found the real process.

| Commit | Change |
|--------|--------|
| `b6f038c` test | The fixture runs beside a spawned stand-in process whose argv matches the plugin's discovery and passes `lsDiscover: () => null`; a second test requires an injected `lsDiscover` to keep the provider in-thread. On `d8479dc`: `Unexpected request: POST http://127.0.0.1:54321/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs`, and `expect(calls).toEqual(["openusage-nonexistent-ls"])` received `[]`. |
| `cdfaed1` fix | Optional `lsDiscover` on `OpenUsagePluginProvider` (default: real discovery), included in the `useDefaultRuntime` check. |

Checks: the two touched test files 7/7 (orchestrator rerun), bun:test 374/374, vitest 1196/1196.

Triple review round 1 (`d8479dc..cdfaed14c7251b8dd5513959155c26e9e64b9baf`): all three lanes
APPROVE with no findings.
