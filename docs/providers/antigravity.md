# Antigravity

> Reverse-engineered from app bundle and language server binary. May change without notice.

Antigravity is built on Codeium/Windsurf-derived infrastructure and uses the same Codeium language server binary and Connect-RPC protocol. The discovery, port probing, and RPC endpoints are virtually identical to that stack. The key differences: Antigravity uses fraction-based per-model quota (not credits), and doesn't require an API key in the request metadata.

## Overview

- **Vendor:** Google (internal codename "Jetski")
- **Protocol:** Connect RPC v1 (JSON over HTTP) on local language server
- **Service:** `exa.language_server_pb.LanguageServerService`
- **Auth:** CSRF token from app/IDE process args; Google OAuth tokens from SQLite; `agy` token from macOS Keychain
- **Quota:** fraction (0.0–1.0, where 1.0 = 100% remaining)
- **Quota windows:** two shared pools (Gemini; Claude and GPT), each with a rolling 5-hour and a weekly window; eligible Pro accounts also have a separate Gemini 4 Argon weekly window
- **Timestamps:** ISO 8601
- **Requires:** Antigravity app/IDE running, signed-in app/IDE SQLite credentials, or `agy` signed in

## Discovery

The Antigravity app/IDE language server listens on a random localhost port. Three values must be discovered from the running process.

```bash
# 1. Find process and extract CSRF token
ps -ax -o pid=,command= | grep -i '[l]anguage_server.*antigravity'
# Process name: language_server, language_server_macos, or language_server_macos_arm
# Match: --app_data_dir antigravity / antigravity-ide OR path contains /antigravity/
# Extract: --csrf_token <token>
# Extract: --extension_server_port <port>  (HTTP fallback)

# 2. Find listening ports
lsof -nP -iTCP -sTCP:LISTEN -a -p <pid>

# 3. Probe each port to find the Connect-RPC endpoint
POST https://127.0.0.1:<port>/.../GetUnleashData  → first 200 OK wins
```

Port and CSRF token change on every app/IDE restart. The LS may use HTTPS with a self-signed cert.

`agy` can also expose the same local service via an `agy` process. It has listening ports but no CSRF token or Antigravity marker flags, so discovery matches the `agy` executable directly.

## Headers (all local requests)

| Header | Required | Value |
|---|---|---|
| Content-Type | yes | `application/json` |
| Connect-Protocol-Version | yes | `1` |
| x-codeium-csrf-token | yes | `<csrf_token>` (from process args) |

## Endpoints

### GetUserStatus (primary)

Returns plan info and per-model quota for all models (Gemini, Claude, GPT-OSS) in a single call.

```
POST http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus
```

#### Request

```json
{
  "metadata": {
    "ideName": "antigravity",
    "extensionName": "antigravity",
    "ideVersion": "unknown",
    "locale": "en"
  }
}
```

#### Response

```jsonc
{
  "userStatus": {
    "planStatus": {
      "planInfo": {
        "planName": "Pro",                       // "Free" | "Pro" | "Teams" | "Ultra"
        "teamsTier": "TEAMS_TIER_PRO"
      }
    },

    "cascadeModelConfigData": {
      "clientModelConfigs": [
        {
          "label": "Gemini 3 Pro (High)",
          "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M7" },
          "quotaInfo": {
            "remainingFraction": 1,              // 0.0–1.0
            "resetTime": "2026-02-07T14:23:01Z"
          }
        },
        {
          "label": "Claude Sonnet 4.5",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        },
        {
          "label": "Claude Opus 4.5 (Thinking)",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        },
        {
          "label": "GPT-OSS 120B (Medium)",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        }
        // ~7 models total, dynamic
      ]
    }
  }
}
```

### GetCommandModelConfigs (fallback)

Returns model configs with per-model quota only. No plan info, no email. Use when `GetUserStatus` fails.

```
POST http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs
```

#### Request

```json
{
  "metadata": {
    "ideName": "antigravity",
    "extensionName": "antigravity",
    "ideVersion": "unknown",
    "locale": "en"
  }
}
```

#### Response

```jsonc
{
  "clientModelConfigs": [
    // same shape as GetUserStatus.cascadeModelConfigData.clientModelConfigs
  ]
}
```

## Quota Summary (primary)

`RetrieveUserQuotaSummary` reports the windows the Antigravity CLI shows in `/usage`. The plugin asks it before the per-model endpoints, on the local server (`.../LanguageServerService/RetrieveUserQuotaSummary`, body `{ metadata }`, reply wrapped as `{ "response": { "groups": [...] } }`) and on Cloud Code (`POST /v1internal:retrieveUserQuotaSummary`, body `{ "project": "<cloudaicompanionProject>" }`, reply `{ "groups": [...] }`).

```jsonc
{
  "groups": [
    {
      "displayName": "Gemini Models",
      "buckets": [
        { "bucketId": "gemini-weekly", "window": "weekly", "remainingFraction": 0.8, "resetTime": "..." },
        { "bucketId": "gemini-5h", "window": "5h", "remainingFraction": 1, "resetTime": "..." }
      ]
    },
    {
      "displayName": "Claude and GPT models",
      "buckets": [
        { "bucketId": "3p-weekly", "window": "weekly", "remainingFraction": 0.6, "resetTime": "..." },
        { "bucketId": "3p-5h", "window": "5h", "remainingFraction": 1, "resetTime": "..." }
      ]
    }
  ]
}
```

| Line | Bucket |
|---|---|
| Session | `gemini-5h` |
| Weekly | `gemini-weekly` |
| Argon Weekly | the one `window: "weekly"` bucket of the `Gemini 4 Argon` group |
| Claude | `3p-5h` |
| Claude Weekly | `3p-weekly` |

Rules, ported from upstream `robinebers/openusage` (`AntigravityUsageMapper.swift`, main `26132ff4`):

- Shared-pool buckets match the exact ids above; other ids are skipped.
- Argon Weekly needs the exact group name, exactly one weekly bucket with its own id, `disabled` not true, and a finite fraction. Otherwise there is no Argon line.
- A bucket without a finite `remainingFraction` has no line.
- Any reply with `groups` is authoritative. The per-model endpoints are used only when no host returned `groups`, because they read missing quota as fully used.
- Cloud Code is asked on both hosts. On 2026-10-21 production returned an untouched Gemini weekly window while daily returned real use, so the plugin keeps the lower remaining fraction per bucket, with that bucket's reset time. Upstream prefers production instead.
- `loadCodeAssist` is sent with User-Agent `antigravity/2.24.0 (aidev_client; os_type=darwin; arch=amd64)` and body `{ "metadata": { "ideType": "ANTIGRAVITY", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI" } }`. Without them the reply has only `allowedTiers` ("Gemini Code Assist") and no `paidTier`.
- Per-model pooling maps every Gemini model to Session and every other model to Claude. Argon models are skipped there because those replies do not name their pool or period.

Observed on 2026-10-21: all three signed-in Google accounts on this machine received the same `cloudaicompanionProject` (`aicode-consumers`, a shared consumer value) and identical fractions and reset times, with or without the project field. Cause not determined. No account returned a `Gemini 4 Argon` group.

## Available Models

| Display Name | Internal ID | Provider |
|---|---|---|
| Gemini 3 Flash | 1018 | Google |
| Gemini 3 Pro (High) | 1008 | Google |
| Gemini 3 Pro (Low) | 1007 | Google |
| Claude Sonnet 4.5 | 333 | Anthropic (proxied) |
| Claude Sonnet 4.5 (Thinking) | 334 | Anthropic (proxied) |
| Claude Opus 4.6 (Thinking) | MODEL_PLACEHOLDER_M26 | Anthropic (proxied) |
| GPT-OSS 120B (Medium) | 342 | OpenAI (proxied) |

Models are dynamic — the list changes as Google adds/removes them. The plugin reads labels from the response, not a hardcoded list.

Interestingly, non-Google models (Claude, GPT-OSS) are proxied through Codeium/Windsurf infrastructure — Antigravity uses the same language server binary as Windsurf. The `GetUserStatus` response also includes `monthlyPromptCredits`, `monthlyFlowCredits`, and `monthlyFlexCreditPurchaseAmount` fields inherited from the Windsurf credit system, but these appear to be completely irrelevant to Antigravity's quota model which is purely fraction-based per model.

## Local SQLite Database

The Antigravity IDE stores auth credentials in VS Code-compatible state databases.

- **Paths, tried in order:**
  - `~/Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb`
  - `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb`
- **Table:** `ItemTable` (`key` TEXT, `value` TEXT)

### antigravityUnifiedStateSync.oauthToken (sentinel envelope → protobuf)

Google OAuth tokens are stored under this key in a double-wrapped base64 envelope.

Decoding layers:

1. Base64-decode the DB `value` → `outer` bytes.
2. `outer` field 1 (wire type 2) → `wrapper` bytes.
3. Inside `wrapper`: field 1 is the sentinel string `"oauthTokenInfoSentinelKey"`; field 2 is `payload` bytes.
4. Inside `payload`: field 1 (wire type 2) is a **UTF-8 base64 string** (not raw bytes).
5. Base64-decode that string → final `OAuthTokenInfo` protobuf.

```protobuf
message OAuthTokenInfo {
  string access_token = 1;              // "ya29...." Google OAuth access token
  string token_type = 2;                // ignored
  string refresh_token = 3;             // "1//..." Google OAuth refresh token
  Timestamp expiry = 4;                 // field 4, wire type 2
}
message Timestamp {
  int64 seconds = 1;                    // Unix epoch seconds
}
```

The plugin decodes this using a minimal protobuf wire-format parser (varint, length-delimited, fixed32, fixed64). The access token is short-lived; the refresh token is used to obtain new access tokens via Google OAuth.

### Token Refresh

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com
&client_secret=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
&refresh_token=<refresh_token>
&grant_type=refresh_token
```

Response: `{ "access_token": "ya29...", "expires_in": 3599 }`

Same client_id/secret is there in the Antigravity app bundle, used for the Google OAuth refresh token.

## Cloud Code API (fallback)

When the language server is not running, the plugin falls back to Google's Cloud Code API using a Google OAuth access token from the unified-state protobuf, a cached refreshed token, or the `agy` keychain account.

### fetchAvailableModels

```
POST https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
Authorization: Bearer <access_token>
Content-Type: application/json
User-Agent: antigravity
```

Base URLs tried in order:
1. `https://daily-cloudcode-pa.googleapis.com`
2. `https://cloudcode-pa.googleapis.com`

### agy keychain fallback

`agy` stores its auth in the macOS Keychain under service `gemini`, account `antigravity`. OpenUsage reads that exact account only; it does not use legacy Gemini CLI files.

Local multi-home wrappers (for example `agy` / `agy2` via `HOME=~/.agy-homes/<profile>`) keep a private `.gemini` tree. The plugin also reads:

`~/.agy-homes/<profile>/.gemini/antigravity-cli/antigravity-oauth-token`

Detect also includes the default CLI home (`$HOME`, stored as `~`, with `~/.gemini/antigravity-cli/antigravity-oauth-token`) so unwrapped `agy` shows up beside `agy1` / `agy2` overlays. Account labels are just the account slug (for example "Antigravity · acct1"), not the Google email. Each detected home also reports its signed-in email (CLI `id_token`, IDE `antigravityAuthStatus.email`); Detected Homes shows it and notes a home signed in to the same Google account as a tracked one.

`agy` 1.4.x authenticates from the system keyring first (`ChainedAuth: authenticated via keyring` in `cli.log`). On Linux that is the Secret Service, shared by every `HOME`, so a `HOME` overlay does not change which account `agy` runs as; it uses whichever account signed in last. The plugin reads each home's `antigravity-oauth-token` file, so its cards follow the files, not the account `agy` is using. An IDE home counts as signed in only when its `state.vscdb` contains the oauth key `antigravityUnifiedStateSync.oauthToken`. A database file with no oauth key is ignored.

Probes add an **Account** badge when the oauth file has an OIDC `id_token`; the badge text is that token's email. If the file has no `id_token`, the badge is omitted. The card title already shows the home, and the Google email is not used as the account label.

When enabled Antigravity accounts exist and none of them is the default CLI home, Settings shows **Default Antigravity Account Not Tracked** at the top of Provider Accounts, whichever provider is selected. The button adds that home through the existing account API with the label `Antigravity · Local CLI` and selects Antigravity. The manual placeholder for Antigravity is the same label and `~`.

When WebUI Provider Accounts pin a home, that path is injected as `OPENUSAGE_ANTIGRAVITY_CLI_HOME`. IDE config roots use `OPENUSAGE_ANTIGRAVITY_CONFIG_DIR` and only that root’s `state.vscdb`. A home is treated as an IDE config root when it looks like one: it contains `User/globalStorage`, ends with `/Antigravity` or `/Antigravity IDE`, or sits under `Library/Application Support/Antigravity`. Every other path counts as a CLI home, so a manual CLI home that doesn't have an oauth token file yet still gets picked up. Pinned homes skip local language-server discovery and the global keychain so accounts stay isolated.

For `agy`, OpenUsage calls:

1. `POST /v1internal:loadCodeAssist`
2. `POST /v1internal:retrieveUserQuotaSummary` (both hosts)
3. `POST /v1internal:retrieveUserQuota`, only when step 2 returned no `groups`

#### Response

```jsonc
{
  "models": {
    "gemini-3-pro": {
      "displayName": "Gemini 3 Pro",
      "model": "gemini-3-pro",
      "quotaInfo": {
        "remainingFraction": 0.8,          // 0.0–1.0
        "resetTime": "2026-02-08T10:00:00Z"
      }
    }
    // ... more models
  }
}
```

Returns 401/403 if the token is invalid or expired — triggers reactive refresh.

The response includes all models provisioned for the account. The plugin filters out non-user-facing models using three layers: (1) `isInternal: true` flag from the API, (2) empty `displayName` (catches internal autocomplete models like `chat_20706`, `tab_flash_lite_preview`), and (3) a model-ID blacklist (catches Gemini 2.5 variants and placeholders).

The Cloud Code model set is a superset of the LS model set. The LS returns only cascade-configured chat models, Cloud Code includes all provisioned models. This difference is expected.

## Plugin Strategy

1. Probe the Antigravity app/IDE language server (skipped when a multi-account home env is set): `GetUserStatus` for the plan, `RetrieveUserQuotaSummary` for the lines, per-model configs when the summary is absent.
2. Probe the `agy` local language server (skipped when a multi-account home env is set).
3. Read CLI oauth file when `OPENUSAGE_ANTIGRAVITY_CLI_HOME` is set; otherwise read SQLite token candidates from Antigravity state DB paths (or only `OPENUSAGE_ANTIGRAVITY_CONFIG_DIR` when set).
4. Try unexpired SQLite/CLI/cached access tokens: `loadCodeAssist` (plan), then the quota summary on both hosts, then `fetchAvailableModels` only when no host returned a summary. Expired CLI tokens are skipped and refreshed instead of tried.
5. Refresh SQLite/CLI refresh tokens only after auth failure or when no access token exists.
6. Read `agy` keychain token from service `gemini`, account `antigravity` (skipped when a multi-account home env is set), then call `loadCodeAssist`, the quota summary, and `retrieveUserQuota` as a fallback.
7. If all strategies fail: error "Start Antigravity or run `agy` and try again."

### Multi-account homes (WebUI)

Settings → Provider Accounts can detect `~/.agy-homes/*` CLI overlays, the default CLI home, and IDE config dirs that contain the oauth key. Enabled accounts become `antigravity:<slug>` providers with the matching home env injected. The dashboard shows two or more accounts of one provider as columns of one card. The provider selector opens on the first provider that already has an account.