# Backlog Integration Fix Log — 2026-10-11

> Branch: `integration/2026-10-11-backlog` (base `main` = `49b3b38`)
> Integrated pull requests: #47 Grok spend, #50 hourly allowance tokens, #48 OpenRouter, #49 Ollama,
> #51 Pi scanner. Each was reviewed and approved on its own branch (see its fix log).
> Report: `../openusage_webui-artifacts/2026-10-11-backlog/integration/INTEGRATION_REPORT.md`

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, verification | Claude Code, `claude-opus-5-5` |
| Integrator (conflict resolution) | Codex, `gpt-6.1-sol`, `xhigh` |
| Review lanes | 1 Grok Build `grok-4.7` `high`; 2 AGY `gemini-3.8-flash-high` `high`; 3 Codex `gpt-6.1-sol` `high` |

The branches overlapped in `openusage-plugin.ts`, `grok-session-usage.ts`, `structured-usage.ts`,
`sqlite-storage.ts`, `registry.ts`, `provider-accounts.ts`, core and UI types, and README files. They
were merged with `--no-ff` in order; no branch commit was rewritten, so every source head is an
ancestor of this branch.

| Step | Source | Merge commit | Conflicts |
|------|--------|--------------|-----------|
| 0 | `fix/grok-spend-from-sessions` | `ac8239d` | none |
| 1 | `feat/hourly-allowance-tokens` | `10dd42f` | `docs/providers/grok.md`, `grok-session-usage.ts`, `openusage-plugin.ts` — one session scan now feeds spend tiles, daily rows and hourly rows; new `grok-refresh-integration.test.ts` proves a single transcript read |
| 2 | `feat/port-openrouter` | `30bc27c` | none |
| 3 | `feat/port-ollama` | `32f7793` | `docs/USER_GUIDE_WEBUI.zh-TW.md`, plan file — both providers' text kept |
| 4 | `feat/port-pi` | `7d1ff99` | see `INTEGRATION_REPORT.md`; Pi owner cleanup coexists with hourly rows and Ollama default-disabled |

Checks: per-step suites in the report; final bun:test 487/487 (59 files), vitest 1301/1301 (69 files),
`bun run build:webui` pass. Orchestrator rerun: bun:test 487/487; vitest 1300/1301 then 1301/1301 twice
(intermittent `sessions-page.vitest.tsx` card test, seen on three branches; follow-up).

Triple review of the resolutions (`git show --cc` of the four merges plus `0661641`): all three lanes
APPROVE with no findings.
