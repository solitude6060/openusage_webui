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

## Final Verification

- Baseline check: temporarily restore the three changed production files from `3cae978`, keeping repaired bytes in persistent backups and restoring them through an exit trap. `baseline-3cae978-red.log` reports 3 passed and 13 failed. Every safety regression fails for its intended assertion; there are no import or fixture errors.
- `bun run test -- --run`: exit 0, 1193 passed across 66 files (`vitest.log`).
- `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`: exit 0, 373 passed across 43 files (`buntest.log`).
- The known ccusage timeout-cleanup and Antigravity Cloud Code fixture tests both passed in this run. No unrelated test was modified.
- `bun run build:webui`: exit 0; TypeScript, Vite, and server Bun bundle completed (`build-webui.log`). Building the bundle does not verify its worker path; that finding remains explicitly deferred.
- Final source inspection removed the provider accessor made unused by the callback routing change. No other adjacent cleanup was performed.
- After that removal: `bun test apps/server/test` passed 51 tests across 7 files (`server-final.log`), and `bun run build:webui` passed again. `git diff --check` passed.
- Scope: no push, PR, new review round, live data modification, service operation, other-worktree modification, or `.sisyphus/` modification. All commits retain the requested `Claude-Session` trailer.

First-principles check: the task restores refresh ordering and account validity after worker execution introduces interleaving. Deferred providers verify those actual interleavings; an executable fixture verifies environment masking across the real worker boundary. The queue and commit guards address the observed failures without changing plugin logic. Independent re-review before merge remains pending outside this implementer assignment.

## Roles And Review Record (Orchestrator)

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, planning, verification | Claude Code, `claude-opus-5-5` |
| Implementer R1/R2 (`bb0ec09`–`3cae978`) | Grok Build, `grok-4.7`, `xhigh` |
| Implementer RR1-1–RR1-4 (`e7c5cb9`–`9a9bc66`) | Codex, `gpt-6.1-sol`, `xhigh` (user allowed Sol to implement part of the work) |
| Review lanes | 1 Grok Build `grok-4.7` `high`; 2 AGY `gemini-3.8-flash-high` `high`; 3 Codex `gpt-6.1-sol` `high` |

Family overlap: round 1 lane 1 shares the R1/R2 implementer family (xAI); round 2 lane 3 shares the
RR1 implementer family (OpenAI). Each review ran in a fresh read-only session.

Pre-review QA (orchestrator, `3cae978`, database copy on port 6740): two concurrent full refreshes
returned in 21.7 s and ran each provider once; `GET /api/health` max 0.013 s during the run
(24.2 s on the live service before this branch).

Round 1 (`ff1abf1..3cae978`): Grok REQUEST_CHANGES (1 HIGH, 1 MEDIUM, 1 LOW), AGY APPROVE, Codex
REQUEST_CHANGES (2 HIGH, 2 MEDIUM). The Grok HIGH and MEDIUM match RR1-2 and RR1-1.

Round 2 (`3cae978..3d00791`): Grok APPROVE, AGY APPROVE, Codex REQUEST_CHANGES:

| ID | Finding | Severity (lane) | Verified evidence | Disposition |
|----|---------|-----------------|-------------------|-------------|
| RR2-1 | After the identity/status check, the commit spans several `await`s, so an account change could interleave | HIGH (Codex) | Every storage method used in the commit is synchronous bun:sqlite; the only real I/O `await`s in `sqlite-storage.ts` are in initialization (lines 80–90). After the check the commit runs as microtasks in one event-loop turn, so no HTTP request can run in between. Codex reproduced it with an in-memory storage stub that yields to the event loop. Lane 1 reached the same conclusion independently. | Not applicable with the current storage; recorded as an invariant: if storage becomes truly asynchronous, the commit needs a lock shared with account mutations. |
| RR2-2 | A single refresh queued behind a full refresh can exceed the 120 s `idleTimeout` | MEDIUM (Codex) | Before this branch a full refresh blocked every request, including that one. Measured full refresh: 21.7 s; slowest provider 33 s. | Deferred follow-up: request-level timeout policy covering queue wait. |
