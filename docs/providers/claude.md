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

After each refresh, OpenUsage also runs `ccusage claude blocks --json --session-length 1` with the same `--since` date as the daily query and stores the one-hour totals in a separate `token_hourly` table that only the Allowance page reads. Blocks have no per-model split, so these rows use the model name `All Models`. For each completed local day, new hourly rows are written only when their sum equals the day's daily `totalTokens`. A day with daily tokens but no usable block counts as a mismatch. A mismatch is logged and nothing is written for that day: hourly rows already stored for it stay and Allowance keeps reading them, and a day with no stored hourly rows keeps using its daily rows. Today (the day still in progress) is written without the check. Days whose Claude logs are already deleted have no blocks and keep their daily rows. A failed blocks call is logged and does not fail the refresh.

Local `ccusage` data can also include Fable model rows such as `claude-fable-5`, but OpenUsage does not infer remaining Fable weekly quota from local logs. If the live usage API does not return a separate Fable weekly quota window, the dashboard does not show a Fable weekly line.

### Dollar credits

A top-level object with a numeric `limit_dollars` becomes a dollar progress line. `used_dollars` is the used amount, or 0 when it is missing. `resets_at` is the reset time. These amounts are already dollars, not cents.

The label is the object's `label`. If that text is missing, `cinder_cove` is shown as "Claude Code And Cowork Credit" and `iguana_necktie` as "Cloud Credit" (a name chosen by the owner; Claude Code 2.1.303 does not label this key). Any other key is shown as "Credit". When two lines would share a label, the later one is named with a suffix, such as "Credit 2". A blank label is treated as missing. `extra_usage` and `spend` are skipped. `extra_usage` stays the separate cents row above. A limit that is not above zero is omitted, because a progress line needs a positive limit.

### Rate limit resets

OpenUsage also sends:

```text
GET {baseApiUrl}/api/oauth/usage?cedar_ember=1&skip_spend=1
```

Headers match the usage request, except `User-Agent` is `claude-cli/2.1.303 (external, cli)`. With the usage request's older user agent, Anthropic can answer `eligible: false` and `ineligible_reason: "surface"`.

The `cedar_ember` object holds the grants. If that key is absent and the body itself has `eligible` or `grants`, that body is the block. OpenUsage adds up each grant's `resets_left` and shows `N available`. If any grant has `ends_at`, the text includes the soonest deadline in UTC, for example `1 available · by Oct 22`. This row is text. The host does not keep a separate reset time on a text line.

`eligible: false` with no grants shows `0 available`. The row shows `No data` when the block is missing, or when any grant lacks a string `id` or a numeric `resets_left`. One bad grant rejects the whole block.

The same access token is checked at most once an hour. OpenUsage saves the last result in its plugin data folder, so a later refresh can reuse it instead of asking again. The access token is not written there. A failed request keeps the previous text and is logged. If there was no previous text, the row is left off until a later check succeeds. Switching to another access token starts its own check.

The row is display only. OpenUsage never sends the claim that spends a grant.

### Plan badge

After a usage fetch succeeds, OpenUsage calls `GET {baseApiUrl}/api/oauth/profile` once for that access token. The badge is saved with the reset check above, so a later refresh reuses it. The badge reads `organization.rate_limit_tier`. For example, `default_claude_max_20x` is shown as "Max 20x". If the profile cannot be read, the badge stays on the plan saved with the Claude login.

Grant ids, organization ids, email addresses, and `event_props` are not copied onto the card.

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
A successful refresh with configured Claude accounts clears stored Claude-family Pi
records for the scanned usage days in the snapshot's storage transaction. This refresh
cleanup preserves other days, sources, provider families, and ccusage records.
Unreadable session files or subdirectories are skipped; other files still contribute.
Errors log only an error code, without file contents or paths.
Files modified before the 30-day cutoff are skipped before message-ID deduplication.

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
