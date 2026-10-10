# Hourly Allowance Tokens Fix Log — 2026-10-11

> Branch: `feat/hourly-allowance-tokens` (base `main` = `49b3b38`)
> Decision: `docs/ADR_2026-10-11_HOURLY_ALLOWANCE_TOKENS.md`
> Plan: `docs/plans/2026-10-11-hourly-allowance-tokens.md`
> Artifacts: `../openusage_webui-artifacts/2026-10-11-backlog/hourly-qa/` and `hourly/`

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, ADR, verification, screenshots | Claude Code, `claude-opus-5-5` |
| Investigation and plan | Claude Code subagent, `claude-opus-5-5`, `high` |
| Implementer | Claude Code subagent, `claude-sonnet-5-5`, `xhigh` (user choice) |
| Review lanes | 1 Grok Build `grok-4.7` `high`; 2 AGY `gemini-3.8-flash-high` `high`; 3 Codex `gpt-6.1-sol` `high` |

Commits `360d247`–`da544db` (seven test/feat pairs plus docs), round-1 repairs `5bc5eb0`/`8a8ec11`,
`ed46413`/`4bbd372`, `6cd2d06`.

QA (implementer, database copy, port 6742; one refresh each of claude-code, cursor, grok; writes
only to the copy): no hourly rows in `usage_records`; `token_hourly` claude-code 114 hours, grok 154
hours; hourly sums equal daily sums for Claude 11/11 local days and Grok 27/27 UTC days.

| Provider (7 days) | Before | After |
|-------------------|--------|-------|
| claude-code | 9→59%, 1,142,757,543 tokens, estimate 2,285,515,086 | 0→61%, 1,403,560,579 tokens, estimate 2,300,918,982, `All Models` |
| codex:codex | unchanged | unchanged |
| cursor | unchanged (no hourly rows; see below) | unchanged |
| grok | 0→13%, 114,221,590 tokens, estimate 878,627,615 | 0→29%, 177,133,665 tokens, estimate 610,805,741 |

Cursor was not exercised on real data: its billing-cycle event fetch hit the plugin's 2000-event page
cap, so the existing completeness rule wrote no Cursor token rows (daily or hourly). Pre-existing;
Cursor token rows have not updated since 2026-10-10. Recorded as a follow-up.

Checks: implementer at `6cd2d06` bun:test 402/402, vitest 1196/1196, build pass. Orchestrator rerun at
`da544db`: vitest 1196/1196, bun:test 398/398.

## Review Round 1 (`49b3b38..da544db`)

Grok APPROVE, AGY APPROVE, Codex REQUEST_CHANGES:

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| H1-1 | Daily-sum check compared with the model-row sum, not the day's `totalTokens` | MEDIUM | Fixed `5bc5eb0`/`8a8ec11` |
| H1-2 | Only dates with valid blocks were checked; a completed day without blocks fell back silently | MEDIUM | Fixed `ed46413`/`4bbd372` |
| H1-3 | Docs described mismatch fallback incorrectly | LOW | Fixed `6cd2d06` |
| H1-4 | `ccusage-hourly-blocks.test.ts` fails on main through a missing export, not an assertion | LOW | Accepted: new API; other red tests fail on assertions |

## Review Round 2 (`da544db..6cd2d06`)

All three lanes APPROVE with no findings.

Follow-up (orchestrator observation): the Allowance explanation still says daily totals cannot be split
inside a day; accurate for Codex, outdated for providers with hourly rows.
