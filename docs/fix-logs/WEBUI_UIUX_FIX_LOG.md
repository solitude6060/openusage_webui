# WebUI UI/UX — Fix Log

> Date: 2026-06-28
> Branch: `fix/webui-uiux-review-corrections`
> Plan: `docs/plans/WEBUI_UIUX_FIX_PLAN.md`
> Review source: `docs/ANTIGRAVITY_20260628_UI_UX_REVIEW.md`

## Changes shipped (corrections of valid review findings)

| Commit | Change | Verification |
|--------|--------|--------------|
| `refactor(web): split App.tsx` | 970-line `App.tsx` → `pages/` + `components/` + `lib/format.ts`; shell now 202 lines (`AGENTS.md:18` <500 LOC) | `tsc` + `vite build` green; bundle byte-stable (254.5 kB JS / 11.2 kB CSS); 30 tests pass |
| `fix(web): bundle Inter` | `@fontsource-variable/inter` (weight axis) imported locally; `"Inter Variable"` prepended to the stack | woff2 emitted to `dist`; `@font-face` present in built CSS; no CDN; `unicode-range` loads only Latin at runtime |
| `fix(web): float global alerts` | global error/notice moved into a fixed `.app-toasts` region (`aria-live`), so they no longer reflow the page | build green; verified live (dark-mode app) |
| `fix(web): address triple-review findings` | see triple-review section below | build + 30 tests green |

## Triple review (independent, multi-model — per §5)

Three different model families reviewed `main..HEAD`; none authored the code.

- **codex (GPT)** — `codex exec review --base main`: **NO BLOCKERS**. "Behavior-preserving extraction… build and web tests pass… no introduced correctness bug."
- **opencode (deepseek-v4-flash-free)** — **NO BLOCKERS**. Verified every function body / dependency array / JSX / 15 import paths; AGENTS.md rules pass. One *minor*: dark-mode toast shadow weak.
- **agy (Antigravity / Gemini)** — confirmed the split preserved all prop signatures, rendering, CSS classes, import depths, and the font change. Raised 1 blocker + 2 major + 1 minor (triaged below).

### Findings triage & resolution

| # | Finding (source) | Severity | Verdict | Resolution |
|---|------------------|----------|---------|------------|
| 1 | Dark-mode toast shadow invisible (opencode + agy) | major/minor | **Valid** | Dark-mode `box-shadow` override + hairline `--line-strong` border on `.app-toasts .alert` |
| 2 | `aria-live="polite"` can delay error announcement (agy) | major | **Valid** | Added `role="alert"` to the error toast (assertive); container stays polite for success notices |
| 3 | `z-index: 50` low for a global toast layer (agy) | minor | **Valid** | Bumped `.app-toasts` z-index 50 → 1000 |
| 4 | "`ProviderId` removed but still relied on — BLOCKER" (agy) | blocker | **FALSE POSITIVE** | `tsc`/`noUnusedLocals` *errors when the import is present* and passes without it. `App.tsx`'s `providerMap` is an inferred `Map`; the `ProviderId`-typed handlers live in `providers-page.tsx`, which imports the type itself. Re-adding would break the build. Verified by green build before and after. |

Finding 4 is the classic "reviews can be wrong, including false-positive blocking verdicts" case (CLAUDE.md §5): the cited claim was checked against the actual compiler result rather than acted on.

### Re-review (round 2 — after fixes 1–3)

- **agy** — **APPROVE (NO BLOCKERS), "Ready to merge."** Re-verified all fixes and explicitly endorsed the rejection of finding 4 ("removal of `ProviderId` is correct… enforcing an explicit type just to satisfy an import would be unnecessary churn").
- **codex** — one new **[P2]**: the floating `.app-toasts .alert` had `pointer-events: auto` but no dismiss control, so on a short/small viewport a persistent error toast could cover and intercept clicks on a bottom-right control — a regression from the inline alert.

| # | Finding (source) | Severity | Verdict | Resolution |
|---|------------------|----------|---------|------------|
| 5 | Text-only toast intercepts clicks on covered controls (codex) | P2 | **Valid** | Removed `pointer-events: auto`; the region inherits the container's `pointer-events: none`, so text toasts are fully click-through and can never block a control beneath them |

Round-3 re-review (codex) after fix 5: see PR.

## Not done (documented constraints)

- **`lucide-react` not removed** — it's used by 7 files in the root Tauri app (`src/`), not `apps/web`; removing it breaks that build.
- **Hugeicons / sidebar icons not added** — `@hugeicons-pro/core-solid-rounded` is **404 on public npm** (license-gated), so it cannot be installed in this environment.
- **Glassmorphism / dark-gradient / glow / pulse** — rejected in triage: conflict with the light-first design, data-density/contrast, and accessibility (no `prefers-reduced-motion` guard).
