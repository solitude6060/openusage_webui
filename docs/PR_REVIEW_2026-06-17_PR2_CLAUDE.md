# PR #2 Claude Review

PR: https://github.com/solitude6060/openusage_webui/pull/2
Base: `dev`
Head: `codex/webui-provider-fixture-coverage`
Reviewed head: `c5bd41342570d8c7c447377b5b40c9feebe4dda1`
Reviewer command:

```bash
claude -p "$(cat /tmp/pr2_review_prompt.txt)" > /tmp/pr2_review_claude_rerun.out 2>&1
```

Verdict: REQUEST CHANGES

## Findings

| Finding | Severity | Action |
| --- | ---: | --- |
| `ccusageRunner` injection seam existed without direct caller or test coverage. | MEDIUM | Fixed by routing the ccusage isolation test through `ccusageRunner` instead of monkeypatching global `Bun.spawnSync`. |
| `gh:github.com` local keychain precedence was only covered for the happy path, and blank local entries blocked env/CLI fallback. | LOW | Fixed by adding local-vs-env and blank-local fallback regression tests; blank stored local values now behave as absent. |
| Blank `homeDir` isolation test assumed `process.env.HOME` was set. | LOW | Fixed by asserting against the same `process.env.HOME || homedir()` fallback shape used by the provider. |
| `openusage-plugin.ts` exceeds the repo's ~500 LOC guardrail. | LOW | Recorded as a follow-up because the overage predates this PR and a refactor would widen the fixture-coverage change. |
| Earlier review docs recorded blocked reviewer lanes and stale reviewed-head labels. | LOW | This artifact records the valid Claude rerun against `c5bd413`. |

## Verification

- `bun test packages/providers/test/openusage-plugin-isolation.test.ts`: failed before the fix on blank local GitHub keychain fallback, then passed after the fix.
- `bun run test:webui`: passed, 144 tests.
- `bun run build:webui`: passed.
- `git diff --check`: passed.

## Remaining Limits

- This Claude lane produced a valid REQUEST CHANGES review and the findings above were addressed locally.
- Claude should be rerun on the post-fix commit before merging.
- Claude MiniMax remains a separate reviewer lane and is still blocked until its Token Plan quota is available.
