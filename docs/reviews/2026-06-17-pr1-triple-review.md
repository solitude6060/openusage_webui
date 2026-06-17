# PR #1 Triple Review Status

Date: 2026-06-17
PR: https://github.com/solitude6060/openusage_webui/pull/1
Branch: `codex/webui-dev-proxy-stability`
Base: `dev` at `3329272`
Head reviewed: `c4fdc08`

## Scope

Review the WebUI provider-adapter branch:

- Keep the original Tauri app intact.
- Run the WebUI from `127.0.0.1:6736`.
- Use original bundled OpenUsage `plugins/*/plugin.js` behavior where available.
- Keep Gemini / Google AI Pro ccusage-backed because this repo has no bundled Gemini plugin.
- Improve WebUI scanning and settings layout without changing the app into a landing page.

## Review Lanes

| Reviewer | Output File | Result | Blocking Findings |
| --- | --- | --- | --- |
| agy | `/tmp/pr1_review_agy_rerun.out` | REQUEST CHANGES | curl body truncation |
| claude | `/tmp/pr1_review_claude_rerun.out` | REQUEST CHANGES | detection semantics, missing per-plugin e2e coverage, Antigravity LS caveat, curl dependency docs, bundled-plugin trust boundary |
| claude-mm | `/tmp/pr1_review_claude_mm_rerun.out` | REQUEST CHANGES | filesystem trust boundary, Settings desktop layout, parser edge cases, keychain type validation |

The triple-review lane execution is now complete, but the merge gate is still not green because all three reviewers returned `REQUEST CHANGES`.

## Triage

| Finding | Source | Severity | Verified Evidence | Action |
| --- | --- | ---: | --- | --- |
| Missing `ctx.host.sqlite.exec` breaks Cursor auth persistence | agy initial review | CRITICAL | `plugins/cursor/plugin.js` calls `ctx.host.sqlite.exec`; adapter had only `query` before `b572314` | Fixed in `b572314`; covered by `supports original plugin sqlite exec writes` |
| curl parser truncates bodies containing blank lines | agy, claude low | HIGH | `parseCurlIncludeOutput` split on every blank line and returned only the last segment | Fixed with regression test `preserves plugin HTTP response bodies that contain blank lines` |
| Registry should enforce bundled-plugin path boundary | claude, claude-mm | HIGH/MEDIUM | WebUI registry should only load repo-bundled plugin scripts while host shims preserve original plugin filesystem behavior | Partially fixed: `resolveBundledPluginScriptPath` rejects traversal ids and resolves under repo `plugins/` |
| `host.fs` / `host.sqlite` remain broad inside bundled plugin host | agy, claude, claude-mm | HIGH/MEDIUM | Adapter still intentionally exposes original plugin host file/SQLite primitives to bundled plugins | Not fully closed; requires explicit bundled-plugin trust decision or a provider-specific allowlist |
| `curl` runtime dependency undocumented | claude | MEDIUM | Original plugin HTTP shim uses `curl --config -` | Fixed in `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, and `docs/USER_GUIDE_WEBUI.zh-TW.md` |
| Antigravity LS discovery stub disables local LS path | claude | MEDIUM | `plugins/antigravity/plugin.js` calls `ctx.host.ls.discover` | Improved: added `/proc` command-line LS discovery and exported parser test |
| Antigravity localhost HTTPS ignores `dangerouslyIgnoreTls` | claude | MEDIUM | Antigravity passes `dangerouslyIgnoreTls` for loopback HTTPS | Fixed: curl config emits `insecure` only for loopback URLs |
| Settings desktop layout collapsed to one column | claude-mm | MEDIUM | `.settings-grid` was single-column on desktop | Fixed: restored two columns on desktop, kept mobile single-column; screenshot updated |
| Keychain write silently stringifies non-string passwords | claude-mm | MEDIUM | `String(password)` stored `[object Object]` before validation | Fixed with runtime type check and regression test |
| `detect()` means "bundled plugin loads", not "user credentials/tool detected" | claude | MEDIUM | `OpenUsagePluginProvider.detect()` checks plugin export only | Open; UI/semantics need follow-up |
| 13 bundled plugins lack real fixture-backed refresh tests | claude | MEDIUM | Only Claude/Codex/Copilot are run end-to-end against real plugin files | Open; needs fixture-backed tests per plugin |

## Verification After Fixes

- `bun test packages/providers/test/openusage-plugin-provider.test.ts`: passed, 15 tests.
- `bun test packages/providers/test/registry.test.ts`: passed, 17 tests.
- `bun run test:webui`: passed, 109 tests.
- `bun run build:webui`: passed.
- Headless Chrome screenshot refreshed: `docs/reviews/screenshots/webui-ui-audit-settings-after.png`.

## Merge Recommendation

Do not merge yet. The branch is buildable and much closer, but the merge gate still has two explicit unresolved items:

- Decide and document whether `Detected` should mean bundled plugin availability or actual local credential/tool availability.
- Add fixture-backed refresh coverage for the remaining bundled plugin providers, or explicitly narrow the PR's support claim.
