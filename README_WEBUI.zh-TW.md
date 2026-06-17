# OpenUsage WebUI Fork

## 這是什麼

OpenUsage WebUI 是一個 local-first 的 AI coding usage 儀表板，目標是在 Ubuntu/Linux 上用瀏覽器查看本機 AI 工具使用狀態。

預設入口：

```text
http://127.0.0.1:6736
```

這個 WebUI 不是原本 macOS Tauri menu bar app 的完整移植。它保留原專案的 provider 概念，但改成「本機 HTTP server + React WebUI + SQLite」架構。

## 目前支援

- Amp via 原本 OpenUsage plugin adapter
- Antigravity via 原本 OpenUsage plugin adapter
- Claude Code via 原本 OpenUsage plugin adapter
- Codex CLI via 原本 OpenUsage plugin adapter
- Cursor via 原本 OpenUsage plugin adapter
- Devin via 原本 OpenUsage plugin adapter
- Factory / Droid via 原本 OpenUsage plugin adapter
- Grok via 原本 OpenUsage plugin adapter
- GitHub Copilot via 原本 OpenUsage plugin adapter
- JetBrains AI Assistant via 原本 OpenUsage plugin adapter
- Kimi via 原本 OpenUsage plugin adapter
- Kiro via 原本 OpenUsage plugin adapter
- OpenCode Go via 原本 OpenUsage plugin adapter
- Perplexity via 原本 OpenUsage plugin adapter
- Synthetic via 原本 OpenUsage plugin adapter
- Z.ai via 原本 OpenUsage plugin adapter
- Gemini CLI / Google AI Pro coding usage via `ccusage`
- MiniMax Token Plan remains API key 查詢
- 手動 usage entries

## 目前不做

- 不做 browser cookie scraping
- 不讀取 browser session
- 不做 cloud sync
- 不做 remote dashboard
- 不做 macOS menu bar
- 暫不做 Linux tray
- 不儲存 MiniMax API key 到 SQLite 或 config

## 安裝

需要先安裝：

- Bun
- `curl`，原本 OpenUsage plugin adapter 會用它執行 provider HTTP refresh

```bash
bun install
```

## 開發模式啟動

```bash
bun run dev:webui
```

成功後打開：

```text
http://127.0.0.1:6736
```

開發模式會同時啟動：

- WebUI backend: `127.0.0.1:6736`
- Vite frontend dev server: `127.0.0.1:6737`

你平常只需要開 `6736`。

## 類 Production 本機執行

```bash
bun run build:webui
bun run start:webui
```

`start:webui` 會用同一個本機 server 服務已 build 的 frontend 和 API。如果 frontend build 產物不存在，server 會回傳明確錯誤，而不是空白頁。

## MiniMax 設定

MiniMax refresh 沿用原本 OpenUsage 的 Token Plan remains API 方法。啟動 server 前設定其中一個環境變數：

```bash
export MINIMAX_API_KEY="..."
# 或
export MINIMAX_API_TOKEN="..."
# 或
export MINIMAX_CN_API_KEY="..."
```

安全規則：

- WebUI 不會儲存 MiniMax API key
- Global key 只會送到 `www.minimax.io`
- 只有設定 `MINIMAX_CN_API_KEY` 時才會使用 CN endpoint
- MiniMax 回傳的是剩餘 prompt quota，不是逐筆 token usage
- MiniMax quota 會顯示在 Sessions 的 `Quota` 欄位，不會被灌進 token/cost summary

## ccusage 設定

WebUI refresh 會依序嘗試：

```bash
bunx ccusage
npx ccusage
```

如果 `ccusage` 支援 JSON output，WebUI 會 normalize 成 usage records。如果只有非 JSON output，WebUI 會保留 raw fallback record，不做脆弱的表格 parsing。

## Claude / Codex 設定

Claude Code 和 Codex 已開始沿用原本 OpenUsage 的 provider plugin：

```text
plugins/claude/plugin.js
plugins/codex/plugin.js
```

WebUI 會提供 Linux-friendly host adapter，讓原本 plugin 可以在本機 server 裡執行。

Claude 會讀：

```text
CLAUDE_CONFIG_DIR/.credentials.json
~/.claude/.credentials.json
```

Codex 會讀：

```text
CODEX_HOME/auth.json
~/.config/codex/auth.json
~/.codex/auth.json
```

原本 plugin 可能會 refresh OAuth token，並把更新後的 credential 寫回同一個檔案來源。WebUI 不使用 browser cookies。

## GitHub Copilot 設定

GitHub Copilot 已開始沿用原本 OpenUsage 的 `plugins/copilot/plugin.js`。WebUI 會提供 Linux-friendly host adapter，讓原本 plugin 可以在本機 server 裡執行。

建議先用 GitHub CLI 登入：

```bash
gh auth login
```

WebUI refresh 時會嘗試使用 `gh auth token`。也可以在啟動前提供其中一個環境變數：

```bash
export GH_TOKEN="..."
# 或
export GITHUB_TOKEN="..."
```

Copilot quota 會以原本 plugin 的 progress/text lines 存成 snapshot record，並顯示在 Sessions。

## 手動輸入

到 WebUI 的 `Settings` 頁面可以新增 manual usage entries。適合用來追蹤目前還沒有自動 provider 的服務或一次性紀錄。

## 資料位置

```text
~/.openusage-webui/openusage.sqlite
~/.openusage-webui/config.json
~/.openusage-webui/plugins/<provider>/keychain.json
```

目錄和檔案會盡量用 owner-only 權限建立。

## 安全性

- Server 預設只綁定 `127.0.0.1`
- 不綁定 `0.0.0.0`
- 沒有 telemetry
- 不會上傳資料到 cloud
- 不讀 browser cookies
- 不儲存 API key 到 WebUI database
- 原本 OpenUsage plugin 如果寫入 keychain，WebUI 會用本機 shim 存在 `~/.openusage-webui/plugins/<provider>/keychain.json`，檔案權限會設成 owner-only。這不是 macOS Keychain，也不是 Linux secret-service。

## 常用指令

```bash
bun run dev:webui      # 開發模式
bun run build:webui    # build frontend 和 server
bun run start:webui    # 類 production 本機模式
bun run test:webui     # WebUI 測試
```

## 使用手冊

完整操作、頁面說明、provider 設定和 troubleshooting 請看：

```text
docs/USER_GUIDE_WEBUI.zh-TW.md
```
