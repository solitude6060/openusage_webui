# Allowance Delivery Fix Log

Date: 2026-10-01
Review: `docs/reviews/2026-10-01-allowance-delivery-review.md`

## Unexplained Historical Token Changes

The complete independent review approved production revision `193348c` but rejected the proposed live daily reimport. On the database copy, owner tokens decreased by 2,023,396,848 and model/day identities changed despite retaining all 68 dates. Cause not determined. No live write was performed.

Repair: the private operation now updates only `cost_usd` and `raw_json` in one SQLite transaction. It selects confirmed September rewrite rows through the original backup and skips later changed prices or reported-price provenance. Standard estimates use retained token components. Source-reported model prices require identical model/token fields; reported day prices require the complete day to match. No row is inserted or deleted by the price repair.

Verification: a fresh backup copy received 207 provenance updates and one price-value change, with two later changes skipped. All record identity/model/date/token fields and all non-Codex usage records retained exact hashes. Per-row fee/provenance checks and SQLite integrity check passed. The original rejected script and its output remain archived privately for audit.

Files: private `docs/reviews/2026-10-01-delivery.local/rewrite-codex.ts`, the delivery plan, review and this fix log. Production code was unchanged. The same independent reviewer approved the remediation at SHA256 `92327bc0658dd2c7ba0b95a01a8db67a482ac469ae2b7c2b8ce8624c1a6fe6cc`; this remains one reviewer lane as requested.
