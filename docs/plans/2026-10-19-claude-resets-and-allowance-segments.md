# Plan: Claude Resets, Credits, Plan Badge, And Allowance Segments (2026-10-19)

Branch: `feat/claude-resets-allowance-segments` (off `main` `e807b8e`).
Planner: Claude Opus 5.5. Implementers (user instruction 2026-10-19): Grok Build `grok-4.7` / high for
track A, Claude Sonnet 5.5 / xhigh for track B. Review: triple-review fixed routes before merge.

## Evidence (2026-10-19, read-only calls with the local Claude login)

- `GET /api/oauth/usage` returns `iguana_necktie` with `limit_dollars: 250`, `used_dollars: 0`,
  `resets_at: 2026-11-05T07:59Z`. The plugin ignores it. Claude Code 2.1.303 renders two dollar
  windows, `cinder_cove` ("Claude Code and Cowork credit") and `wattle_ember` (`label` or "Credit");
  `iguana_necktie` is not in that binary, so its product name is unverified.
- `GET /api/oauth/usage?cedar_ember=1&skip_spend=1` with `User-Agent: claude-cli/2.1.303 (external, cli)`
  returns one grant (`resets_left: 1`, `ends_at: 2026-10-22T16:00Z`). With the plugin's
  `claude-code/2.1.69` style agent it returns `eligible: false, ineligible_reason: "surface"`.
- `GET /api/oauth/profile` returns `organization.rate_limit_tier: default_claude_max_20x`; the saved
  credential says `default_claude_max_5x`, so the card shows `Max 5x`.
- Weekly meter fell mid-cycle with an unchanged `resets_at`: 2026-10-14T04:22Z 96% → 04:42Z 1%, and
  2026-10-01T04:50Z 10% → 04:58Z 0%. Allowance drops both cycles as `meter-fell`; the baseline is n=1.
- API dollars per percent from `token_hourly`: 9.22 (10/01–10/03), 9.49 (10/03–10/10), 10.09
  (10/10–10/14), 15.56 (10/14–10/17), 16.51 (current, partial). Tokens per percent: 22.5M, 24.3M,
  35.6M, 63.7M, 50.5M. The 10/14 drop coincides with the dollars-per-percent change; whether it is the
  5x → 20x upgrade is not confirmed from API data.
- Upstream (`robinebers/openusage` `main` `26132ff`): `a7953bf` reads and claims Claude reset grants;
  `docs/providers/claude.md` documents the hourly `cedar_ember` read and the profile plan badge.
  Pace formula (`Sources/OpenUsage/Support/Pace.swift`) equals our `projectedEndPercent`.

## Track A — Claude plugin (owner: Grok Build; files `plugins/claude/*`, `docs/providers/claude.md`)

A1. Rate Limit Resets row: separate GET `?cedar_ember=1&skip_spend=1` with
    `User-Agent: claude-cli/<version> (external, cli)`, at most once per hour per access-token
    login, cached between; failure keeps the previous value. Row: `N available` with the soonest
    `ends_at` as `resetsAt`. Reject the block if a grant lacks string `id` or numeric `resets_left`
    (show No Data). Display only: no claim POST (spends a grant, irreversible).
A2. Dollar credit lines: every top-level object in the usage response with numeric `limit_dollars`
    becomes a dollars progress line (`used_dollars` of `limit_dollars`, `resets_at`). Label: object
    `label`; else `cinder_cove` → "Claude Code And Cowork Credit"; else "Credit". Skip null objects.
A3. Plan badge from `GET /api/oauth/profile` `organization.rate_limit_tier`, once per access token,
    after a successful usage fetch; fall back to the saved credential plan.
A4. Do not expose `event_props`, grant ids or organization ids in lines; audit against
    `src-tauri/src/plugin_engine/host_api.rs` redaction and add tests for new fields.
Tests (red first): A1 parse/cache/UA/malformed, A2 iguana-shaped fixture, A3 profile badge.

## Track B — Allowance segments (owner: Sonnet; files `packages/providers/src/allowance-cycles.ts` + tests, `apps/web/src/pages/allowance-page.tsx` if a field is added)

B1. A reading that falls ≥ 5 points while `resets_at` stays within one hour of the cycle's reset
    splits the cycle into segments. Each segment is measured alone (first to last reading, tokens
    and API cost inside it). The cycle's consumed percent is the sum of segment climbs. Remove
    `meter-fell` as an exclusion for this case.
B2. Each cycle/segment reports `dollarsPerPercent` and `tokensPerPercent`; the baseline adds a
    dollars-per-percent median.
B3. Segments pool into the baseline only when their snapshot plan label equals the current one. A
    segment boundary at a plan-label change is a regime boundary.
B4. Current-cycle projection stays the Pace formula (already matches upstream).
Tests (red first): fixture with the 96 → 1 → 95 shape gives consumed 190 and is included; plan-label
change excludes old-regime segments from the baseline.

## Track C — Cloud Credit label and billing months (added 2026-10-19 after user answers)

The user asked for both views of "the whole subscription period": weekly cycles (Track B) and the
monthly billing period. Added to this branch before triple-review, so the review covers A, B and C.

C1. `iguana_necktie` dollar window is labelled "Cloud Credit" (user choice). Other unlabeled keys
    keep "Credit". Done in `532633c` (test) and `6b13473` (feat).
C2. Billing months (owner: Claude Sonnet 5.5 / xhigh; files `packages/providers/src/allowance-cycles.ts`
    or a new sibling module, `apps/server/src/quota-history.ts`, `apps/web/src/pages/allowance-page.tsx`,
    `apps/web/src/lib/api.ts`, tests).
    - Anchor: provider setting `billingAnchor` (ISO timestamp) in `provider_settings`, read and written
      through the existing `/api/settings/:providerId` route. The API does not expose a renewal
      date (`/api/oauth/profile` has only `subscription_created_at` 2025-09-06T14:19Z, and the
      subscription lapsed 2026-09-09 and restarted 2026-10-01). Without the setting, months are
      UTC calendar months and the page says so.
    - Month k is [anchor + k months, anchor + k + 1 months); a day past the month's end clamps to
      its last day.
    - Each month reports API dollars and tokens from `token_hourly` rows whose `hour_start` falls in
      the month (hour resolution), and the first hour with token data when it starts after the
      month start (partial coverage).
    - Weekly percent per month is reported per regime, never summed across a regime boundary,
      because a percent under Max 5x and under Max 20x measure different amounts. Each part gives
      consumed percent (segment climbs from Track B, clipped to the month using readings inside
      it, no interpolation) and available percent (overlap days / 7 x 100).
    - The current month adds the Pace projection of API dollars to month end
      (`mtd / elapsed * length`), with the same reliability rule as the weekly projection.
    - The page shows a billing-month table per provider and a date input that saves `billingAnchor`.
    Tests (red first): anchor clamping (Jan 31 anchor), month token sums at the boundaries, a month
    containing a regime change reports two parts, current-month projection, missing anchor falls
    back to calendar months.

Plan-label evidence (2026-10-19, read-only): stored Claude snapshots switch between `Pro` and
`Max 5x` at 2026-07-24, 08-06, 10-01 and 10-07 with no change in the weekly meter (10-07: 34% before
and after), so stored labels do not mark plan changes. The only observed plan change is the
2026-10-14 upgrade, found by the dollars-per-percent rule.

## Docs

`docs/providers/claude.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md` §5.5 and Claude section, `README.md`
(Claude row), `status.md`, `tracker.md`, `handover.md`.

## Open Questions For The User

- Upgrade time to Max 20x. Answered 2026-10-19 by the user: 2026-10-14 12:33 Taiwan time
  (04:33Z). This falls inside the observed weekly meter fall (04:22Z 96% → 04:42Z 1%), so the
  10/14 segment boundary and the dollars-per-percent change (about 10 → 15.6) are the upgrade.
  Stored snapshots before the A3 fix all say `Max 5x`, so B3 uses the dollars-per-percent ratio
  rule instead of plan labels; it places the regime boundary at the same reset. The only finished
  post-upgrade data is the 10/14–10/17 segment, so the baseline stays n=1 until the 10/17–10/24
  cycle ends.
- "整個訂閱期間" — weekly reset cycle (implemented) or the monthly billing period (not implemented).

## Deferred Upstream Candidates

Cursor Extra Usage from usage-summary (`eab20cf`), Antigravity Gemini meters from Cloud Code
(`9e6d362`), Antigravity Argon quota (`063eb06`), incremental log reads (`5c9d9a7`, `f0039b2`).
