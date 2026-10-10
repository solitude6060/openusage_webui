# Mobile Layout Refinement — 2026-10-10

## Evidence

Headless Chrome, 390 px wide (iPhone 12–15 class), live site at `ff1abf1`. Screenshots:
`../openusage_webui-artifacts/2026-10-10-mobile/before-*.png`.

| ID | Page | Observation |
|----|------|-------------|
| M1 | Tokens | The navigation block stretches to about 630 px tall: the tab grid rows grow and the active tab becomes a tall box. Other pages show the same block at about 175 px. Likely the shell grid stretches the sidebar row when page content is short. |
| M2 | All | Before the first content: brand block, two rows of tabs, the `LOCAL DASHBOARD` eyebrow, a 28 px title and a full-width `Refresh All` button. The first card starts at about y = 330 px, about 40% of an 844 px viewport. |
| M3 | Sessions | The records table is wider than the viewport; the third column (`Tool`) is cut at the right edge and later columns need horizontal scrolling inside the panel. |
| M4 | Settings | Server Settings and Provider Accounts content sits flush against the panel border (no inner padding at this width); the `Detect Homes` button wraps beside the heading. |
| M5 | Providers | Each provider card stacks label above value for four fields plus a full-width button; one card is about 310 px tall. |
| M6 | Allowance | Eight range buttons wrap into three rows; two explanation paragraphs take about 290 px before the first result. |

## Changes (CSS-first, breakpoint `max-width: 640px`)

1. M1, M2: compact sticky top bar on narrow screens: brand on one line, the six tabs in one
   horizontally scrollable row, `Refresh All` as a compact button in the bar. Hide the
   eyebrow and reduce the page title size on narrow screens. Fix the row stretch so the
   navigation height does not depend on page content height.
2. M3: on narrow screens render each Sessions record as a stacked card (started at, provider,
   tool, model, tokens, cost) instead of the wide table; keep the table at desktop widths.
3. M4: restore inner panel padding at narrow widths; panel header actions wrap below the title
   at full width.
4. M5: provider status fields as two-column label/value rows; the toggle and Refresh share a row.
5. M6: range buttons in one horizontally scrollable row; explanation text inside a
   `<details>` element (`How This Is Calculated`), collapsed on narrow screens.

Desktop layout (≥ 1024 px) must not change; verify with before/after desktop screenshots.

## Out Of Scope

- Reducing the number of `OpenUsage Plugin Snapshot` rows shown in Sessions.
- New features or navigation structure changes on desktop.

## Acceptance

- Screenshots at 390 px and 1440 px for all six pages before and after.
- No horizontal page scroll at 390 px (`document.documentElement.scrollWidth <= 390`).
- Existing suites and `bun run build:webui` pass; component tests where markup changes
  (Sessions card list, Allowance details).

## Routing

Coding Medium: Grok Build `grok-4.7` / `high`; triple-review with the fixed lanes.
