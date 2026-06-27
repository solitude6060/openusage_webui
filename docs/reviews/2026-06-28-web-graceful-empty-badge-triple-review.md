# Triple Review: Graceful Empty Badge (`fix/web-graceful-empty-badge`)

Date: 2026-06-28
Scope: Frontend robustness — a badge that arrives without its text must not render an
empty pill.
Branch: `fix/web-graceful-empty-badge` (base `main`)
Commits: `854ea10` (test) · `0af44ed` (fix)

## Background

While inspecting a live dashboard, the Codex "Reset Credit" rows showed an empty pill and
no countdown. Root cause was **operational, not a code defect**: a dev backend that had
been running ~7 days (before the reset-credit merge) held the old `createLineApi` in memory
and stripped `tone`/`expiresAt` from every badge (`apps/server` dev has no `--watch`). A
restart + refresh fixed the live view (badges now carry `tone`/`expiresAt`). This PR is the
**robustness follow-up**: even with partial/garbled badge data, the UI should degrade
gracefully instead of drawing an empty box.

## Change

- `plainBadgeText(text)` (`apps/web/src/provider-ui.ts`): returns the text for a non-empty
  string, else `null`.
- `UsageLine` (`apps/web/src/App.tsx`): the plain-badge path renders the chip only when
  `plainBadgeText` is non-null, using `value-chip` (it dropped `badgeToneClassName(tone)`
  from this path — urgency tone belongs only to the stacked expiry layout). Orphaned
  `badgeToneClassName` import removed.

## Pass results

| # | Lens | Model | Verdict |
|---|------|-------|---------|
| A | Correctness / regression | Claude (code-reviewer) | APPROVE |
| B | Independent | **Codex** | APPROVE |
| C | UI / regression / a11y | Claude | APPROVE |

Key confirmations:
- **`plainBadgeText`** correct for `""`, whitespace-only, `undefined`, `null`, number, and
  non-empty string; fully covered by `provider-ui.test.ts` (RED-proven).
- **Zero real badges change.** Pass C grepped all `plugins/`: every plain badge carries
  non-empty `text`, and the only `tone:` in the codebase is codex's Reset Credit badge,
  which **also** sets `expiresAt` → routes to the expiry path, never the plain path. So
  dropping the tone class from the plain path changes the output of **no** real badge.
- **Closes the latent specificity trap** (nit from the prior PR2 review): a `reset-*` tone
  on a badge *without* `expiresAt` would previously render `status-pill reset-*` as a direct
  `.usage-text-line > span:last-child` (0,2,1) and get its color overridden. The plain path
  now always uses `value-chip`, removing that possibility.
- **Expiry path untouched**; orphan removal clean; `tsc`/`noUnusedLocals` satisfied.

## Triage

No actionable findings — **no fixes required**, so no fix-log for this PR.

Two observations from Pass C are explicitly **pre-existing and out of scope** (not this
PR's to fix; this PR neither causes nor worsens them):
- N1: `.value-chip { color: var(--accent-dark) }` is already overridden by
  `.usage-text-line > span:last-child` in this placement (dead since before this PR).
- N2: the badge `color` field some plugins set is never consumed by the WebUI badge
  renderer (it keys off `tone`); the old code ignored `color` too.

## Verification
- `vitest`: 1138 passed.
- `bun test apps/web/src` + provider-api: green (provider-ui `plainBadgeText` tests added).
- `apps/web` build: clean (orphan import removed → `tsc` passes).
- Pre-existing unrelated failures (GH keychain / GH_TOKEN / Antigravity Cloud-Code fixtures,
  flaky ccusage timeout) unchanged, also fail on `main`.

## Gate decision: **APPROVE — clear to merge** (3/3 APPROVE, no fixes)
