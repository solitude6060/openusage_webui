# Antigravity Quota Summary, Argon Weekly, And Account Scan

## Need

The owner reported that the Antigravity card looks wrong and that Antigravity now has a separate Gemini 4 Argon quota to show. The owner signs in three Google accounts: `agy` (real home), `agy1` (`~/.agy-homes/acct1`) and `agy2` (`~/.agy-homes/acct2`).

## Evidence (2026-10-21, read-only calls)

- Every stored snapshot for both tracked accounts reads 0% used with a reset five hours after the reading. The plugin reads only the per-model `fetchAvailableModels` / `retrieveUserQuota` responses, which carry the rolling 5-hour window.
- `v1internal:retrieveUserQuotaSummary` returns the quota groups that the Antigravity CLI shows: `Gemini Models` (`gemini-5h`, `gemini-weekly`) and `Claude and GPT models` (`3p-5h`, `3p-weekly`). The weekly buckets showed use that the 5-hour buckets did not.
- The two Cloud Code hosts disagreed on one bucket. Production returned `gemini-weekly` at 1.0 with a reset seven days after the call (an untouched rolling window). Daily returned 0.935 with a fixed reset three days ahead. The `agy` CLI log shows it calls the daily host.
- `loadCodeAssist` without the Antigravity client User-Agent and metadata returns only `allowedTiers` (`Gemini Code Assist`), which is the plan the card shows. With them it returns `paidTier.id = g1-pro-tier`.
- None of the three accounts returned a `Gemini 4 Argon` group on either host. Upstream reports the group and a weekly bucket (`gemini-argon-wtu-weekly`) for eligible Pro accounts.
- The three accounts returned identical fractions and reset times. Cause not determined.
- The plugin maps any Gemini label without "Pro" or "Flash" to the Claude pool, so an Argon model would be counted as Claude.
- Account scan finds all three CLI homes plus two IDE state databases last written in May and June. The real-home account (`antigravity:local-cli`) exists but is disabled, so `agy` is not tracked.

## Source

Upstream `robinebers/openusage` main `26132ff4`, files `Sources/OpenUsage/Providers/Antigravity/AntigravityUsageMapper.swift`, `AntigravityUsageClient.swift`, `AntigravityMetric.swift` (PRs #1395 and #1407). Rules ported:

- Labels `Session`, `Weekly`, `Argon Weekly`, `Claude`, `Claude Weekly`, in that order.
- Shared-pool buckets match exact `bucketId` only; unknown ids are skipped.
- Argon needs the exact group `Gemini 4 Argon`, exactly one `window: "weekly"` bucket with a separate id, not `disabled`, and a finite `remainingFraction`.
- A bucket without a finite `remainingFraction` drops its line.
- A parsed summary, even empty of lines, is authoritative; legacy endpoints are used only when no host returned `groups`.
- Both envelopes: bare `{groups}` (Cloud Code) and `{response: {groups}}` (local server).
- Legacy pooling: every Gemini model goes to `Session`, every other model to `Claude`, Argon models are skipped.
- Plan: known `paidTier.id` (`g1-pro-tier` Pro, `g1-ultra-tier` Ultra, `g1-ultra-lite-tier` Ultra Lite), then the tier name with a leading `Google AI ` removed.
- `loadCodeAssist` sends User-Agent `antigravity/2.24.0 (aidev_client; os_type=<os>; arch=<arch>)` and metadata `{ideType: ANTIGRAVITY, platform: PLATFORM_UNSPECIFIED, pluginType: GEMINI}`.
- Cloud Code hosts in order production, then daily.

Difference from upstream: upstream merges the two hosts first-wins (production preferred). This plugin asks both hosts and keeps the lower remaining fraction per bucket, with that bucket's reset time, because the hosts disagreed with production reading an untouched window. The lower value is the limit that applies first. This matches the plugin's existing worst-fraction rule for legacy pools.

## Changes

- `plugins/antigravity/plugin.js`: quota summary on the local server and Cloud Code, Argon Weekly, legacy pooling, plan, host order.
- `plugins/antigravity/plugin.json`: declared lines.
- `packages/providers/src/account-detect.ts`: detected homes carry the signed-in email (CLI `id_token`, IDE `antigravityAuthStatus.email`).
- `apps/web/src/pages/settings-page.tsx`, `apps/web/src/lib/api.ts`: show that email in Detected Homes.
- `docs/providers/antigravity.md`.

## Tests

- Summary gives Session, Weekly, Claude, Claude Weekly with used percent and period.
- Hosts that disagree give the lower remaining fraction per bucket.
- Argon group gives Argon Weekly after Weekly; disabled, ambiguous or missing-fraction Argon gives no line.
- A bucket without a fraction drops its line; unknown bucket ids are skipped.
- Summary on the local server (`response` envelope) is used before legacy calls.
- No summary falls back to legacy pooling; Argon models are skipped there.
- Plan from `paidTier.id`.
- Detected homes include the email.

## Live Steps (owner approval)

- Deploy and restart :6736.
- Enable `antigravity:local-cli` so `agy` is tracked.

## Not In Scope

- AI credits.
- Local conversation token history and spend for Antigravity.
