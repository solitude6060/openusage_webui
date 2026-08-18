# Grok Local Spend Tiles

**Goal:** Show Today / Yesterday / Last 30 Days on the Grok card from the local Grok CLI log, matching official OpenUsage.

**Architecture:** After the credits probe succeeds, read `~/.grok/logs/unified.jsonl` (or `$GROK_HOME/logs/unified.jsonl`). Attribute each `shell.turn.inference_done` row to that process's current model. Price attributed rows at public xAI API rates. Omit a period with no priced usage instead of showing `$0.00 · 0 tokens`.

**Docs to update:** `docs/providers/grok.md`, `README.md`, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md`

## First-principles

1. Need: see Grok CLI spend on the card. The weekly bar does not show dollars or tokens.
2. Assumption: official `GrokLogUsageScanner` is the correct log contract.
3. Verified this session: local log exists; model events use `grok-4.6`; zero `inference_done` rows.
4. If the contract is wrong: tiles stay omitted; weekly billing still works.
5. This reads the log. It does not invent a new API.

## Rules

- Missing or unreadable log does not fail the probe.
- Unattributed or unpriced rows are excluded from totals.
- Standard rates from https://docs.x.ai/developers/pricing (2026-08-18). Prompts at or above 200k tokens use the listed long-context rates.
- Alias: `grok-build` → `grok-build-0.1`.
