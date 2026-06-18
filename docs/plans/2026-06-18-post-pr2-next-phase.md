# Post-PR2 Next Phase Plan

Date: 2026-06-18
Branch: `codex/webui-post-pr2-planning`
Base: `dev` at `203c6f8`

## Goal

Turn the merged provider-adapter work into a safer, easier-to-test WebUI iteration:

- Keep the original OpenUsage provider behavior working through the WebUI host shims.
- Improve the local dashboard experience without changing the app into a marketing page.
- Keep every change on a feature branch with TDD, review artifacts, and a merge gate before returning to `dev`.

## Constraints

- Do not touch the original Tauri panel/tray code unless a doc or compatibility fix requires it.
- Do not add browser cookie scraping, external telemetry, remote sync, or public network exposure.
- Keep local server binding to `127.0.0.1`.
- Preserve provider credential isolation and avoid logging secrets.
- Run triple review before merge; blocked reviewer lanes require explicit replacement approval.

## Candidate Scope

1. Live local smoke pass
   - Start WebUI on `127.0.0.1:6736`.
   - Verify dashboard, providers, sessions, and settings load after PR2 merge.
   - Record any layout/runtime regressions with screenshots.

2. Provider status clarity
   - Make plugin-backed providers clearer about "adapter loaded" vs "logged in" vs "refresh failed".
   - Add focused tests for any status-label changes.

3. UI polish
   - Improve dense provider/session readability.
   - Fix layout issues found during screenshot review.
   - Keep controls utilitarian and app-like; no landing-page redesign.

4. Review follow-ups
   - Decide whether to add a `gh` token runner seam to remove global `Bun.spawnSync` monkeypatching in tests.
   - Decide whether `parseDateMs` should document milliseconds-only input or share the `toIso` seconds heuristic.
   - Decide whether bundled error-string tests should keep exact upstream-copy pinning or use substring assertions.

## TDD / SDD Plan

- Write or update tests before behavior changes.
- For UI changes, capture before/after screenshots and document visual intent.
- Keep each fix small enough for direct review.
- Re-run `bun run test:webui`, `bun run build:webui`, and `git diff --check` before review.

## Progress

- Live smoke found and fixed the favicon probe noise; see `docs/reviews/2026-06-18-post-pr2-live-smoke.md`.
- Provider status labels now distinguish ccusage-backed cards from directly detected providers.
- GitHub token lookup tests now use an injectable runner seam instead of patching global `Bun.spawnSync` for ordinary cases.
- `parseDateMs` now shares the same seconds-versus-milliseconds timestamp heuristic as `toIso`.

## Merge Gate

- AGY review.
- Claude review.
- Third lane: Claude-MM when available; otherwise use the explicitly approved fallback reviewer and record the substitution.
- All accepted CRITICAL/HIGH/MEDIUM findings fixed or explicitly waived with evidence.
