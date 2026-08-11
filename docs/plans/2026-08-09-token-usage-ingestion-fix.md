# Token Usage Ingestion Fix Plan

> Updated 2026-08-11: generic Claude and Codex rows are retained as failure fallback. Successful
> structured plugin refreshes remove overlapping token fields through the storage replacement path.
> See `docs/ADR_2026-08-11_CCUSAGE_FALLBACK.md`.

## Problem

The Tokens page only aggregates positive `usage_records.total_tokens` values. Claude,
Codex, and Cursor already fetch structured token data during provider refresh, but the
WebUI adapter stores only display snapshots, leaving `total_tokens` empty.

## Scope

1. Add regression fixtures proving provider refresh emits exact token records.
2. Preserve quota snapshots and additionally normalize structured usage into stable
   provider/account, day, and model records.
3. Verify repeated refreshes upsert the same records without increasing totals.
4. Verify the provider refresh to `/api/usage/tokens` integration path.
5. Update `docs/USER_GUIDE_WEBUI.zh-TW.md` and the WebUI readmes to describe automatic
   token ingestion and its supported sources.

## Constraints

- Do not parse formatted display text such as `1.2M tokens`.
- Do not attach rolling totals to refresh-time snapshot records because each snapshot
  has a unique ID and would be counted repeatedly.
- Keep quota-only providers out of token totals.
- Keep existing plugin request and response secrets out of stored token records.
- Audit any plugin-exposed fields against `src-tauri/src/plugin_engine/host_api.rs`
  redaction coverage if plugin output fields change.

## Exit Criteria

- Claude and Codex ccusage daily model data produce stable token records.
- Complete Cursor usage-event samples produce stable daily model token records; partial
  pagination results do not replace previously complete totals.
- Two identical refreshes return the same token totals and record count.
- Existing targeted provider, storage, server, and WebUI tests pass.
- Production build succeeds.
