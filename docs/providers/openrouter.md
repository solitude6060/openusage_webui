# OpenRouter

Tracks [OpenRouter](https://openrouter.ai) credits and spend for the API key you already use.

## Overview

- **Protocol:** REST (plain JSON, `{ "data": { ... } }` wrapper)
- **URLs:** `https://openrouter.ai/api/v1/credits` and `https://openrouter.ai/api/v1/key`
- **Auth:** API key from a config file or an environment variable
- **Requests:** both endpoints are fetched independently (15 s timeout each), and the card shows whatever succeeds

## Authentication

The first key found wins. Config files are checked before the environment, so a key you edit in the file is not shadowed by an old exported variable.

### Credential Sources (checked in order)

**1. `~/.config/openusage/openrouter.json`**

```json
{ "apiKey": "sk-or-v1-..." }
```

`api_key` and `key` are accepted as field names too. A plain-text file that contains only the key also works. Text containing `{` is rejected, so a half-written JSON file is never sent as a key.

**2. `~/.config/openrouter/key.json`**

Same formats as above.

**3. Environment variable** — `OPENROUTER_API_KEY`, then `OPENROUTER_KEY`

The WebUI server only sees variables from its own environment. When it runs as the systemd service, put the key in `~/.config/openusage/openrouter.json` instead. That file is read on every refresh, so no restart is needed.

The key is sent as `Authorization: Bearer <key>`. It is never logged or shown in the UI.

## Data Source

### GET /api/v1/credits

```
Authorization: Bearer <api_key>
Accept: application/json
```

```json
{ "data": { "total_credits": 277.47, "total_usage": 178.20 } }
```

`total_credits` is the lifetime amount added to the account. `total_usage` is the lifetime spend. Numbers may also arrive as numeric strings.

### GET /api/v1/key

```json
{
  "data": {
    "is_free_tier": false,
    "usage_daily": 0,
    "usage_weekly": 1.25,
    "usage_monthly": 4.5,
    "limit": 5,
    "limit_remaining": 3
  }
}
```

The response also carries a `label` (the key's name). The plugin ignores it.

## Plan Detection

`is_free_tier: true` shows "Free tier". `is_free_tier: false` shows "Pay as you go". Any other value shows no plan.

## Displayed Lines

| Line       | Scope    | Source             | Condition                          | Description                                      |
|------------|----------|--------------------|------------------------------------|--------------------------------------------------|
| Credits    | overview | `/credits`         | `total_credits > 0`                | Spend against credits added (dollars)            |
| Balance    | overview | `/credits`         | `total_usage` is numeric           | Credits left, floored at `$0.00`                 |
| Today      | detail   | `/key`             | `usage_daily` is numeric           | Spend today                                      |
| This Week  | detail   | `/key`             | `usage_weekly` is numeric          | Spend this week                                  |
| This Month | detail   | `/key`             | `usage_monthly` is numeric         | Spend this month                                 |
| Key Limit  | overview | `/key`             | `limit > 0`                        | Per-key spend cap; used = `limit - limit_remaining` |

A free account that never added credits has `total_credits: 0`: it shows Balance `$0.00` and no Credits meter. Key Limit uses `limit_remaining`, which covers the current window, so it stays correct after the cap resets.

## Errors

| Condition                                              | Message                                                                                           |
|--------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| No API key found                                       | "No OpenRouter API key. Set OPENROUTER_API_KEY or add it to ~/.config/openusage/openrouter.json." |
| Both endpoints return 401/403 and no line was produced | "OpenRouter API key invalid. Check your key at openrouter.ai/keys."                               |
| Network error (first failing endpoint)                 | "Couldn't reach OpenRouter. Check your connection."                                               |
| Other non-2xx (first failing endpoint)                 | "OpenRouter request failed (HTTP {status})."                                                      |
| 2xx without a `data` object, or no usable fields       | "OpenRouter usage data unavailable. Try again later."                                             |

One endpoint returning 401/403 while the other works is not an error: OpenRouter limits some endpoints by key type, so the card shows the lines that did come back.
