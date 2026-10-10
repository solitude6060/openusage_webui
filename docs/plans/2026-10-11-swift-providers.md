# Swift-Only Providers: Ollama, OpenRouter, Pi — 2026-10-11

Decisions (orchestrator, following upstream source behavior; user may override):
1. Ollama is disabled by default, as upstream.
2. `host.crypto.ed25519Sign` is added to the WebUI host only; the Tauri desktop host returns a clear error.
3. Pi rows for providers other than Claude and Codex (e.g. `xai`) are dropped, as upstream.
4. No `OLLAMA_API_KEY` Bearer path in this port.

Routing: OpenRouter and Ollama — Claude `claude-sonnet-5-5` / `xhigh`; Pi scanner — Codex
`gpt-6.1-sol` / `xhigh` (user choice: GPT-6.1 and Sonnet). One pull request per provider;
triple-review fixed lanes.

## Problem

Backlog item: "original Swift providers Ollama / OpenRouter / Pi have no JS plugin here"
(first recorded in `docs/plans/2026-09-20-grok-build-session-tokens.md:33`). Upstream
`robinebers/openusage` `main` is a Swift rewrite; our JS plugin lineage is `tauri-legacy`, so
these three were never ported.

The item is accurate for Ollama and OpenRouter: upstream registers both as provider cards in
`Sources/OpenUsage/Providers/ProviderCatalog.swift` (`OllamaProvider()`, `OpenRouterProvider()`).

The item is inaccurate for Pi. Upstream has no Pi provider card: `ProviderCatalog.make` never
instantiates a Pi runtime. "Pi" upstream is the pi coding agent CLI (BYO-key agent; config dir
`~/.pi/agent`, overrides `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`; repository
`badlogic/pi-mono`, now redirected to `earendil-works/pi`, described as "AI agent toolkit: unified
LLM API, agent loop, TUI, coding agent CLI"). Upstream uses it in two ways:

1. `PiUsageScanner` reads pi session logs (`~/.pi/agent/sessions/**/*.jsonl`) and folds token and
   cost usage into the Claude and Codex cards' usage history (`ClaudeProvider.swift:313`,
   `CodexProvider.swift:245`).
2. `PiCodexLoginScanner` treats pi's `openai-codex` OAuth login in `~/.pi/agent/auth.json` as a Codex
   credential source and decides which Codex account card claims pi usage.

So the Pi deliverable is a session-log scanner attached to the existing Codex and Claude plugin
refreshes (same pattern as `packages/providers/src/providers/grok-session-usage.ts` and the
`if (this.pluginId === "grok")` hook in `openusage-plugin.ts`), not a new `plugins/pi/`.

## Source Record

- Upstream: https://github.com/robinebers/openusage, branch `main`, commit
  `bb7de176def23a99bbdcaabe1ac7269f18c738be` (2026-10-10T08:01:19Z). License: MIT (repository
  `LICENSE`; GitHub reports `MIT`). Keep the MIT notice when copying the SVG logos.
- Last commits touching each directory at the pin: Ollama `677d886eb7` "fix(ollama): read credits
  and limits from /api/balance (#1368)"; OpenRouter `dc2d3cb581` "fix(openrouter): use
  current-window spend for Key Limit (#1109)"; Pi `b5a6e56e5f` "fix(codex): make auto-review free
  from October 6 (#1354)".
- Files read (sha256 of the file at the pin):

| File | sha256 |
| --- | --- |
| `Sources/OpenUsage/Providers/Ollama/OllamaAuthStore.swift` | `89623e993ea22e8bcd4665c937ecd3cabc06f2c5a0a7139fb7bbd27b35bd13be` |
| `Sources/OpenUsage/Providers/Ollama/OllamaProvider.swift` | `1f9db772cc1101e7f82730a92eb4f15b299d33b0909c26cefafbe5b0adc523bb` |
| `Sources/OpenUsage/Providers/Ollama/OllamaUsageClient.swift` | `fcde3fa17048441b52fa531f2e454f6e36da2b7fe8affb39a75cc56d2e7162ff` |
| `Sources/OpenUsage/Providers/Ollama/OllamaUsageMapper.swift` | `10ebbd4feb79d93e3d01c1dceb91d827035198a0a24f84c1340e73f6a0687b64` |
| `Sources/OpenUsage/Providers/Ollama/OpenSSHEd25519Key.swift` | `2643595eeb128764f66678cdea6fd80f89056f71a60876010838821ef3fdab07` |
| `Sources/OpenUsage/Providers/OpenRouter/OpenRouterAuthStore.swift` | `86f62a2684187f16982769150ab40225b9d6b4979809c4f8b45f03fb8b8cfedb` |
| `Sources/OpenUsage/Providers/OpenRouter/OpenRouterProvider.swift` | `6cfe99602b46657fbf00a990346865e2727b5b4f3c2706f597bbbc0944a8a4ef` |
| `Sources/OpenUsage/Providers/OpenRouter/OpenRouterUsageClient.swift` | `2dc5208be6eb0aabe4019ee6baf883f777381ef39c0084c3430ec85f6ee37cd0` |
| `Sources/OpenUsage/Providers/OpenRouter/OpenRouterUsageMapper.swift` | `9e28ecc040abb37575fcc512789f4b6eb7e01dc559b02458139654c2709d640d` |
| `Sources/OpenUsage/Providers/UserAPIKeyStore.swift` | `4ab12e3ca4825094d687edf70fd8d67f0e0c589d3f9d50c58166cdfb1697c7e8` |
| `Sources/OpenUsage/Providers/Pi/PiPaths.swift` | `954624a494872cbc8b1383089a5ec62645e74e0498e9dc12fccc6acbfb239827` |
| `Sources/OpenUsage/Providers/Pi/PiProviderMapping.swift` | `c6682212198ce6e17a7a0b130b367c72e46efd1f24228b3c55eef6468d28f4bd` |
| `Sources/OpenUsage/Providers/Pi/PiUsageScanner.swift` | `8a123c0fa37cf2ea9615f01b7e79d0ae42be8acc52e90624cf11f38ce6a83635` |
| `Sources/OpenUsage/Providers/Codex/PiCodexLoginScanner.swift` | `4cbbdecab757894fdff72ad757ddb18376a7213835fc51cd801c41166a6a295d` |
| `Sources/OpenUsage/Resources/ProviderIcons/ollama.svg` | `aa8eb269b52b2ff4ea4a08aa64b58356990282ae8de49b84eab8bb0fdb53a7f3` |
| `Sources/OpenUsage/Resources/ProviderIcons/openrouter.svg` | `0d3983f2545afd7f7b51d94f97cc30196cca6e7020c19632b01e2e1e41d9e75e` |
| `Tests/OpenUsageTests/OllamaProviderTests.swift` | `9bbc34f0c93c7f3ef7960aa07a9978512a115ceba6afa871043590bcb016a977` |
| `Tests/OpenUsageTests/OllamaMonthlyUsageTests.swift` | `007224ea1b4facefc9eb345950646d60008f72cbd5dda8080044bbcf6a2f785f` |
| `Tests/OpenUsageTests/OpenRouterProviderTests.swift` | `0395e307f8b08af4f07c1f90cf9bb9a926b0210d70ba8d975d76b6ab761c4e18` |
| `Tests/OpenUsageTests/PiUsageScannerTests.swift` | `9b15a389d08249dac6e625b532da38ab6002cdb47ec560e5271131523bbbea85` |
| `Sources/OpenUsage/Services/ProviderAccountAssembly+Codex.swift` | `3a16fccc66efab9d49f15ce9b5a424a00d0f85ba486f4bb0398e3960d5d6181d` |
| `Sources/OpenUsage/Providers/IncrementalJSONLScanner.swift` | `cc236426c727007ddafe4bde56768019b1e11bc3ac5edba03b801dda9c727030` |
| `Sources/OpenUsage/Providers/DailyUsageAccumulator.swift` | `75c97a080f60f63a7fb620b88302c79fcc4e6a5ade4855b09c733328057de867` |
| `Sources/OpenUsage/Providers/Codex/CodexUsagePricing.swift` | `26fc91db759466cf13c0e0bd82293c9d85c57f895e358e76a601281126b83009` |
| `Sources/OpenUsage/Support/ProviderParse.swift` | `97bd62ef886543ee5c7653617313a6b992a8143dcdec1f31d438a2f56fd1630a` |
| `Sources/OpenUsage/Support/OpenUsageISO8601.swift` | `326bd0e01154be921b9c8e3da240dfb647bacb563e8567b19610ce9cac43c7a9` |
| `Sources/OpenUsage/Providers/JSONLStreamingReader.swift` | `0659314418a50815a28ef7e526817e7754d19d15ec6198f6d8c57b929c9f7f98` |

  Also read for context (not ported): `ProviderCatalog.swift`, `ClaudeProvider.swift`,
  `CodexProvider.swift`, `CodexHistoryScope.swift`, `ProviderAccountAssembly+Codex.swift`,
  `CodexUsagePricing.swift`. Both upstream SVGs already use `fill="currentColor"`.
- External contract check: https://docs.ollama.com/api/balance (fetched 2026-10-11) matches the
  upstream mapper's two shapes (current monthly `included.balance_usd` / `allowance_usd` / `period`,
  legacy `included.session` / `included.weekly` with `remaining_percent` and `resets_at`, plus
  `purchased.balance_usd`). It documents a 10 requests/minute per-user rate limit and shows
  `Authorization: Bearer $OLLAMA_API_KEY` as an auth option upstream does not use.
- Port rule: translate upstream logic into the JS plugin API; keep endpoints, auth sources and
  precedence, line labels, error classification and math. Each difference below is either a
  required runtime adaptation or is marked as needing user authorization.

### Differences (all three)

| # | Upstream | Port | Type |
| --- | --- | --- | --- |
| D1 | `MetricLine.values(... kind: .dollars)` (unbounded dollar row) | `ctx.line.text({ label, value: "$x.xx" })`, as `plugins/amp/plugin.js:165` does | Runtime adaptation |
| D2 | Snapshot `warning` (amber notice), e.g. Ollama plan lookup failure | Our plugin result has no warning field (`openusage-plugin*.ts` has none). Use a `ctx.line.badge` in detail scope with the upstream text, plus `ctx.host.log.warn` | Runtime adaptation |
| D3 | API key editor UI (`APIKeyManaging` save/delete) for OpenRouter | Not ported. Key read only | Scope cut (UI) |
| D4 | Persistent incremental parse cache for pi logs (`JSONLScanCachePersistence`) | Full rescan per refresh, matching `grok-session-usage.ts`. 285 pi session files on this machine | Simplification; add a cache if refresh time is measured as a problem |
| D5 | Ollama provider opt-in (`hasLocalCredentials() == false`) | Needs a per-provider default in our registry; see User Decision U1 | Needs user decision |

### Pi implementation decisions and differences

- Second-round remediation (PR2-1, stale Pi usage after losing the matching account):
  after a successful Claude/Codex probe, scan Pi data when that family has no owner and
  attach an explicit null owner plus the scanned usage days to the plugin snapshot.
  Storage clears only that family's `Pi Session` / `local-log` rows for those days in
  the same replacement transaction as the snapshot insertion. A configured owner on
  another account must not trigger cleanup. Preserve ccusage, other days, families,
  and sources; an insertion failure rolls back cleanup. Add storage integration tests
  for matching-to-unmatched Codex logins and configured Claude accounts, through both
  in-thread and worker refreshes. Commit the failing tests before the fix. Update
  `docs/providers/codex.md`, `docs/providers/claude.md`, `README_WEBUI.md`,
  `README.md`, `README_WEBUI.zh-TW.md`, and `docs/USER_GUIDE_WEBUI.zh-TW.md`. Validation logs:
  `../openusage_webui-artifacts/2026-10-11-backlog/pi/r2/`. Run the focused regression,
  `bun run test -- --run`, `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`,
  and `bun run build:webui`. No push, service operation, or edits to other worktrees.
- Review remediation scope (PR1-1 through PR1-5): atomically remove same-day Pi rows
  from previous owners within the Claude/Codex family, preserving ccusage; remove default
  Claude Pi rows when Claude accounts are configured; resolve login ownership at each
  refresh; skip unreadable files/directories with error-code-only logging; isolate the
  native-only Claude API test; skip files modified before the scan cutoff. Each finding
  gets a failing `test:` commit followed by a `fix:` commit. Validation logs are under
  `../openusage_webui-artifacts/2026-10-11-backlog/pi/r1/`. Behavior documentation to update:
  `docs/providers/codex.md`, `docs/providers/claude.md`, `README_WEBUI.md`,
  `README_WEBUI.zh-TW.md`, and `docs/USER_GUIDE_WEBUI.zh-TW.md`. Summary unknown-cost
  display is deferred by the orchestrator.
- Source files above were fetched read-only at the exact pin with `gh api`. Copies and
  verification logs live under `../openusage_webui-artifacts/2026-10-11-backlog/pi/`.
- Only Claude and Codex consume Pi rows. Other upstream-mapped providers and unmapped providers
  are dropped, per decision 3. No Pi provider card or credential import is added.
- The scan cutoff is local midnight 30 calendar days before refresh, matching
  `JSONLScanning.sinceDate`; files modified before the cutoff are skipped before reading.
  Retained files are path-sorted before keep-first message-ID deduplication, followed by
  message-date and card filtering, matching `IncrementalJSONLScanner` / `PiUsageScanner`.
  ISO timestamps without a zone are normalized as UTC; fractional seconds and the space/UTC
  forms use the existing plugin utility, matching `OpenUsageISO8601`.
- Pi costs join the existing usage summary. `getUsageSummary` already sums all tools; its
  `ccusage`-only branch chooses between native structured costs and legacy CLI costs. Keep Pi
  outside that branch so a legacy CLI price never removes independent Pi costs.
- Codex zero/missing carried costs use the existing standard-rate table, as specified here.
  Upstream additionally applies long-context/priority adjustments, model aliases, and dated
  auto-review fallback models; those estimators are not available in this port. Free auto-review
  from 2026-10-06 remains $0 even when a carried cost is positive.
- Upstream excludes unpriceable rows and lists unknown models separately. The port retains
  their reported tokens with undefined cost, as specified here; a daily model total containing
  any unpriced message has undefined cost. Claude has no fallback rate table.
- Upstream splits cache writes into 5-minute and 1-hour buckets. `UsageRecord` has one cache-write
  field, so the port stores `max(cacheWrite - cacheWrite1h, 0) + cacheWrite1h` there.
  Missing model names use the existing storage label `Unknown`.
- Pi daily records encode the local date at UTC midnight, like ccusage. Allowance translates
  that date back to local midnight, including daylight-saving day lengths.
- Account ownership uses the configured Codex homes' `tokens.account_id` and Pi's base
  `openai-codex` OAuth `accountId`; pool entries and credential sources remain out of scope.
  Each Claude/Codex refresh resolves ownership from the current login files, including
  inside the refresh worker; reusing providers does not freeze the login identity.
  Disabled configured accounts participate in ownership selection so their usage is not
  reassigned. Duplicate matching homes select one owner by account ID because Swift collapses
  identical account identities into one card. Only the unconfigured default Claude provider
  receives unattributed Pi usage.
- Same-day `Pi Session` / `local-log` rows move between owners atomically within their
  Claude/Codex family, including the default provider ID. Other days, sources, families,
  and ccusage rows are preserved. Configuring Claude accounts removes default Claude Pi
  rows because no configured Claude account receives unattributed Pi usage.
  When a refresh scan has no owner for that family, its snapshot carries
  `piSessionOwnership: { ownerId: null, days }`, where `days` contains the scanned daily
  usage dates. Storage clears that family's Pi rows for those days in the same
  replacement transaction; other days and ccusage remain. Another configured owner
  prevents this cleanup signal. Failed insertion rolls back the cleanup.
- Full rescan replaces the upstream persistent cache (D4). Unreadable files and subdirectories
  are skipped independently; logs contain only fixed text and an error code. A missing root
  returns empty. Read failures preserve the successful plugin snapshot. Authentication reads are strictly
  read-only; no keys, tokens, message bodies, or response IDs enter usage records or logs.
- Redaction audit: Pi adds no HTTP request, plugin request/response fields, or Rust host API.
  `host_api.rs:396-434` already redacts `accountId` and `account_id` but has no plain `access`
  or `refresh` auth-key rule. Pi auth stays inside the Node ownership reader and never crosses
  that logging boundary; all its error messages are constant strings. Pi fixtures assert that
  private access values and message text are absent from logs and emitted records. No host
  redaction-list change is required for this scanner.

### Pi implementation evidence (2026-10-11)

- Second-round no-owner cleanup: the storage regression first produced four assertion
  failures from retained Pi rows with 12 passing tests (`pi/r2/pr2-1-red.log`). After
  remediation, all 29 focused ownership/storage tests passed (`pi/r2/pr2-1-green.log`).
  Full validation passed 1,196 Vitest tests (`pi/r2/pr2-1-vitest.log`), 430 Bun tests
  (`pi/r2/pr2-1-bun-tests.log`), and the WebUI build (`pi/r2/pr2-1-build.log`).
- No separate Pi plugin, card, credential source, or network call was added. The scanner,
  ownership resolver, worker options, token-record tool, and local Allowance day buckets are
  wired into existing Claude/Codex refreshes. The six Pi-relevant documentation files listed
  below were updated; OpenRouter/Ollama documentation is left to their own implementations.
- Red: 26 of 30 focused tests failed on absent Pi behavior (`pi/red.log`), with four existing
  storage behaviors passing. An additional timestamp test failed on incorrect local-day
  grouping (`pi/red-timestamp.log`) before normalization was corrected.
- Green: 31 Pi tests passed under `TZ=Asia/Taipei` (`pi/green-timestamp.log`). The full requested
  Bun suite passed 409 tests across 48 files (`pi/bun-tests-complete.log`); Vitest passed 1,196
  tests across 67 files (`pi/vitest-final.log`). `bun run build:webui` passed
  (`pi/build-final.log`). Logs are under the persistent artifact directory named above.
- The first full Bun run exposed four fixture tests reading actual Pi sessions; native-only
  tests now explicitly disable Pi recording, and the server test uses its isolated fixture
  home with both Pi and native rows. The known ccusage timeout child-process test failed once
  in that run, then passed in both subsequent full runs without a production change.
- Read-only real-data check at `2026-10-11T00:21:34.670981+08:00`, cutoff
  `2026-09-11T00:00:00+08:00`: 285 Pi files contain 34,428 Codex assistant usage messages and
  4,368 other-provider usage messages. The scanner produces two daily-model records for
  2026-09-13 through 2026-09-15, from 277 usable messages after ID deduplication and the cutoff.
  Three additional messages have zero tokens and no known cost and emit no record.
- Real Codex totals: 40,168,984 reported tokens; 2,019,171 input; 111,157 output; 38,038,656
  cache-read; zero cache-write tokens. Both records have known cost. Independent Python counts
  match every token bucket and record count (`pi/real-data-reference.json`,
  `pi/real-data-scan-final.json`); scripts are archived beside those count-only files. The first
  comparison counted empty model groups; its initial script, counts, and failed comparison
  remain archived, and the corrected reference explicitly counts the three empty messages.
- The local ownership check selects `~/.codex` once and `~/.codex-family` zero times. Across
  all Pi Codex messages, 11,185 unique response IDs have zero overlap with response IDs in
  4,128 native Codex rollout files (`pi/real-data-reference.json`). No response IDs or private
  contents were printed or saved. No live database, other worktree, or service was accessed.

## Changes

### 1. OpenRouter plugin (`plugins/openrouter/`)

Port of `OpenRouter*.swift` + `UserAPIKeyStore.loadKey()`.

- Auth: config file first, env second (upstream precedence). Files in order
  `~/.config/openusage/openrouter.json`, `~/.config/openrouter/key.json`; JSON fields `apiKey`,
  `api_key`, `key`, or a plain-text file holding only the key (reject text containing `{`). Env
  `OPENROUTER_API_KEY`, then `OPENROUTER_KEY`. Missing key throws
  "No OpenRouter API key. Set OPENROUTER_API_KEY or add it to ~/.config/openusage/openrouter.json."
- Requests: `GET https://openrouter.ai/api/v1/credits` and `GET https://openrouter.ai/api/v1/key`,
  `Authorization: Bearer <key>`, `Accept: application/json`, timeout 15 s. Both fetched
  independently; body is `{ "data": { ... } }`.
- Lines from `/credits` (`data.total_usage`, `data.total_credits`): `Credits` progress
  (used = max(0,total_usage), limit = total_credits, dollars) only when total_credits > 0;
  `Balance` text = max(0, total_credits − used), shown even at $0.00.
- Lines from `/key`: `Today` / `This Week` / `This Month` text from `usage_daily` /
  `usage_weekly` / `usage_monthly`; `Key Limit` progress when `limit` > 0 with
  used = max(0, limit − max(0, limit_remaining)). Plan: `is_free_tier` → "Free tier" /
  "Pay as you go".
- Errors: any lines → success. No lines and both endpoints 401/403 → "OpenRouter API key invalid.
  Check your key at openrouter.ai/keys." Otherwise first failure: connection → "Couldn't reach
  OpenRouter. Check your connection."; non-2xx → "OpenRouter request failed (HTTP n)."; bad body →
  "OpenRouter usage data unavailable. Try again later."
- `plugin.json`: lines Credits, Balance, Today, This Week, This Month, Key Limit; links Activity
  `https://openrouter.ai/activity`, Credits `https://openrouter.ai/settings/credits`;
  `brandColor` from OpenRouter's official brand assets (record the source URL in the PR; do not
  guess); `icon.svg` copied from upstream.

### 2. Ollama plugin (`plugins/ollama/`) + one host primitive

Port of `Ollama*.swift` + `OpenSSHEd25519Key.swift`.

- Host gap (verified): plugins get `host.crypto` = `sha256Hex`, `encryptAes256Gcm`,
  `decryptAes256Gcm` only (`packages/providers/src/providers/openusage-plugin.ts:304`;
  `src-tauri/src/plugin_engine/host_api.rs:749-795` same set). Ed25519 signing is required because
  the `~/.ollama/id_ed25519` keypair is the whole credential.
- Add `host.crypto.ed25519Sign(seedBase64, message)` to the WebUI runtime, returning
  `{ signatureBase64, publicKeyBase64 }` (raw 32-byte public key derived from the seed). Implement
  with Node `crypto.createPrivateKey` (PKCS#8 DER prefix `302e020100300506032b657004220420` + seed)
  and `crypto.sign(null, Buffer.from(message), key)`. Add the same function to
  `plugins/test-helpers.js` `makeCtx()` using `node:crypto`.
- Binary decode: `ctx.base64.decode` returns a UTF-8 string, so it cannot read the OpenSSH
  container. The plugin ships a small pure-JS base64-to-bytes decoder and ports the upstream
  bounds-checked `ByteReader` parser. This keeps the parser in the plugin (faithful to upstream
  structure) and keeps the host primitive generic. Parser checks, as upstream: magic
  `openssh-key-v1\0`, cipher and kdf `none`, one key, type `ssh-ed25519`, private blob 64 bytes,
  derived public key equals both the private-section public half and the outer public key blob.
  `publicKeyBase64` sent on the wire is the base64 of the outer SSH public key blob.
- Requests: challenge `"<METHOD>,<path>?ts=<unix seconds>"`; header
  `Authorization: <publicKeyBlobBase64>:<signatureBase64>`, `Accept: application/json`, timeout
  15 s. `GET https://ollama.com/api/balance?ts=…` (required), `POST https://ollama.com/api/me?ts=…`
  (best-effort, plan only). Use `ctx.nowIso` for `ts`.
- Mapper (pure function, ported 1:1): Session / Weekly from legacy `remaining_percent`
  (used = clamp(100 − remaining)), period 5 h / 7 d only when `resets_at` parses; Monthly progress
  (used = min(allowance, max(0, allowance − balance)), dollars, resetsAt `period.until`,
  periodDurationMs = until − from when until > from); Purchased Credits text from
  `purchased.balance_usd` (max 0). Missing `included` or no Session/Weekly/Monthly → loud
  "invalid response" error. Plan from `Plan` or `plan`, trimmed, title-cased; non-object / missing
  / non-string → unreadable (warning); empty string → no plan, no warning.
- Errors: no key file → "No Ollama key found. Install Ollama and run `ollama signin` to track cloud
  usage."; read failure → "Couldn't read ~/.ollama/id_ed25519. Check the file's permissions.";
  parse failure → "~/.ollama/id_ed25519 isn't a usable Ollama signing key."; balance 401/403 →
  "Not signed in to Ollama Cloud. Run `ollama signin` to see usage."; plan failure or unreadable →
  one badge "Couldn't read your Ollama plan. Usage below is still up to date." (D2).
- Secret handling: the seed lives only inside one probe call. Never pass PEM, seed or signature to
  `ctx.host.log.*`, thrown messages, or returned lines.
- `plugin.json`: lines Session, Weekly (period weekly), Monthly, Purchased Credits; links Usage
  `https://ollama.com/settings`, API Keys `https://ollama.com/settings/keys`; `brandColor` from
  Ollama's official assets (record source); `icon.svg` copied from upstream.
- Default enablement: see U1. If approved, add `defaultEnabled: false` to the Ollama entry in
  `packages/providers/src/registry.ts` and honor it where new provider status rows are created
  (`apps/server/src/index.ts` `ensureProviderStatus` around line 458, and
  `apps/server/src/cli-status.ts:92/101`).

### 3. Pi session usage scanner (`packages/providers/src/providers/pi-session-usage.ts`)

Port of `PiPaths.swift`, `PiProviderMapping.swift`, `PiUsageScanner.parseLine/dedup/aggregate`, and
the ownership rule from `ProviderAccountAssembly+Codex.swift:152,170`.

- Directory: `PI_CODING_AGENT_SESSION_DIR`, else `PI_CODING_AGENT_DIR/sessions`, else
  `~/.pi/agent/sessions`; recursive `*.jsonl`. Reuse the `PI_CODING_AGENT_DIR` handling pattern
  already in `plugins/synthetic/plugin.js`.
- Parse: lines containing `"usage":{`; `type == "message"`, `message.role == "assistant"`,
  `message.provider` mapped via the upstream table (`anthropic`, `claude-agent-sdk` → Claude;
  `openai-codex` → Codex; others in the table have no consumer upstream and are dropped here too).
  Skip files modified before the cutoff before reading or deduplication.
  Tokens: input, cacheRead, cacheWrite (5 m = cacheWrite − cacheWrite1h), output; row total =
  `usage.totalTokens`. Dedup by top-level `id`, keep first. Window: last 30 days, local-day buckets.
- Cost precedence (upstream): Codex model `codex-auto-review` at or after 2026-10-06T00:00:00Z →
  $0; else carried `usage.cost.total` when > 0; else estimate (Codex: existing
  `openAiTokenCostUsd` in `packages/providers/src/openai-token-rates.ts`; Claude: leave cost
  undefined because the WebUI has no Claude rate table) ; unpriced rows with tokens are kept as
  tokens with unknown cost. Recorded difference: pi rows use pi's carried cost, not the WebUI's
  ccusage day-cost allocation in `structured-usage.ts`, because pi records an authoritative
  per-message cost.
- Emit `UsageRecord`s via `createTokenRecord` with a new kind `"pi-session"` (extend the
  `TokenRecordKind` union in `structured-usage.ts`). `createTokenRecord` currently maps any kind
  other than `ccusage` / `grok-session` to tool `"Cursor Usage Event"`, so add an explicit tool
  `"Pi Session"` (source `local-log`). The tool must be distinct: `upsertUsageRecords(...,
  { replaceScopes: true })` deletes by scope (providerId, tool, startedAt, source)
  (`packages/storage/src/sqlite-storage.ts:251-286`); sharing `ccusage` would let pi rows and
  ccusage rows for the same Codex day delete each other.
- Storage consumers: add `"Pi Session"` to `DAILY_TOKEN_TOOLS` (`sqlite-storage.ts:934`) so the
  Allowance page buckets pi rows by day. The Codex/Claude cost-summary path
  (`sqlite-storage.ts:398-412`) only reads `tool === "ccusage"` rows; decide in the PR whether pi
  cost joins that summary and record the decision (default: include, since pi traffic does not
  appear in ccusage).
- Hook: in `openusage-plugin.ts` after a successful probe, beside the Grok hook, for pluginId
  `codex` (when this provider owns pi Codex usage) and `claude`. Scanner failure logs and does not
  fail the probe, as the Grok hook does.
- Claude ownership: upstream uses a per-card `allowsUnattributedPiUsage` flag. Port rule: the
  default `claude-code` provider (no Provider Accounts configured) owns pi Claude usage; with
  several Claude accounts, none owns it and this is logged once. pi logs on this machine contain zero
  `anthropic` / `claude-agent-sdk` rows, so this path is fixture-only here.
- Codex ownership (upstream rule): one Codex provider → it owns pi Codex usage. Several Codex
  accounts → only the account whose `<homePath>/auth.json` `tokens.account_id` equals
  `~/.pi/agent/auth.json` `openai-codex.accountId` owns it; no match → nobody, logged once. Our
  accounts are identified by `homePath` only (`registry.ts`, `account-detect.ts`), so this is a
  file read per account, not a port of `PiCodexLoginScanner`. Pass configured account homes
  into `createHomedPluginProvider` and its refresh worker; resolve ownership at each refresh.
- Not ported: pi as a Codex credential source (`piCredentialSources`); `multi-pass.json` labels;
  `openai-codex-N` pool entries (only `openai-codex` decides ownership upstream).
- Tokens-page dedup: pi talks to the OpenAI Codex backend directly, not through the Codex CLI, so
  pi rows should not appear in `~/.codex/sessions` rollouts. Confirm with a count on real data
  before merge (see Acceptance).

### 4. Shared wiring and docs

- Register `openrouter` and `ollama` in `packages/core/src/types.ts` `PROVIDER_IDS`,
  `packages/providers/src/registry.ts` `pluginProviders`, and `apps/web/src/provider-ui.ts`
  (`providerCards`, `refreshableProviders`).
- Docs to update: `README.md` (supported plugins list), `README_WEBUI.md`,
  `README_WEBUI.zh-TW.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md`, new `docs/providers/openrouter.md`
  and `docs/providers/ollama.md` (format of `docs/providers/synthetic.md`: Overview, Authentication,
  endpoints, lines), and a "Usage from pi" section in `docs/providers/codex.md` and
  `docs/providers/claude.md`. No `docs/providers/pi.md`, because pi has no card.

## User Decisions Needed

- **U1 — Ollama default on or off.** Upstream keeps Ollama off until the user enables it, because
  `~/.ollama/id_ed25519` exists for anyone who has run local models, signed in or not. Our server
  enables every new provider (`enabled: true` in `ensureProviderStatus`). Recommended: default off
  (upstream behavior, about 15 lines). Alternative: default on, matching how Z.ai/Synthetic show an
  error card when unconfigured.
- **U2 — Tauri host parity.** The Rust host (`host_api.rs`) lacks Ed25519. The WebUI is the product
  on this fork (`README_WEBUI.md`), so the recommendation is WebUI host only; the Ollama plugin then
  fails under the Tauri desktop build with a clear error. Alternative: add the Rust function too
  (needs an ed25519 crate; larger).
- **U3 — pi `xai` rows.** Upstream `PiProviderMapping` has no `xai` entry. On this machine pi logs
  contain 34,428 `openai-codex` and 4,368 `xai` assistant usage rows (count over
  `~/.pi/agent/sessions`, 2026-10-11). A faithful port drops the `xai` rows. Mapping `xai` → Grok is
  a source deviation and needs authorization.
- **U4 (optional) — Ollama Bearer API key.** `docs.ollama.com/api/balance` accepts
  `Authorization: Bearer $OLLAMA_API_KEY`. Upstream does not use it. Adding it as a fallback needs no
  crypto but is a deviation. Not recommended for the first port.

## Out of Scope

- API key editor UI for OpenRouter (D3); Ollama Cloud usage history (`/api/cloud-usage`).
- pi as a Codex credential source; pi usage for Cursor, Z.ai, Antigravity, Copilot (mapped but not
  consumed upstream either).
- Persistent pi parse cache (D4).
- Any change to `~/.openusage-webui/`, the live worktree or the systemd service.

## Acceptance

Tests are `vitest` (`plugins/*/plugin.test.js`, `packages/providers/test/*.test.ts`). Each item
starts as a failing test.

- OpenRouter fixtures (port `OpenRouterProviderTests.swift` cases): config file beats env; plain-text
  key file; `{`-containing text rejected; both endpoints OK; `/credits` 403 with `/key` OK still
  shows key lines; both 401 → invalid-key message; free account (total_credits 0) shows Balance
  only; Key Limit uses `limit_remaining`; plan labels.
- Ollama fixtures (port `OllamaProviderTests.swift` and `OllamaMonthlyUsageTests.swift` cases, reusing
  upstream's MIT test PEM): parses the unencrypted key; rejects mismatched public half, encrypted,
  truncated and garbage keys; request URL `https://ollama.com/api/balance?ts=1700000000` (the test
  sets `ctx.nowIso = "2023-11-14T22:13:20.000Z"`; `makeCtx()` defaults to 2026-02-02); signature
  verifies with `crypto.verify` against `"GET,/api/balance?ts=1700000000"`; `/api/me` is POST;
  monthly, legacy and purchased mapping; missing `included` fails loudly; plan casing; 401 →
  not-signed-in; plan failure keeps meters and shows the badge.
- Host primitive test: `ed25519Sign` output equals `crypto.sign` for an RFC 8032 test vector (Ed25519
  is deterministic) in `packages/providers/test/openusage-plugin-api.test.ts` or a new focused test.
- Pi fixtures (port `PiUsageScannerTests.swift` cases): path precedence; non-assistant and unmapped
  providers dropped; dedup by id; carried cost wins; zero cost falls back to Codex rates;
  `codex-auto-review` free from 2026-10-06; multi-account ownership by `accountId`; no match → no
  records; scanner error does not fail the Codex probe; pi records carry tool `"Pi Session"`; a
  storage test where pi and ccusage records for the same Codex provider and day both survive two
  consecutive `upsertUsageRecords(..., { replaceScopes: true })` calls.
- Registry/UI tests updated (`packages/providers/test/registry.test.ts`) for the two new providers;
  if U1 = off, a test that a new Ollama status row is created disabled.
- Redaction audit against `host_api.rs` `redact_url` / `redact_body` / `redact_log_message`, with a
  test per gap or a recorded decision:
  - Ollama `/api/me` keys are capitalized when called directly (`Plan`, per upstream mapper
    comment). `redact_body` matches `"email":` / `"name":` case-sensitively, so `"Email":` and
    `"Name":` would not be redacted. Add a test with a capitalized `/api/me` fixture and extend the
    list if the plugin ever logs the body.
  - OpenRouter `/key` returns `label` (key name), not in the sensitive list; decide and record.
  - OpenRouter keys (`sk-or-v1-…`) match the existing `sk-` pattern; add an assertion.
  - Ollama `Authorization` is `<pubkey>:<sig>`; the host logs only method and redacted URL
    (`host_api.rs:839`); `?ts=` is not sensitive. Add a plugin test that no `ctx.host.log.*` call
    and no thrown message contains the PEM body, seed or signature. `redact_body` has no OpenSSH
    key pattern; record that.
- `bun run build:webui` passes; full vitest passes.
- Real-data checks the implementer can run without secrets: pi scanner over the real
  `~/.pi/agent/sessions` produces non-empty Codex records attributed to the `~/.codex` account (on
  2026-10-11 `~/.codex/auth.json` matches pi's `openai-codex.accountId`; `~/.codex-family` does not);
  pi record count and date range logged; a count confirming no pi `responseId` also appears in Codex
  rollouts.
- Live verification that needs the user: (a) OpenRouter — the service unit loads only
  `~/.config/openusage-webui/secrets.env`, which holds `MINIMAX_API_KEY` only, so the shell's
  `OPENROUTER_API_KEY` is not visible to the service; the user creates
  `~/.config/openusage/openrouter.json` (read at refresh time, no restart) or adds the variable to
  `secrets.env` (restart needs approval). (b) Ollama — key file exists here, but whether it is linked
  to an ollama.com account is unknown until a signed `/api/balance` call; one live probe by the user
  or with user approval.

## Risks

- Ollama signing mismatch (URI string vs signed challenge) shows as "not signed in"; the fixture
  signature test and one live probe cover it.
- Ollama `/api/balance` rate limit is 10 requests/minute per user; our refresh cadence is far below
  it, but repeated manual refreshes across devices share the limit.
- `/api/me` response shape is only described by upstream comments; the plan badge depends on it.
- Pi log schema can change upstream of pi; parser drops unknown lines silently by design, so a schema
  change shows as missing pi usage, not an error. The real-data count check catches it at merge time.
- Adding pi Codex rows changes Codex token totals and allowance inputs on the Tokens and Allowance
  pages; compare totals before and after on a database copy, not the live database.
- Files stay under 500 lines: the Ollama plugin (parser + mapper + client) is the largest. The
  loader evaluates one `plugin.js` per plugin (`openusage-plugin.ts` `loadPlugin`), so the parser
  cannot move to a second plugin file; keep it compact (~280 lines expected).

## Estimated Size

| Item | Production | Tests | Size |
| --- | --- | --- | --- |
| OpenRouter plugin + docs | ~150 lines | ~220 lines | S |
| Ollama plugin + host `ed25519Sign` + optional default-off + docs | ~280 lines | ~320 lines | M |
| Pi scanner + hook + Codex ownership + docs | ~220 lines | ~260 lines | M–L |

Order: OpenRouter (no host change), then Ollama, then Pi. Each is an independent PR.
