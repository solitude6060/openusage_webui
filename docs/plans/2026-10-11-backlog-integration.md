# Backlog Integration — 2026-10-11

## Contract

Integrate the reviewed branch heads into `integration/backlog-dryrun`, starting at
`ac8239d`, using `git merge --no-ff` in this order:

1. `feat/hourly-allowance-tokens` (`e67c936`)
2. `feat/port-openrouter` (`3616a2c`)
3. `feat/port-ollama` (`15e833f`)
4. `feat/port-pi` (`d8d890d`)

Keep the source branch commits unchanged and reachable as ancestors. Do not push,
modify other worktrees or user data, or operate the always-on service.

## Resolution Rules

Read each branch's plan, ADR and fix log. Preserve Grok spend and hourly tokens from
one transcript scan per refresh; separate hourly storage from daily usage; retain
Claude's completed-day sum check. Retain OpenRouter registration, Ollama's disabled
initial state, Pi Session attribution and stale-owner cleanup. Combine supported
provider lists and documentation, including both OpenRouter and Ollama.

Affected documentation: README.md, README_WEBUI.md, README_WEBUI.zh-TW.md,
docs/USER_GUIDE_WEBUI.zh-TW.md, docs/providers/{grok,claude,codex}.md and the shared
docs/plans/2026-10-11-swift-providers.md. Preserve the incoming ADR, provider docs,
fix logs and review screenshots. Record integration outcomes in this plan and the
local status.md, tracker.md and handover.md files.

## Validation And Commit Gates

After resolving each merge, run:

- `bun test packages/storage/test packages/providers/test apps/server/test apps/web/src`
- `bun run test -- --run`

Keep full per-step logs under
`../openusage_webui-artifacts/2026-10-11-backlog/integration/`. Redirect test temporary
roots into that persistent artifact directory. Fix only integration regressions;
add a failing regression test before a semantic adaptation. Commit conflict
resolutions in the merge commit, listing all conflicted files and their resolution.
Every new commit ends with the user-specified Claude-Session trailer.

Finally run `bun run build:webui`, verify all original source heads remain ancestors
and unchanged, and verify a clean worktree. This local integration uses the user's
explicit merge/test procedure rather than creating PRs or rerunning the source
branches' archived multi-model reviews.

## Outcomes

Step 1: hourly conflicts resolved with one Grok scan for spend, daily and hourly
records. Bun: 415 passed; Vitest: 1,190 passed. Logs: step-1-bun-test.log and
step-1-vitest.log in the integration artifact directory. Dependencies installed
from the unchanged lockfile after the initial Vitest invocation returned exit 127.

Step 2: OpenRouter merged without conflicts; supported-provider documentation,
registration and redaction changes retained. Bun: 419 passed; Vitest: 1,255 passed.
Logs: step-2-bun-test.log and step-2-vitest.log.

Step 3: user guide and shared source-plan conflicts resolved by retaining both
OpenRouter and Ollama records. Default-disabled wiring and hourly behavior retained.
Bun: 434 passed; Vitest: 1,301 passed. Logs: step-3-bun-test.log and step-3-vitest.log.
