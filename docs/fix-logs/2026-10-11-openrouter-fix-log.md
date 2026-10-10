# OpenRouter Port Fix Log — 2026-10-11

> Branch: `feat/port-openrouter` (base `main` = `49b3b38`)
> Plan and source record: `docs/plans/2026-10-11-swift-providers.md` (OpenRouter, O1–O7)
> Upstream: robinebers/openusage `bb7de176def23a99bbdcaabe1ac7269f18c738be` (MIT)
> Artifacts: `../openusage_webui-artifacts/2026-10-11-backlog/openrouter/`

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, verification, screenshots | Claude Code, `claude-opus-5-5` |
| Investigation and plan | Claude Code subagent, `claude-opus-5-5`, `high` |
| Implementer | Claude Code subagent, `claude-sonnet-5-5`, `xhigh` (user choice) |
| Review lanes | 1 Grok Build `grok-4.7` `high`; 2 AGY `gemini-3.8-flash-high` `high`; 3 Codex `gpt-6.1-sol` `high` |

Commits: `fadfeb2` test, `f6f63b1` plugin, `7d02fca` registration, `0e0975e` Rust test,
`c401b92` Rust host (env whitelist `OPENROUTER_API_KEY`/`OPENROUTER_KEY`; `label` added to
`redact_body`), `a2ead58` docs, `2caa231`/`80e41da` plan record; round-1 repair `37df144` test,
`3db02a5` fix.

Not verified here: the Tauri crate does not compile on this host (missing `libssl-dev`); the Rust
edits were checked only by extracting the `redact_*` functions into a standalone crate. Run
`cd src-tauri && cargo test --lib plugin_engine::host_api` where Tauri builds. No live OpenRouter
call was made; the live service cannot see the shell's `OPENROUTER_API_KEY` (see
`docs/providers/openrouter.md` for `~/.config/openusage/openrouter.json`).

Checks (orchestrator rerun at `80e41da`): vitest 1255/1255, bun:test 382/382. Implementer at
`3db02a5`: vitest 1261/1261, bun:test 382/382, build pass.

## Review Round 1 (`49b3b38..80e41da`)

Grok APPROVE, AGY APPROVE, Codex REQUEST_CHANGES:

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| OR1-1 | `label` redaction regex `"([^"]+)"` leaves the suffix after an escaped quote | MEDIUM | Deferred: every existing `redact_body` pattern shares this regex; affects Tauri log previews only (the WebUI logs no bodies); Rust cannot be compiled here. Follow-up: escape-aware string matching for all patterns with regression tests. |
| OR1-2 | Non-empty invalid JSON fails silently; upstream logs a parse warning | LOW | Fixed in `37df144`/`3db02a5` (warning carries URL and length only). |

## Review Round 2 (`80e41da..3db02a5`)

Grok APPROVE, AGY APPROVE, Codex REQUEST_CHANGES:

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| OR2-1 | A literal JSON `null` body is reported as invalid JSON (the request helper maps parse failure and `null` to the same value) | LOW | Deferred: spurious warning log only; user-facing output unchanged. |

Screenshots (`docs/reviews/screenshots/2026-10-11-openrouter-providers-*`): before from the live
site on `main`, after from this branch on a database copy (no refresh).
