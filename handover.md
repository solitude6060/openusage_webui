# Handover

Updated: 2026-08-11

## Token Usage Fix

- Branch: `fix/token-usage-ingestion`
- Pull request: https://github.com/solitude6060/openusage_webui/pull/33
- Plan: `docs/plans/2026-08-09-token-usage-ingestion-fix.md`
- Grouping plan: `docs/plans/2026-08-09-token-grouping-ux.md`
- Fixture isolation plan: `docs/plans/2026-08-11-plugin-fixture-isolation.md`
- Fixture isolation review: `docs/CODEX_2026-08-11_PLUGIN_FIXTURE_ISOLATION_REVIEW.md`
- Fixture isolation fix log: `docs/CODEX_2026-08-11_PLUGIN_FIXTURE_ISOLATION_FIX_LOG.md`
- ccusage fallback decision: `docs/ADR_2026-08-11_CCUSAGE_FALLBACK.md`
- Pull request review: `docs/CODEX_GPT56_2026-08-11_PR33_REVIEW.md`
- Pull request fix log: `docs/CODEX_GPT56_2026-08-11_PR33_FIX_LOG.md`

## Verification Commands

```sh
bun test packages/providers/test/openusage-plugin-token-ingestion.test.ts \
  packages/providers/test/ccusage-provider.test.ts \
  packages/providers/test/ccusage-parser.test.ts \
  packages/storage/test/sqlite-storage.test.ts \
  apps/server/test/api.test.ts \
  apps/web/src/pages/tokens-page.test.ts
bunx vitest run plugins/claude/plugin.ccusage.test.js \
  plugins/codex/plugin.ccusage.test.js \
  plugins/cursor/plugin.test.js
bun run build:webui
TMPDIR="$PWD/node_modules/.cache/openusage-tests" bun run test:webui
```

The complete WebUI suite passes with 237 tests after plugin fixtures were isolated from ambient
credentials and local ccusage fallback was retained for failed provider refreshes.

## Operational Note

After deployment, run Refresh All once. This writes dated token totals and clears overlapping legacy
Claude and Codex token fields while retaining their cost and raw provenance.

At verification time, an older server process still owned port 6736. The current branch was started
without stopping it by using `OPENUSAGE_WEBUI_PORT=6746 bun run dev:webui`; both ports use the same
SQLite database, and the 6746 Token page has data after Refresh All.
