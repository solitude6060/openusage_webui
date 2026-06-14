# Phase 2 Triple Review

## Scope

- Base branch: `main`
- Head branch: `codex/webui-phase2-ccusage`
- Reviewed head before fixes: `d00b80e8f46892a2b0b351c46c86bc2c79adc8a5`
- Purpose: Phase 2 ccusage detection, refresh, JSON normalization, raw fallback, and provider-level error isolation.

## Reviewer Results

| Reviewer | Result | Notes |
|---|---|---|
| `agy` | Request changes | Found command execution deadlock risk, timeout propagation gaps, compact monthly date omission, and trailing-noise parser fragility. |
| `claude` | Approve with follow-ups | Verified previous fixes, then flagged duplicate runner probes, parser efficiency, real ccusage shape uncertainty, dead ID parameters, and timeout propagation. |
| `claude-mm` | Blocked | Review command returned API 429: token plan usage limit reached. No code findings were available from this lane. |

## Triage

| Finding | Source | Severity | Verified Evidence | Action |
|---|---|---:|---|---|
| Subprocess output pipes can block while waiting for process exit. | `agy` | High | `runCcusageCommand` waited for `proc.exited` before reading streams. | Fixed by starting stdout/stderr reads immediately. Covered by large stdout test. |
| Timeout option does not reach default runner. | `agy`, `claude` | Medium | `runWithTimeout` used configured timeout, but `runCcusageCommand` used the constant timeout. | Fixed by passing `timeoutMs` into the runner and default subprocess timeout. |
| Timeout can leave wrapper-spawned child processes alive. | Smoke test | High | API returned while host `ps` showed `ccusage daily/session/monthly --json` child processes still running. | Fixed by launching commands through Linux `setsid` and killing the process group on timeout. Covered by child cleanup test. |
| `detect()` then `refresh()` repeats runner probes. | `claude` | Medium | Server refresh calls `detect()` before `refresh()`, and provider `refresh()` called `findRunner()` again. | Fixed by consuming the runner discovered by `detect()` for the next refresh. |
| Compact monthly dates like `YYYYMM` parse incorrectly. | `agy` | Medium | `Date.parse("202602")` produced an unintended extended year instead of February 2026. | Fixed with explicit compact-month parsing. |
| JSON extraction fails when valid JSON is followed by command noise. | `agy` | Low | Parser only tried whole suffixes from bracket positions. | Fixed with balanced JSON extraction. |
| Valid JSON rows that do not normalize are silently dropped. | `claude` | Medium | `parseCcusageRecords` returned `parsed=true` with zero records, causing refresh to return empty success. | Fixed by tracking parsed row count and falling back to a raw record when structured rows cannot normalize. |
| JSON extraction can select JSON-looking package-manager metadata before the real payload. | `claude-mm` | Medium | A leading JSON-looking banner such as `{}` could be selected before the real ccusage payload. | Fixed by selecting the last complete non-nested JSON payload. |
| Stable ID helper still accepted unused total/cost fields. | `claude` | Low | Totals/cost were intentionally excluded from the hash but still present in the helper input type. | Fixed by removing dead parameters. |
| Real ccusage row shape is unconfirmed. | `claude` | Medium follow-up | Live successful ccusage JSON import was not available in this environment. | Deferred to Phase 2 live-fixture follow-up; generic `ccusage` attribution remains safe fallback. |

## Verification

- `bun test packages/providers/test/ccusage-provider.test.ts`: passed, 11 tests.
- `bun test packages/providers/test/ccusage-parser.test.ts packages/providers/test/ccusage-provider.test.ts`: passed, 21 tests.
- `bun run test:webui`: passed, 34 tests.
- `bun run build:webui`: passed.
- Local smoke on `http://127.0.0.1:6736`: `GET /api/health` returned ok; `POST /api/providers/refresh` returned provider-level ccusage error with manual/minimax success.
- Post-smoke process check: no `ccusage` process, no `bun` process, and no listener on `127.0.0.1:6736`.

## Merge Gate

Final merge-gate review approved the branch with no critical or high findings. Track first-run seed-time ccusage detection latency and non-Linux process-tree cleanup as follow-ups; both are non-blocking for the Linux-first Phase 2 scope.
