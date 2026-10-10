# Ollama Port Fix Log — 2026-10-11

> Branch: `feat/port-ollama` (base `main` = `49b3b38`)
> Plan and source record: `docs/plans/2026-10-11-swift-providers.md` (Ollama, O1–O12)
> Upstream: robinebers/openusage `bb7de176def23a99bbdcaabe1ac7269f18c738be` (MIT)
> Artifacts: `../openusage_webui-artifacts/2026-10-11-backlog/ollama/`

| Role | Client / model / effort |
|------|-------------------------|
| Orchestrator, verification, screenshots | Claude Code, `claude-opus-5-5` |
| Investigation and plan | Claude Code subagent, `claude-opus-5-5`, `high` |
| Implementer | Claude Code subagent, `claude-sonnet-5-5`, `xhigh` (user choice) |
| Review lanes | 1 Grok Build `grok-4.7` `high`; 2 AGY `gemini-3.8-flash-high` `high`; 3 Codex `gpt-6.1-sol` `high` |

Decisions applied (orchestrator, following upstream): disabled by default; `host.crypto.ed25519Sign`
in the WebUI host only (Tauri shows a clear error); no `OLLAMA_API_KEY` Bearer path.

Commits: `ebbbe20` test / `ccf8bfe` host `ed25519Sign`; `f29ff8f` test / `85f8140` plugin;
`c34c9c5` test / `4de6943` default-disabled registration; `b8aca64` docs and source record.

Verification: implementer used a throwaway `ssh-keygen -t ed25519` key (the real
`~/.ollama/id_ed25519` was never read); the Authorization blob equalled the key's public part and
signatures verified with Node `crypto`; RFC 8032 vectors 1 and 2 pass. No live ollama.com call:
whether this machine's key is linked to an account is unknown. QA on a database copy (port 6744):
Ollama status `enabled: false`, `detected: true`; no refresh ran.

Checks (orchestrator rerun at `b8aca64`): vitest 1242/1242, bun:test 393/393.

## Review Round 1 (`49b3b38..b8aca64`)

Grok APPROVE, AGY APPROVE, Codex REQUEST_CHANGES:

| ID | Finding | Severity | Disposition |
|----|---------|----------|-------------|
| OL1-1 | New tests create their scratch directories with `mkdtempSync(tmpdir())` (and the Ollama fixture through `withIsolatedHome`), against the persistent-workspace policy | MEDIUM | Deferred: the whole test suite uses this convention (`withIsolatedHome` and other helpers predate this branch); these are per-test disposable fixtures removed after each test. Follow-up: move the suite's test scratch root to a persistent sibling directory in one change. |

Known limits recorded by the implementer: `host_api.rs` redaction lacks case-insensitive `Email`/`Name`
and an OpenSSH key pattern; unreachable today because the Tauri host has no `ed25519Sign`; must be
fixed before adding Ed25519 to the Tauri host. `plugins/ollama/plugin.test.js` is 521 lines.
