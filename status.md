# Project Status

Updated: 2026-08-09

## Current State

- Pull request #33 fixes the WebUI Tokens page ingestion path for Claude, Codex, and Cursor.
- Repeated refreshes replace the same dated model totals. Refresh All keeps Claude and Codex on
  their plugin paths, while generic ccusage retains Gemini and GitHub Copilot rows.
- Legacy overlapping token fields are cleared on the first complete plugin refresh. Existing cost
  and raw provenance remain stored.
- Independent verification approved the final change after the duplicate-ingestion and legacy-data
  findings were fixed.

## Verification

- Focused Bun tests: 69 passed, 0 failed.
- Claude, Codex, and Cursor plugin Vitest tests: 72 passed, 0 failed.
- Production WebUI build: passed.
- Full WebUI suite: 225 passed, 4 failed in provider fixture and process-cleanup cases. Their causes
  were not determined in this task; the affected token ingestion tests pass.

## Risk

- A live refresh against configured external provider accounts has not been run.
