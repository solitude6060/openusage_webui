# Refresh Off The Main Thread — Repair Log

Contract and triage: [review round 1](../reviews/2026-10-10-refresh-off-main-thread-review.md).
Persistent command output: `docs/fix-logs/2026-10-10-refresh-off-main-thread.local/`.

## RR1-4: Handler Ownership

- Regression: `keeps full refresh state inside each handler` holds one handler's provider while a second handler requests its own provider using separate SQLite storage.
- Red: `rr1-4-red.log` reports zero second-provider calls instead of one. Production files were still at `3cae978`.
- Fix: move the full-refresh promise and refresh callback into `createRequestHandler`; pass that callback to the API router.
- Files: `apps/server/src/index.ts`, `apps/server/test/refresh-single-flight.test.ts`.
- Green: `rr1-4-green.log`, 4 passed, 0 failed.
