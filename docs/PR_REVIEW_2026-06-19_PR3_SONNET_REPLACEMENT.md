# PR3 Claude Sonnet Replacement Review

PR: https://github.com/solitude6060/openusage_webui/pull/3
Base: `dev`
Head: `codex/webui-post-pr2-planning`
Reviewed SHA: `b2c9e12cba6710592c18c8003f1c852179ade9e1`
Fix SHA: `69558ee`
Reviewer command: `timeout 15m claude --model sonnet -p "$(cat /tmp/pr3_review_prompt_sonnet_replacement.txt)"`
Output file: `/tmp/pr3_review_sonnet_replacement.out`

## Replacement Approval

Claude-MM repeatedly failed with `429 Token Plan usage limit reached` before producing a review. The operator explicitly approved replacing that third lane with Claude Sonnet 4.6. The local Claude CLI rejected `--model sonnet-4.6` and `--model sonnet4.6`, but accepted the `--model sonnet` alias.

## Verdict

APPROVE

## Findings

| Finding | Severity | Triage | Fix Status |
| --- | ---: | --- | --- |
| Magic string `"via ccusage"` was split across provider metadata, label logic, and tests. | LOW | Accepted. A shared constant is clearer and keeps future ccusage-backed labels tied to one value. | Fixed in `69558ee` with `CCUSAGE_NOTE`. |
| `parseDateMs` decimal numeric-string path was untested. | LOW | Accepted. The existing behavior is coherent and should be documented by a test. | Fixed in `69558ee` with `parseDateMs("1781683200.5")` coverage. |

## Verification After Fixes

- `bun test apps/web/src/provider-ui.test.ts`: 18 pass.
- `bun test packages/providers/test/openusage-plugin-api.test.ts`: 4 pass.
- `bun run test:webui`: 151 pass.
- `bun run build:webui`: passed.
- `git diff --check`: passed.
