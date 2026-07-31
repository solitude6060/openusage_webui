# Cursor + Antigravity Provider Accounts

**Goal:** Settings → Provider Accounts can track multiple Cursor configs and Antigravity / `agy` homes, same pattern as Codex and Claude Code.

## Home model

| Provider | `homePath` | Injected env | Auth signal |
|---|---|---|---|
| Cursor | App config root (e.g. `~/.config/Cursor`) | `OPENUSAGE_CURSOR_CONFIG_DIR` | `User/globalStorage/state.vscdb` exists |
| Antigravity IDE | App config root (e.g. `~/.config/Antigravity`) | `OPENUSAGE_ANTIGRAVITY_CONFIG_DIR` | `User/globalStorage/state.vscdb` exists |
| Antigravity CLI (`agy` / `agy2`) | Overlay root (e.g. `~/.agy-homes/acct1`) | `OPENUSAGE_ANTIGRAVITY_CLI_HOME` | `.gemini/antigravity-cli/antigravity-oauth-token` exists |

Local `agy-run-profile` sets `HOME=~/.agy-homes/<profile>` and keeps a private `.gemini` per account. Detect should scan `~/.agy-homes/*` for that oauth file.

## Plugin rules

- When a multi-account env is set, prefer that home’s sqlite / oauth file and skip global keychain fallback (avoids cross-account bleed).
- Cursor optional power-user: `OPENUSAGE_CURSOR_STATE_DB` = full path to a specific `state.vscdb`.

## Docs to update

- `docs/plans/2026-07-24-provider-accounts.md`
- `docs/USER_GUIDE_WEBUI.zh-TW.md` (Provider Accounts section)
- `docs/providers/cursor.md`, `docs/providers/antigravity.md` if present
- Tauri `WHITELISTED_ENV_VARS` for desktop probes

## Exit criteria

- Capabilities API lists `cursor` and `antigravity`
- Detect finds default Cursor config + `.agy-homes` CLI homes in fixtures
- Registry fans out enabled accounts to `cursor:*` / `antigravity:*` cards
- Plugin tests cover env override + keychain suppression
- WebUI Settings provider select includes the new providers
