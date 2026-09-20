# Grok Build Session Tokens

**Goal:** Show Grok Build CLI usage as a Tokens-page provider, using the same session transcripts original OpenUsage reads.

**Docs to update:** `docs/providers/grok.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md`, `README.md`, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`

## Why

The Tokens page only sums `usage_records` with `total_tokens > 0`. The Grok plugin stores snapshots with a null token count, so Grok never appears. Original OpenUsage (`robinebers/openusage` Swift `main`) still uses provider id `grok` and display name `Grok`, and its docs call this **Grok Build** CLI usage.

Original source of truth is no longer `~/.grok/logs/unified.jsonl`. `GrokLogUsageScanner.swift` reads `~/.grok/sessions/**/updates.jsonl` `turn_completed` rows with per-model `modelUsage`. It says the unified log is a capped debug file and cannot back historical spend or reliable model attribution.

This machine has 218 `updates.jsonl` files and `grok-4.6-build` `turn_completed` rows. The WebUI plugin still estimates card tiles from `unified.jsonl` and does not ingest Tokens records.

## Incorporate now

1. On Grok plugin refresh, scan session transcripts in the host (not the  plugin VM).
2. Emit stable daily per-model token records (`tool: Grok Session`, `source: local-log`).
3. Dedup copied events by `eventId` + model. Do not add `reasoningTokens` on top of `outputTokens`.
4. Include child, fork, and resume `updates.jsonl` files. Missing sessions do not fail weekly billing refresh.
5. Label the provider **Grok Build** in the WebUI. Keep provider id `grok`.

## Original updates deferred

These are useful and verified in original Swift `main`. They are separate from Tokens ingestion:

| Update | Why deferred |
|---|---|
| Card Today / Yesterday / Last 30 Days from sessions | Plugin tests and tiles still use `unified.jsonl`. Switching the card would mix display parsers in this change. |
| Usage trend bar chart | Original `GrokProvider` adds a history chart. Tokens page already lists days. |
| Incremental JSONL scan cache | Local session files are ~460MB. A full refresh scan is acceptable for the first slice; a cache is a later performance change. |
| `Extra Usage` badge title | Copy-only. |
| New Swift providers (Ollama, OpenRouter, Pi) | No JS plugin in our tree. New providers, not a Grok token fix. |
| Merge `tauri-legacy` | Already reviewed: only a security bump was worth taking. Swift `main` has no shared history. |

## Acceptance

- A fixture `updates.jsonl` with `grok-4.6-build` tokens produces a Grok token record after refresh.
- Two identical refreshes keep the same record ids and totals.
- Duplicate `eventId`+model rows count once; two models in one turn both count.
- Reasoning tokens are not added twice.
- No session directory → snapshot only, no throw.
- Tokens docs list Grok Build session transcripts next to Claude, Codex, and Cursor.
