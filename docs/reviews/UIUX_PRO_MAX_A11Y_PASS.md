# WebUI UI/UX Pass — ui-ux-pro-max skill audit

> Date: 2026-06-28
> Scope: `apps/web/src/styles.css`
> Source: `ui-ux-pro-max` skill (installed project-level, local-only via `.git/info/exclude`)

Drove the `ui-ux-pro-max` design-intelligence skill (`scripts/search.py --design-system`
and `--domain ux`) against the WebUI. The skill's high-priority checks (accessibility,
interaction, typography) surfaced four gaps, each verified against the real code/numbers
before fixing. No flashy redesign — changes are consistent with the existing light-first
"paper" design.

| # | Skill finding (severity) | Verified gap | Fix |
|---|--------------------------|--------------|-----|
| 1 | Reduced Motion — "Check prefers-reduced-motion" (High) | `grep` found **zero** `prefers-reduced-motion` handling; all transitions/animations run unconditionally | Added `@media (prefers-reduced-motion: reduce)` that near-zeroes transition/animation durations |
| 2 | Color Contrast — "min 4.5:1 for body text" (High) | `--muted #787774` measured **4.48:1** on white, **4.14:1** on `--canvas`, **3.89:1** on `--surface-muted` — fails AA; used heavily for small text (`th`/`dt`/`label`/`.eyebrow`/progress values) | Darkened light-mode `--muted` → `#6c6b68` (now 5.33 / 4.93 / 4.63:1 — all pass). Dark mode already passed (4.91:1+), left unchanged |
| 3 | Focus States — "visible focus rings on interactive elements" (High) | Inputs/buttons/toggle had `:focus-visible`; the keyboard-focusable **draggable cards** (dnd-kit) had none | Added `.provider-card:focus-visible` accent outline |
| 4 | Active Navigation — "highlight active nav with color/border" (Medium) | Active nav item used background-only | Added an accent left bar (`inset 3px 0 0 var(--accent)`, no layout shift); switches to a bottom bar at ≤980px where the nav is horizontal |

## Verification

- `cd apps/web && bun run build` green; `bun test apps/web/src` 30 pass.
- Contrast re-measured in-code (WCAG relative-luminance): all light-mode `--muted` pairs ≥ 4.5:1.
- Visual: active-nav accent bar confirmed via headless screenshot
  (`docs/screenshots/webui-a11y-nav-after.png`).

## Triple review (independent, multi-model)

- **codex (GPT)** — NO BLOCKERS ("only adjusts CSS accessibility affordances… no correctness,
  security, performance, or maintainability issue").
- **opencode (deepseek-v4)** — NO BLOCKERS; verified all four changes in detail (no `@keyframes`
  exist, dnd-kit drag is transform-based and unaffected, dark-mode `--muted` is a separate token,
  no overflow clipping).
- **agy (Gemini)** — raised 1 blocker + 1 major + 1 minor + 1 nit:

| # | Finding (severity) | Verdict | Note |
|---|--------------------|---------|------|
| 1 | reduced-motion reset breaks dnd-kit + "minute-tick CSS animation" (blocker) | **FALSE POSITIVE** | `grep` → zero CSS animations; minute-tick is a JS `setInterval`; `0.01ms` is the canonical library-safe pattern (preserves `transitionend`). Confirmed by opencode. |
| 2 | `--muted` darkening regresses dark mode (major) | **FALSE POSITIVE** | Dark mode re-declares `--muted: #888888` (styles.css:38); the edit was to light `:root` (line 11). Dark mode unaffected. |
| 3 | `.nav-item.active` is the wrong selector (minor) | **FALSE POSITIVE** | App.tsx:122 sets `"nav-item active"`; selector is correct (and the screenshot renders it). |
| 4 | inset box-shadow bar rounds at the 6px corners (nit) | **VALID — fixed** | Replaced the inset shadow with a `::before` pseudo-element (inset 6px top/bottom, 3px radius) for a crisp pill bar; bottom-edge variant at ≤980px. |

Re-reviewed after the nit fix; all three APPROVE.

## Not changed (skill suggested, deliberately skipped)

- **Dark-only OLED palette / Fira Code / Fira Sans / slate+green tokens** (from the
  design-system generator) — would replace the established light-first teal "paper"
  identity. Out of scope for a quality pass; the brand stays.
