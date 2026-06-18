# PR #2 AGY Review

PR: https://github.com/solitude6060/openusage_webui/pull/2
Base: `dev`
Head: `codex/webui-provider-fixture-coverage`
Reviewed head: `7c85321c57e37b368556a2db892b924c056e0d76`
Reviewer command:

```bash
agy --print-timeout 15m --dangerously-skip-permissions -p "$(cat /tmp/pr2_review_prompt.txt)" > /tmp/pr2_review_agy.out 2>&1
```

Verdict: REQUEST CHANGES

## Findings And Triage

| Finding | Severity | Evidence | Triage | Fix |
| --- | ---: | --- | --- | --- |
| `ccusage` did not receive provider `homeDir` for tilde expansion. | HIGH | `packages/providers/src/providers/openusage-plugin.ts:462` now accepts `homeDir`; `packages/providers/src/providers/openusage-plugin.ts:475` threads it into the ccusage env. | Accepted. The prior code could resolve `~/...` against the real host home. | Fixed in `9b8510f`; regression at `packages/providers/test/openusage-plugin-isolation.test.ts:8`. |
| GitHub CLI token lookup did not run with configured host env/home. | HIGH | `packages/providers/src/providers/openusage-plugin.ts:288` now passes `env: { ...process.env, ...this.env, HOME: this.homeDir }`. | Accepted. The prior spawn could read global `gh` config instead of the adapter home. | Fixed in `9b8510f`; regression at `packages/providers/test/openusage-plugin-isolation.test.ts:45`. |
| Local `gh:github.com` keychain shim was bypassed by the special GitHub token path. | MEDIUM | `packages/providers/src/providers/openusage-plugin.ts:219` now checks local keychain first. | Accepted. A locally saved token should beat env/CLI fallback. | Fixed in `9b8510f`; regression at `packages/providers/test/openusage-plugin-isolation.test.ts:81`. |
| Fixture helper leaked temporary home directories. | LOW | `packages/providers/test/openusage-plugin-fixture-helpers.ts:10` now removes the temp directory in `finally`. | Accepted. Low risk but easy to close. | Fixed in `9b8510f`; regression at `packages/providers/test/openusage-plugin-fixture-helpers.test.ts:8`. |
| `writeJson` used `resolve(path, "..")` instead of `dirname(path)`. | LOW | `packages/providers/test/openusage-plugin-fixture-helpers.ts:19` now uses `dirname`. | Accepted. This keeps helper intent explicit. | Fixed in `9b8510f`; regression at `packages/providers/test/openusage-plugin-fixture-helpers.test.ts:19`. |
| Blank `homeDir` was accepted as a real path. | LOW | `packages/providers/src/providers/openusage-plugin.ts:113` normalizes `homeDir`; `packages/providers/src/providers/openusage-plugin.ts:836` rejects blank strings. | Accepted. Prevents malformed app data paths. | Fixed in `9b8510f`; regression at `packages/providers/test/openusage-plugin-isolation.test.ts:116`. |

## Verification

- `bun test packages/providers/test/openusage-plugin-provider.test.ts packages/providers/test/openusage-plugin-isolation.test.ts packages/providers/test/openusage-plugin-fixture-helpers.test.ts`: passed, 17 tests.
- `bun run test:webui`: passed, 142 tests.
- `bun run build:webui`: passed.
- `git diff --check`: passed.

## Remaining Risk

Live authenticated refresh for paid/local provider accounts was not run. The current coverage verifies bundled plugin host behavior with fixture data and keeps live account validation as a separate manual gate.
