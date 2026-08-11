# Project Status

Updated: 2026-08-11

## Current State

- Pull request #33 fixes the WebUI Tokens page ingestion path for Claude, Codex, and Cursor.
- Repeated refreshes replace the same dated model totals. Refresh All keeps Claude and Codex on
  their plugin paths, while generic ccusage retains Gemini and GitHub Copilot rows.
- Legacy overlapping token fields are cleared on the first complete plugin refresh. Existing cost
  and raw provenance remain stored.
- The Tokens page supports Provider → Model and Model → Provider views, compact M/B parent totals,
  exact expanded values, and deterministic model-family grouping.
- Plugin providers now keep filesystem expansion, plugin-visible `HOME`, and local keychain data
  under one canonical home. Credential-sensitive fixtures no longer read developer account data.
- Independent verification approved the final change after the duplicate-ingestion and legacy-data
  findings were fixed.

## Verification

- Focused Bun tests: 74 passed, 0 failed.
- Claude, Codex, and Cursor plugin Vitest tests: 72 passed, 0 failed.
- Production WebUI build: passed.
- Live provider refresh and visual Token page verification: passed at `127.0.0.1:6746`.
- Provider tests: 141 passed, 0 failed.
- Full WebUI suite: 236 passed, 0 failed.
- Independent Codex GPT-5.6 review: approved after the ambient Antigravity account-pin finding was fixed.
