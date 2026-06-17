# PR #2 Triple Review

PR: https://github.com/solitude6060/openusage_webui/pull/2
Base branch: `dev`
Head branch: `codex/webui-provider-fixture-coverage`
Head SHA reviewed: `7c85321`

## Reviewer Lanes

| Reviewer | Command | Output File | Verdict |
| --- | --- | --- | --- |
| agy | `agy --print-timeout 15m --dangerously-skip-permissions -p "$(cat /tmp/pr2_review_prompt.txt)"` | `/tmp/pr2_review_agy.out` | REQUEST CHANGES |
| claude | `claude -p "$(cat /tmp/pr2_review_prompt.txt)"` | `/tmp/pr2_review_claude.out` | BLOCKED: session limit reached |
| claude-mm | `CLAUDE_CONFIG_DIR=$HOME/.claude-minimax claude -p "$(cat /tmp/pr2_review_prompt.txt)"` | `/tmp/pr2_review_claude_mm.out` | BLOCKED: MiniMax 429 Token Plan usage limit |

## Triage

| Finding | Source | Severity | Verified Evidence | Action |
| --- | --- | ---: | --- | --- |
| `ccusage` query did not consistently use adapter `homeDir` for tilde expansion and HOME. | agy | HIGH | `runPluginCcusageQuery` previously called `ccusageEnvForProvider` without adapter home context. | Fixed: `runPluginCcusageQuery` now receives `homeDir`, and `ccusageEnvForProvider` sets `HOME`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR` relative to it. Regression: `expands plugin ccusage home paths against configured homeDir`. |
| GitHub CLI fallback token lookup spawned `gh` without adapter env/home. | agy | HIGH | `readGitHubToken` previously called `Bun.spawnSync(["gh", "auth", "token"])` without `env`. | Fixed: spawn now uses `{ ...process.env, ...this.env, HOME: this.homeDir }`. Regression: `runs GitHub CLI token lookup with configured homeDir environment`. |
| `gh:github.com` keychain lookup bypassed local keychain store. | agy | MEDIUM | `readGenericPassword("gh:github.com")` previously went directly to env/CLI fallback. | Fixed: local keychain store is checked first, then env/CLI fallback. Regression: `prefers locally saved GitHub keychain token before gh CLI fallback`. |
| Isolated fixture helper leaked temporary home directories. | agy | LOW | `withIsolatedHome` created a temp directory and never removed it. | Fixed: helper removes the temp directory in `finally`. Regression: `cleans up isolated home directories after callback completion`. |
| `writeJson` used `resolve(path, "..")` instead of a parent-directory API. | agy | LOW | Helper used `resolve` to calculate parent directory. | Fixed: helper uses `dirname(path)`. Regression: `writes JSON after creating the target parent directory`. |
| Blank `homeDir` values were accepted. | agy | LOW | Constructor used the configured `homeDir` directly. | Fixed: blank/whitespace values fall back to resolved real home. Regression: `ignores blank configured homeDir values`. |

## Fix Commit

- `9b8510f` - Keep plugin host credential lookups isolated

## Verification

- `bun test packages/providers/test/openusage-plugin-provider.test.ts --test-name-pattern "homeDir|GitHub CLI token|local GitHub keychain|blank configured homeDir|locally saved GitHub"`: passed, 4 tests.
- `bun test packages/providers/test/openusage-plugin-provider.test.ts packages/providers/test/openusage-plugin-bundled-fixtures.test.ts packages/providers/test/openusage-plugin-local-fixtures.test.ts packages/providers/test/openusage-plugin-api-fixtures.test.ts`: passed, 45 tests.
- `bun run test:webui`: passed, 142 tests.
- `bun run build:webui`: passed.

## Remaining Limits

- Two reviewer lanes were blocked by external account limits, not repository failures:
  - Claude: session limit, resets at 22:00 Asia/Taipei.
  - Claude MiniMax: Token Plan 429 usage limit.
- Live authenticated provider refresh remains untested locally because it requires the user's real provider accounts and installed CLIs/IDEs.
