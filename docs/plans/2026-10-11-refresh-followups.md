# Refresh Follow-Ups — 2026-10-11

Deferred items from `docs/fix-logs/2026-10-10-refresh-off-main-thread-fix-log.md`.

F1. Refresh requests and the HTTP idle timeout. `apps/server/src/index.ts` sets
`idleTimeout: 120`. A single-provider refresh now waits in the per-handler queue behind a full
refresh; queue wait plus run can exceed 120 s, so the client loses the connection before it gets
its result. Repair: refresh endpoints (`POST /api/providers/refresh`,
`POST /api/providers/:id/refresh`) must not be cut by the idle timeout while queued or running
(e.g. Bun `server.timeout(request, 0)` for those requests), keeping the 120 s worker timeout per
provider. Other endpoints keep 120 s.

Behavior documentation: `README_WEBUI.md` and `docs/USER_GUIDE_WEBUI.zh-TW.md`.

F2. Bundled server worker path. `bun run --cwd apps/server build` produces `apps/server/dist`,
where `import.meta.url` points at the bundle and `openusage-plugin-worker.ts` is absent, so every
default plugin refresh from the bundle fails. Repair: make the bundle carry a runnable worker
entry and resolve it in both layouts (source and bundle), or stop producing a server bundle if
nothing uses it — choose the smaller correct change and record why.

Implementation choice: retain the server bundle. `build:webui` already builds it; adding
the worker as a second entry and resolving `.ts` in source / `.js` in the bundle preserves
the existing build command and emits both files together. Removing the bundle would
change that workflow. Document the output in `README_WEBUI.md`.

Acceptance: regression tests that fail on `d8479dc`; for F2, a test or scripted check that runs a
default plugin refresh from the built bundle. Existing suites and `bun run build:webui` pass.

Routing: Codex `gpt-6.1-sol` / `xhigh` implements (user choice); triple-review fixed lanes.
