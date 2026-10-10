# Grok Build

Tracks Grok Build credit usage from the local Grok CLI login.

> Reverse-engineered, undocumented API. May change without notice.

## Overview

- **Protocol:** REST (plain JSON)
- **Base URL:** `https://cli-chat-proxy.grok.com/v1`
- **Auth:** cached Grok CLI token from `~/.grok/auth.json`
- **Refresh:** Grok CLI refresh token from the same file
- **Usage:** weekly shared pool percent from the CLI credits response
- **Local spend tiles (WebUI):** Today / Yesterday / Last 30 Days from Grok CLI session transcripts, using recorded cost
- **Tokens page:** daily per-model totals from Grok CLI session transcripts under `~/.grok/sessions/**/updates.jsonl`
- **Plan source:** `GET /settings` (`subscription_tier_display`)
- **Reset period:** current weekly period from the credits response

This is the Grok Build CLI provider. SuperGrok and other unified-billing accounts use a weekly shared pool. The older monthly credits meter is no longer shown. Cursor-billed Grok usage stays under Cursor.

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

Today, Yesterday, and Last 30 Days on the WebUI dashboard card come from completed turns in `~/.grok/sessions/**/updates.jsonl`, or `$GROK_HOME/sessions/**/updates.jsonl` when that environment variable is set. Costs use the CLI's recorded cost. Turns without a recorded cost contribute tokens and $0; a period with no recorded costs shows tokens only. No model price estimate is added. These totals are separate from the weekly pool and do not include Cursor-billed Grok usage.

The card and Tokens page use the same completed turns during a Grok refresh. Each `turn_completed` row contributes per-model `inputTokens` and `outputTokens`. `reasoningTokens` are already inside `outputTokens` and are not added again. Copied session transcripts count once per `eventId` and model. Child, resumed, and forked sessions are included. A missing or unreadable session directory does not fail the weekly refresh.

A card period with no tokens is omitted. Today and Yesterday use the server's local time zone; Last 30 Days covers the rolling 30 × 24 hours ending at refresh time. Grok rows on the Tokens page keep UTC days, so totals can differ at day boundaries. The capped `unified.jsonl` debug log is not used.

These spend tiles are available in the WebUI. The Tauri desktop app shows the weekly pool and pay-as-you-go status without Grok spend tiles.

## Displayed Lines

| Line | Description |
|------|-------------|
| Weekly | Percent of the shared weekly pool used |
| Today / Yesterday / Last 30 Days | WebUI session tokens and recorded cost; tokens only when no costs are recorded |
| Pay as you go | Disabled, or the configured pay-as-you-go cap |

The Tokens page lists this provider as **Grok Build**. Its token totals come from session transcripts, not from the weekly pool and not from Cursor.

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
