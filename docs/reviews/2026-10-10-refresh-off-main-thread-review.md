# Refresh Off The Main Thread — Review Round 1

Reviewed revision: `3cae978870ec385d7d8075c9d8ce4f3327bfd1cf`.
Raw verdicts: `../openusage_webui-artifacts/2026-10-10-refresh/triple-review-r1/lane*.verdict.md`.
Repair contract: the four findings verified by the orchestrator and per-finding test/fix commits.

| Finding | Severity | Risk? | This PR? | Why |
| --- | --- | --- | --- | --- |
| RR1-1: overlapping provider refreshes | HIGH | Credential rotation and stale usage replacement | Yes | `apps/server/src/index.ts:448` bypasses the full-refresh promise; `plugins/codex/plugin.js:233,288` rotates and persists credentials. Queue all runs inside each handler. |
| RR1-2: stale writes after account changes | HIGH | Deleted records return; disabled providers become enabled | Yes | `apps/server/src/index.ts:476-508` writes after awaiting a provider using its earlier status. Check current provider identity and stored status in both result branches. |
| RR1-3: explicit undefined environment values disappear | MEDIUM | Worker reads ambient configuration that the provider masked | Yes | `openusage-plugin.ts:200-205` filters values while `openusage-plugin-runtime.ts:359` merges ambient and provider environments. Preserve undefined properties. |
| RR1-4: refresh state crosses handlers | MEDIUM | A handler receives another handler's provider results | Yes | `apps/server/src/index.ts:435` owns a module-level promise. Move refresh state into `createRequestHandler`. |
| Bundled worker entry path | LOW | Default plugin refresh from the server bundle fails | No | Deferred by the orchestrator; the service runs `bun src/index.ts`. |

Repair order: RR1-4, RR1-1, RR1-2, RR1-3. Handler ownership precedes the queue so each test/fix pair isolates one finding. Tests use deferred promises and controlled fixtures. The implementation task ends after the specified suites and build; no push, deployment, or new review round is authorized.

Fix evidence: [repair log](../fix-logs/2026-10-10-refresh-off-main-thread-fix-log.md).
