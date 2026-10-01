# Codex Shared Session Tokens

**Goal:** When two Codex account homes resolve to the same `sessions` directory, store ccusage token rows once.

**Docs to update:** `docs/providers/codex.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md`, `README_WEBUI.md`, `README_WEBUI.zh-TW.md`, `README.md`

## Why

`~/.codex-family/sessions` is a symlink to `~/.codex/sessions`. Each account refresh runs ccusage with its own `CODEX_HOME`, reads that same directory, and writes daily model rows under its own provider id. The Tokens page sums every provider, so By Model doubles the overlapping days.

Quota, plan, and credit probes stay per account. Card lines for Today / Yesterday / Last 30 Days stay on each card.

## Behavior

- Resolve `<home>/sessions`. Accounts whose sessions path is missing stay eligible to record tokens.
- Accounts that share one resolved directory keep a single owner. Prefer the account whose `sessions` entry is a real directory. If several real directories or only symlinks share the path, the lowest account id wins.
- The owner still writes ccusage token rows. Other accounts in that group still run the ccusage query for their card, and do not write token rows.
- On provider rebuild, delete `tool = ccusage` and `source = local-log` rows for the non-owner accounts. Leave plugin snapshots in place.

## Acceptance

- A real sessions directory and a symlink to it yield one owner and one duplicate id.
- Distinct sessions directories both record tokens.
- A provider with recording disabled still returns the plugin snapshot and no ccusage token rows.
- Rebuilding providers deletes the duplicate local-log rows and leaves the owner rows.
