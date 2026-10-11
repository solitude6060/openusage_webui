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
- Antigravity via 原本 OpenUsage plugin adapter（可選 **Provider Accounts** 追蹤多個 CLI／IDE 家目錄，含 `~/.agy-homes/*` 與預設本機 CLI 家目錄 `~`）
- Claude Code via 原本 OpenUsage plugin adapter（可選 **Provider Accounts** 追蹤多個 `CLAUDE_CONFIG_DIR`）
- Codex CLI via 原本 OpenUsage plugin adapter（可選 **Provider Accounts** 追蹤多個 `CODEX_HOME`）
- Cursor via 原本 OpenUsage plugin adapter（可選 **Provider Accounts** 追蹤多個 Cursor 設定目錄）
- Devin via 原本 OpenUsage plugin adapter
- Factory / Droid via 原本 OpenUsage plugin adapter
- Grok Build via 原本 OpenUsage plugin adapter — 週配額、方案名稱、pay-as-you-go 上限，以及花費磁磚與 Tokens 頁共用的 Grok CLI 本機完成回合紀錄（`~/.grok/sessions/**/updates.jsonl`）
- GitHub Copilot via 原本 OpenUsage plugin adapter
- JetBrains AI Assistant via 原本 OpenUsage plugin adapter
- Kimi via 原本 OpenUsage plugin adapter
- Kiro via 原本 OpenUsage plugin adapter
- Ollama via 原本 OpenUsage plugin adapter — Ollama Cloud 的額度與限制，使用 `~/.ollama/id_ed25519` 簽章；預設停用，請到 **Providers** 頁自行啟用（見 `docs/providers/ollama.md`）
- OpenCode Go via 原本 OpenUsage plugin adapter
- OpenRouter via 由上游 Swift provider 移植的 OpenUsage plugin adapter — credits、餘額、期間花費、key 上限；API key 讀自 `~/.config/openusage/openrouter.json` 或 `OPENROUTER_API_KEY`
- Perplexity via 原本 OpenUsage plugin adapter
- Synthetic via 原本 OpenUsage plugin adapter
- Z.ai via 原本 OpenUsage plugin adapter
- Gemini CLI / Google AI Pro coding usage via `ccusage`
- MiniMax Token Plan remains API key 查詢
- 手動 usage entries
- Tokens 頁可依時間區間切換 Provider → Model 與 Model → Provider，父層以 M／B 顯示，
  展開後顯示完整數值；Claude／Codex 本機用量、Cursor 完整 usage events，以及 Grok Build
  CLI 本機完成回合紀錄會在 refresh 後自動寫入。Cursor 帳單裡的 Grok 仍掛在 Cursor 底下。

Pi 的本機用量會併入既有 Claude／Codex，沒有獨立的 provider 卡片。

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

### 常駐服務改用獨立 worktree

server 會服務自己 checkout 內的 `apps/web/dist`，也從同一個 checkout 載入 `plugins/`。如果常駐
server 和開發共用同一個 checkout，在開發分支跑 `bun run build:webui` 會直接換掉正在服務的
frontend，但執行中的 server 程序仍是舊的 API，畫面可能因此讀不到資料。常駐 server 請改從一個
追蹤 `main` 的獨立 worktree 執行：

```bash
git worktree add --detach ../openusage_webui-wt-live origin/main
cd ../openusage_webui-wt-live
bun install --frozen-lockfile
bun run build:webui
```

服務指向該 worktree，例如 systemd user unit：

```ini
WorkingDirectory=/path/to/openusage_webui-wt-live/apps/server
ExecStart=/path/to/bun src/index.ts
```

資料庫與設定仍在 `~/.openusage-webui/`（或 `OPENUSAGE_WEBUI_DIR`），搬移服務不會搬移資料。
merge 之後部署：

```bash
cd ../openusage_webui-wt-live
git fetch origin && git checkout --detach origin/main
bun install --frozen-lockfile && bun run build:webui
systemctl --user restart openusage-webui.service
```

## Tailscale 連線

預設只開本機。若要讓 Tailscale 裝置連進來，需要同時設定綁定位址與 `Host` header 允許清單：

```bash
OPENUSAGE_WEBUI_HOST=0.0.0.0 \
OPENUSAGE_WEBUI_ALLOWED_HOSTS=<tailscale-ip>,<magic-dns-name> \
bun run start:webui
```

`OPENUSAGE_WEBUI_ALLOWED_HOSTS` 可填逗號分隔的主機名稱或 IP 位址；`127.0.0.1`、`localhost`、`[::1]` 會自動允許。若所在區域網路不可信，綁定 `0.0.0.0` 時仍應搭配主機防火牆，只允許 Tailscale 介面連入 `6736`。

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

如果 `ccusage` 支援 JSON output，WebUI 會 normalize 成 usage records。如果只有非 JSON output，WebUI 會保留 raw fallback record，不做脆弱的表格 parsing。Claude／Codex plugin refresh 失敗時會保留本機 ccusage token totals；成功時會移除重疊的 token totals。

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

多個 Codex 家目錄若解析到同一個 `sessions` 目錄，Tokens 頁只保留該目錄本體那個帳號的用量。配額卡仍依各帳號分開顯示。Allowance 改讀 session 事件：至少一天的 Session 或 Weekly 窗口、而且沒有更短 Session 的帳號，和同時有 5 小時 Session 與 Weekly 窗口的帳號，各自計算自己的用量。先前存成 7 天 Session 的讀數也看成 Weekly，所以它和 5 小時 Session 一起時，用量歸到 5 小時那個帳號。`sessions` 目錄是連結的帳號只要有事件也會換算，而且不會把另一個帳號的 token 算進來。同一天只要這組裡任何一個帳號有事件，那天的合併 ccusage 每日列就不進入 Allowance。事件屬於它自己時間的本地日。

原本 plugin 可能會 refresh OAuth token，並把更新後的 credential 寫回同一個檔案來源。WebUI 不使用 browser cookies。

Allowance 在有每小時 token 資料時（Claude、Cursor、Grok，以及有 Codex session 事件的日子）對齊到整點，沒有那些事件的日子仍對齊到日界。每小時資料另外存放，只有 Allowance 讀取；Tokens、Sessions、Dashboard 的合計仍用每日紀錄。Claude 卡片上，以及以 Codex session 事件測量的日子，只列一行 `All Models`，不分模型。

Allowance 頁的 Subscription Period 列出最近 120 天的每一次重設週期。Codex 以前存成 7 天 Session 的讀數，會和較新的 Weekly 讀數放在同一個系列。基準是最近四個納入的週期的中位數，只用完整落在各週期內的用量，並標出最低、最高，以及這個中位數用了幾個週期；token 與記下的 API 金額各一組。目前這個週期顯示最新的額度讀數、完整落在週期內的 token 與 API 金額、對照這個中位數還剩多少，以及推估的結束百分比。Unreliable 表示這個週期還不滿一天、目前週期的額度表中途下降，或最近四個週期裡有一個比原本的重設時間早超過一小時結束。週期中途額度表往下掉、session 紀錄與另一個帳號共用且這個帳號沒有自己的 session 事件、週期起點早於這次載入的紀錄、沒有 token、結束時低於 10%、跨過邊界的用量超過週期內用量的 25%，或結束前最後一天沒有讀數時，該週期不進入基準。完整落在週期裡的用量是較低的數字。跨過任一邊界的用量只加進較高的數字。API 金額只有一側有值時，另一側顯示 Unknown。沒有進行中的週期、也沒有納入的週期時，這個帳號不列出。每一筆讀數都是 0% 時也不列出，除非目前這個週期已經有記下的 token。

### Pi 的用量

Pi 歸屬切換時，同一天的 Pi 紀錄會移到新帳號。設定 Claude 帳號後，會移除原本預設
Claude provider 的 Pi 紀錄；兩種情況都保留 ccusage 紀錄。
若 Codex 沒有符合 Pi 登入的帳號，或已設定 Claude 帳號而無法歸屬 Pi 用量，下次成功
更新會清除該 provider 群組在掃描日期的既有 Pi 紀錄。其他日期、來源、provider 群組
與 ccusage 紀錄均保留。
每次更新都會重新判斷 Pi 歸屬；Pi 或 Codex 登入切換在下次更新生效，無須重啟伺服器。
無法讀取的 session 檔案或子目錄會個別略過，其餘檔案繼續計入。日誌只記錄錯誤代碼，
不包含檔案內容或路徑。
修改時間早於 30 天截止日的檔案會整份略過，其訊息 ID 不參與去重。

Claude 或 Codex 更新成功後，WebUI 會讀取最近 30 天的 Pi assistant 用量，起點為當地午夜。
目錄依序使用 `PI_CODING_AGENT_SESSION_DIR`、`PI_CODING_AGENT_DIR/sessions`、
`~/.pi/agent/sessions`。只納入 `anthropic`、`claude-agent-sdk`、`openai-codex`；重複的訊息 ID 只計一次。

用量以 `Pi Session` 紀錄加入 Tokens、Allowance 與費用摘要，和 ccusage 分別保存。
每日合計使用這台電腦的本地日，優先採用 Pi 記下的大於零費用；Codex 缺少費用時使用既有標準單價。
無法定價的紀錄保留 token，費用保持未知。`codex-auto-review` 自 2026-10-06 UTC 起費用為零。

只有一個 Codex provider 時，由它接收 Pi 用量。設定多個 Codex 家目錄時，只有
`auth.json` 的 `tokens.account_id` 與 Pi `openai-codex` OAuth 登入的 `accountId`
相同者接收。Pi 登入檔來自 `PI_CODING_AGENT_DIR/auth.json`，預設為 `~/.pi/agent/auth.json`。
停用帳號的用量不會移交給其他帳號。Claude 只在沒有設定 Claude 帳號時，由預設 provider 接收。
沒有符合帳號或掃描失敗時會記錄錯誤，已取得的配額快照仍保留。掃描器只讀檔案，不匯入或更新
Pi 憑證，也不儲存訊息內容。

## Grok Build 設定

Grok Build 沿用原本 OpenUsage 的 `plugins/grok/plugin.js`。先執行 `grok login`。WebUI 會讀 `~/.grok/auth.json`（依 process `HOME` 展開）。`$GROK_HOME` 只用在 session 完成回合紀錄，不會改 `auth.json` 路徑。

儀表板的週配額與 pay-as-you-go 來自 Grok CLI billing API。Grok refresh 成功後，卡片上的 Today／Yesterday／Last 30 Days 與 Tokens 頁共用 `~/.grok/sessions/**/updates.jsonl` 裡已完成的回合（`turn_completed`／`modelUsage`），不再使用有容量上限的 `unified.jsonl` debug log。花費使用 CLI 記錄的費用；沒有費用的回合仍計入 token，費用加總為 $0。整個期間都沒有費用紀錄時，只顯示 token；沒有 token 時省略該期間。token 為輸入加輸出，不重複加上 reasoning。Today／Yesterday 使用伺服器本地日，Last 30 Days 涵蓋更新當下往前 30 × 24 小時，Tokens 頁的 Grok 每日用量仍維持 UTC 日。複製的 session 依 `eventId` 與 model 各算一次；子 session、resume、fork 都會列入。Cursor 帳單裡的 Grok 仍掛在 Cursor 底下。

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
- 只有明確設定 `OPENUSAGE_WEBUI_HOST` 和 `OPENUSAGE_WEBUI_ALLOWED_HOSTS` 時，才開放指定的 Tailscale 主機名稱或 IP 位址
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
