# Plugin Fixture Isolation Plan

## Goal

Make plugin tests independent of credentials and configuration stored in the developer's real home directory.

## Work

- Add a regression test that keeps a provider's `homeDir`, `HOME`, and plugin data under one isolated root.
- Make the GitHub Copilot and bundled plugin fixtures use isolated home and plugin data directories.
- Keep the Antigravity Cloud Code fixture inside its isolated home.
- Preserve production credential priority and plugin behavior.

## Verification

- Run the provider isolation and fixture tests.
- Run the complete WebUI test suite.
- Run the production WebUI build.

## Documentation

- Update `status.md`, `tracker.md`, and `handover.md` with the final results.

## Result

- Complete WebUI suite: 236 passed, 0 failed.
- Production WebUI build: passed.
- Independent review: approved after the ambient Antigravity account-pin finding was corrected.
- Review: `docs/CODEX_2026-08-11_PLUGIN_FIXTURE_ISOLATION_REVIEW.md`.
- Fix log: `docs/CODEX_2026-08-11_PLUGIN_FIXTURE_ISOLATION_FIX_LOG.md`.
