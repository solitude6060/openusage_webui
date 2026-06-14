# WebUI Phase 3 Production Local Server

## Goal

Make `bun run build:webui` plus `bun run start:webui` a reliable production-like local flow:

- API and built frontend are served from the same server.
- Server binds to `127.0.0.1:6736`.
- SPA routes such as `/dashboard`, `/providers`, `/sessions`, and `/settings` return the built `index.html`.
- Missing frontend build output fails loudly instead of serving an empty or confusing response.
- Existing Tauri app files remain untouched.

## Non-Goals

- No Tauri packaging changes.
- No AppImage, deb, rpm, or tray work.
- No provider expansion beyond the existing Phase 2 ccusage/manual/minimax behavior.
- No browser cookie scraping or cloud sync.

## TDD Plan

1. Add server tests for static production serving:
   - `/dashboard` returns the built `index.html`.
   - static assets keep their content type.
   - missing `apps/web/dist/index.html` returns a clear JSON server error.
2. Implement the smallest server changes to pass those tests.
3. Run `bun run test:webui`.
4. Run `bun run build:webui`.
5. Smoke `bun run start:webui` on `127.0.0.1:6736` after checking the port is free:
   - `GET /api/health`
   - `GET /dashboard`
   - verify no server remains running after smoke.

## Review Gate

Run triple review before merge using:

- Claude
- Gemini or `agy`
- `opencode` with `opencode/deepseek-v4-flash`

All critical, high, and medium findings must be fixed or explicitly triaged before merge.

## Verification Log

- `bun test apps/server/test/api.test.ts`: passed, 12 tests.
- `bun run test:webui`: passed, 40 tests.
- `bun run build:webui`: passed.
- `bun run start:webui` smoke on `127.0.0.1:6736` with `OPENUSAGE_WEBUI_DIR=/tmp/openusage-webui-phase3-smoke`:
  - `GET /api/health`: `200`, JSON ok.
  - `GET /dashboard`: `200`, `text/html`, built `index.html`.
  - `GET /assets/index-Bk9lO7YM.css`: `200`, `text/css`.
- Post-smoke check: no listener remains on `127.0.0.1:6736`.

## Review-Fix Coverage

- Missing frontend builds now emit a structured `frontend_build_missing` server log before returning JSON error output.
- Static production tests cover `/`, SPA routes, asset MIME types, and path traversal attempts staying inside the built frontend directory.
