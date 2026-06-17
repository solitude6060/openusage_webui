# PR #2 Triple Review

PR: https://github.com/solitude6060/openusage_webui/pull/2
Base branch: `dev`
Head branch: `codex/webui-provider-fixture-coverage`
Latest technical head reviewed: `c5bd413`

## Reviewer Lanes

| Reviewer | Command | Output File | Verdict |
| --- | --- | --- | --- |
| agy | `agy --print-timeout 15m --dangerously-skip-permissions -p "$(cat /tmp/pr2_review_prompt.txt)"` | `/tmp/pr2_review_agy.out` | REQUEST CHANGES, fixed in `9b8510f` |
| claude | `claude -p "$(cat /tmp/pr2_review_prompt.txt)"` | `/tmp/pr2_review_claude_rerun.out` | REQUEST CHANGES, fixes staged after `c5bd413` |
| claude-mm | `CLAUDE_CONFIG_DIR=$HOME/.claude-minimax claude -p "$(cat /tmp/pr2_review_prompt.txt)"` | `/tmp/pr2_review_claude_mm.out` | BLOCKED: MiniMax 429 Token Plan usage limit |

## Triage

| Finding | Source | Severity | Verified Evidence | Action |
| --- | --- | ---: | --- | --- |
| `ccusage` query did not consistently use adapter `homeDir` for tilde expansion and HOME. | agy | HIGH | `runPluginCcusageQuery` previously called `ccusageEnvForProvider` without adapter home context. | Fixed: `runPluginCcusageQuery` now receives `homeDir`, and `ccusageEnvForProvider` sets `HOME`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR` relative to it. Regression: `expands plugin ccusage home paths against configured homeDir`. |
| GitHub CLI fallback token lookup spawned `gh` without adapter env/home. | agy | HIGH | `readGitHubToken` previously called `Bun.spawnSync(["gh", "auth", "token"])` without `env`. | Fixed: spawn now uses `{ ...process.env, ...this.env, HOME: this.homeDir }`. Regression: `runs GitHub CLI token lookup with configured homeDir environment`. |
| `gh:github.com` keychain lookup bypassed local keychain store. | agy | MEDIUM | `readGenericPassword("gh:github.com")` previously went directly to env/CLI fallback. | Fixed: local keychain store is checked first, then env/CLI fallback. Regression: `prefers locally saved GitHub keychain token before gh CLI fallback`. |
| `ccusageRunner` injection seam was introduced without direct test coverage. | claude | MEDIUM | The ccusage isolation test used global `Bun.spawnSync` monkeypatching instead of the provider option. | Fixed: the isolation test now passes `ccusageRunner` directly and asserts the expanded `CODEX_HOME`. |
| `gh:github.com` local-vs-env precedence and blank local entries were not pinned. | claude | LOW | Local keychain won over env by implementation, and empty local strings short-circuited fallback. | Fixed: added local-vs-env and blank-local fallback regressions; blank local keychain values now behave as absent. |
| Blank `homeDir` test assumed `process.env.HOME` was set. | claude | LOW | Test expected `join(process.env.HOME ?? "", ".openusage-webui")` while production falls back to `homedir()`. | Fixed: assertion now uses `process.env.HOME?.trim() || homedir()`. |
| Isolated fixture helper leaked temporary home directories. | agy | LOW | `withIsolatedHome` created a temp directory and never removed it. | Fixed: helper removes the temp directory in `finally`. Regression: `cleans up isolated home directories after callback completion`. |
| `writeJson` used `resolve(path, "..")` instead of a parent-directory API. | agy | LOW | Helper used `resolve` to calculate parent directory. | Fixed: helper uses `dirname(path)`. Regression: `writes JSON after creating the target parent directory`. |
| Blank `homeDir` values were accepted. | agy | LOW | Constructor used the configured `homeDir` directly. | Fixed: blank/whitespace values fall back to resolved real home. Regression: `ignores blank configured homeDir values`. |
| `openusage-plugin.ts` is above the ~500 LOC guardrail. | claude | LOW | File is 838 LOC and the overage predates this PR. | Follow-up only; splitting it in this PR would widen a fixture-coverage change. |

## Verification

- `bun test packages/providers/test/openusage-plugin-isolation.test.ts`: failed before the blank-local fix, then passed after the fix.
- `bun run test:webui`: passed, 144 tests.
- `bun run build:webui`: passed.
- `git diff --check`: passed.

## Remaining Limits

- Claude must be rerun on the post-fix commit before merge.
- Claude MiniMax is still blocked by external Token Plan quota, not by a repository failure.
- Live authenticated provider refresh remains untested locally because it requires the user's real provider accounts and installed CLIs/IDEs.
