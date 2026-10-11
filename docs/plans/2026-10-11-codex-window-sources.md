# Codex Window Sources (Upstream Ports) — 2026-10-11

## Problem

Upstream review: `openusage_webui-artifacts/2026-10-11-upstream/upstream-review.md` (sibling artifact directory).

1. `plugins/codex/plugin.js` reads Session/Weekly percent from the `x-codex-*-used-percent` headers before
   the response body windows. Upstream `a4cba27` (#708) recorded a stale 99% header overriding a fresh window
   and switched to body first, headers only when the window field is missing. Wrong readings feed Allowance.
2. The plugin maps `primary_window` to Session and `secondary_window` to Weekly by slot. Codex can put a weekly
   window in the primary slot (the codex:codex Pro account reports only a 7-day primary window; the page shows it
   as "Session" with a 7-day period). Upstream `e1ddf23` classifies by `limit_window_seconds`; payloads without a
   recognized duration keep the slot fallback; headers fill percents missing from the matching window. The same
   classification applies to `additional_rate_limits` entries.
3. Plan labels: upstream `aeceecc`/`d5166d6` map `prolite` → Pro 100, `pro` → Pro 200, `promax` → Pro 500,
   `self_serve_business_prolite` → Business Premium.

Upstream is a Swift rewrite; these are hand ports of behavior, not cherry-picks. Source: robinebers/openusage at
the commits above (local reference clone `../openusage-upstream-ref`).

## Changes

W1. Body first, header fallback for Session and Weekly percent.
W2. Duration-based classification (Session ≈ 5 h, Weekly ≈ 7 d; tolerance as upstream), slot fallback.
W3. History continuity: existing codex:codex observations were stored under the Session window with a 7-day
    period. After W2 new readings arrive as Weekly. Allowance, Quotas and history views must still find one
    continuous weekly series for that account (choose the least-code correct approach: read-time alias of a
    7-day-period Session to Weekly, or a one-time storage migration in `packages/storage` with a test).
    Do not delete stored rows.
W4. Plan label mapping as upstream.
W5. `docs/providers/codex.md` updated; fix log `docs/fix-logs/2026-10-11-codex-window-sources-fix-log.md`.

## Acceptance

- Plugin tests: stale header with fresh body → body wins; missing body percent → header used; weekly window in
  the primary slot → Weekly line with 7-day period and no Session line; unknown duration → slot fallback;
  plan labels.
- Continuity test: observations under the old Session/7-day key plus new Weekly readings form one window for
  Allowance.
- Full runners and `bun run build:webui` pass.

## Routing

Coding Medium: Grok Build `grok-4.7` / `xhigh` (user instruction). Triple-review.
