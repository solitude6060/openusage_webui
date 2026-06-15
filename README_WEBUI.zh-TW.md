# OpenUsage WebUI Fork

## 這是什麼

這是一個 local-first 的 WebUI 儀表板，用於在 Ubuntu/Linux 上追蹤 AI coding usage。

## 目前支援

- Claude Code via ccusage
- Codex CLI via ccusage
- GitHub Copilot CLI via ccusage
- Gemini CLI / Google AI Pro coding usage via ccusage
- MiniMax Token Plan remains API key 查詢
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

`start:webui` 會用同一個本機 server 服務已 build 的 frontend 和 API。如果 frontend build 產物不存在，server 會回傳明確的本機錯誤，而不是空白頁。

## 安全性

Server 預設只綁定 `127.0.0.1`。
沒有 telemetry。
不會上傳資料到 cloud。

## ccusage 狀態

手動 entries 和 MiniMax settings 已實作。`ccusage` refresh 會先嘗試 `bunx ccusage`，再嘗試 `npx ccusage`，並在 JSON output 可用時做 normalize。如果 ccusage 只回傳非 JSON output，WebUI 會儲存 raw fallback record，不做脆弱的表格 parsing。

## MiniMax 狀態

MiniMax refresh 沿用原本 OpenUsage 的 Token Plan remains API 方法。啟動 server 前設定其中一個環境變數：

```bash
export MINIMAX_API_KEY="..."
# 或
export MINIMAX_CN_API_KEY="..."
```

WebUI 不會儲存 MiniMax API key。MiniMax 回傳的是剩餘 prompt quota，不是逐筆 token usage，所以 WebUI 會把它存成 raw API usage snapshot。
