# WebUI Phase 3 Triple Review

Date: 2026-06-15
Branch: `codex/webui-phase3-production-server`
Base: `main` at `2547e88`

## Scope

Review Phase 3 production local server work:

- `bun run build:webui`
- `bun run start:webui`
- Serve API and built frontend from `127.0.0.1:6736`
- Keep SPA routes working from the Bun server
- Keep original Tauri app untouched

## Verification Before Final Review

- `bun test apps/server/test/api.test.ts`: passed, 12 tests.
- `bun run test:webui`: passed, 40 tests.
- `bun run build:webui`: passed.
- `bun run start:webui` smoke on `127.0.0.1:6736`:
  - `GET /api/health`: `200`, JSON ok.
  - `GET /dashboard`: `200`, `text/html`.
  - `GET /assets/index-Bk9lO7YM.css`: `200`, `text/css`.
  - `GET /..%2foutside.txt`: `200`, `text/html` fallback without reading outside `dist`.
- Post-smoke check: no listener remained on port `6736`.

## Review Lanes

| Reviewer | Result | Blocking Findings |
| --- | --- | --- |
| Claude | APPROVE | None |
| Gemini | APPROVE | None |
| opencode `opencode/deepseek-v4-flash-free` | APPROVE | None |

`opencode/deepseek-v4-flash` was attempted first, but the provider returned a billing error. The third review lane used the same provider's free DeepSeek v4 flash model instead. MiniMax was not used.

## Findings Fixed During Review

- Missing frontend builds now emit a structured `frontend_build_missing` log before returning `FRONTEND_BUILD_MISSING`.
- Static serving tests now cover `/`, SPA routes, common MIME types, and missing frontend build output.
- The path traversal regression test now uses encoded traversal (`..%2f`) so it reaches the handler-level decoder instead of being normalized away by the URL parser.
- Static serving now strips leading path separators after normalization before joining into the Vite `dist` directory.

## Non-Blocking Follow-Ups

- Consider adding `.map` and `.mjs` MIME mappings if Vite source maps or alternate module outputs are enabled later.
- Consider replacing the current normalization chain with an explicit `resolve` plus containment check if static serving expands beyond this Bun-only local server.

## Merge Recommendation

Merge Phase 3 into `main`.
