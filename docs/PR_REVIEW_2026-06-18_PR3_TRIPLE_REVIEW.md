# PR3 Triple Review Summary

PR: https://github.com/solitude6060/openusage_webui/pull/3
Base: `dev`
Head: `codex/webui-post-pr2-planning`
Initial reviewed SHA: `ed5ac5c96dd4604742a04a8c6272b9b6c359b6ac`
Current SHA after fixes: `f52c884d548f90ec16d0924f57d3e4f6d2cc70a9`
Claude-MM retry SHA: `c0137a6d20a6c7c9073bc1b9712e9c0ab72cb885`
Claude-MM second retry SHA: `8abccf3fd4ee8dc46c4f2848559cd420361c2541`
Claude-MM recovered rerun SHA: `b029231312208ce507aa9cc2f555a1ec83ac836b`
Replacement reviewer SHA: `b2c9e12cba6710592c18c8003f1c852179ade9e1`
Replacement fix SHA: `69558ee`

## Reviewer Results

| Reviewer | Verdict | Artifact |
| --- | --- | --- |
| AGY | APPROVE | `docs/PR_REVIEW_2026-06-18_PR3_AGY.md` |
| Claude | APPROVE | `docs/PR_REVIEW_2026-06-18_PR3_CLAUDE.md` |
| Claude-MM | REPLACED after repeated quota failures | `docs/PR_REVIEW_2026-06-18_PR3_CLAUDE_MM.md` |
| Claude Sonnet replacement | APPROVE | `docs/PR_REVIEW_2026-06-19_PR3_SONNET_REPLACEMENT.md` |

## Triage

| Finding | Source | Severity | Verified Evidence | Action |
| --- | --- | ---: | --- | --- |
| `parseDateMs` should early-return for nullish input. | AGY | LOW | `packages/providers/src/providers/openusage-plugin-api.ts` converted nullish values through string parsing. | Fixed in `f52c884`; added nullish tests. |
| `parseDateMs` upstream divergence needed explicit documentation. | Claude | MEDIUM | WebUI now applies the timestamp seconds heuristic to `parseDateMs`, unlike upstream `parseDateMs`, to align with `toIso`. | Fixed in `f52c884`; added code comment and plan note. |
| `parseDateMs` tests under-covered timestamp boundaries and invalid inputs. | Claude | LOW | Existing test only covered two epoch-second inputs. | Fixed in `f52c884`; added millisecond passthrough, threshold, invalid, nullish, and `Date` inputs. |
| Bundled fixture auth/config fragments were too generic for some providers. | Claude | LOW | Cursor, Factory, Kimi, and Perplexity used generic `Not logged in` fragments. | Fixed in `f52c884`; changed to provider-specific guidance fragments. |
| Favicon test did not assert the referenced asset exists. | Claude | LOW | `apps/web/src/app-shell.test.ts` only checked `index.html` contents. | Fixed in `f52c884`; added an asset existence assertion. |
| Default `Bun.spawnSync` GitHub CLI path is no longer directly tested. | Claude | LOW | Tests now use the injected `gitHubTokenRunner`. | Skipped. This is the intended tradeoff to avoid process-global monkeypatching; behavior remains covered through the runner seam. |
| Magic string `"via ccusage"` was split across provider metadata, label logic, and tests. | Claude Sonnet replacement | LOW | `apps/web/src/provider-ui.ts` and `apps/web/src/provider-ui.test.ts` repeated the literal. | Fixed in `69558ee`; added `CCUSAGE_NOTE`. |
| `parseDateMs` decimal numeric-string path was untested. | Claude Sonnet replacement | LOW | `packages/providers/src/providers/openusage-plugin-api.ts` accepts decimal numeric strings through the regex path. | Fixed in `69558ee`; added decimal timestamp-string coverage. |

## Verification After Fixes

- `bun test packages/providers/test/openusage-plugin-api.test.ts`: 4 pass.
- `bun test packages/providers/test/openusage-plugin-bundled-fixtures.test.ts`: 17 pass.
- `bun test apps/web/src/app-shell.test.ts`: 1 pass.
- `bun test apps/web/src/provider-ui.test.ts`: 18 pass.
- `bun run test:webui`: 151 pass.
- `bun run build:webui`: passed.
- `git diff --check`: passed.

## Gate Status

Passed pending final merge verification. The AGY and Claude lanes are approved and all accepted findings are fixed. Claude-MM hit repeated 429 quota errors, so the operator explicitly approved replacing that third lane with Claude Sonnet; the replacement lane approved and its LOW findings were fixed.
