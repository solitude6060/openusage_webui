# OpenUsage WebUI Fork

## 這是什麼

這是一個 local-first 的 WebUI 儀表板，用於在 Ubuntu/Linux 上追蹤 AI coding usage。

## 目前支援

- Claude Code via ccusage
- Codex CLI via ccusage
- GitHub Copilot CLI via ccusage
- Gemini CLI / Google AI Pro coding usage via ccusage
- MiniMax 手動追蹤
- 手動 usage entries

## 目前不做

- 不做 browser cookie scraping
- 不做 cloud sync
- 不做 remote dashboard
- 不做 macOS menu bar
- 暫不做 Linux tray

## 安裝

```bash
bun install
bun run dev:webui
```

## 開啟

```text
http://127.0.0.1:6736
```

## 資料位置

```text
~/.openusage-webui/openusage.sqlite
~/.openusage-webui/config.json
```

## 類 Production 本機執行

```bash
bun run build:webui
bun run start:webui
```

## 安全性

Server 預設只綁定 `127.0.0.1`。
沒有 telemetry。
不會上傳資料到 cloud。

## ccusage 狀態

手動 entries 和 MiniMax settings 已實作。`ccusage` refresh 會先嘗試 `bunx ccusage`，再嘗試 `npx ccusage`，並在 JSON output 可用時做 normalize。如果 ccusage 只回傳非 JSON output，WebUI 會儲存 raw fallback record，不做脆弱的表格 parsing。
