# Refresh Off The Main Thread — Repair Log

Contract and triage: [review round 1](../reviews/2026-10-10-refresh-off-main-thread-review.md).
Persistent command output: `docs/fix-logs/2026-10-10-refresh-off-main-thread.local/`.

## RR1-4: Handler Ownership

- Regression: `keeps full refresh state inside each handler` holds one handler's provider while a second handler requests its own provider using separate SQLite storage.
- Red: `rr1-4-red.log` reports zero second-provider calls instead of one. Production files were still at `3cae978`.
- Fix: move the full-refresh promise and refresh callback into `createRequestHandler`; pass that callback to the API router.
- Files: `apps/server/src/index.ts`, `apps/server/test/refresh-single-flight.test.ts`.
- Green: `rr1-4-green.log`, 4 passed, 0 failed.

## RR1-1: Refresh Ordering

- Regressions: `queues concurrent single-provider refreshes as separate runs` and `waits for an in-flight full refresh before a separate single-provider refresh` hold the first provider behind a deferred promise and drain runnable continuations with `setImmediate`.
- Red: `rr1-1-red.log`, 2 passed and 2 failed; both failures report two active provider calls instead of one.
- Fix: one promise queue inside each handler covers every refresh run through its storage writes. Full refreshes retain single-flight behavior; individual requests keep separate results. A queued run reads the provider list when it starts. Queue settlement preserves errors for the caller and allows subsequent runs.
- Files: `apps/server/src/index.ts`, `apps/server/test/refresh-single-flight.test.ts`; ordering documented in the plan, `README_WEBUI.md`, and `docs/USER_GUIDE_WEBUI.zh-TW.md`.
- Green: `rr1-1-green.log`, 4 passed, 0 failed; both overlap regressions observe at most one active provider call.
