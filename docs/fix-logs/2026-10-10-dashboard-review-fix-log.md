# Dashboard Review Fix Log — 2026-10-10

> Branch: `fix/dashboard-review-2026-10-10` (base `main` = `6b0a742`)
> Plan: `docs/plans/2026-10-10-dashboard-review-fixes.md`
> Review: `docs/reviews/2026-10-10-dashboard-page-review.md`
> Artifacts: `../openusage_webui-artifacts/2026-10-10-review/` (sibling of the repository)

## Roles

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, planning, verification | Claude Code, `claude-opus-5-5` |
| Implementer C1–C6, C6b, review fixes | Grok Build, `grok-4.7`, `high` |
| Implementer C7 (Allowance alignment) | Grok Build, `grok-4.7`, `xhigh` |
| Triple-review lane 1 | Grok Build, `grok-4.7`, `high`, `--permission-mode plan` |
| Triple-review lane 2 | AGY, `gemini-3.8-flash-high`, `high` |
| Triple-review lane 3 | Codex, `gpt-6.1-sol`, `high`, `--sandbox read-only` |

Lane 1 shares the implementer's model family (xAI). This is the fixed-route overlap accepted
in the routing registry; the review ran in a separate context with no implementation history.

## Changes

| ID | Finding | Test commit | Fix commit |
|----|---------|-------------|------------|
| C1 | Claude card lacked the Fable weekly limit (`limits[]` `weekly_scoped`) | `e391e6a` | `a4fd10c` |
| C2 | Idle 5-hour window (`resets_at: null`) and overdue resets showed no reset label | `5769e40` | `a130509` |
| C3 | Compact Cursor card showed only Total usage | `97e5d8d` | `437bee2` |
| C4 | Dashboard read the 100 most recent records shared with Sessions filters | `817ad75` | `6aac4d4` |
| C5 | Sessions showed blank values and invalid dates | `eed8d80` | `19d1f3b` |
| C6 | Antigravity default home untracked; repeated badge; IDE home counted as signed in without OAuth key | `71ce897` | `51772b0` |
| C7 | Allowance produced no estimate when cycle edges fell inside day buckets | `dee2313` | `b98fae3` |
| C6b | Default-account notice hidden behind the Codex selector; home derived from the database path | `da5f05e` | `81a244b` |

## Verification Before Review

- Plugin tests (vitest): 182/182 pass.
- Server, storage, providers and WebUI tests (bun:test): 350 tests, 349 pass on the
  first full run. The failure is `ccusage cleans up child processes on timeout`, which uses
  a 10 ms timeout and is not touched by this branch; three reruns had 0 failures.
- `bun run build:webui`: pass.
- QA server on port 6738 against a copy of the database (`db.local/`, mode 700). The live
  database `~/.openusage-webui/` and `openusage-webui.service` were not modified.
- The QA refresh request refreshed all providers even though the request body named a
  subset. Writes went only to the database copy, using the same local credentials as the
  live 20-minute refresh.
- 7-day Allowance on the QA server after C7:

| Provider | Reason | Aligned span (UTC) | Meter | Tokens |
|----------|--------|--------------------|-------|--------|
| `claude-code` | ok | 2026-10-05T16:00 to 2026-10-09T16:00 | 9% → 59% | 1,142,757,543 |
| `codex:codex` | ok | — | 11% → 57% | 39,749,600 |
| `cursor` | ok, coarse | — | 7.33% → 8.81% | — |
| `grok` | ok (unchanged) | — | 0% → 13% | 114,221,590 |

The Grok estimate matches the earlier anchor of 878.63M tokens.

## Triple Review Round 1

Target: `6b0a742..c28d1add563759a61180f73a9e719c1951deb954`.
Prompt and raw outputs: `triple-review-r1/` in the artifacts directory.

| Lane | Verdict | CRITICAL / HIGH | MEDIUM | LOW |
|------|---------|-----------------|--------|-----|
| 1 Grok | REQUEST_CHANGES | 0 / 0 | 1 | 2 |
| 2 AGY | REQUEST_CHANGES | 0 / 0 | 1 | 1 |
| 3 Codex | REQUEST_CHANGES | 0 / 0 | 5 | 0 |

Lane notes:

- Lane 2: AGY printed a warning that `--mode plan` has no effect with
  `--disable-slash-commands`. The review stayed read-only (`--sandbox` was set) and no file
  changed.
- Lane 3, attempt 1: `codex exec` waited on an open standard input and produced 0 bytes in
  78 minutes (stderr: `Reading additional input from stdin...`). It was stopped and rerun
  once with standard input closed (`</dev/null`); attempt 2 completed. Attempt 1 output is
  archived as `lane3-codex.attempt1-*`.

### Triage

| ID | Finding | Source | Severity | Verified evidence | Disposition |
|----|---------|--------|----------|-------------------|-------------|
| R1-1 | `percent: null`, `""` or `false` in `limits[]` becomes 0% | Lanes 1, 3 | MEDIUM | `plugins/claude/plugin.js:862` uses `Number(entry.percent)` then `Number.isFinite` | Fix in this PR |
| R1-2 | Legacy `Sonnet` and new `Sonnet Weekly` both emitted for one quota | Lanes 1, 2, 3 | MEDIUM | Dedupe keys on `seen[label]`; legacy label at `plugin.js:1026` is `Sonnet` | Fix in this PR |
| R1-3 | `Add Default Account` fails when the default account exists but is disabled | Lane 3 | MEDIUM | Notice counts only enabled accounts; `apps/server/src/provider-accounts.ts:117` rejects an existing home path | Fix in this PR: enable the existing account |
| R1-4 | A newer undisplayable snapshot hides an older usable one | Lane 3 | MEDIUM | `sqlite-storage.ts:359` ranks every `OpenUsage Plugin Snapshot`; the Dashboard drops rows without `lines`/`quota` afterwards | Fix in this PR: filter before ranking |
| R1-5 | An older Sessions request can overwrite newer filter results | Lane 3 | MEDIUM | `sessions-page.tsx:63` applies every response unconditionally | Fix in this PR |
| R1-6 | Fix log not yet committed | Lane 1 | LOW | Planned for after review | This file |
| R1-7 | No regression test for a legacy label without the `Weekly` suffix | Lane 2 | LOW | Covered by the R1-2 test | Fix in this PR |

### Repairs

Implementer: Grok Build `grok-4.7` / `high` (task packet `grok-task-r1-fixes.md`).

| ID | Test commit | Fix commit | Files | Test added |
|----|-------------|------------|-------|------------|
| R1-1 | `f724db5` | `4348090` | `plugins/claude/plugin.js` | `percent: null` entry yields no line; numeric sibling kept |
| R1-2, R1-7 | `6b21147` | `ac7be98` | `plugins/claude/plugin.js`, `docs/providers/claude.md` | Legacy `seven_day_sonnet` / `seven_day_omelette` plus `limits[]` yield one line each |
| R1-3 | `9a80640` | `a87d7b8` | `apps/web/src/lib/default-account.ts`, `settings-page.tsx` | `disabledDefaultAccount` helper cases |
| R1-4 | `ad913f4` | `ce1fa71` | `packages/storage/src/sqlite-storage.ts` | Newer snapshot without `lines`/`quota` does not hide an older usable one |
| R1-5 | `d9725cf` | `9c522bc` | `apps/web/src/lib/session-load.ts`, `sessions-page.tsx` | Request-id guard cases |

Checks at `9c522bc`: vitest 713/713 (plugins), bun:test 357/357, `bun run build:webui` pass.
The orchestrator reverted the R1-2 and R1-4 fixes individually and confirmed the new tests
fail on their behavior assertions.

## Triple Review Round 2

Target: `c28d1ad..9c522bcb4bfef02cde7f4220e336d2709376e60b` (diff sha256 `f615b9e6…`).
Raw outputs: `triple-review-r2/`.

| Lane | Verdict | Findings |
|------|---------|----------|
| 1 Grok | APPROVE | None |
| 2 AGY | APPROVE | None |
| 3 Codex | REQUEST_CHANGES | 2 MEDIUM |

| ID | Finding | Severity | Verified evidence | Disposition |
|----|---------|----------|-------------------|-------------|
| R2-1 | R1-3 test covers only the helper; reverting the Settings button branch still passes | MEDIUM | No test rendered `SettingsPage` | Fix: page-level test |
| R2-2 | R1-5 test covers only the helper; reverting the guard in `SessionsPage.load` still passes | MEDIUM | `session-load.test.ts` defines its own `publish()` | Fix: page-level test |

Repairs (Grok Build `grok-4.7` / `high`, packet `grok-task-r2-tests.md`; test-only commits):

| ID | Commit | Files |
|----|--------|-------|
| R2-1 | `00b058c` | `apps/web/src/pages/settings-page.vitest.tsx` |
| R2-2 | `952a4e7` | `apps/web/src/pages/sessions-page.vitest.tsx`, `vite.config.ts` (one include glob `apps/web/src/**/*.vitest.tsx`) |

The `.vitest.tsx` suffix keeps the page tests out of `bun test`, which matches `*.test.*` and
`*.spec.*`; the bun:test file count stayed at 40. Checks at `952a4e7`: vitest 1193/1193
(66 files), bun:test 357/357. Revert check: with the page-level fixes removed, Grok observed
4 failures (1 control case passes); the orchestrator removed the Sessions guard and observed
3 failures.

## Triple Review Round 3

Target: `9c522bc..952a4e785ce63d2e393a5638f3e9e4826d1c79b1` (diff sha256 `28c23c20…`).
Raw outputs: `triple-review-r3/`.

| Lane | Verdict | Findings |
|------|---------|----------|
| 1 Grok | APPROVE | None |
| 2 AGY | APPROVE | None |
| 3 Codex | APPROVE | None |

## Operational Incident

The live service `openusage-webui.service` runs from this checkout and serves
`apps/web/dist`. Running `bun run build:webui` on this branch replaced the served frontend
while the live server process (started 2026-10-01 from `main`) has no
`/api/usage/latest-snapshots` route (HTTP 404). The live Dashboard showed no cards from the
build until the branch is merged and the service restarted. The database was not modified.
Follow-up chosen by the user: after merge, run the live service from a separate worktree.

All three lanes approved round 3. Code gate passed at
`952a4e785ce63d2e393a5638f3e9e4826d1c79b1`; this fix log is a records-only commit on top.
