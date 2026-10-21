# Fix Log: Antigravity Quota Summary (PR #61)

Review record: `docs/reviews/2026-10-21-antigravity-quota-review.md`.

| ID | Repro | Fix | Tests added | Files |
|---|---|---|---|---|
| R1-1 | LS `GetUserStatus` and `GetCommandModelConfigs` return 404, `RetrieveUserQuotaSummary` returns groups: probe ended at the login message. | `probeDiscovery` asks the summary right after `GetUserStatus` and returns it before the per-model fallback. Plan moved to `userStatusPlan`. | "reads the local summary even when both per-model calls fail" | `plugins/antigravity/plugin.js` |
| R1-2 | LS summary `{response:{groups:[]}}`: result became null. | A parsed summary is returned even with no lines. | "keeps an empty local summary instead of falling back" | same |
| R1-3 | `fetchAvailableModels` / `retrieveUserQuota` with `MODEL_PLACEHOLDER_M421`: Claude read 90% used. | Both parsers keep `modelId`; `isArgonModel` matches the placeholder in label or id. | "skips Argon placeholders in the Cloud Code per-model fallback", "skips Argon buckets in the agy keychain per-model fallback" | same |
| R1-4 | Saved order `["antigravity:acct1","codex","antigravity:acct2"]` put the group last. | `orderCardGroups` maps account ids and base ids to the current card id, first position wins. | "Dashboard card order" (3 tests) | `apps/web/src/pages/dashboard-page.tsx` |
| R1-5 | Same used percent, Session reset equal, Weekly reset different: note shown. | Every window with use must reset at the same time on every account. | "does not flag accounts whose used windows reset at different times" | same |
| R1-6 | `loadCodeAssist` 200, summary 403 on both hosts: refresh started, per-model calls skipped. | Only `loadCodeAssist` or the per-model calls mark the token failed. | "uses per-model quota without refreshing when only the summary is rejected" | `plugins/antigravity/plugin.js` |
| R1-7 | Columns followed snapshot recency. | Members sorted by account id. | "orders a group's accounts by id, not by which snapshot is newer" | `apps/web/src/pages/dashboard-page.tsx` |
| R1-8 | Unpinned home, `fetchAvailableModels` returns `{models:{}}`: keychain token was tried. | Parsed per-model reply with no lines ends the probe with the login message. | "does not fall back to the keychain when per-model quota has no lines" | `plugins/antigravity/plugin.js` |

Checks after the fixes: `bunx vitest run` 1361 passed; `bun run test:webui` 599 passed; `bun run build:webui` OK; live read-only probe of the three homes returned Session, Weekly, Claude, Claude Weekly and plan Google AI Pro.
