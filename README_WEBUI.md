# OpenUsage WebUI Fork

## What This Is

A local-first WebUI dashboard for AI coding usage on Ubuntu/Linux.

## What It Supports

- Claude Code via ccusage
- Codex CLI via ccusage
- GitHub Copilot CLI via ccusage
- Gemini CLI / Google AI Pro coding usage via ccusage
- MiniMax manual tracking
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

## Security

The server binds to 127.0.0.1 by default.
No telemetry.
No cloud upload.

## ccusage Notes

Manual entries and MiniMax settings are implemented. ccusage refresh attempts `bunx ccusage` first and then `npx ccusage`, using JSON output when available. If ccusage returns non-JSON output, the WebUI stores a raw fallback record instead of brittle table parsing.
