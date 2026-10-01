# Allowance Delivery

Date: 2026-10-01
Status: Production and fee-only procedure approved; merge and activation pending.

## Authorization And Scope

The user authorized commit, push, pull request, a single independent review, merge, service restart and historical data correction. This supersedes the original session's local-only instruction and the usual three-review delivery gate for this request.

Deliver the existing quota-history, Allowance, shared Codex session ownership and model-cost work together with the verified repairs. Branch `fix/allowance-review-delivery` starts from the current deployed `main`, `7a0ad63`, as a correction to the running application. No worktree is needed. Preserve unrelated local agent state, generated builds, credentials and review execution artifacts outside the commit.

## Exit Criteria

1. Correct README behavior descriptions and provide before/after browser screenshots before creating the pull request.
2. Audit modified plugin fields against Rust host redaction; only numeric quota values, duration and existing percent fields were added. No new sensitive request or response field is introduced. Existing credential/identity redaction tests remain applicable.
3. Preserve the existing regression history and validation evidence. Run the full WebUI/plugin suites and build after any additional code change.
4. One fresh Coding High verifier context (GPT-6 Astra, medium) reviews the complete pull-request revision and the data correction procedure. Verify findings before repair; merge only after approval.
5. Before live writes, make a consistent SQLite backup in persistent ignored project storage. Correct only fee/provenance fields of the confirmed September price rewrite: identify rows from its original backup, skip rows changed since then, and calculate standard rates from retained token fields. Use source-reported model prices only for identical model/token records; use a reported day price only when the entire day's model/token set matches. Preserve every existing identity, model, date and token field. Startup handles confirmed sibling duplication and v2 quota replay through existing code.
6. Exercise the rewrite on a database backup first and record affected row counts, cost provenance and unchanged unrelated rows. Apply it only after merge, then restart the exact inspected user service and verify health, allowance ranges and real browser output.

## Records And Limits

Update this plan, the existing session review/fix log, README files if affected, `status.md`, `tracker.md` and `handover.md`. Keep private data, backup files and operational logs in `docs/reviews/2026-10-01-delivery.local/` with owner-only access. Screenshots show the local app only and belong under `docs/reviews/screenshots/`.

Daily aggregates cannot recover event timestamps. Standard short-context estimates do not prove billed subscription value. Historical multiple-account legacy fee ownership remains unidentified; preserve ambiguous records. Do not blanket-overwrite reported model costs from the standard-rate table.

The first independent review approved the production revision but rejected full daily reimport for live correction: current local scanning changed historical token/model totals for an undetermined reason. Fee-only remediation passed a fresh-copy preflight with zero model/token changes. The same reviewer approved this bounded remediation before live execution.
