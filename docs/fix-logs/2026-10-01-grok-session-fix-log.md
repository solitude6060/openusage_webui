# Grok Session Fix Log

Date: 2026-10-01
Review: `docs/reviews/2026-10-01-grok-session-review.md`
Source session: `01a0ede0-2615-7d43-a147-0bd50108164e`

| Issue | Repair | Regression Evidence | Files |
| --- | --- | --- | --- |
| Percent and token starts disagree | Use actual observations inside the selected range as both endpoints | Boundary fixture checks percent, tokens, API Cost and API Value | `allowance-estimate.ts`, `allowance-boundaries.test.ts` |
| Entire UTC day crosses observation/reset | Preserve daily coverage end; withhold conversion of overlapping buckets | Historical-day and reset-crossing fixtures; API test | `sqlite-storage.ts`, estimator, API types, Allowance page, provider/server tests |
| Intermediate meter fall is hidden | Inspect all measured points for decreases | 10→40→0→30 fixture rejects estimate | Estimator and boundary tests |
| Historical week qualifies later five-hour session | Restrict inferred duration evidence to the same reset timestamp | Long-to-short and long-cycle-tail fixtures | Estimator and boundary tests |
| Fractional positive movement / zero price omitted | Accept any positive movement as rough and retain known zero API Value | Half-point and zero-price fixtures | Estimator and boundary tests |
| Day price replaced by estimated model price | Allocate identifiable reported day cost before rate estimates; Codex-only rates | Single model source total, explicit zero, unknown residual and Claude provider fixtures | `structured-usage.ts`, rate tests |
| Price provenance missing | Record reported-model, reported-day or standard-rate in existing raw metadata | Known-price provenance and unknown-price fixtures | Structured importer and rate tests |
| Cursor text converted to zero/partial number | Accept complete numeric currency text only | N/A, Included, empty, invalid text, thousand separators and zero fixtures | Structured importer and `cursor-cost.test.ts` |
| Retained legacy CLI cost duplicates new model fees | Apply summary precedence for an identifiable single account; retain original rows | Both refresh orders, missing prices, zero prices and multiple-account fixtures | Storage and `cost-precedence.test.ts` |
| Copilot fixture reads ambient credentials | Explicit isolated environment/home and fake token runner | Existing test failed before repair; full suite passes after repair | `openusage-plugin-bundled-fixtures.test.ts` |
| Sampling drops evidence used by meter checks | Preserve every percent change; replay existing snapshots with v2 marker | Three failing refresh/replay fixtures then ten passing focused tests | `quota-observations.ts`, `quota-history.ts`, provider/server tests |

Validation: 326 WebUI tests, 259 affected plugin tests, TypeScript/Vite frontend build, Bun server build, and diff whitespace checks passed. Logs, source hashes and independent review outputs are under the ignored persistent `docs/reviews/2026-10-01-grok-session.local/` directory.

Independent review: Grok 4.7 Build, Gemini 3.8 Flash and a fresh GPT-6.1 Sol verifier returned APPROVE for content identity `089936dc7e7a2ac80a9fb99a0541bdb17f892db16a92c37bfeccf20a32f6a960`. Final file hashes were recomputed with no differences. See the linked review for process identities, the Sol fallback and reviewer verification limits.

Limits: multiple-account legacy ownership is not identifiable from old rows; retain ambiguous source costs. Daily aggregates lack finer timestamps and many spans are therefore unconvertible. Existing live database prices were not rewritten. No commit, push, pull request, or service restart was performed.
