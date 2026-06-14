# WebUI Phase 2 ccusage Plan

## Scope

Implement the ccusage provider integration for the local WebUI without adding scraping, cookies, telemetry, or external provider API calls.

## Research Inputs

- User WebUI fork spec, Phase 2.
- `npm view ccusage`: current package `20.0.11`, binary `ccusage`, repository `ccusage/ccusage`.
- Existing repo docs in `docs/plugins/api.md`, which document provider-focused ccusage usage and commonly observed JSON fields.
- Existing fork implementation in `src-tauri/src/plugin_engine/host_api.rs`:
  - Runner fallback logic and `daily --json --order desc` command shape.
  - Output normalization accepts leading package-manager noise and extracts the last valid JSON object/array.
  - Array output is normalized as daily records.
  - `{ daily: [...] }` output is the canonical host API shape.
- Existing Claude/Codex plugin tests and implementations:
  - Claude rows commonly use `totalCost`, `cacheCreationTokens`, `cacheReadTokens`, and `modelBreakdowns`.
  - Codex rows commonly use `costUSD`, `cachedInputTokens`, and `models`.
  - Compact dates (`YYYYMMDD`), ISO dates, and ISO timestamps are already supported by the original plugin code.
- GitHub raw README fetch was attempted but blocked by sandbox DNS and not approved for escalation.

## Requirements

- Detect whether ccusage can run.
- Preferred detection order:
  - `bunx ccusage --help`
  - `npx ccusage --help`
- Refresh using JSON output if available.
- Try:
  - `ccusage daily --json`
  - `ccusage session --json`
  - `ccusage monthly --json`
- Prefer exact spec commands for this WebUI MVP (`bunx ccusage ...`, then `npx ccusage ...`), while keeping parsing compatible with the original fork's provider-focused output shapes.
- Normalize structured rows into `UsageRecord[]`.
- Store raw command output in each record's `raw` field.
- If structured JSON is unavailable but stdout exists, store a raw fallback record with source `cli`.
- Use stable hash IDs for imported ccusage records.
- Map known tools/sources:
  - Claude Code -> `claude-code`
  - Codex -> `codex`
  - GitHub Copilot -> `github-copilot`
  - Gemini -> `gemini-cli`
  - Unknown aggregate -> `ccusage`
- Do not install anything directly from app code beyond invoking the configured runner command.
- Provider-level refresh errors must not fail the whole refresh-all API.

## TDD Plan

1. Add parser tests for:
   - Daily rows with Claude-style fields.
   - Codex-style `costUSD` fields.
   - Nested `{ daily: [...] }` and array JSON shapes.
   - Raw fallback when JSON cannot be parsed.
   - Stable IDs for repeated imports.
2. Add provider tests with an injected command runner for:
   - `detect()` tries `bunx` before `npx`.
   - `refresh()` returns normalized records from the first JSON command.
   - `refresh()` returns raw fallback when stdout is non-JSON.
   - `refresh()` throws a provider-level error when no runner works.
3. Implement the smallest provider/parser code to pass tests.
4. Run:
   - `bun run test:webui`
   - `bun run build:webui`

## Files Expected To Change

- `packages/providers/src/providers/ccusage.ts`
- `packages/providers/src/providers/ccusage-parser.ts`
- `packages/providers/test/ccusage-provider.test.ts`
- `packages/providers/test/ccusage-parser.test.ts`
- `README_WEBUI.md`
- `README_WEBUI.zh-TW.md`
- `docs/plans/2026-06-14-webui-phase-2-ccusage.md`

## Deferred

- MiniMax proxy/API tracking.
- Browser cookie/session scraping.
- Provider-specific UI beyond showing ccusage refresh status.
- SQL aggregate optimization.
- CSRF hardening and other low-risk items from Phase 1 re-review.
