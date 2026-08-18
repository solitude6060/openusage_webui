# Grok

Tracks Grok subscription usage from the local Grok CLI login.

> Reverse-engineered, undocumented API. May change without notice.

## Overview

- **Protocol:** REST (plain JSON)
- **Base URL:** `https://cli-chat-proxy.grok.com/v1`
- **Auth:** cached Grok CLI token from `~/.grok/auth.json`
- **Refresh:** Grok CLI refresh token from the same file
- **Usage:** weekly shared pool percent from the CLI credits response
- **Local spend:** Today / Yesterday / Last 30 Days from `~/.grok/logs/unified.jsonl`
- **Plan source:** `GET /settings` (`subscription_tier_display`)
- **Reset period:** current weekly period from the credits response

SuperGrok and other unified-billing accounts use a weekly shared pool. The older monthly credits meter is no longer shown.

## Setup

1. Install and sign in to the Grok CLI:

```bash
grok login
```

2. Enable the Grok plugin in OpenUsage settings.

OpenUsage reads the same local auth file that the Grok CLI uses. Access tokens are refreshed automatically before expiry when a `refresh_token` is present. If refresh fails, run `grok login` again.

## Endpoint

### GET /billing?format=credits

Returns the current weekly pool, reset window, and pay-as-you-go cap. This is the same call the Grok CLI makes.

#### Headers

| Header | Required | Value |
|--------|----------|-------|
| Authorization | yes | `Bearer <token from ~/.grok/auth.json>` |
| X-XAI-Token-Auth | yes | `xai-grok-cli` |
| Accept | yes | `application/json` |

#### Response

```json
{
  "config": {
    "creditUsagePercent": 45,
    "currentPeriod": {
      "type": "USAGE_PERIOD_TYPE_WEEKLY",
      "start": "2026-08-16T17:26:56.286320+00:00",
      "end": "2026-08-23T17:26:56.286320+00:00"
    },
    "onDemandCap": { "val": 0 },
    "isUnifiedBillingUser": true
  }
}
```

Zero values may be omitted. A missing `creditUsagePercent` means 0%. A missing `onDemandCap`, or `onDemandCap` as `{}`, means pay-as-you-go is disabled.

Used fields:

- `creditUsagePercent` — weekly shared pool used, 0–100
- `currentPeriod.type` — `USAGE_PERIOD_TYPE_WEEKLY` shows the Weekly line
- `currentPeriod.start` / `currentPeriod.end` — weekly window and reset time
- `onDemandCap.val` — pay-as-you-go cap; omitted, `{}`, or `0` means disabled

Accounts that still report a non-weekly period have no Weekly line. Pay as you go and the plan name still appear.

### GET /settings

Returns remote CLI settings. OpenUsage reads `subscription_tier_display` from this response and shows it as the provider plan label, for example `SuperGrok Heavy`.

## Local Spend

Today, Yesterday, and Last 30 Days come from the Grok CLI log at `~/.grok/logs/unified.jsonl`, or `$GROK_HOME/logs/unified.jsonl` when that environment variable is set. Each `shell.turn.inference_done` row is attributed to that process's current model, then priced at public xAI API rates. These dollars are local estimates. They are not the weekly pool and they do not include Cursor-billed Grok usage.

A period with no priced token rows is omitted, rather than shown as `$0.00 · 0 tokens`. Older CLI versions that never logged token counts stay blank until a Grok CLI session writes `inference_done` rows. A missing or unreadable log does not fail the weekly refresh.

## Displayed Lines

| Line | Description |
|------|-------------|
| Weekly | Percent of the shared weekly pool used |
| Today / Yesterday / Last 30 Days | Local cost and tokens estimated from the Grok CLI log |
| Pay as you go | Disabled, or the configured pay-as-you-go cap |

## Errors

| Condition | Message |
|-----------|---------|
| Missing auth file | "Grok not logged in. Run `grok login`." |
| Expired token with no refresh token | "Grok auth expired. Run `grok login` again." |
| Refresh token rejected | "Grok auth expired. Run `grok login` again." |
| 401/403 after retry | "Grok auth expired. Run `grok login` again." |
| HTTP error | "Grok billing request failed (HTTP {status}). Try again later." |
| Network error | "Grok billing request failed. Check your connection." |
| Invalid response | "Grok billing response changed." |
