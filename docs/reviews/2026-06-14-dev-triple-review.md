# Dev Branch Triple Review

## Context

- Branch: `dev`
- Base: `main`
- Reviewed commit: `4284bb5da8870e11e9e95efe9296ed9bcaa53f5a`
- Scope: WebUI Phase 0-1

## Reviewer Results

| Reviewer | Verdict | Notes |
|---|---|---|
| agy | REQUEST CHANGES | Found SPA history, static asset directory, 1000-row summary cap, ccusage refresh UX, and manual ID collision issues. |
| claude | REQUEST CHANGES | Found manual ID collision, ccusage refresh UX, 1000-row summary cap, Host allowlist hardening, and missing endpoint tests. |
| claude-mm fallback | REQUEST CHANGES | Found 1000-row summary cap, 500-vs-400 API errors, provider card mismatch, dev server readiness, and missing endpoint tests. |

## Triage

| Finding | Source | Severity | Verified Evidence | Action |
|---|---|---:|---|---|
| Manual usage records can overwrite identical same-minute entries | agy, claude | HIGH | `packages/providers/src/providers/manual.ts` used deterministic content hash, while storage upserts by ID. | Fixed with UUID IDs and regression test. |
| Usage summary aggregates only latest 1000 rows | agy, claude, claude-mm | HIGH | `getUsageSummary()` called `listUsageRecords({ limit: 1000 })`. | Fixed by reading the full usage table for summary and adding 1001-row regression test. |
| `Refresh All` always reports ccusage error in Phase 1 | agy, claude | MEDIUM | `CcusageProvider.refresh()` threw a Phase 2 placeholder error. | Fixed by making Phase 1 ccusage refresh a neutral no-op. |
| Client errors return 500 instead of 400 | claude, claude-mm | MEDIUM | Unknown provider and malformed JSON bubbled to the generic 500 handler. | Fixed with `HttpError`, JSON parsing helper, and API tests. |
| Missing Host allowlist for local write API | claude | MEDIUM | Request handler accepted any Host header that reached localhost. | Fixed with localhost/127.0.0.1 Host allowlist and test. |
| Static asset directory request can try to serve a directory | agy | MEDIUM | `existsSync(filePath)` accepted directories. | Fixed by checking `statSync(filePath).isFile()`. |
| Browser Back/Forward does not update SPA state | agy | HIGH | App updated state on `pushState` but had no `popstate` handler. | Fixed with `popstate` listener. |
| Dev server proxies before Vite is ready | claude-mm | MEDIUM | `dev.ts` spawned Vite and immediately started the proxy server. | Fixed with readiness polling before starting the proxy. |
| Provider card/count mismatch | claude-mm | MEDIUM | Providers page intentionally shows Phase 2 cards "via ccusage"; API registers only three providers. | Deferred. The current UI labels those cards as `via ccusage`; Phase 2 will wire them through ccusage. |
| Health endpoint has constant DB status | claude | LOW | `database: "ok"` is returned after init succeeds. | Deferred. Current health route is Phase 0 smoke signal; future DB ping can be added. |
| Negative numeric values are accepted | claude | LOW | API numeric helper accepts any finite number. | Deferred. Local MVP currently trusts client input; boundary validation can be added with broader input schema work. |

## Verification After Fixes

- `bun run test:webui`: 12 pass, 0 fail.
- `bun run build:webui`: web and server builds pass.
- Live smoke test on `127.0.0.1:6736` with temporary data dir:
  - `GET /api/health`: 200.
  - Unexpected `Host`: 403 `FORBIDDEN_HOST`.
  - `POST /api/providers/refresh`: 200 with ccusage/manual/minimax no-op success results.
  - `POST /api/manual/usage`: 201 with UUID ID.
  - Malformed JSON: 400 `BAD_REQUEST`.
  - Unknown provider: 400 `BAD_REQUEST`.
  - `GET /api/usage/summary`: reflects multiple identical manual records.
