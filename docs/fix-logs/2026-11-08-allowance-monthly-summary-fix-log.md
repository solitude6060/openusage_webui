# Fix Log: Allowance Monthly Summary And Codex Account Attribution

Plan: `docs/plans/2026-11-08-allowance-monthly-summary.md`. Review and triage:
`docs/reviews/2026-11-08-allowance-monthly-summary-review.md`. Implementer: Claude Opus 5.5 (owner decision
2026-11-08). Each repair is a failing `test:` commit followed by its `fix:` commit unless noted.

| Finding | Severity | Test commit | Fix commit | Files |
|---|---|---|---|---|
| Plan S1 (Codex attribution by session creator) | — | `82bdd9c8` | `1a68b7ae` | `codex-session-events.ts`, new `codex-session-files.ts`, `codex-token-events.ts`, `codex-event-refresh.ts` |
| Plan S2–S4 (summary, no percent above 100, plain reasons) | — | `2f24934b` | `289e2c1e` | `allowance-page.tsx`, new `allowance-summary.tsx`, `allowance-billing.tsx`, `pages.css` |
| Transient `auth.json` / first-line read failures | — | `a66de5bb` | `515543b3` | `codex-session-files.ts`, `codex-session-events.ts`, `codex-event-refresh.ts` |
| Plan follow-ups (projection text, rough estimates) | — | `d0ed27e2` | `688e74b2` | `allowance-page.tsx` |
| Plan S5 (Codex API value split) | — | `db5d6633` | `41c46e1f` | `allowance-tokens.ts` |
| R1-4, R1-5 | LOW | `26792fe6` | `1c9c4923` | `allowance-summary.tsx`, `allowance-page.tsx` |
| R1-1, R1-2 | HIGH, MEDIUM | `f4c3a2b9` | `61e0e270` | `codex-token-events.ts`, `codex-session-events.ts`, `codex-event-refresh.ts` |
| R1-3 | MEDIUM | `fa955f56` | `7ad87ab8` | `allowance-tokens.ts`, `allowance-cycles.ts` |
| R1-6 | LOW | `bd108e2b` | test only (behavior already correct) | `codex-event-cost-days.test.ts` |
| R1-7 | LOW | — | `5f20d901`, `4bb109aa` (docs) | `docs/providers/codex.md`, `README.md` |
| G-R1-1 to G-R1-4 | HIGH, HIGH, LOW, LOW | `effc3440` | `d7daf90e` | `codex-session-events.ts`, `codex-session-files.ts`, ADR |
| R2-5 / G-R2-2 | LOW | `6d1bc9ae` | `0fd0cda8` | `allowance-page.tsx` |
| R2-1, R2-2, R2-4 | MEDIUM, LOW, LOW | `65d9beb2` | `e47a4325` | `codex-event-refresh.ts` |
| G-R2-1 | LOW | `2b7d9f86` | `9177d82e` | `codex-token-events.ts` |
| R2-3, G-R2-3 | LOW | `17b74a5e` | test only | retention and cost tests |
| R3-1 | MEDIUM | `3b1dd4c4` | `af8838ed` | `codex-event-refresh.ts` |
| R3-3 | LOW | `35242cfa` | `bb903977` | `codex-session-events.ts`, `codex-event-refresh.ts` |
| G-R3-1, G-R3-2 | MEDIUM, LOW | `7eae5632` | `a14fea4f` | `codex-session-events.ts`, ADR |
| R4-1, R4-2 | LOW | `73fbae1d` | `997f8159` | `codex-event-refresh.ts`, ADR |
| R4-3 | LOW | `59f2d6e3` | test only | `codex-event-rescan-failure.test.ts` |
| F-1 | HIGH | `3686efc0` | `7adedf5a` | `codex-token-events.ts` |
| F-2 | MEDIUM | `11419742` | `9c45d3df` | `allowance-cycles.ts`, omission test fixtures |
| R5-1 | LOW | — | `b5615c5e` (docs) | ADR, `docs/providers/codex.md` |
| R6-1 (Codex Sol) / R6-2 (Opus) | HIGH / LOW | `31039f54` | `32bcb774` | `codex-token-events.ts` |
| R6-1 (Opus), R6-3 | LOW | — | `d269485d` (docs) | ADR, `docs/providers/codex.md`, user guide |
| R7-1, R7-2 | LOW | — | `451efa0a` (docs) | ADR, user guide |

Deferred: R3-2 (a deleted Codex home rereads all files on each refresh). Cursors under a missing sessions
path are kept so a temporarily unmounted directory is not read as empty; recorded in the ADR.

## Verification at the approved code (`c026a758`)

- `bunx vitest run`: 1373 passed. `bun run test:webui`: 629 pass, 0 fail. `bun run build:webui`: exit 0.
  Logs: `../openusage_webui-artifacts/2026-11-08-allowance/integration/*-r7.log`.
- "CcusageProvider > default command runner cleans up child processes on timeout" failed in some earlier
  runs at load average about 19 and passed at about 5; its source and test files are unchanged from `ec01a33f`.
- Database copy of the live database (`../openusage_webui-artifacts/2026-11-08-allowance/s1/db-copy-check-r9.json`):
  first rescan complete with no unassigned events; per-UTC-day Codex totals equal before and after for
  2026-10-29 to 2026-11-07; the 35,136 events before 2026-10-29 (4,185,077,414 tokens) byte-identical;
  861 earlier `token_hourly` rows unchanged; last 14 days `codex:codex` 127,297,474 and `codex:family`
  101,911,827 tokens.
- S5 (`s1/s5-cost-split-r4.json`): allocated Codex cost equals the ccusage day cost on each local day
  2026-10-29 to 2026-11-08; November billing month `codex:codex` $80.60, `codex:family` $58.08.
- Screenshots (personal usage figures, not attached to the public PR):
  `../openusage_webui-artifacts/2026-11-08-allowance/integration/after-*-summary-integrated.png`,
  `../openusage_webui-artifacts/2026-11-08-allowance/s2/after-*-r2.png`; before:
  `../openusage_webui-artifacts/2026-11-08-allowance/before/before-1440-{7days,subscription-period}.png`.
