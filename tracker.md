# Tracker

Updated: 2026-08-11

## Token Usage Ingestion

- [x] Reproduce missing provider token records.
- [x] Normalize Claude and Codex daily model usage.
- [x] Aggregate complete Cursor usage events.
- [x] Prevent repeated-refresh, stale-model, and Refresh All double counting.
- [x] Preserve legacy cost and provenance during token de-duplication.
- [x] Update user documentation and README provider support.
- [x] Pass focused tests, plugin tests, production build, and independent review.
- [x] Open pull request #33; GitHub reports it as clean and mergeable with no configured checks.
- [x] Add Provider → Model and Model → Provider Token views.
- [x] Add deterministic model-family detection and compact M/B parent totals.
- [x] Capture and inspect before and after Token page screenshots.

## Plugin Fixture Isolation

- [x] Reproduce ambient GitHub, Cursor, and Antigravity credential access in provider fixtures.
- [x] Align configured provider homes with plugin-visible `HOME`.
- [x] Run credential-sensitive bundled fixtures inside isolated homes.
- [x] Pass all provider tests, the complete WebUI suite, and the production build.
- [x] Pass independent Codex GPT-5.6 review after correcting its Antigravity environment finding.
