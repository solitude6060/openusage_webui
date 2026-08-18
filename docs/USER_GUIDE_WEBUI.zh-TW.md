# OpenUsage WebUI 使用手冊

## 1. 適用對象

這份手冊給想在 Ubuntu/Linux 上本機追蹤 AI coding usage 的使用者。

目前 WebUI 適合追蹤：

- Amp
- Antigravity
- Claude Code
- Codex CLI
- Cursor
- Devin
- Factory / Droid
- Grok（週配額與 pay-as-you-go）
- GitHub Copilot CLI
- JetBrains AI Assistant
- Kimi
- Kiro
- OpenCode Go
- Perplexity
- Synthetic
- Z.ai
- Gemini CLI / Google AI Pro coding usage
- MiniMax Token Plan quota
- 手動記錄的使用量

## 2. 基本概念

OpenUsage WebUI 採 local-first 設計：

- 使用瀏覽器開本機 dashboard
- API server 預設只綁定 `127.0.0.1`
- 需要 Tailscale 裝置連線時，必須明確設定綁定位址和 `Host` header 允許清單
- 使用 SQLite 存本機 usage records
- 不上傳資料到 cloud
- 不讀 browser cookies
- 不做 browser session scraping

預設網址：

```text
http://127.0.0.1:6736
```

## 3. 安裝與啟動

### 3.1 安裝依賴

系統需要先有：

- Bun
- `curl`，原本 OpenUsage plugin adapter 會用它執行 provider HTTP refresh

在 repo 根目錄執行：

```bash
bun install
```

### 3.2 開發模式

```bash
bun run dev:webui
```

開啟：

```text
http://127.0.0.1:6736
```

開發模式內部會使用：

- `127.0.0.1:6736`：WebUI backend 和對外入口
- `127.0.0.1:6737`：Vite frontend dev server

正常使用時只需要打開 `6736`。

### 3.3 類 Production 本機模式

```bash
bun run build:webui
bun run start:webui
```

這個模式只需要 `6736`，frontend build 和 API 會由同一個 server 提供。

### 3.4 Tailscale 裝置連線

預設模式只允許本機瀏覽器。若要讓同一個 Tailscale 網路內的其他裝置連到 WebUI，啟動前設定：

```bash
OPENUSAGE_WEBUI_HOST=0.0.0.0 \
OPENUSAGE_WEBUI_ALLOWED_HOSTS=<tailscale-ip>,<magic-dns-name> \
bun run start:webui
```

之後可從其他 Tailscale 裝置開：

```text
http://<tailscale-ip>:6736
```

`OPENUSAGE_WEBUI_ALLOWED_HOSTS` 可填逗號分隔的主機名稱或 IP 位址；本機的 `127.0.0.1`、`localhost`、`[::1]` 會自動允許。這個設定限制的是 HTTP `Host` header，不等同於防火牆；若區域網路不可信，請另外用主機防火牆只允許 Tailscale 介面連入 `6736`。

## 4. 第一次打開後要做什麼

1. 打開 `http://127.0.0.1:6736`
2. 到 `Providers` 看 provider 狀態
3. 按 `Refresh All`
4. 到 `Sessions` 看 usage records
5. 到 `Tokens` 依時間區間比較各 provider／model 的 token 量
6. 如果需要手動補資料，到 `Settings` 新增 manual entry

如果沒有設定 MiniMax key、沒有登入對應 coding agent，或沒有安裝可執行的 `ccusage`，dashboard 仍可開啟，只是對應 provider 會顯示錯誤或沒有資料。
多數原本 OpenUsage provider 目前透過 plugin adapter refresh，不依賴 `ccusage` 才能查 quota。

## 5. 頁面說明

### 5.1 Dashboard

Dashboard 顯示概覽：

- Today total tokens
- Today estimated cost
- Month total tokens
- Month estimated cost
- Provider breakdown
- Last refresh/status
- Refresh All button

注意：MiniMax Token Plan 回傳的是 quota snapshot，不是 token usage，所以不會加進 token/cost totals。MiniMax quota 會在 `Sessions` 的 `Quota` 欄位顯示。

### 5.2 Providers

Providers 頁面顯示各 provider 狀態：

- 是否 detected
- 是否 enabled
- last refresh
- last error
- refresh button

Amp、Antigravity、Claude Code、Codex、Cursor、Devin、Factory、Grok、GitHub Copilot、JetBrains AI Assistant、Kimi、Kiro、OpenCode Go、Perplexity、Synthetic、Z.ai 目前透過原本 OpenUsage provider plugin adapter refresh。Gemini CLI / Google AI Pro 仍主要透過 `ccusage` 匯入，因為原本 repo 目前沒有 Gemini provider plugin。

### 5.3 Sessions

Sessions 頁面顯示 usage records 表格。

主要欄位：

- Started At
- Provider
- Tool
- Model
- Input Tokens
- Output Tokens
- Total Tokens
- Quota
- Cost USD
- Source

`Quota` 欄位主要用於 MiniMax 這類回傳剩餘額度而不是 token/cost 的 provider。

### 5.4 Tokens

Tokens 頁面依時間區間加總本機 `usage_records` 的 token：

- 時間：Today／Last 7 Days／Last 30 Days／This Month／All／Custom
- 分組：By Provider 顯示 Provider → Model；By Model 顯示 Model → Provider
- 父層總量以 M／B 縮寫，展開後顯示完整 token 整數
- 已知的 routing、日期 revision 與 inference profile 名稱差異會歸入同一 model family；
  不同 model 版本仍分開顯示
- Claude／Codex 會使用本機 usage logs；Cursor 會使用完整取得的 usage events

按下 Refresh All 或等待自動 refresh 後，上述來源會更新對應日期與 model 的 token
records。Claude／Codex plugin refresh 失敗時，本機 `ccusage` token 數值仍會保留；plugin
refresh 成功時，同日期的重疊 token 數值會被取代，舊有費用與來源資料仍會保留。Cursor
events 必須完整取得才會寫入，避免把部分資料顯示成完整總量。只提供即時配額的 provider
不會列入 token totals。

### 5.5 Settings

Settings 頁面包含：

- Server bind host
- Port
- Database path
- Refresh interval（WebUI 每 20 分鐘自動 refresh 一次）
- Currency display
- Provider Accounts（選 Provider → 偵測／新增多個家目錄帳號）
- MiniMax tracking method
- Manual entry form

**Provider Accounts**：先選 Provider（目前支援 Codex、Claude Code、Cursor、Antigravity），再按「Detect Homes」找出已登入的家目錄，或手動填標籤與路徑。每個啟用中的帳號會變成儀表板上的獨立卡片。Codex 使用 `CODEX_HOME`；Claude Code 使用 `CLAUDE_CONFIG_DIR`；Cursor 使用 `OPENUSAGE_CURSOR_CONFIG_DIR`；Antigravity CLI（例如本機 `agy`／`agy1`／`agy2`：預設 `~/.gemini` 與 `~/.agy-homes/<profile>`）使用 `OPENUSAGE_ANTIGRAVITY_CLI_HOME`，IDE 設定目錄使用 `OPENUSAGE_ANTIGRAVITY_CONFIG_DIR`。Detect 若讀得到 oauth 裡的 Google 信箱，標籤與儀表板卡片會顯示該信箱。尚未新增任何帳號時，行為與原本單一 Provider 卡片相同。

Manual entry form 可以手動新增 usage record，適合目前沒有自動 provider 的服務。

## 6. ccusage 使用

WebUI refresh 會嘗試執行：

```bash
bunx ccusage
npx ccusage
```

它會優先使用 JSON output。如果 JSON output 可用，WebUI 會 normalize 成 usage records。如果 output 不是 JSON，WebUI 會保留 raw fallback record。

### 6.1 ccusage 找不到

如果 refresh 顯示 ccusage unavailable，可以先在終端機確認：

```bash
bunx ccusage --help
```

或：

```bash
npx ccusage --help
```

WebUI 不會自動安裝 `ccusage`，避免在未確認的情況下修改使用者環境。

## 7. MiniMax 使用

MiniMax provider 沿用原本 OpenUsage 的 Token Plan remains API 方法。

啟動 WebUI 前設定其中一個：

```bash
export MINIMAX_API_KEY="..."
# 或
export MINIMAX_API_TOKEN="..."
# 或
export MINIMAX_CN_API_KEY="..."
```

然後啟動：

```bash
bun run dev:webui
```

或：

```bash
bun run start:webui
```

### 7.1 MiniMax 安全行為

- API key 只從環境變數讀取
- API key 不會存進 SQLite
- API key 不會存進 config
- `PUT /api/settings/minimax` 會被拒絕
- Global key 只送到 `www.minimax.io`
- CN endpoint 只在 `MINIMAX_CN_API_KEY` 存在時使用

### 7.2 MiniMax 顯示方式

MiniMax 回傳的是目前 plan/window 的剩餘 prompt quota。WebUI 會存成 raw API snapshot，並在 Sessions 的 `Quota` 欄位顯示，例如：

```text
30 / 100 prompts · 70 Left · Resets ...
```

它不會被計入 token totals 或 cost totals。

## 8. Claude / Codex 使用

Claude Code 和 Codex provider 已開始沿用原本 OpenUsage plugin：

```text
plugins/claude/plugin.js
plugins/codex/plugin.js
```

WebUI 在 Linux 上會提供 adapter，讓原本 plugin 可以讀取 CLI credential、呼叫原本 usage API，並把回傳的 progress/text lines 存成 Sessions 裡的 snapshot。

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

若要在 WebUI 同時追蹤多個 Codex／Claude／Cursor／Antigravity 家目錄，到 Settings → Provider Accounts：選 Provider → Detect Homes 或手動新增。每個帳號會以對應環境變數獨立 probe（識別碼形如 `codex:local`、`claude-code:work`、`cursor:work`、`antigravity:acct1`）。

原本 plugin 可能會 refresh OAuth token，並把更新後的 credential 寫回同一個檔案來源。WebUI 不使用 browser cookies。

如果沒有登入，provider refresh 會顯示類似：

```text
Not logged in. Run `claude` to authenticate.
Not logged in. Run `codex` to authenticate.
```

## 9. GitHub Copilot 使用

GitHub Copilot provider 已開始沿用原本 OpenUsage plugin：

```text
plugins/copilot/plugin.js
```

WebUI 在 Linux 上會提供 adapter，讓原本 plugin 可以讀 token、呼叫 GitHub Copilot quota API，並把回傳的 progress/text lines 存成 Sessions 裡的 snapshot。

建議先登入 GitHub CLI：

```bash
gh auth login
```

refresh 時 WebUI 會嘗試使用：

```bash
gh auth token
```

也可以啟動前提供環境變數：

```bash
export GH_TOKEN="..."
# 或
export GITHUB_TOKEN="..."
```

GitHub Copilot 的 quota snapshot 不一定是 token/cost usage，因此主要會出現在 Sessions 的 raw snapshot / quota 類資訊，不應和 Claude/Codex token totals 混在一起解讀。

## 10. 手動 Usage Entry

到 `Settings` 頁面填入：

- Provider
- Tool
- Model
- Input tokens
- Output tokens
- Cost USD
- Date/time
- Notes

送出後，資料會寫入 SQLite，並可在 `Sessions` 和 summary 中看到。

## 11. 資料與備份

資料位置：

```text
~/.openusage-webui/openusage.sqlite
~/.openusage-webui/config.json
~/.openusage-webui/plugins/<provider>/keychain.json
```

`keychain.json` 是 WebUI 為原本 OpenUsage plugin 提供的本機 keychain shim。它只存在本機 plugin 資料夾，會用 owner-only 權限建立；它不是 macOS Keychain，也不是 Linux secret-service。

要備份資料時，備份整個目錄即可：

```text
~/.openusage-webui
```

## 12. Port 與連線問題

### 12.1 Port 6736 被占用

如果啟動時顯示 port 已被使用，先找出目前是哪個 process 使用：

```bash
ss -ltnp 'sport = :6736'
```

或：

```bash
lsof -iTCP:6736 -sTCP:LISTEN
```

停掉舊 process 後再啟動 WebUI。

### 12.2 開 `6736` 閃爍或沒有反應

開發模式下，`6736` 會代理 Vite dev server。若看到閃爍：

1. 重新整理 `http://127.0.0.1:6736`
2. 如果還是閃爍，hard refresh
3. 確認 dev server console 沒有錯誤
4. 確認 health endpoint：

```bash
curl http://127.0.0.1:6736/api/health
```

正常會看到：

```json
{"ok":true,"version":"0.1.0","database":"ok"}
```

### 12.3 API 有回應但頁面沒有資料

常見原因：

- 還沒有按 refresh
- `ccusage` 不可執行
- MiniMax key 沒設定
- 目前 provider 沒有 records
- date range / provider filter 篩掉資料

## 13. 常用 API

Health:

```http
GET /api/health
```

Providers:

```http
GET /api/providers
```

Refresh all:

```http
POST /api/providers/refresh
```

Refresh one:

```http
POST /api/providers/minimax/refresh
```

Summary:

```http
GET /api/usage/summary
```

Records:

```http
GET /api/usage/records
```

Manual entry:

```http
POST /api/manual/usage
```

## 14. 測試與驗證

WebUI 測試：

```bash
bun run test:webui
```

Build：

```bash
bun run build:webui
```

## 15. 目前限制

- 沒有 multi-user auth
- 沒有 remote dashboard
- 沒有 cloud sync
- 沒有 browser cookie scraping
- 沒有 MiniMax dashboard scraping
- 沒有 Google AI Pro web quota scraping
- MiniMax 尚未做 live API 自動驗證測試
- `ccusage` structured output 依賴 `ccusage` 本身支援的 JSON output

## 16. 建議工作流程

日常使用：

```bash
bun run dev:webui
```

正式一點的本機使用：

```bash
bun run build:webui
bun run start:webui
```

每次要更新資料：

1. 打開 WebUI
2. 到 Dashboard 或 Providers
3. 按 Refresh All 或單一 provider refresh
4. 到 Sessions 檢查 records

## 17. 不要做的事

- 不要在未設定 `OPENUSAGE_WEBUI_ALLOWED_HOSTS` 與主機防火牆的情況下，把 WebUI 綁到 `0.0.0.0`
- 不要把 MiniMax API key 填進 provider settings API
- 不要把 `~/.openusage-webui` 公開上傳
- 不要期待 MiniMax quota 等於 token usage
- 不要把 dev frontend 的 `6737` 當正式入口；主要入口是 `6736`
