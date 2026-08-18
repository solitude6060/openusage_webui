# OpenUsage WebUI Fork

## What This Is

A local-first WebUI dashboard for AI coding usage on Ubuntu/Linux.

## What It Supports

- Amp via the original OpenUsage plugin adapter
- Antigravity via the original OpenUsage plugin adapter — optional **Provider Accounts** for multiple CLI/IDE homes, including `~/.agy-homes/*`
- Claude Code via the original OpenUsage plugin adapter — optional **Provider Accounts** for multiple `CLAUDE_CONFIG_DIR` homes
- Codex CLI via the original OpenUsage plugin adapter — session/weekly/review usage, plus **reset-credit expiry**: each banked reset credit's exact expiry date and a live countdown, color-coded by urgency (red = expires today, amber = within 3 days, grey = plenty of time); optional **Provider Accounts** for multiple `CODEX_HOME` homes
- Cursor via the original OpenUsage plugin adapter — optional **Provider Accounts** for multiple Cursor config homes
- Devin via the original OpenUsage plugin adapter
- Factory / Droid via the original OpenUsage plugin adapter
- Grok via the original OpenUsage plugin adapter — weekly shared pool, plan, pay-as-you-go cap, and local spend from the Grok CLI log
- GitHub Copilot via the original OpenUsage plugin adapter
- JetBrains AI Assistant via the original OpenUsage plugin adapter
- Kimi via the original OpenUsage plugin adapter
- Kiro via the original OpenUsage plugin adapter
- OpenCode Go via the original OpenUsage plugin adapter
- Perplexity via the original OpenUsage plugin adapter
- Synthetic via the original OpenUsage plugin adapter
- Z.ai via the original OpenUsage plugin adapter
- Gemini CLI / Google AI Pro coding usage via ccusage
- MiniMax Token Plan remains via API key
- Manual usage entries
- Token totals on the Tokens page (`/tokens`) with Provider → Model and Model → Provider views,
  compact M/B totals, deterministic model-family grouping, and exact expanded values; populated
  from Claude/Codex local usage and complete Cursor usage-event refreshes

## What It Does Not Do

- No browser cookie scraping
- No cloud sync
- No remote dashboard
- No macOS menu bar
- No Linux tray yet

## Install

Requirements:

- Bun
- `curl` available on `PATH` for original OpenUsage plugin HTTP refreshes

```bash
bun install
bun run dev:webui
```

Backend code edits hot-reload automatically — the API server runs under `bun --watch`, and the Vite frontend has its own HMR. No manual restart is needed after pulling changes.

## Open

```text
http://127.0.0.1:6736
```

## Data Location

```text
~/.openusage-webui/openusage.sqlite
~/.openusage-webui/config.json
~/.openusage-webui/plugins/<provider>/keychain.json
```

## Production-Like Local Use

```bash
bun run build:webui
bun run start:webui
```

`start:webui` serves the built frontend and API from the same local server. If the frontend build is missing, the server returns a clear local error instead of serving an empty page.

## Security

The server binds to 127.0.0.1 by default.
To expose it to selected Tailscale addresses, set both the bind host and an
explicit Host header allowlist before starting the server:

```bash
OPENUSAGE_WEBUI_HOST=0.0.0.0 \
OPENUSAGE_WEBUI_ALLOWED_HOSTS=<tailscale-ip>,<magic-dns-name> \
bun run start:webui
```

`OPENUSAGE_WEBUI_ALLOWED_HOSTS` accepts comma-separated hostnames or IP
addresses. Localhost stays allowed automatically. Do not bind to `0.0.0.0`
without a narrow allowlist and host firewall rules if the local network is not
trusted.
No telemetry.
No cloud upload.
Original OpenUsage plugins that write keychain items use a local WebUI shim at `~/.openusage-webui/plugins/<provider>/keychain.json` with owner-only file permissions. This is not the macOS Keychain or a Linux secret-service integration.

## ccusage Notes

Manual entries, MiniMax quota refresh, and original OpenUsage plugin-backed providers are implemented. ccusage refresh attempts `bunx ccusage` first and then `npx ccusage`, using JSON output when available. If ccusage returns non-JSON output, the WebUI stores a raw fallback record instead of brittle table parsing. Local Claude and Codex ccusage totals remain available when their plugin refresh fails; a successful plugin refresh removes overlapping token totals.

## Claude And Codex Notes

Claude Code and Codex use the original `plugins/claude/plugin.js` and `plugins/codex/plugin.js` through a WebUI host adapter.

Claude reads `CLAUDE_CONFIG_DIR/.credentials.json` when `CLAUDE_CONFIG_DIR` is set, otherwise `~/.claude/.credentials.json`.

Codex reads `CODEX_HOME/auth.json` when `CODEX_HOME` is set, otherwise `~/.config/codex/auth.json` and `~/.codex/auth.json`.

The original plugins may refresh OAuth tokens and write updated credentials back to the same file source. Browser cookies are not used.

## GitHub Copilot Notes

GitHub Copilot uses the original `plugins/copilot/plugin.js` through a WebUI host adapter. On Linux, authenticate with GitHub CLI:

```bash
gh auth login
```

The WebUI adapter tries `gh auth token` during refresh. You can also start the server with `GH_TOKEN` or `GITHUB_TOKEN`.

## MiniMax Notes

MiniMax refresh uses the original OpenUsage Token Plan remains API method. Set one of these environment variables before starting the server:

```bash
export MINIMAX_API_KEY="..."
# or
export MINIMAX_API_TOKEN="..."
# or
export MINIMAX_CN_API_KEY="..."
```

The WebUI does not store the MiniMax API key. Global keys are only sent to `www.minimax.io`; the CN endpoint is used only when `MINIMAX_CN_API_KEY` is set. It stores quota snapshots as raw API usage records because MiniMax returns remaining prompt quota, not per-request token usage.
