# Allowance Delivery Review

Date: 2026-10-01
Status: Single independent review pending.
Plan: `docs/plans/2026-10-01-allowance-delivery.md`
Previous repairs: `docs/fix-logs/2026-10-01-grok-session-fix-log.md`

## Scope And Gate

The user requested one independent review of the complete pull request before merge, then live data correction and restart. The previous three reviews covered 19 selected files; this pass covers the complete commit and the local data correction procedure. The new explicit request replaces the earlier no-commit instruction and the normal three-lane gate.

The feature branch starts from deployed `main` as a hotfix delivery. Existing regression fixtures and failing/passing evidence are retained; their original uncommitted state prevents reconstruction of separate red/green commits without fabricating history.

## Plugin Redaction Audit

Diffs checked: `plugins/claude/plugin.js`, `plugins/codex/plugin.js`, `plugins/cursor/plugin.js`.

- Claude adds numeric absolute usage and limit values beside an existing percent meter.
- Codex reads existing numeric `used_percent` and `limit_window_seconds` fields and preserves existing reset timestamps.
- Cursor exposes numeric dollar usage/limit and the literal unit `usd`.
- No new HTTP endpoint, credential, identity field or request body is introduced. `src-tauri/src/plugin_engine/host_api.rs:397` already lists token, access/refresh token, user/account/team/org identifiers and email keys. Existing redaction fixtures at lines 3460 onward cover those fields. No gap requiring a new redaction rule or test was found.

## Browser Evidence

Both screenshots use Previous Period with the same live database. The before capture uses the existing backend at port 6736; the after capture uses corrected code through a GET-only preview. The already-built frontend is shared by both, so the comparison isolates the estimator's behavior rather than claiming a full visual redesign.

![Before](screenshots/2026-10-01-allowance-before.png)

![After](screenshots/2026-10-01-allowance-after.png)

## Live Correction Preflight

A consistent SQLite backup passed `PRAGMA integrity_check`. On a copy, the corrected importer rebuilt 212 records over 68 already-stored days for `codex:codex`, replacing 217 rows. Cost provenance: 205 standard-rate, three reported-day, four unknown. No additional historical day was imported. The confirmed sibling has no remaining stored local-log rows. An exact hash of non-Codex usage records remained unchanged, and record-by-record cost/token/provenance checks passed.

Evidence and scripts remain private under `docs/reviews/2026-10-01-delivery.local/`: `preflight.sqlite`, `codex-source.json`, `rewrite-codex.ts`, `rewrite-dry-run.json`. The first dry-run verification compared SQL NULL with the JSON text `null`; that verifier was corrected and the operation rerun on a fresh backup copy. No live data changed during preflight.

Before applying live, stop the exact inspected user service, take a fresh consistent backup and recollect local ccusage input. Limit rewriting to existing owner-account dates; retain unrelated providers and observations. Restart runs existing v2 snapshot replay. Keep the previous September price backup as well. If post-write checks fail, keep the service stopped until the failure is repaired or the fresh backup is restored.
