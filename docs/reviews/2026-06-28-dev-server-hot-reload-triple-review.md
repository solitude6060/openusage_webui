# Triple Review: Dev Server Hot-Reload (`feat/dev-server-hot-reload`)

Date: 2026-06-28
Scope: Make the dev backend auto-reload so backend edits apply without a manual restart
(root cause of the earlier stale-server incident where codex reset-credit badges rendered
blank).
Branch: `feat/dev-server-hot-reload` (base `main`)
Commits: `2f9d587` (orchestrator) · `f710c76` (review-response hardening)

## Change

`apps/server/src/dev.ts` is now an orchestrator: it keeps Vite as a stable child (its own
HMR) and runs the API server as a `bun --watch src/index.ts` child, so backend edits
hot-reload the API in ~0.5s without touching Vite or orphaning it. `index.ts`'s
`import.meta.main` self-start reads the dev frontend URL from
`OPENUSAGE_WEBUI_DEV_FRONTEND_URL` (set only by dev.ts); production (`bun src/index.ts`) is
unchanged and serves the built dist.

## Pass results

| # | Lens | Model | Verdict |
|---|------|-------|---------|
| A | Correctness / regression | Claude (code-reviewer) | APPROVE_WITH_NITS |
| B | Independent | **Codex** | REQUEST_CHANGES |
| C | Robustness / edge cases | Claude | APPROVE_WITH_NITS |

Confirmed by review: `cwd` correct, prod path unaffected, no dead imports, `shuttingDown`
guard sound, and (empirically by Pass C) `bun --watch` reloads the API **in-process** so a
routine backend edit never resolves `Promise.race` and never tears Vite down; port re-bind
+ SQLite (rollback-journal) on reload are clean.

## Triage & disposition (all fixed — see fix log)

| # | Finding | Source | Severity | Fix |
|---|---|---|---|---|
| 1 | Signal handlers registered after `await waitForFrontend` → Vite orphaned on Ctrl+C/throw during startup | Codex (blocking), C (pre-existing/low) | real | Handlers + `shutdown` defined before any `await`; `waitForFrontend` wrapped in try/catch |
| 2 | `shutdown()` `process.exit`s right after `kill()`, not awaiting child death → transient orphan on crash path | A (critical) | real, low practical | `shutdown` is async, awaits both `exited` with a 5s grace before exit |
| 3 | `shutdown()` always `exit(0)` masks a child's failure code | Codex (minor) | real | Propagate the exiting child's code |
| 4 | Prod self-start reads `OPENUSAGE_WEBUI_DEV_FRONTEND_URL` → footgun if exported | C (low, new) | real | Sharpened the comment: dev-internal, must not be set in prod |
| 5 | `waitForFrontend` 8s timeout tight on cold CI | A (nit) | low | Bumped to 30s |
| 6 | No dev-docs note on auto-reload | C (optional) | nit | Added one line to README_WEBUI |

Out of scope (correctly flagged, not changed): the earlier `docs/reviews/...` line saying
"apps/server dev has no --watch" is now historically outdated but is an audit record and is
left as-is.

## Verification (after fixes)
- `bun build apps/server/src/index.ts` and `apps/server/src/dev.ts` both compile.
- `apps/server` tests: 16 passed.
- **Live:** editing the providers package reloads the API (`server_started` re-logged) while
  the Vite PID stays identical; SIGTERM to the orchestrator alone cleans up **both**
  children with no orphan and frees the ports.
- TDD exception: dev-tooling/orchestration change, verified by live behavior (no unit test;
  the repo has none for `dev.ts`).

## Outcome

Findings #1–#6 fixed in `f710c76`. The independent re-review then split:

- **Codex (re-check of its blocking findings):** APPROVE — handlers before `await`, exit-code
  propagation, async shutdown (grace + guard) all correct, build + tests green, no new issues.
- **Claude verifier:** found one further concurrency defect (#7 in the fix log) — a catch
  fall-through that could orphan the API when a signal races the frontend wait. Fixed by
  gating the API spawn on `if (!shuttingDown)`, then **re-reviewed APPROVE** (both the throw
  and success sub-cases close; no new TOCTOU race; normal path identical).

All findings resolved across all passes. Clear to merge.

Note on tests: `dev.ts` (startup/shutdown orchestration) has no unit test on `main` and the
race is impractical to unit-test without a process-level signal-interleaving harness; per the
fix log this is verified by live behavior (hot-reload keeps the Vite PID stable; SIGTERM to
the orchestrator leaves no orphan). Documented TDD exception for dev tooling.
