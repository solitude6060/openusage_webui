# Token Grouping UX Plan

## Observed State

- The running development server at `127.0.0.1:6746` returns token data after a refresh. The existing
  `127.0.0.1:6736` process was started before the current branch and remains on its loaded code.
- The Token API already returns enough provider and model totals for both grouping directions.
- Model strings include known routing, dated revision, and inference-profile variants.

## Scope

1. Add failing pure-function tests for compact totals, model-family detection, and both grouping
   directions.
2. Add a Provider → Model / Model → Provider control to the Tokens page.
3. Show compact parent totals and complete integers in expanded child rows.
4. Apply conservative model-family detection without changing stored raw model names.
5. Update `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, and
   `docs/USER_GUIDE_WEBUI.zh-TW.md`.
6. Add before and after screenshots under `docs/screenshots/`.

## Constraints

- Do not change the token API, storage schema, or ingestion identity.
- Do not use fuzzy string matching.
- Do not merge distinct versions or named variants.
- Reuse the existing chip controls and expandable table.
- Keep title copy in title case.

## Exit Criteria

- Both grouping directions preserve the same total token count and record count.
- Known aliases group under one model family; distinct versions remain separate.
- Parent totals use `M` or `B`; expanded rows use complete formatted integers.
- Token page tests and the production WebUI build pass.
- The live page at `127.0.0.1:6746/tokens` is visually verified with an after screenshot.
