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

### OpenRouter port record (branch `feat/port-openrouter`)

Actual imported files: the seven OpenRouter files in the table above (hashes re-verified against
the pin on 2026-10-11) plus `Sources/OpenUsage/Support/ProviderParse.swift` (`number`, `jsonObject`),
sha256 `97bd62ef886543ee5c7653617313a6b992a8143dcdec1f31d438a2f56fd1630a`, which the plan's file table
omitted. Read-only copies are kept in
`/home/ma/Research/side_project/openusage_webui-artifacts/2026-10-11-backlog/openrouter/upstream/`.
`plugins/openrouter/icon.svg` is byte-identical to upstream `openrouter.svg` (sha256
`0d3983f2545afd7f7b51d94f97cc30196cca6e7020c19632b01e2e1e41d9e75e`, `fill="currentColor"`).

Differences from upstream (O1 = plan D1, O2 = plan D3):

| # | Upstream | Port | Type |
| --- | --- | --- | --- |
| O1 | Dollar rows are `MetricLine.values(kind: .dollars)` | `ctx.line.text` with `"$" + toFixed(2)`; progress rows use `format: { kind: "dollars" }` | Runtime adaptation |
| O2 | `saveAPIKey` / `deleteAPIKey` / `keyStatus` and the API key editor | Not ported; key is read only | Scope cut (UI) |
| O3 | Key from the login-shell environment captured at launch (`ProcessEnvironmentReader`) | `ctx.host.env.get`: server process environment in the WebUI host; whitelisted names in the Tauri host. `OPENROUTER_API_KEY` and `OPENROUTER_KEY` were added to `WHITELISTED_ENV_VARS` in `src-tauri/src/plugin_engine/host_api.rs` (the WebUI host has no whitelist) | Runtime adaptation |
| O4 | Widget metadata: `exportingLimit(...)`, bounded widgets with `limit: 100`, `isUsagePeriod` | Not ported. Progress rows in dollars get `limitUnit: "usd"` from `quota-observations.ts:126` | Runtime adaptation |
| O5 | Unreadable config file (`try?`) and transport errors are silent | `ctx.host.log.warn` with the path or endpoint URL and the error text; no key, header or response body is logged. The user-facing messages are unchanged | Logging addition (AGENTS.md: fail loudly) |
| O6 | `is_free_tier as? Bool` (Swift may also bridge a JSON number 0/1 to Bool) | JSON booleans only. Not verified on Swift (no Swift runtime here); `/key` returns a JSON boolean | Unverified minor difference |
| O7 | `ProviderParse.number` uses `Double(String)` | `Number(String)` after rejecting blank strings; booleans, non-finite values and non-strings are rejected as upstream. Exotic strings such as hex floats may parse differently | Minor difference |

No difference changes endpoints, key sources and precedence, line labels, error messages,
error classification or the Credits / Balance / Key Limit math.

Host changes outside upstream (needed by the plugin): the two env names above, and `"label"` added
to the `redact_body` sensitive key list.

Brand color: `plugin.json` `brandColor` is `#7624F4` ("Grape"). Source: https://openrouter.ai/brand
lists four logo colors (Grape, Volt, Ink, Cloud); the page text has no hex codes, so the fills were
read from the glyph SVGs `https://openrouter.ai/brand/logos/transparent/glyph/svg/glyph-{grape,volt,ink,cloud}.svg`:
Grape `#7624F4`, Volt `#C8FF00`, Ink `#03080A`, Cloud `#FCFCFE` (copies in the artifacts directory
`brand/`). The page designates no primary color. Grape was chosen because it is the first-listed
color and stays legible on light and dark backgrounds; Volt (lime) would be the alternative.
These were four unauthenticated GET requests for public static files; no OpenRouter API request was
made. Note: the current brand glyph is a new mark, while the upstream icon (kept, as instructed) is
the earlier arrow mark. Swapping the icon is a user decision. `brandColor` is read only by the Tauri desktop UI
(`src/components/side-nav.tsx` `getIconColor`: white on a dark theme when luminance < 0.15,
`currentColor` on a light theme when luminance > 0.85, otherwise the color itself; Grape is used as
is). The WebUI (`apps/`, `packages/`) does not read `plugin.json` (grep, 2026-10-11).

Redaction audit against `src-tauri/src/plugin_engine/host_api.rs` (the Tauri host logs
`METHOD redacted_url` and a redacted 500-byte preview of every response body, and passes plugin
log messages through `redact_log_message`):

| Item | Finding | Resolution |
| --- | --- | --- |
| Request URLs `/api/v1/credits`, `/api/v1/key` | No query string, so `redact_url` has nothing to redact; `Authorization` is never logged by the host | None needed |
| Key shape `sk-or-v1-...` | Matches the existing `sk-` pattern in `redact_body` and `redact_log_message` | Rust tests `redact_body_redacts_openrouter_api_keys`, `redact_log_message_redacts_openrouter_api_key` |
| `/key` `label` (user-chosen name or masked key) | Not in the `redact_body` sensitive key list, so the 500-byte body preview would log it | Added `"label"` to the list; Rust test `redact_body_redacts_openrouter_key_label` (red before, green after) |
| `/credits` and `/key` numeric fields | Spend and balance amounts only | Left visible |
| Plugin output and logs | Plugin logs only on a failed config read or a failed request; never the key or a body | vitest "sensitive data" tests (no log call and no thrown message or line contains the key or the label) |
| Env access | Tauri host returns `None` for non-whitelisted names | Added both names; Rust assertion in `env_api_respects_allowlist_in_host_and_js` |

Verification limits: the Tauri crate cannot build on this host (`openssl-sys` needs OpenSSL dev
files; log `cargo-baseline-build.log` in the artifacts directory). The Rust redaction tests were run
against the verbatim `redact_*` functions in a standalone crate (`redact-check/`); the array-length
change to `[&str; 22]` and the whitelist assertion were not compiled.

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
  file read per account, not a port of `PiCodexLoginScanner`. Pass the result into
  `createHomedPluginProvider` the same way `recordCcusageTokens` is passed.
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
