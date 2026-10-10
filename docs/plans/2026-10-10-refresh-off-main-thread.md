# Refresh Off The Main Thread — 2026-10-10

## Problem

The site fails to load while a provider refresh runs.

- Original OpenUsage plugins call the host synchronously (`ctx.host.http.request`, ccusage,
  `gh auth token`). The runtime implements these with `Bun.spawnSync`
  (`packages/providers/src/providers/openusage-plugin-runtime.ts:321`, `:394`;
  `openusage-plugin.ts:319`).
- `refreshProviders` (`apps/server/src/index.ts:435`) runs every provider on the server's
  only JavaScript thread. While a plugin waits on `spawnSync`, no HTTP request is served.
- Live evidence (2026-10-10, journal of `openusage-webui.service`): two full refreshes at
  17:36:37 and 17:37:19; the second Cursor refresh took 33 s. `GET /api/health`, which returns
  a constant object, took 24.2 s during that period and 0.0004 s afterwards.
- Triggers: every open browser tab calls `POST /api/providers/refresh` every 20 minutes
  (`apps/web/src/App.tsx:24`, `:125`) and on Refresh All. Two open tabs start two full
  refreshes.

## Changes

R1. Plugin refresh in a Worker. `OpenUsagePluginProvider.refresh()` runs the plugin in a Bun
`Worker` when it uses the default runtime (no injected `request`, `ccusageQuery`,
`ccusageRunner`, `gitHubTokenRunner` or `now`). The worker receives only serializable options
(`providerId`, `name`, `pluginId`, `scriptPath`/`scriptText`, `env`, `homeDir`,
`pluginDataDir`, `recordCcusageTokens`), constructs the same provider and calls its existing
in-thread refresh. Records and errors return by message. Providers with injected functions
keep the in-thread path, so existing tests keep their behavior. Storage writes stay on the
main thread. One worker per refresh call, terminated afterwards; a worker crash or timeout
becomes a provider refresh error (existing error path).

R2. Single-flight full refresh. Concurrent `POST /api/providers/refresh` calls share one
in-flight run and receive the same results. Single-provider refresh is unchanged.

## Out Of Scope

- Changing the plugin API to async or rewriting plugins.
- Server-side scheduled refresh; the tab-driven 20-minute refresh stays.
- Mobile layout (separate plan).

## Acceptance

- Test: while a plugin refresh with a slow synchronous host call runs through the worker
  path, a timer on the main thread fires before the refresh resolves (fails on current code).
- Test: worker path returns the same records as the in-thread path for a fixture plugin, and
  a plugin error surfaces as the same error message.
- Test: two concurrent full refresh requests run providers once.
- Existing suites and `bun run build:webui` pass.
- Live check after deploy: `GET /api/health` stays under 1 s during a full refresh.

## Routing

Coding High, engineering: Grok Build `grok-4.7` / `xhigh` implements; triple-review with the
fixed lanes.
