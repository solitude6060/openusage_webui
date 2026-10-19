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

## Docs

`docs/providers/claude.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md` §5.5 and Claude section, `README.md`
(Claude row), `status.md`, `tracker.md`, `handover.md`.

## Open Questions For The User

- Upgrade time to Max 20x (10/14?). Stored snapshots before the A3 fix all say `Max 5x`, so under B3
  the 20x baseline appears after the first full 20x cycle unless historical labels are corrected.
- "整個訂閱期間" — weekly reset cycle (implemented) or the monthly billing period (not implemented).

## Deferred Upstream Candidates

Cursor Extra Usage from usage-summary (`eab20cf`), Antigravity Gemini meters from Cloud Code
(`9e6d362`), Antigravity Argon quota (`063eb06`), incremental log reads (`5c9d9a7`, `f0039b2`).
