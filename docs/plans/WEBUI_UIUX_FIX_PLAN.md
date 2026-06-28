# WebUI UI/UX Review — Fix Plan & Triage

> Date: 2026-06-28
> Scope: `apps/web` (OpenUsage WebUI)
> Source review: `docs/ANTIGRAVITY_20260628_UI_UX_REVIEW.md`
> Branch: `fix/webui-uiux-review-corrections`

## Context

The Antigravity review targets `apps/web` (the browser WebUI). The repo also contains a
second, separate frontend — the root `src/` Tauri desktop app — which is already split
into `pages/`/`components/`/`hooks/`/`stores/` and is **out of scope** here. Several review
findings were checked against the actual code (verified line-by-line, then re-checked by an
independent adversarial pass). Many aesthetic suggestions turned out to be already
implemented or to conflict with the product's deliberate light-first "paper" design.

## Triage

| # | Finding | Verdict | Action | Evidence |
|---|---------|---------|--------|----------|
| A1 | `App.tsx` > 970 LOC violates `<~500 LOC` | **Valid** | **Fix** — split into `pages/`+`components/`+`lib/` | `apps/web/src/App.tsx` = 970 lines; `AGENTS.md:18` |
| A2 | Create `src/pages` / `src/components` | Partially moot | Apply to `apps/web` only | Root `src/` already has these |
| A3 | Remove `lucide-react`; adopt Hugeicons | **Misleading + dangerous** | **Do NOT remove** | `lucide-react` is used by 7 root Tauri files; `apps/web` imports it zero times. `@hugeicons-pro/core-solid-rounded` is **404 on public npm** (license-gated), not installable here |
| V1 | Flat design / 1px borders too basic | Subjective | Skip | Deliberate light-first paper system |
| V2 | Dark gradient + glassmorphism | **Reject** | Skip | `rgba(255,255,255,0.03)` fill + inset-white highlight are invisible on the default white surface; forces dark-only, deleting the `prefers-color-scheme` token set |
| V3 | Introduce Inter + tabular-nums | Mostly done; **one real bug** | **Fix the bug** — bundle Inter | Inter already first in stack (`styles.css:3`) and tabular-nums already applied (`:286/:332/:674/:699/:729/:751`), but Inter is **never bundled** (no `@font-face`/`@import`), so it silently falls back |
| V4 | Enforce Title Case | Already satisfied | Skip | `App.tsx:151` already `Local Dashboard` |
| I1 | Sidebar icons + active indicator bar | Good idea; icons blocked | Defer | Icons need the license-gated Hugeicons pkg (see A3) |
| I2 | View Transitions / page fades | Low value | Skip | Adds latency to a local at-a-glance tool |
| I3 | Refresh All → icon/FAB button | Subjective | Skip | — |
| I4 | Progress glow + 90% red pulse | Threshold already ships | Skip pulse | 90% color-swap already exists (`App.tsx:420` + `styles.css:692`); infinite pulse nags + no reduced-motion guard |
| I5 | Toast instead of inline alert | **Valid (reflow)** | **Fix reflow** (not a full toast system) | `.alert` renders in normal flow (`App.tsx:159-160`, `styles.css:560`, no `position`), pushing layout down |
| I6 | Card hover translateY(-2px)+shadow | Already lifts | Skip | `styles.css:354` already `translateY(-1px)`; shadow fights flat paper + drag affordance |
| I7 | Table padding / lighter thead / responsive | Mostly done | Skip | thead already muted/uppercase/small (`styles.css:270-278`); horizontal scroll already exists (`.panel{overflow:auto}` `:292`) |

## This PR ships

1. **refactor(web): split `App.tsx` (<500 LOC)** — behavior-preserving extraction into
   `pages/` + `components/` + `lib/format.ts`. No UI/behavior change.
2. **fix(web): bundle Inter via `@fontsource/inter`** — local-first (no CDN), so the named
   primary font renders as designed instead of falling back to system-ui on Linux.
3. **fix(web): alert no longer reflows the page** — reserve/anchor the alert region so an
   error/notice does not push content down; errors stay until dismissed/cleared, success
   keeps its existing 3s auto-dismiss.

## Explicitly NOT in this PR (with reason)

- Removing `lucide-react` — would break the Tauri app build.
- Hugeicons adoption / sidebar icons — `@hugeicons-pro/*` is license-gated (404 on public
  npm). Documented as a known constraint; revisit if a registry token is available.
- Glassmorphism / dark-gradient / glow / pulse — conflict with the light-first design and
  data-density/accessibility; rejected in triage.

## Verification

- `cd apps/web && bun run build` (tsc + vite build) green.
- `bun test apps/web/src` green (baseline: 30 pass).
- Before/after screenshots for the two visual changes (Inter, alert) per `AGENTS.md:84`.

## Exit criteria

- All three changes landed in small commits; build + tests green.
- Independent triple review returns APPROVE; findings logged in
  `docs/fix-logs/WEBUI_UIUX_FIX_LOG.md`.
- PR opened against `solitude6060/openusage_webui` with before/after screenshots, then merged.
