# MiniMax API Provider Review Fixes

## Scope

Address triple-review findings for the WebUI MiniMax provider while preserving the original OpenUsage Token Plan remains API method.

## Fixes

- Added regression tests for missing-key errors, id-stable snapshots without `start_time`, `remains_time` reset fallback, explicit remaining-count precedence, Global-key-to-CN credential isolation, and MiniMax `base_resp` errors.
- Updated `MiniMaxProvider` so `MINIMAX_API_TOKEN` is listed in the missing-key error.
- Changed CN endpoint auth to require `MINIMAX_CN_API_KEY`; Global keys are no longer sent to `api.minimaxi.com`.
- Derived stable snapshot windows from `end_time`, `remains_time`, or UTC day fallback, and removed dynamic `endedAt` from the snapshot ID hash.
- Documented that `current_interval_usage_count` is treated as remaining prompts because that is how the original OpenUsage MiniMax plugin handles the remains endpoint.
- Removed the dead `MiniMaxManualProvider` export and test.
- Replaced the MiniMax Settings form with read-only environment-variable tracking details.
- Updated English and Traditional Chinese README MiniMax notes.
- Updated `docs/providers/minimax.md` and the implementation plan to document the WebUI-specific CN key restriction.
- After the second review pass, aligned `remains_time` reset derivation and unit inference with the original plugin.
- Added stable snapshot coverage for payloads that provide only `remains_time`.
- Rejected `PUT /api/settings/minimax` so API-key-like values cannot be stored through the local settings API.
- Added coverage for CN-to-Global fallback, HTTP failure mapping, and abort mapping.

## Verification

- `bun test packages/providers/test/minimax-provider.test.ts`
- `bun test packages/providers/test/manual-provider.test.ts apps/server/test/api.test.ts`
- `bun test apps/server/test/api.test.ts`

## Deferred

- The shared server refresh handler still sets `detected: false` after any provider refresh error. That behavior predates this MiniMax provider branch and should be handled separately if provider detection semantics are refined.
- Live MiniMax API verification is not performed by local tests. The implementation follows the original OpenUsage endpoint and bearer-header method without browser cookies or dashboard scraping.
