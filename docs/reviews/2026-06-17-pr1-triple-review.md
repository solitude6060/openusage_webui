# PR #1 Triple Review Status

Date: 2026-06-17
PR: https://github.com/solitude6060/openusage_webui/pull/1
Branch: `codex/webui-dev-proxy-stability`
Base: `dev` at `3329272`
Head after fixes: `e6d5727`

## Scope

Review the WebUI provider-adapter branch:

- Keep the original Tauri app intact.
- Run the WebUI from `127.0.0.1:6736`.
- Use original bundled OpenUsage `plugins/*/plugin.js` behavior where available.
- Keep Gemini / Google AI Pro ccusage-backed because this repo has no bundled Gemini plugin.
- Improve WebUI scanning and settings layout without changing the app into a landing page.

## Review Lanes

| Reviewer | Result | Blocking Findings |
| --- | --- | --- |
| agy | REQUEST CHANGES | Missing `ctx.host.sqlite.exec`; path-access concerns |
| claude | BLOCKED | CLI returned `Execution error` without a usable review |
| claude-mm | BLOCKED | CLI produced no output before interruption |

This triple-review gate is not complete yet because only one usable reviewer result was obtained.

## agy Findings

### Fixed

- `ctx.host.sqlite.exec` was missing from the WebUI OpenUsage plugin adapter.
- Cursor's original plugin calls `ctx.host.sqlite.exec(...)` when persisting auth state.
- Fix commit: `b572314 Preserve original plugin host behavior in WebUI`.
- Regression coverage:
  - `OpenUsagePluginProvider > supports original plugin sqlite exec writes`
  - `OpenUsagePluginProvider > persists original plugin keychain writes in the local WebUI plugin directory`

### Needs Follow-Up Review

- `host.fs` and `host.sqlite` expose original-plugin filesystem and SQLite access without a WebUI-specific allowlist.
- Current triage: this matches the original OpenUsage plugin host model and is needed by bundled provider plugins that read local credential/config stores.
- Risk boundary: the WebUI registry currently wires bundled repository plugins, not user-installed arbitrary plugin scripts.
- Required before merge: rerun review lanes or explicitly decide whether bundled-plugin trust is acceptable for this WebUI fork, because a strict allowlist may break original provider compatibility.

### Reviewed As Non-Blocking For Current Direction

- `curl --config -` is used for synchronous original plugin HTTP calls.
- Current triage: original plugin probes are synchronous; headers are passed through stdin rather than argv so bearer tokens are not exposed in process arguments.
- Follow-up: replace or isolate only if an async plugin execution model is introduced.

## Verification After Fixes

- `bun test packages/providers/test/openusage-plugin-provider.test.ts`: passed, 9 tests.
- `bun run test:webui`: passed, 102 tests.
- `bun run build:webui`: passed.
- `gh pr view 1`: PR is open and mergeable.

## Merge Recommendation

Do not merge solely on this artifact. The critical Cursor compatibility issue is fixed, but the triple-review process still needs either successful replacement reviewer lanes or an explicit project decision on the bundled-plugin filesystem trust boundary.
