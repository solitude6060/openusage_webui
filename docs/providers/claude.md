# Claude Code

> Reverse-engineered, undocumented API. May change without notice.

## Overview

- **Protocol:** REST (plain JSON)
- **Base URL:** `https://api.anthropic.com`
- **Auth provider:** `platform.claude.com` (OAuth 2.0)
- **Client ID:** `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- **Beta header required:** `anthropic-beta: oauth-2025-04-20`
- **Utilization:** integer percentage (0-100)
- **Credits:** cents (divide by 100 for dollars)
- **Timestamps:** ISO 8601 (response), unix milliseconds (credentials file)

## Endpoints

### GET /api/oauth/usage

Returns rate limit windows and optional extra credits.

#### Headers

| Header | Required | Value |
|---|---|---|
| Authorization | yes | `Bearer <access_token>` |
| Accept | yes | `application/json` |
| Content-Type | yes | `application/json` |
| anthropic-beta | yes | `oauth-2025-04-20` |

#### Response

```jsonc
{
  "five_hour": {
    "utilization": 25,              // % used in 5h rolling window
    "resets_at": "2026-01-28T15:00:00Z"
  },
  "seven_day": {
    "utilization": 40,              // % used in 7-day window
    "resets_at": "2026-02-01T00:00:00Z"
  },
  "seven_day_opus": {               // separate weekly Opus limit (optional, plan-dependent)
    "utilization": 0,
    "resets_at": "2026-02-01T00:00:00Z"
  },
  "seven_day_omelette": {           // separate weekly Claude Design limit (optional, plan-dependent)
    "utilization": 0,
    "resets_at": "2026-02-01T00:00:00Z"
  },
  "seven_day_fable": {              // separate weekly Fable limit (optional, older responses)
    "utilization": 0,
    "resets_at": "2026-02-01T00:00:00Z"
  },
  "limits": [                       // current weekly model windows (optional)
    {
      "kind": "weekly_scoped",
      "group": "weekly",
      "percent": 44,                // % used
      "resets_at": "2026-02-01T00:00:00Z",
      "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null }
    }
  ],
  "extra_usage": {                  // on-demand overage credits (optional)
    "is_enabled": true,
    "used_credits": 500,            // cents spent
    "monthly_limit": 10000,         // cents cap (0 = unlimited)
    "currency": "USD"
  }
}
```

All windows are enforced simultaneously — hitting any limit throttles the user.

OpenUsage also accepts `seven_day_falbe`, `weekly_fable`, `weekly_falbe`, `fable`, and `falbe` as aliases for the Fable weekly window because the API is undocumented and field names can vary. If Claude returns the Fable weekly window nested under another object, OpenUsage looks for Fable/Falbe usage windows recursively.

Current responses put model weekly windows in `limits[]` instead of `seven_day_fable`. Each entry with `kind: "weekly_scoped"` and a model `display_name` becomes a `<display_name> Weekly` percent line (for example `Fable Weekly`), using `percent` as the used amount and `resets_at` as the reset time. Older `seven_day_*` keys are still read. If both shapes describe the same model, OpenUsage keeps the legacy line and does not add a second one. `Sonnet` and `Sonnet Weekly` are the same quota, and so are `Claude Design` and `Claude Design Weekly`.

Local `ccusage` data can also include Fable model rows such as `claude-fable-5`, but OpenUsage does not infer remaining Fable weekly quota from local logs. If the live usage API does not return a separate Fable weekly quota window, the dashboard does not show a Fable weekly line.

## Authentication

### Token Location

On macOS, OpenUsage reads Claude Code credentials from Keychain first. The default service name is:

```text
Claude Code-credentials
```

When `CLAUDE_CONFIG_DIR` is set, Claude Code may use a config-specific service name instead. OpenUsage checks this hashed name before the default service:

```text
Claude Code-credentials-<sha256(CLAUDE_CONFIG_DIR).slice(0, 8)>
```

Keychain values use the same JSON structure as the legacy credentials file:

```jsonc
{
  "claudeAiOauth": {
    "accessToken": "<jwt>",          // OAuth access token (Bearer)
    "refreshToken": "<token>",
    "expiresAt": 1738300000000,      // unix ms
    "scopes": ["..."],
    "subscriptionType": "pro",
    "rateLimitTier": "..."
  }
}
```

**Fallback:** `~/.claude/.credentials.json`. This file can be left behind by older Claude Code versions, so it is treated as a fallback when Keychain does not contain usable credentials.

## WebUI Adapter Notes

The Linux WebUI runs the original `plugins/claude/plugin.js` through a local host adapter instead of rewriting the provider logic.

Because Linux WebUI does not use the macOS keychain, the adapter relies on the file credential path:

1. `CLAUDE_CONFIG_DIR/.credentials.json` when `CLAUDE_CONFIG_DIR` is set
2. `~/.claude/.credentials.json`

### Multiple Claude Homes (WebUI)

Use Settings → Provider Accounts, choose **Claude Code**, then detect or add homes. Configured accounts become `claude-code:<slug>` providers with `CLAUDE_CONFIG_DIR` set to that home. Detect looks for `~/.claude` and process `CLAUDE_CONFIG_DIR` when `.credentials.json` is present.

### Usage From Pi

Configuring Claude accounts removes previously stored default Claude Pi records.
Native ccusage records are preserved.
Each refresh checks the current Pi ownership rule using the configured accounts.

After a successful WebUI Claude refresh, Pi assistant messages with provider `anthropic`
or `claude-agent-sdk` add usage to the default Claude provider when no Claude accounts
are configured. Configured Claude homes do not receive unattributed Pi usage; a warning
is logged once. Pi has no separate card.

The scanner recursively reads `*.jsonl` from `PI_CODING_AGENT_SESSION_DIR`, else
`PI_CODING_AGENT_DIR/sessions`, else `~/.pi/agent/sessions`. It starts at local midnight
30 days ago, keeps the first occurrence of each message ID, and groups reported tokens
by local day and model. Other Pi providers are excluded.

`Pi Session` records add to Tokens, Allowance, and cost summaries alongside ccusage.
Positive Pi costs are preserved. Zero/missing costs remain unknown because the WebUI
has no Claude fallback rate table; tokens remain available. A model-day containing any
unpriced message retains unknown cost. The scanner only reads files and stores no
message content or credentials. Scan errors are logged without discarding the successful
quota snapshot.

The original plugin may refresh OAuth tokens and write the updated credential JSON back to the same file source. Browser cookies are not used.

### Token Refresh

Access tokens are short-lived JWTs. Refreshed proactively 5 minutes before expiration, or reactively on 401/403.

```
POST https://platform.claude.com/v1/oauth/token
Content-Type: application/json
```

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "<refresh_token>",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
}
```

```jsonc
{
  "access_token": "<new_jwt>",
  "refresh_token": "<new_refresh_token>",  // may be same as previous
  "expires_in": 3600                       // seconds
}
```
