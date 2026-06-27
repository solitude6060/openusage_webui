# Fix Log: PR2 Codex Reset-Credit Expiry — Triple-Review Findings

Date: 2026-06-28
Review: `docs/reviews/2026-06-28-codex-reset-credit-expiry-triple-review.md`
Branch: `feat/codex-reset-credit-expiry`

All six actionable findings fixed in TDD order where a unit test fit. The seventh
(legacy-path tone override) is accepted as unreachable from the codex producer.

## #1 — Countdown not truly live (Codex, MEDIUM)

- **Repro:** `formatRelativeTime(expiresAt)` was computed at render with no timer, so a
  countdown only updated when some other state changed; a credit would not flip to
  "Expired" on time. (The pre-existing window-reset lines had the same staleness.)
- **Fix:** added a 60-second tick in `App` (`apps/web/src/App.tsx`) that bumps state and
  re-renders, so every relative time — credit expiry **and** window resets — stays fresh.
- **Tests:** lifecycle/timer behavior; verified by build + the existing render path
  (no unit test for the interval itself).
- **Files:** `apps/web/src/App.tsx`.

## #2 — Invalid `expiresAt` crashes the dashboard (Codex + UI, MEDIUM/minor)

- **Repro:** `formatDate(expiresAt)` → `Intl.DateTimeFormat.format(new Date("bad"))` throws
  `RangeError`. With no React error boundary in the repo, a throw during render blanks the
  whole dashboard. Not reachable from the codex producer (it validates + re-serializes via
  `toIso`), but `expiresAt` is a generic badge field any plugin could set.
- **Fix:** new pure `resetCreditExpiryView(expiresAt, tone, nowMs)` in
  `apps/web/src/provider-ui.ts` validates the timestamp (`Number.isFinite(new
  Date(expiresAt).getTime())`). The renderer only takes the expiry branch when
  `view.valid`; otherwise it falls through to the legacy badge path. `formatDate` is never
  called on an invalid value.
- **Tests (RED→GREEN):** `apps/web/src/provider-ui.test.ts` — "rejects an invalid or
  missing expiry without throwing".
- **Files:** `apps/web/src/provider-ui.ts`, `apps/web/src/App.tsx`,
  `apps/web/src/provider-ui.test.ts`.

## #3 — Expired lapse-window visual mismatch (UI, nit)

- **Repro:** a credit lapsing between refreshes flipped its text to "Expired" but kept the
  red `urgent` pill color + filled dot.
- **Fix:** `resetCreditExpiryView` returns `toneClass` for an **effective** tone —
  `expired ? "expired" : tone` — computed against the live clock, so color/dot match the
  "Expired" text the moment it crosses the line.
- **Tests:** `apps/web/src/provider-ui.test.ts` — "a lapsed credit uses the expired styling
  even if the baked tone was urgent".
- **Files:** `apps/web/src/provider-ui.ts`, `apps/web/src/App.tsx`, test.

## #4 — Test-helper `parseDateMs` numeric divergence (Plugin, minor)

- **Repro:** `plugins/test-helpers.js` `parseDateMs` returned numeric inputs as-is, while
  production (`createUtilApi.parseDateMs`) applies the `|v| < 1e10 ⇒ seconds ⇒ ×1000`
  heuristic. A numeric `expires_at` would validate wrong behavior in tests.
- **Fix:** aligned the helper to production (number and numeric-string paths both apply the
  heuristic; other strings → `Date.parse`).
- **Tests:** `plugins/codex/plugin.test.js` — "parses a numeric (unix seconds) expires_at
  the same way production does" (would mis-tier under the old helper).
- **Files:** `plugins/test-helpers.js`, `plugins/codex/plugin.test.js`.

## #5 — No assertion the endpoint is skipped at `available_count = 0` (Plugin, nit)

- **Repro:** a regression firing the secondary fetch on zero credits would be swallowed by
  the non-fatal try/catch and pass silently.
- **Fix:** test asserts `ctx.host.http.request` is never called with the reset-credits URL
  when `available_count` is 0.
- **Tests:** `plugins/codex/plugin.test.js` — "does not call the reset-credits endpoint
  when available_count is 0".
- **Files:** `plugins/codex/plugin.test.js`.

## #6 — `soon` light-mode pill contrast 3.75:1 (UI, nit)

- **Repro:** `--caution` `#b06b1f` on `--caution-soft` `#fbf0e0` = 3.75:1, under WCAG AA 4.5.
- **Fix:** darkened light `--caution` to `#9c5e18` (still amber). Verified in-browser:
  **4.63:1**. Dark mode already passed and is unchanged.
- **Files:** `apps/web/src/styles.css`.

## #7 — Legacy-path tone override (UI, nit) — ACCEPTED

A `reset-*` tone on a badge *without* `expiresAt` would re-hit the specificity override.
Not reachable from the codex producer (it always pairs `tone` + `expiresAt`) and
undocumented for other plugins. No change; recorded here for the record.

## Verification after fixes

- `vitest`: 1138 passed (+2: numeric, skip-at-0).
- `bun test` (providers api + web provider-ui): 33 passed (+3: resetCreditExpiryView).
- `apps/web` build: clean.
- Pre-existing unrelated failures (GH keychain / GH_TOKEN / Antigravity Cloud-Code fixtures,
  flaky ccusage timeout) are unchanged and also fail on `main`.
- Screenshots re-captured (light + dark) with final CSS.
