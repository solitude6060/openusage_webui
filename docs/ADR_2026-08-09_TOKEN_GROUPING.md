# ADR: Token Grouping And Model Families

Date: 2026-08-09
Status: Accepted

## Context

The Tokens page specification only defines Provider → Model rows. Users also need Model → Provider
rows, compact token totals, and deterministic grouping for model names that include provider routing,
dated revisions, or inference-profile suffixes.

The token API already returns provider and model totals. Stored usage records retain the original
model string required for refresh identity and provenance.

## Decision

- Add Provider → Model and Model → Provider views in the WebUI.
- Regroup the existing API response in the browser. Do not add another API or SQL aggregation.
- Derive model-family display names with explicit rules for known routing prefixes, dated revisions,
  Claude name ordering, and terminal inference-profile suffixes.
- Keep different model versions and named variants such as `mini`, `spark`, `sol`, `terra`, and
  `luna` separate.
- Keep the raw model name in storage. Model-family detection only affects Token page grouping.
- Show compact parent totals with `M` or `B`. Expanded child rows show the complete integer.

## Consequences

- The two views use the same totals and date filters.
- Model-family grouping remains deterministic and testable. Unknown names remain separate.
- New naming patterns require an explicit rule and regression case before they are grouped.
