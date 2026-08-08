# Provider Accounts (Multi-Home) Plan

**Goal:** Settings lets you pick a provider, detect homes/accounts, and track several at once — not Codex-only.

**Model:** `provider_accounts` rows with `id = "<providerId>:<slug>"`, `homePath`, `label`, `enabled`.

**First adapters:** `codex` (`CODEX_HOME`), `claude-code` (`CLAUDE_CONFIG_DIR`), `cursor` (`OPENUSAGE_CURSOR_CONFIG_DIR`), `antigravity` (`OPENUSAGE_ANTIGRAVITY_CLI_HOME` / `OPENUSAGE_ANTIGRAVITY_CONFIG_DIR`).

See also: `docs/plans/2026-07-31-cursor-antigravity-accounts.md`.

**UI:** Settings → Provider Accounts → provider select → Detect / Add Manually.

**Compat:** Migrate `codex_instances` → `provider_accounts`; keep `/api/codex/instances*` as thin aliases.
