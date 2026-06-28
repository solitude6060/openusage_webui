# Fix Log: Dev Server Hot-Reload — Triple-Review Findings

Date: 2026-06-28
Review: `docs/reviews/2026-06-28-dev-server-hot-reload-triple-review.md`
Branch: `feat/dev-server-hot-reload`
Fix commit: `f710c76`

## #1 — Vite orphaned if a signal/throw lands during startup (Codex blocking; C low/pre-existing)

- **Repro:** signal handlers were registered after `await waitForFrontend`, so a Ctrl+C or a
  `waitForFrontend` timeout/throw during startup exited the process while the spawned Vite
  child was unmanaged (reparented to PID 1). Pre-existing in the old `dev.ts`, but in scope
  since the file is rewritten.
- **Fix:** `shutdown()` and the SIGINT/SIGTERM handlers are now registered **before** any
  `await`; `waitForFrontend` is wrapped in `try/catch` that calls `await shutdown(1)` (kills
  Vite) on failure.
- **Files:** `apps/server/src/dev.ts`.

## #2 — Transient orphan on crash-recovery teardown (correctness-review critical)

- **Repro:** `shutdown()` called `process.exit(0)` immediately after `kill()`; `kill(2)` only
  enqueues SIGTERM, so the parent exited before the surviving child handled it, orphaning it
  for the crash path (one child exits → `Promise.race` → kill the other → exit now).
- **Fix:** `shutdown(code)` is async and `await`s `Promise.all([vite.exited, api.exited])`
  (with a 5s `Bun.sleep` grace so it can't hang) before `process.exit(code)`.
- **Verification:** live — SIGTERM to the orchestrator alone leaves **no** orphaned Vite/API
  process and frees ports 6736/6737.
- **Files:** `apps/server/src/dev.ts`.

## #3 — `shutdown()` always exited 0 (Codex minor)

- **Fix:** the final `Promise.race` captures the exiting child + its code; `shutdown` exits
  with that code (`?? 1`), so a child crash surfaces a non-zero exit to CI/supervisors.
- **Files:** `apps/server/src/dev.ts`.

## #4 — Prod footgun: `OPENUSAGE_WEBUI_DEV_FRONTEND_URL` (robustness low, new)

- **Repro:** the prod self-start now reads this env var; an operator who happened to export
  it would flip `start:webui` into proxy-to-Vite mode.
- **Fix:** sharpened the `index.ts` comment to state it is INTERNAL/dev-only and must not be
  set in production. (Consistent with the existing env-config convention; documented at the
  read site rather than adding argv plumbing.)
- **Files:** `apps/server/src/index.ts`.

## #5 — `waitForFrontend` 8s timeout tight on cold CI (correctness nit)

- **Fix:** bumped to 30s (deadline-based loop) with a clearer timeout message.
- **Files:** `apps/server/src/dev.ts`.

## #6 — No dev-docs note on auto-reload (robustness optional)

- **Fix:** added a one-line note to `README_WEBUI.md` that backend edits hot-reload (API
  under `bun --watch`, Vite HMR), no manual restart needed.
- **Files:** `README_WEBUI.md`.

## Verification after fixes
- `bun build` of `index.ts` + `dev.ts`: compile clean.
- `apps/server` tests: 16 passed.
- Live: hot-reload keeps the Vite PID stable; clean shutdown leaves no orphan.
