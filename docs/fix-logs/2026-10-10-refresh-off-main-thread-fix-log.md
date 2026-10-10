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

## RR1-2: Account Changes During Refresh

- Regressions: six successful/failed probes cover account deletion, replacement through the account endpoint, and status removal; two cover disabling through the enabled endpoint. A ninth replaces the provider during a pending full refresh and requests a new full run plus a shared request.
- Red: `rr1-2-red.log`, 9 failed; obsolete writes occurred, disabled status reverted, and the new full request received old results.
- Fix: success and failure branches re-read status and check provider object identity before usage, quota, probe failure, or status writes. Removed status is not recreated; injected providers without initial status retain first-refresh behavior. Both branches use the current enabled flag. Full single-flight compares provider-list identity, and an older run only clears its own promise.
- Files: `apps/server/src/index.ts`, `apps/server/test/refresh-account-safety.test.ts`, `README_WEBUI.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md`.
- Green: `rr1-2-green.log`, 13 passed, 0 failed across the account and queue suites.

## RR1-3: Environment Masking

- Regression: `preserves undefined environment masking in worker ccusage calls` launches an isolated Bun process with an ambient test key. A fake ccusage executable reports whether that key survived a provider override of `undefined`; real worker and in-thread records are compared.
- Initial observation: changing `process.env` after test-process startup did not expose the bug. `rr1-3-inherited-red.log` reproduced it when the key was inherited at startup. The final fixture sets its own child-process startup environment.
- Red: `rr1-3-red.log`, 1 failed; the worker reports fixture value 99 while the masked in-thread path reports 17.
- Fix: pass the provider environment directly through structured clone and retain `string | undefined` in the worker options type.
- Files: `packages/providers/src/providers/openusage-plugin.ts`, `packages/providers/src/providers/openusage-plugin-refresh-worker.ts`, `packages/providers/test/openusage-plugin-worker.test.ts`.
- Green: `rr1-3-green.log`, 3 passed, 0 failed, including the real worker/in-thread environment comparison.
