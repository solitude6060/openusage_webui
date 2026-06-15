# WebUI Phase 2 Review Fixes

## Summary

Phase 2 ccusage refresh had correct API-level behavior, but re-review and smoke testing found subprocess lifecycle risks. The fixes harden command execution, parser edge cases, and refresh latency without expanding Phase 2 scope beyond ccusage integration.

## Fixes

| Area | Change | Tests |
|---|---|---|
| Command timeout | Propagated `commandTimeoutMs` from `CcusageProvider` into the default runner. | `default command runner honors an explicit timeout` |
| Process cleanup | On Linux, run provider commands through `setsid`, discover descendant PIDs, and kill descendants plus the process group on timeout. | `default command runner cleans up child processes on timeout` |
| Pipe draining | Start stdout/stderr reads immediately after spawn instead of waiting for process exit first. | `default command runner drains large stdout while waiting for exit` |
| Duplicate detection | Reuse the runner found by `detect()` for the next `refresh()` call. | `refresh reuses the runner found by detect` |
| Monthly parsing | Parse compact month strings like `202602` as the first day of that month. | `parses compact monthly dates` |
| Noisy JSON output | Extract balanced JSON from output with leading or trailing command noise. | `parses JSON output with trailing command noise` |
| Multiple JSON-like fragments | Select the last complete non-nested JSON payload so package-manager metadata cannot hide the real ccusage output. | `uses the last complete JSON payload after JSON-looking noise` |
| Structured unmapped output | Preserve valid JSON rows that fail normalization as a raw fallback instead of reporting an empty success. | `structured rows that cannot normalize fall back to raw output` |
| Stable ID helper cleanup | Removed dead `totalTokens` and `costUsd` helper inputs from the stable ID hash builder. | Covered by stable ID tests |

## Verification

- `bun test packages/providers/test/ccusage-parser.test.ts packages/providers/test/ccusage-provider.test.ts`: passed, 21 tests.
- `bun run test:webui`: passed, 41 tests.
- `bun run build:webui`: passed.
- Local smoke used `OPENUSAGE_WEBUI_DIR=/tmp/openusage-webui-phase2-smoke` and confirmed provider-level ccusage failure does not break manual/minimax refresh.
- Host process checks after smoke showed no `ccusage`, no `bun`, and no listener on `127.0.0.1:6736`.

## Deferred

- Live successful ccusage JSON import still needs confirmation on a machine with usable ccusage logs.
- Provider attribution for real ccusage aggregate rows remains conservative: unknown rows stay under `ccusage`.
- First-run server startup can wait for seed-time ccusage detection before binding the port; move detection after bind if startup latency becomes visible.
- Non-Linux timeout cleanup kills only the direct subprocess; Phase 2 is Linux-first, but future macOS support should add process-tree cleanup there.
