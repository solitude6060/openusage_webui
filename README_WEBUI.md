# OpenUsage WebUI Fork

## What This Is

A local-first WebUI dashboard for AI coding usage on Ubuntu/Linux.

## What It Supports

- Claude Code via ccusage
- Codex CLI via ccusage
- GitHub Copilot via the original OpenUsage plugin adapter
- Gemini CLI / Google AI Pro coding usage via ccusage
- MiniMax Token Plan remains via API key
- Manual usage entries

## What It Does Not Do

- No browser cookie scraping
- No cloud sync
- No remote dashboard
- No macOS menu bar
- No Linux tray yet

## Install

```bash
bun install
bun run dev:webui
```

## Open

```text
http://127.0.0.1:6736
```

## Data Location

```text
~/.openusage-webui/openusage.sqlite
~/.openusage-webui/config.json
```

## Production-Like Local Use

```bash
bun run build:webui
bun run start:webui
```

`start:webui` serves the built frontend and API from the same local server. If the frontend build is missing, the server returns a clear local error instead of serving an empty page.

## Security

The server binds to 127.0.0.1 by default.
No telemetry.
No cloud upload.

## ccusage Notes

Manual entries, MiniMax quota refresh, and GitHub Copilot through the original OpenUsage plugin adapter are implemented. ccusage refresh attempts `bunx ccusage` first and then `npx ccusage`, using JSON output when available. If ccusage returns non-JSON output, the WebUI stores a raw fallback record instead of brittle table parsing.

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
