# Dashboard And Page Review — 2026-10-10

> Branch: `fix/dashboard-review-2026-10-10`
> Plan and triage: `docs/plans/2026-10-10-dashboard-review-fixes.md` (findings F1–F14)
> Fix log: `docs/fix-logs/2026-10-10-dashboard-review-fix-log.md`

## Sources

| Source | Scope | Method |
|--------|-------|--------|
| User report | Claude reset/Fable, Cursor compact card, Antigravity accounts, Allowance | Five numbered requests |
| Orchestrator (Claude Code, Opus 5.5) | Claude and Cursor data | Live `GET /api/oauth/usage` response; 500 `claude-code` snapshots from the database (read-only); headless page screenshots |
| Page review subagent (Claude, read-only) | `apps/web/src` all pages | Static review; 15 findings |
| Antigravity subagent (Claude, read-only) | Account detection, registry, plugin, Settings | Code trace; `provider_accounts` rows; token file names and key names only |
| Allowance subagent (Claude, read-only) | Allowance estimate path | Code trace; database granularity counts; 7-day alignment simulation |

## Verification Of Subagent Findings

Each finding adopted in the plan was re-checked against the cited code or data by the
orchestrator before inclusion:

- Shared records state: `apps/web/src/App.tsx:217` passes `onRecords={setRecords}`; the
  same state feeds the Dashboard.
- Dashboard limit: `App.tsx:53` loads `limit: 100`.
- Antigravity default account: `provider_accounts` has only `acct1` (enabled) and `acct2`
  (disabled); the last bare `antigravity` snapshot is 2026-08-08 (1790 rows).
- Allowance rule: `packages/providers/src/allowance-estimate.ts:300-313` and
  `packages/storage/src/sqlite-storage.ts:779-781`.
- ccusage day grouping: `bunx ccusage claude daily --help` states the default is the
  system time zone; 2026-10-09 totals are 382,279,638 (local) and 231,894,683
  (`--timezone UTC`).

## Rejected Or Changed Suggestions

- Putting the Google email in Antigravity labels and dropping the `allowedTiers[0]` plan
  fallback: rejected. Both conflict with decisions recorded in
  `docs/reviews/2026-08-08-cursor-antigravity-accounts-pr31-triple-review.md`.
- Hourly token buckets for Allowance: deferred. Day-boundary alignment produces estimates
  from existing rows without changing import paths or stored data.
- Re-importing ccusage with `--timezone UTC`: rejected. It would mix bucket semantics with
  historical local-day rows.
