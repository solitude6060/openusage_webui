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

## Phase 1 狀態

手動 entries 和 MiniMax settings 已實作。`ccusage` 目前只會列為 provider，自動 refresh 和 parsing 會在 Phase 2 實作。
