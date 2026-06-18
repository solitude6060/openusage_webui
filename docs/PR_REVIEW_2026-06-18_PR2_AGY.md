# PR #2 AGY Review Rerun

PR: https://github.com/solitude6060/openusage_webui/pull/2
Base: `dev`
Head: `codex/webui-provider-fixture-coverage`
Reviewed head: `8eb7b3062f0790d8d2bc1837c8349da17c22fb14`
Fix head: `a20f931d10c4aa3edd2a9eeefd64353bee8e40bd`

Reviewer command:

```bash
agy --print-timeout 15m --dangerously-skip-permissions -p "Review PR #2 ..."
```

Output file: `/tmp/pr2_review_agy_current.out`

Verdict: REQUEST CHANGES, fixed in `a20f931`

## Findings And Triage

| Finding | Severity | Verified Evidence | Action |
| --- | ---: | --- | --- |
| `packages/providers/src/providers/openusage-plugin.ts` was 838 LOC, above the repo guardrail for new files. | MEDIUM | `wc -l` confirmed 838 lines before the fix. | Fixed by splitting pure plugin host helpers into `openusage-plugin-runtime.ts` and `openusage-plugin-api.ts`; post-fix line counts are 349, 411, and 134 lines. |
| `readGenericPassword` and `readGenericPasswordForCurrentUser` returned `null` when not found, while `docs/plugins/api.md` says keychain misses should throw. | MEDIUM | `docs/plugins/api.md` Keychain section says "Throws if not found"; provider tests showed missing reads returned `null`. | Fixed by making local and GitHub keychain misses throw `Keychain item not found: ...`; original plugins already catch keychain misses for fallback. |
| Provider UI note copy used `OpenUsage plugin`, not titlecase. | LOW | `apps/web/src/provider-ui.ts` hardcoded `note: "OpenUsage plugin"`. | Fixed to `OpenUsage Plugin` and updated `getProviderStatusLabel` plus tests. |

## Verification

- `bun test packages/providers/test/openusage-plugin-provider.test.ts --test-name-pattern "keychain writes"`: failed before the keychain fix, then passed.
- `bun test apps/web/src/provider-ui.test.ts`: failed before the copy fix, then passed.
- `bun test packages/providers/test/openusage-plugin-provider.test.ts packages/providers/test/openusage-plugin-isolation.test.ts apps/web/src/provider-ui.test.ts`: passed, 34 tests.
- `bun run test:webui`: passed, 144 tests.
- `bun run build:webui`: passed.
- `git diff --check`: passed.

## Remaining Limits

- AGY must be rerun against `a20f931` before merge approval.
- Claude and opencode reviewer lanes still need current-head outputs for the triple-review gate.
