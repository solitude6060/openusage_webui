# Pi Session Scanner Fix Log — 2026-10-11

> Branch: `feat/port-pi` (base `main` = `49b3b38`)
> Plan and source record: `docs/plans/2026-10-11-swift-providers.md` (Pi section)
> Upstream: robinebers/openusage `bb7de176def23a99bbdcaabe1ac7269f18c738be` (MIT)
> Artifacts: `../openusage_webui-artifacts/2026-10-11-backlog/pi/`

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, verification | Claude Code, `claude-opus-5-5` |
| Investigation and plan | Claude Code subagent, `claude-opus-5-5`, `high` |
| Implementer | Codex, `gpt-6.1-sol`, `xhigh` (user choice) — three sessions (port, round-1 repairs, round-2 repair) |
| Review lanes | 1 Grok Build `grok-4.7` `high`; 2 AGY `gemini-3.8-flash-high` `high`; 3 Codex `gpt-6.1-sol` `high` (shares the implementer family; fresh read-only sessions) |

"Pi" upstream is the pi coding agent CLI; upstream adds its session usage to the Claude and Codex
cards, with no Pi card. This port records it as tool `Pi Session` (own replace scope, never touching
`ccusage` rows). Rows for other pi providers (for example `xai`) are dropped, as upstream.

Real local scan (implementer, counts only): 2 daily records 2026-09-13 to 2026-09-15, 40,168,984
tokens, all attributed to the `~/.codex` account; 285 files scanned in about 1.0–1.1 s.

## Review Round 1 (`49b3b38..8f5fdbf`)

Grok REQUEST_CHANGES, AGY APPROVE, Codex REQUEST_CHANGES.

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| PR1-1 | Pi rows stayed under the previous owner after attribution changed (double counting) | HIGH (lanes 1, 3) | Fixed `7d4bb27`/`d716b20` |
| PR1-2 | Attribution fixed at provider construction; login changes ignored until restart | MEDIUM (lanes 1, 3) | Fixed `89b0572`/`76655ca` |
| PR1-3 | One unreadable file aborted the whole scan | MEDIUM (lane 1) | Fixed `2bb77b6`/`d650eb6` |
| PR1-4 | A Claude API test scanned the real `~/.pi` | MEDIUM (lane 1) | Fixed `be5d38d`/`5b2b167` |
| PR1-5 | Files older than the cutoff took part in message-id dedup | LOW (lane 1) | Fixed `234e33e`/`bd134e3` |
| PR1-6 | Summary shows an unknown Pi cost as $0 | LOW (lane 1) | Deferred: shared existing path for all tools with null `cost_usd` |

## Review Round 2 (`8f5fdbf..bd134e3`)

Grok APPROVE, AGY APPROVE, Codex REQUEST_CHANGES:

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| PR2-1 | Switching from a matching owner to no matching owner left the old owner's Pi rows | MEDIUM | Fixed `8805fa4`/`5918a34` (explicit no-owner result clears the family's Pi rows for scanned days in one transaction) |

## Review Round 3 (`bd134e3..5918a34`)

All three lanes APPROVE with no findings.

Checks (orchestrator rerun at `5918a34`): vitest 1196/1196, bun:test 430/430.
No visual change (usage is added to existing Claude/Codex numbers), so no screenshots.
