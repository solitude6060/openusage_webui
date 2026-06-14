# WebUI Phase 0-1 Review Fix Log

## Summary

Triple review requested changes before `dev` could merge to `main`. The accepted findings were fixed with regression tests first, then minimal implementation changes.

## TDD Red

`bun run test:webui` failed after adding regression tests:

- Manual repeated entries produced the same ID.
- Summary over 1001 records returned only 1000.
- API tests initially exposed the need for a request-handler test seam and then covered bad request/Host/refresh behavior.

## Fixes

- Manual records now use UUID IDs because user-entered records need uniqueness, not import idempotency.
- Summary no longer calls the paginated record listing path.
- API request handling is testable without binding a port.
- Unknown provider IDs and malformed JSON return `400 BAD_REQUEST`.
- Unexpected Host headers return `403 FORBIDDEN_HOST`.
- `ccusage` refresh is a neutral Phase 1 no-op.
- Static frontend serving checks that a target is a file.
- WebUI navigation listens for `popstate`.
- Dev proxy waits for Vite before starting the outer server.

## Verification

- `bun run test:webui`: 12 pass, 0 fail.
- `bun run build:webui`: pass.
- Local smoke test on `127.0.0.1:6736`: pass.

## Deferred

- SQL-level aggregate optimization for large datasets.
- Formal frontend component tests.
- Full settings schema validation.
- Real ccusage detection, refresh, JSON parsing, and raw fallback storage in Phase 2.
