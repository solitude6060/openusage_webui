# WebUI MiniMax API Provider Plan

## Goal

Use the original OpenUsage MiniMax tracking method in the local WebUI: query MiniMax Token Plan remains APIs with a user-provided API key from environment variables.

## Scope

- Add an automatic `MiniMaxProvider` under `packages/providers`.
- Read API keys from the same environment variables as the original plugin:
  - `MINIMAX_CN_API_KEY`
  - `MINIMAX_API_KEY`
  - `MINIMAX_API_TOKEN`
- Try CN first when `MINIMAX_CN_API_KEY` is present, otherwise try Global first.
- Query:
  - `https://www.minimax.io/v1/token_plan/remains`
  - `https://api.minimaxi.com/v1/token_plan/remains`
- Normalize returned quota data into a local API snapshot usage record with `source: "api"`.
- Keep manual MiniMax entries supported through `POST /api/manual/usage`.

## Non-Goals

- No browser cookies.
- No MiniMax web login.
- No dashboard scraping.
- No proxy forwarding.
- No plain-text API key storage in SQLite or config files.
- No attempt to convert MiniMax prompt quota into token counts.

## TDD Plan

1. Missing API key:
   - `detect()` returns false.
   - `refresh()` throws the original missing-key message.
2. Global API key:
   - sends `Authorization: Bearer <key>` to the Global endpoint.
   - normalizes count payload into a stable `minimax` API snapshot.
3. CN API key:
   - tries CN first.
   - converts CN model-call counts to prompt counts with the original `15` divisor.
4. Percent fallback:
   - uses `current_interval_remaining_percent` when count totals are not displayable.
5. Registry:
   - uses the automatic `MiniMaxProvider` instead of the no-op manual provider.

## Data Model Decision

MiniMax Token Plan remains APIs return quota snapshots, not per-request token usage. The WebUI will store one stable snapshot record per region/model/window in `usage_records.raw` and leave token/cost fields empty. This preserves the original provider semantics without pretending prompt quota is token usage.

## Verification

- `bun test packages/providers/test/minimax-provider.test.ts`
- `bun run test:webui`
- `bun run build:webui`
- Local smoke for `/api/providers/minimax/refresh` with no key must return a provider-level error without failing other providers.
