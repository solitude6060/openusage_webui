# Mobile Layout Fix Log — 2026-10-10

> Branch: `fix/mobile-layout` (base `main` = `ff1abf1`)
> Plan: `docs/plans/2026-10-10-mobile-layout.md` (issues M1–M6)
> Artifacts: `../openusage_webui-artifacts/2026-10-10-mobile/` (sibling of the repository)

## Roles

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, planning, verification | Claude Code, `claude-opus-5-5` |
| Implementer | Grok Build, `grok-4.7`, `high` (M1–M6); `xhigh` (MR1-1, after the user asked for xhigh) |
| Review lane 1 | Grok Build, `grok-4.7`, `high` (shares the implementer family, fixed-route overlap) |
| Review lane 2 | AGY, `gemini-3.8-flash-high`, `high` |
| Review lane 3 | Codex, `gpt-6.1-sol`, `high` |

## Changes

| ID | Issue | Commits |
|----|-------|---------|
| M3 | Sessions table wider than a phone; records as cards below 640 px | `e065da8` test, `1b04eeb` fix |
| M6 | Allowance range buttons in one scrollable row; explanation in a collapsed `<details>` | `5d09cc3` test, `1e22f65` fix |
| M1, M2, M4, M5 | Navigation stretch fix (980 px query), compact sticky top bar, panel padding, provider two-column rows | `829194c` (CSS; screenshots are the evidence) |

Checks at `829194c`: vitest 1196/1196 (67 files), bun:test 357/357, `bun run build:webui` pass.
`document.documentElement.scrollWidth` is 390 on all six pages at 390 px. The 1440 px
screenshots of Providers, Sessions, Tokens and Allowance are pixel-identical before and after;
Dashboard and Settings differ only in live countdown and clock text.

## Triple Review Round 1

Target `ff1abf1..829194c8e9d987c001092703e8680c8fa4791750`; raw outputs in `triple-review-r1/`.

| Lane | Verdict | Findings |
|------|---------|----------|
| 1 Grok | APPROVE | 1 LOW |
| 2 AGY | REQUEST_CHANGES | 1 MEDIUM, 2 LOW |
| 3 Codex | REQUEST_CHANGES | 1 MEDIUM |

Lane 3, attempt 1 on `~/.codex` failed with a usage-limit error before reviewing
(`lane3-codex.attempt1-quota.jsonl`). It was rerun on the second Codex home
(`CODEX_HOME=~/.codex-family`, same model and effort), the registry's same-family route.

| ID | Finding | Source | Severity | Verified evidence | Disposition |
|----|---------|--------|----------|-------------------|-------------|
| MR1-1 | A long Last Error value squeezes the provider label column to 0 at 390 px; label and value overlap | Lanes 2, 3 | MEDIUM | `styles.css:1552` used `minmax(0, 1fr) auto`; reproduced in `mr1-1-before.png` | Fixed |
| MR1-2 | `styles.css` grows from 1,424 to 1,624 lines; AGENTS.md asks for about 500 | Lanes 1, 2 | LOW | Pre-existing excess | Deferred: split the stylesheet in a separate cleanup |
| MR1-3 | Allowance `<details open={!narrow}>` resets on a narrow/wide change | Lane 2 | LOW | React updates `open` only when the prop changes; user toggles survive re-renders | Deferred: affects only orientation changes |

Repair: `0f4020f` (Grok Build `grok-4.7` / `xhigh`). The label column uses `max-content` and the
value is right-aligned and wraps. No unit test: jsdom has no grid layout; evidence is
`mr1-1-before.png` / `mr1-1-after.png` (standalone card with the JetBrains error) and refreshed
`after-providers-390.png` / `after-providers-1440.png`. Checks at `0f4020f`: vitest 1196/1196,
bun:test 357/357 (one rerun for the known ccusage timeout flake).

## Triple Review Round 2

Target `829194c..0f4020f1da9cb574ef581dce089dd5a265438a8d`; raw outputs in `triple-review-r2/`.
All three lanes: APPROVE, no findings. Lane 3 ran on `~/.codex` after its quota reset.
