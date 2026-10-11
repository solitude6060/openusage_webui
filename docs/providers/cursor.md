# Cursor

> Reverse-engineered, undocumented API. May change without notice.

## Overview

- **Protocol:** Connect RPC v1 (JSON over HTTP)
- **Base URL:** `https://api2.cursor.sh`
- **Service:** `aiserver.v1.DashboardService`
- **Auth provider:** Auth0 (via Cursor)
- **Client ID:** `KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB`
- **Amounts:** cents (divide by 100 for dollars)
- **Timestamps:** unix milliseconds (as strings)

## Plugin metrics

| Metric | Source field | Scope | Format | Notes |
|---|---|---|---|---|
| Credits | `GetCreditGrantsBalance` + `/api/auth/stripe.customerBalance` | overview | dollars | Combined total: active grant total + Stripe prepaid balance (negative `customerBalance`). Used stays based on grant usage. |
| Total usage | `planUsage.totalPercentUsed` | overview | percent (individual) / dollars (team) | Individual accounts use Cursor's combined pool percent. Spend divided by `limit` is Included Spend, a separate reading. Falls back to computed `(limit - remaining) / limit * 100` only when `totalPercentUsed` is not finite. Free/individual payloads observed on 2026-03-06 may omit `limit`; plugin uses `totalPercentUsed` directly in that case. Team accounts use dollars format and still require `limit`. |
| Included Spend | `planUsage.includedSpend` and `planUsage.limit` | overview | dollars | Individual accounts with a `limit`. Numerator is finite `includedSpend`, otherwise `limit - remaining`. Shown as `$X.XX of $Y.YY`. Total usage `usedValue` still prefers `totalSpend`. This dollar amount can differ from Total usage, Auto usage, and API usage. |
| Auto usage | `planUsage.autoPercentUsed` | overview | percent | Cursor Models pool (Cursor's own models, including Grok and Composer). Omitted when the field is missing or non-finite. `limit` is the Included Spend denominator. |
| API usage | `planUsage.apiPercentUsed` | overview | percent | Other Models pool (third-party models). Omitted when the field is missing or non-finite. `limit` is the Included Spend denominator. |
| Requests | `/api/usage` (enterprise) | overview | count | Enterprise accounts only; unchanged from previous behavior |
| On-demand | `spendLimitUsage` | detail | dollars | Only when individual or pooled limit > 0 |
| Last 7 Days | `get-filtered-usage-events` | detail | text | Soft-fail. Sum of event API price + call count + tokens for the last 7 days, followed by top models. Kept in detail with model rows (not promoted to the card summary). |
| Last 7 Days Cost | `get-filtered-usage-events` | detail | barChart | Soft-fail. Daily API price (USD) bars for the last 7 days. Uses theme ink color (no hardcoded black). |
| Last 7 Days Tokens | `get-filtered-usage-events` | detail | barChart | Soft-fail. Daily token bars when events include `tokenUsage`. |
| Billing Cycle | `get-filtered-usage-events` | detail | text | Soft-fail. Same aggregation for the current billing cycle when the cycle starts earlier than 7 days. |
| Billing Cycle Cost / Tokens | `get-filtered-usage-events` | detail | barChart | Soft-fail. Daily cost and token charts for the billing cycle window when shown. |
| Per-model rows | `usageEventsDisplay[].model` | detail | text | Top models by cost within each window (`$X.XX · N calls · tokens`). |
| Events Note | `get-filtered-usage-events` | detail | text | Soft-fail. Shown when the sample is truncated by the page cap or stopped mid-fetch. |

**Enterprise flow** remains request-based via the REST `/api/usage` endpoint -- unchanged.

**Team detection**: an account is treated as "team" when `planName` is `"Team"`, or `spendLimitUsage.limitType` is `"team"`, or `spendLimitUsage.pooledLimit` is greater than `0`. Team accounts display Total usage in dollars; individual accounts display it as a percentage. When `planUsage.limit` is present, that dollar limit is stored with the quota observation. The Allowance page shows a Cursor dollar limit as Included Dollar Limit next to the token estimate, and notes that on individual plans the percent is Cursor's combined pool percent, whose denominator differs from that dollar limit. Event prices (`chargedCents`, otherwise `tokenUsage.totalCents`) are stored on the daily token rows. The same events are also grouped by UTC hour into a separate `token_hourly` table that only the Allowance page reads, so its measured span can start and end at hour boundaries. Allowance scales that recorded API price by the Total usage percent and shows it as API Value.

## What The Percent Means

Cursor reports pool percents and an included dollar amount for the same billing cycle. The readings use different denominators.

- **Auto usage** is `autoPercentUsed`, the Cursor Models pool (Cursor's own models, including Grok and Composer).
- **API usage** is `apiPercentUsed`, the Other Models pool (third-party models at their API price).
- **Total usage** on an individual account is `totalPercentUsed`, Cursor's combined pool percent. Upstream OpenUsage uses this structured percentage for Total Usage when Cursor supplies it.
- **Included Spend** is the dollar amount. `limit` is the plan's included dollar amount, in cents. The numerator is finite `includedSpend`; otherwise it is `limit - remaining`. `totalSpend` adds bonus and stays on Total usage `usedValue`. Cursor's sentence "You've used N% of your included usage" uses included spend divided by `limit`.

Cursor staff wrote on 2026-08-13 that `totalPercentUsed`, `autoPercentUsed`, and `apiPercentUsed` follow an internal metric of their own, and that the usage sentence uses `includedSpend / limit`. Current Cursor docs describe the two monthly pools and show each as a percentage on the Spending tab. Upstream OpenUsage treats the included dollar amount as the older cap, used when the pool percents are absent.

A local quotas read on 2026-10-11 returned four different figures for Total usage, Auto usage, API usage, and included spend divided by `limit`. The quotas payload has no per-pool dollar size, so the weights inside `totalPercentUsed` stay uncalculated here.

Allowance continues to scale tokens and API dollars by the Total usage percent. On that page the Cursor dollar limit is labeled Included Dollar Limit and remains `planUsage.limit`.

## Endpoints

### POST /aiserver.v1.DashboardService/GetCurrentPeriodUsage

Returns current billing cycle spend, limits, and percentage used.

#### Headers

| Header | Required | Value |
|---|---|---|
| Authorization | yes | `Bearer <access_token>` |
| Content-Type | yes | `application/json` |
| Connect-Protocol-Version | yes | `1` |

#### Request

```json
{}
```

#### Response

```jsonc
{
  "billingCycleStart": "1768399334000",   // unix ms (string)
  "billingCycleEnd": "1771077734000",
  "planUsage": {
    "totalSpend": 23222,                  // cents — includedSpend + bonusSpend
    "includedSpend": 23222,               // cents — counted against plan limit
    "bonusSpend": 0,                      // cents — free credits from model providers
    "remaining": 16778,                   // cents — limit minus includedSpend
    "limit": 40000,                       // cents — plan included amount
    "remainingBonus": false,              // true when bonus credits still available
    "bonusTooltip": "...",
    "autoPercentUsed": 0,                 // Cursor Models pool %
    "apiPercentUsed": 46.444,             // Other Models pool %
    "totalPercentUsed": 15.48             // combined pool %; not totalSpend / limit
  },
  "spendLimitUsage": {                    // on-demand budget (after plan exhausted)
    "totalSpend": 0,                      // cents
    "pooledLimit": 50000,                 // cents — team pool (team plans only, optional)
    "pooledUsed": 0,
    "pooledRemaining": 50000,
    "individualLimit": 10000,             // cents — per-user cap
    "individualUsed": 0,
    "individualRemaining": 10000,
    "limitType": "user"                   // "user" | "team"
  },
  "displayThreshold": 200,               // basis points
  "enabled": true,
  "displayMessage": "You've used 46% of your usage limit",
  "autoModelSelectedDisplayMessage": "...",
  "namedModelSelectedDisplayMessage": "..."
}
```

### POST /aiserver.v1.DashboardService/GetPlanInfo

Returns plan name, price, and included amount.

#### Headers

Same as above.

#### Request

```json
{}
```

#### Response

```json
{
  "planInfo": {
    "planName": "Ultra",
    "includedAmountCents": 40000,
    "price": "$200/mo",
    "billingCycleEnd": "1771077734000"
  }
}
```

### POST /aiserver.v1.DashboardService/GetUsageLimitPolicyStatus

Returns whether user is in slow pool, feature gates, and allowed models. Response undocumented.

### POST /aiserver.v1.DashboardService/GetUsageLimitStatusAndActiveGrants

Returns limit policy status plus any active credit grants. Response undocumented.

### GET /api/auth/stripe

Returns subscription and Stripe customer balance metadata from `cursor.com`.

#### Headers

| Header | Required | Value |
|---|---|---|
| Cookie | yes | `WorkosCursorSessionToken=<userId>%3A%3A<access_token>` |

#### Response (partial)

```json
{
  "membershipType": "ultra",
  "subscriptionStatus": "active",
  "customerBalance": -123456
}
```

`customerBalance` is in cents. Negative means customer credit/prepaid balance.

### POST /api/dashboard/get-filtered-usage-events

Unofficial Cursor dashboard endpoint. Returns paginated usage events with per-request model, token, and cost fields. OpenUsage uses cookie auth (`WorkosCursorSessionToken`) plus `Origin: https://cursor.com`.

#### Request body (partial)

```jsonc
{
  "startDate": "1774846800000", // unix ms string
  "endDate": "1775451599999",
  "page": 1,
  "pageSize": 100
}
```

OpenUsage fetches up to 10 pages of 200 events (2,000 events), aggregates locally into **Last 7 Days** and **Billing Cycle** windows, emits daily cost/token bar charts, and lists the top models by cost. Failures are nonfatal: the main Credits / Total usage card still renders.

Cost prefers positive `chargedCents`, then positive `tokenUsage.totalCents` (API price; numeric or numeric strings). Tokens use `tokenUsage.totalTokens` when present. If pagination stops early or hits the page cap, window totals append `· partial` and an **Events Note** marks the sample as partial.

## Authentication

### Token Sources

OpenUsage reads Cursor auth in this order:

1. **Cursor Desktop SQLite** (preferred)
2. **Cursor CLI keychain** (fallback)

#### 1) Cursor Desktop SQLite (preferred)

Tried in order; first database that has an access or refresh token wins. Refreshed tokens are written back to that same database.

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Linux | `~/.config/Cursor/User/globalStorage/state.vscdb` |

```bash
# macOS
sqlite3 ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb \
  "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"

# Linux
sqlite3 ~/.config/Cursor/User/globalStorage/state.vscdb \
  "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"
```

| Key | Description |
|---|---|
| `cursorAuth/accessToken` | JWT bearer token |
| `cursorAuth/refreshToken` | Token refresh credential |
| `cursorAuth/cachedEmail` | Account email |
| `cursorAuth/stripeMembershipType` | Plan tier (e.g. `pro`, `ultra`) |
| `cursorAuth/stripeSubscriptionStatus` | Subscription status |

#### 2) Cursor CLI keychain (fallback)

OpenUsage reads Cursor CLI tokens from keychain:

- `cursor-access-token`
- `cursor-refresh-token`

To initialize CLI auth:

```bash
agent login
```

### Multi-account homes (WebUI)

Settings → Provider Accounts can track more than one Cursor config. Detect looks for signed-in `state.vscdb` under `~/.config/Cursor` and macOS Application Support. Each enabled account is probed with `OPENUSAGE_CURSOR_CONFIG_DIR` set to that config root (optional power-user override: `OPENUSAGE_CURSOR_STATE_DB` for a full `state.vscdb` path). When either env is set, the plugin uses that home only and skips the global keychain fallback so accounts do not bleed together.

### Token Refresh

Access tokens are short-lived JWTs. The app refreshes before each request if expired, then persists the new access token back to the same source it was loaded from (SQLite or keychain).

```
POST https://api2.cursor.sh/oauth/token
Content-Type: application/json
```

```json
{
  "grant_type": "refresh_token",
  "client_id": "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB",
  "refresh_token": "<refresh_token>"
}
```

**Success:**

```json
{
  "access_token": "<new_jwt>",
  "id_token": "<id_token>",
  "shouldLogout": false
}
```

**Invalid/expired token:**

```json
{
  "access_token": "",
  "id_token": "",
  "shouldLogout": true
}
```

When `shouldLogout` is `true`, the refresh token is invalid and the user must re-authenticate via Cursor.

### Session Cookie (for `cursor.com` endpoints)

Some web endpoints (for example `/api/auth/stripe` and enterprise `/api/usage`) use a session cookie instead of bearer auth:

```
WorkosCursorSessionToken=<userId>%3A%3A<access_token>
```

`userId` is derived from JWT `sub` (e.g. `google-oauth2|user_abc` -> `user_abc`).
