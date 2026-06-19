# ccusage Process Cleanup Review

## Scope

- Base branch: `main`
- Head branch: `codex/webui-ccusage-process-cleanup`
- Reviewed head before follow-up fixes: `53bf607`
- Purpose: prevent timed-out `bunx`/`npx` ccusage refreshes from leaving child processes alive after the API response returns.

## Reviewer Results

| Reviewer | Result | Notes |
|---|---|---|
| `agy` | Approve | No critical, high, or medium findings. Low follow-ups covered non-Linux cleanup and `ps` timeout hardening. |
| `claude` | Approve | No critical, high, or medium findings. Low follow-ups covered PID reuse, Linux-only test clarity, group-kill coverage, and cleanup latency. |
| `claude-mm` | Approve with medium follow-up | Requested a multi-level grandchild cleanup regression test before merge. |

## Triage

| Finding | Source | Severity | Verified Evidence | Action |
|---|---|---:|---|---|
| Cleanup test did not prove multi-level descendant cleanup. | `claude-mm` | Medium | Existing test only covered one detached child. | Fixed by adding `default command runner cleans up grandchildren on timeout`. |
| Descendant BFS used linear membership checks. | `claude-mm` | Medium/Low | `descendants.includes(pid)` was used inside traversal. | Fixed by using `Set<number>` for visited descendants. |
| Linux-only cleanup test could pass misleadingly on non-Linux. | `claude` | Low | Test used `setsid`, while implementation only discovers descendants on Linux. | Fixed by using a Linux-only `linuxTest` wrapper. |
| `ps` cleanup helper has no independent timeout. | `agy` | Low | `listDescendantPids` awaits `ps` output directly. | Deferred; timeout cleanup is already bounded by the provider-level race, and Phase 2 is Linux local-first. |
| PID reuse can theoretically signal an unrelated process. | `claude` | Low | Descendant PIDs are snapshotted before `SIGKILL`. | Deferred; local-only risk is very low, process-group kill remains primary, and follow-up hardening can re-check `/proc` ownership before `SIGKILL`. |

## Verification

- `bun test packages/providers/test/ccusage-provider.test.ts`: passed, 13 tests.
- `bun run test:webui`: passed, 41 tests.
- `bun run build:webui`: passed.
- Local smoke on `http://127.0.0.1:6736`: `POST /api/providers/refresh` returned a provider-level ccusage error with manual/minimax success.
- Post-smoke process check: no `ccusage` process, no `bun` process, and no listener on `127.0.0.1:6736`.

## Merge Gate

The only medium finding was fixed with a regression test. Remaining findings are low-risk follow-ups that do not block this Linux-first local WebUI hotfix.
