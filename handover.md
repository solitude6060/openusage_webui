# Handover

Updated: 2026-08-09

## Token Usage Fix

- Branch: `fix/token-usage-ingestion`
- Pull request: https://github.com/solitude6060/openusage_webui/pull/33
- Plan: `docs/plans/2026-08-09-token-usage-ingestion-fix.md`

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
```

## Operational Note

After deployment, run Refresh All once. This writes dated token totals and clears overlapping legacy
Claude and Codex token fields while retaining their cost and raw provenance.
